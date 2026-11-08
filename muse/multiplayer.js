// Multiplayer for Muse over Firebase Realtime Database.
//
// Each player signs in anonymously and keeps one record at
//   rooms/{room}/players/{uid} = { name, instrument, t, pointers: { "0".."4": { x, y, down } } }
// with x and y normalized to 0..1, so screens of any size line up.
// Everyone listens to the room and plays the other players' notes locally.
// Everyone in a room also keeps rooms/{room}/members/{uid} = { name, joined }.
// Sorting members by join time gives every client the same queue: the first
// MAX_PLAYERS play, the rest watch, and when a player leaves the next watcher
// moves up. Only players write cursor data, so a watcher downloads at most
// MAX_PLAYERS cursor streams however big the crowd gets.
// lobby/{room}/{uid} = "play" | "watch" lets the start screen list rooms
// without downloading anyone's cursors.
// database.rules.json (repo root) only lets a player write their own records.
//
// Multiplayer stays off until muse/firebase-config.js exports a config.

import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/13.2.0";
const SEND_INTERVAL_MS = 66; // about 15 updates a second
const JOIN_TIMEOUT_MS = 6000; // give up and play solo if Firebase is unreachable
export const MAX_SLOTS = 5;
export const MAX_PLAYERS = 8;

// Room names: lowercase letters, digits and dashes, at most 32 characters.
export function cleanRoom(raw) {
	const room = String(raw).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 32);
	return room || "lobby";
}

export function roomFromHash() {
	let raw = location.hash.slice(1);
	try {
		raw = decodeURIComponent(raw);
	} catch {
		// malformed escapes like "#%": just use the raw text
	}
	return cleanRoom(raw);
}

// Local testing against the Firebase emulators: app.html?emulator on localhost.
function emulatorMode() {
	const local = ["localhost", "127.0.0.1"].includes(location.hostname);
	return local && new URLSearchParams(location.search).has("emulator");
}

function activeConfig() {
	const emulator = emulatorMode();
	const config = emulator
		? { apiKey: "demo-key", projectId: "demo-muse", databaseURL: "http://127.0.0.1:9000/?ns=demo-muse" }
		: firebaseConfig;
	return config ? { config, emulator } : null;
}

// Loads the SDK and signs in once; the room list and joinRoom share it.
let firebasePromise = null;
function firebase() {
	firebasePromise ??= (async () => {
		const { config, emulator } = activeConfig();
		const [{ initializeApp }, auth, db] = await Promise.all([
			import(`${SDK}/firebase-app.js`),
			import(`${SDK}/firebase-auth.js`),
			import(`${SDK}/firebase-database.js`),
		]);
		const app = initializeApp(config);
		const authInstance = auth.getAuth(app);
		const database = db.getDatabase(app);
		if (emulator) {
			auth.connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
			db.connectDatabaseEmulator(database, "127.0.0.1", 9000);
		}
		const { user } = await auth.signInAnonymously(authInstance);
		return { db, database, uid: user.uid };
	})();
	firebasePromise.catch(() => { firebasePromise = null; }); // allow a retry
	return firebasePromise;
}

/**
 * Calls onRooms([{ room, players, watchers }]) with the active rooms, busiest first,
 * whenever they change. Does nothing when multiplayer is off or unreachable.
 * Returns a function that stops watching.
 */
export function watchRooms(onRooms) {
	if (!activeConfig()) return () => {};
	let stop = () => {};
	let stopped = false;
	firebase().then(({ db, database }) => {
		if (stopped) return;
		stop = db.onValue(db.ref(database, "lobby"), (snap) => {
			const rooms = [];
			snap.forEach((child) => {
				let watchers = 0;
				child.forEach((m) => {
					if (m.val() === "watch") watchers++;
				});
				rooms.push({ room: child.key, players: child.size - watchers, watchers });
			});
			rooms.sort((a, b) => b.players + b.watchers - a.players - a.watchers || a.room.localeCompare(b.room));
			onRooms(rooms);
		}, (err) => console.warn("Muse: couldn't list rooms", err));
	}).catch((err) => console.warn("Muse: multiplayer unavailable", err));
	return () => {
		stopped = true;
		stop();
	};
}

/**
 * Joins a room. Returns null when multiplayer isn't configured or can't connect.
 * onPlayers(map) is called with { uid: { name, instrument, pointers } } for the other players.
 * onRoom({ role, place, players, watchers }) is called when the queue changes:
 * role is "play" or "watch", and place is the watcher's spot in line (1 = next).
 */
export async function joinRoom({ room, name, onPlayers, onRoom, onStatus }) {
	if (!activeConfig()) return null;

	let timedOut = false;
	const timeout = new Promise((resolve) => setTimeout(() => {
		timedOut = true;
		resolve(null);
	}, JOIN_TIMEOUT_MS));
	return Promise.race([connect({ room, name, onPlayers, onRoom, onStatus }, () => timedOut), timeout])
		.then((session) => {
			if (!session) onStatus?.("offline");
			return session;
		});
}

async function connect({ room, name, onPlayers, onRoom, onStatus }, gaveUp) {
	try {
		const { db, database, uid } = await firebase();
		if (gaveUp()) return null; // too slow; the player is already playing solo
		const roomRef = db.ref(database, `rooms/${room}/players`);
		const meRef = db.ref(database, `rooms/${room}/players/${uid}`);
		const lobbyRef = db.ref(database, `lobby/${room}/${uid}`);
		const memberRef = db.ref(database, `rooms/${room}/members/${uid}`);
		let role = null; // unknown until our place in the queue is confirmed
		let confirmed = false; // our member record (with its real server join time) exists
		let online = false;
		let members = [];

		db.onValue(roomRef, (snap) => {
			const others = {};
			snap.forEach((child) => {
				if (child.key !== uid) others[child.key] = child.val();
			});
			onPlayers(others);
		}, (err) => {
			console.warn("Muse: lost the room", err);
			onStatus?.("offline");
		});

		let pending = null;
		let lastSent = "";
		let timer = null;

		// Joining the queue is a transaction so the answer comes from the server,
		// not a cache: it keeps our record (and place in line) after a short blip,
		// and adds a fresh one after a real drop removed it. Until it commits we
		// stay out of the queue, so an estimated join time can't jump the line.
		let joining = false;
		function ensureMember() {
			if (joining) return;
			joining = true;
			db.runTransaction(memberRef, (current) => current ?? { name, joined: db.serverTimestamp() })
				.then(() => {
					confirmed = true;
					updateRole();
				})
				.catch((err) => console.warn("Muse: couldn't join the queue", err))
				.finally(() => { joining = false; });
		}

		// The queue: oldest members play, everyone else watches in join order.
		function updateRole() {
			if (!confirmed) return;
			const index = members.findIndex((m) => m.uid === uid);
			if (index === -1) {
				// Our record vanished (say, a drop we haven't noticed yet): rejoin.
				confirmed = false;
				if (online) ensureMember();
				return;
			}
			const next = index < MAX_PLAYERS ? "play" : "watch";
			if (next !== role) {
				role = next;
				db.set(lobbyRef, role).catch((err) => console.warn("Muse: couldn't list the room", err));
				if (role === "play") {
					lastSent = "";
					if (pending && !timer) timer = setTimeout(flush, 0);
				} else {
					db.remove(meRef).catch((err) => console.warn("Muse: couldn't step back", err));
				}
			}
			onRoom?.({
				role,
				place: role === "watch" ? index - MAX_PLAYERS + 1 : 0,
				players: Math.min(members.length, MAX_PLAYERS),
				watchers: Math.max(0, members.length - MAX_PLAYERS),
			});
		}

		db.onValue(db.ref(database, `rooms/${room}/members`), (snap) => {
			members = [];
			snap.forEach((child) => {
				const joined = child.child("joined").val();
				members.push({ uid: child.key, joined: typeof joined === "number" ? joined : Infinity });
			});
			members.sort((a, b) => a.joined - b.joined || (a.uid < b.uid ? -1 : 1));
			updateRole();
		}, (err) => console.warn("Muse: lost the queue", err));

		// onDisconnect is one-shot, so re-arm it (and resend our state) after
		// every reconnect; otherwise a dropped player could linger in the room.
		db.onValue(db.ref(database, ".info/connected"), (snap) => {
			online = snap.val() === true;
			onStatus?.(online ? "online" : "offline");
			if (online) {
				db.onDisconnect(meRef).remove().catch((err) => console.warn("Muse: onDisconnect failed", err));
				db.onDisconnect(lobbyRef).remove().catch((err) => console.warn("Muse: onDisconnect failed", err));
				db.onDisconnect(memberRef).remove().catch((err) => console.warn("Muse: onDisconnect failed", err));
				ensureMember();
				// A drop may have cleared our lobby entry; restore it once the role is known.
				if (role) db.set(lobbyRef, role).catch((err) => console.warn("Muse: couldn't list the room", err));
				lastSent = "";
				if (pending && !timer) timer = setTimeout(flush, 0);
			}
		});

		function flush() {
			timer = null;
			if (!pending || role !== "play") return; // watchers don't send cursors
			const json = JSON.stringify(pending);
			if (json === lastSent) return;
			lastSent = json;
			db.set(meRef, { ...pending, t: db.serverTimestamp() }).catch((err) => {
				console.warn("Muse: couldn't send", err);
			});
		}

		return {
			uid,
			room,
			// state: { instrument, pointers: { slot: { x, y, down } } }
			update(state) {
				pending = { name, instrument: state.instrument, pointers: state.pointers };
				if (!timer) timer = setTimeout(flush, SEND_INTERVAL_MS);
			},
			get role() {
				return role;
			},
			leave() {
				db.remove(meRef);
				db.remove(lobbyRef);
				db.remove(memberRef);
			},
		};
	} catch (err) {
		console.warn("Muse: multiplayer unavailable, playing solo", err);
		return null;
	}
}
