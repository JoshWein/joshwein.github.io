// Multiplayer for Muse over Firebase Realtime Database.
//
// Each player signs in anonymously and keeps one record at
//   rooms/{room}/players/{uid} = { name, instrument, t, pointers: { "0".."4": { x, y, down } } }
// with x and y normalized to 0..1, so screens of any size line up.
// Everyone listens to the room and plays the other players' notes locally.
// database.rules.json (repo root) only lets a player write their own record.
//
// Multiplayer stays off until muse/firebase-config.js exports a config.

import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/13.2.0";
const SEND_INTERVAL_MS = 66; // about 15 updates a second
const JOIN_TIMEOUT_MS = 6000; // give up and play solo if Firebase is unreachable
export const MAX_SLOTS = 5;

export function roomFromHash() {
	let raw = location.hash.slice(1);
	try {
		raw = decodeURIComponent(raw);
	} catch {
		// malformed escapes like "#%": just use the raw text
	}
	const room = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
	return room || "lobby";
}

// Local testing against the Firebase emulators: app.html?emulator on localhost.
function emulatorMode() {
	const local = ["localhost", "127.0.0.1"].includes(location.hostname);
	return local && new URLSearchParams(location.search).has("emulator");
}

/**
 * Joins a room. Returns null when multiplayer isn't configured or can't connect.
 * onPlayers(map) is called with { uid: { name, instrument, pointers } } for everyone else.
 */
export async function joinRoom({ room, name, onPlayers, onStatus }) {
	const emulator = emulatorMode();
	const config = emulator
		? { apiKey: "demo-key", projectId: "demo-muse", databaseURL: "http://127.0.0.1:9000/?ns=demo-muse" }
		: firebaseConfig;
	if (!config) return null;

	let timedOut = false;
	const timeout = new Promise((resolve) => setTimeout(() => {
		timedOut = true;
		resolve(null);
	}, JOIN_TIMEOUT_MS));
	return Promise.race([connect(config, emulator, { room, name, onPlayers, onStatus }, () => timedOut), timeout])
		.then((session) => {
			if (!session) onStatus?.("offline");
			return session;
		});
}

async function connect(config, emulator, { room, name, onPlayers, onStatus }, gaveUp) {
	try {
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
		if (gaveUp()) return null; // too slow; the player is already playing solo
		const uid = user.uid;
		const roomRef = db.ref(database, `rooms/${room}/players`);
		const meRef = db.ref(database, `rooms/${room}/players/${uid}`);

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

		// onDisconnect is one-shot, so re-arm it (and resend our state) after
		// every reconnect; otherwise a dropped player could linger in the room.
		db.onValue(db.ref(database, ".info/connected"), (snap) => {
			const online = snap.val() === true;
			onStatus?.(online ? "online" : "offline");
			if (online) {
				db.onDisconnect(meRef).remove().catch((err) => console.warn("Muse: onDisconnect failed", err));
				lastSent = "";
				if (pending && !timer) timer = setTimeout(flush, 0);
			}
		});

		function flush() {
			timer = null;
			if (!pending) return;
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
			leave() {
				db.remove(meRef);
			},
		};
	} catch (err) {
		console.warn("Muse: multiplayer unavailable, playing solo", err);
		return null;
	}
}
