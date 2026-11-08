// Muse: press and drag on the canvas to play.
// Height picks one of 16 notes, left to right sets the volume.
// Every pointer (mouse, pen, each finger) gets its own cursor and voice.
// Other players in the same room (see multiplayer.js) show up as cursors too.

import { joinRoom, roomFromHash, MAX_SLOTS } from "./multiplayer.js";

const NOTES = 16;
const TEMPO_MS = 125; // a held note retriggers on this beat, like the original
const RELEASE_MS = 120;

const INSTRUMENTS = [
	{ name: "Instrument 1", color: "#A44444" },
	{ name: "Instrument 2", color: "#00FFB8" },
	{ name: "Instrument 3", color: "#700FD3" },
	{ name: "Instrument 4", color: "#10F043" },
	{ name: "Instrument 5", color: "#5a7a9e" },
	{ name: "Instrument 6", color: "#FFFF99" },
	{ name: "Instrument 7", color: "#FFAF99" },
	{ name: "Instrument 8", color: "#FF2B99" },
];

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const hint = document.getElementById("hint");

let username = "MuseMan";
let current = Math.floor(Math.random() * INSTRUMENTS.length);
let playing = false;
let session = null; // multiplayer session, or null when solo

// sounds[instrument][lane]; lane 0 is the top of the canvas (note16, the highest)
const sounds = [];
let loaded = 0;
let failed = 0;
const total = INSTRUMENTS.length * NOTES;
let resolveLoaded;
const allLoaded = new Promise((resolve) => (resolveLoaded = resolve));

function onSoundSettled() {
	if (loaded + failed === total) resolveLoaded();
	if (!playing && statusEl.dataset.waiting) {
		statusEl.textContent = `Loading sounds ${loaded}/${total}`;
	}
}

function loadSounds() {
	INSTRUMENTS.forEach((_, i) => {
		sounds.push([]);
		for (let note = NOTES; note >= 1; note--) {
			sounds[i].push(new Howl({
				src: [`instruments/ins${i + 1}/note${note}.mp3`],
				preload: true,
				onload() { loaded++; onSoundSettled(); },
				onloaderror(_id, err) { failed++; console.warn("Muse: sound failed to load", err); onSoundSettled(); },
			}));
		}
	});
}

/* ---------- instrument picker ---------- */

const picker = document.querySelector(".instruments");
const buttons = INSTRUMENTS.map((inst, i) => {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "ins";
	b.setAttribute("role", "radio");
	b.setAttribute("aria-label", `${inst.name} (key ${i + 1})`);
	b.title = `${inst.name} (key ${i + 1})`;
	b.style.setProperty("--swatch", inst.color);
	b.addEventListener("click", () => selectInstrument(i));
	picker.appendChild(b);
	return b;
});

function selectInstrument(i) {
	current = i;
	publish(); // no-op until a multiplayer session exists
	buttons.forEach((b, j) => {
		b.setAttribute("aria-checked", String(j === i));
		b.tabIndex = j === i ? 0 : -1;
	});
}
selectInstrument(current);

picker.addEventListener("keydown", (e) => {
	const n = INSTRUMENTS.length;
	const next = {
		ArrowRight: current + 1, ArrowDown: current + 1,
		ArrowLeft: current - 1, ArrowUp: current - 1,
		Home: 0, End: n - 1,
	}[e.key];
	if (next === undefined) return;
	selectInstrument((next + n) % n);
	buttons[current].focus();
	e.preventDefault();
});

window.addEventListener("keydown", (e) => {
	if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
	const n = Number(e.key);
	if (n >= 1 && n <= INSTRUMENTS.length) selectInstrument(n - 1);
});

/* ---------- canvas sizing ---------- */

let width = 0;
let height = 0;

function resize() {
	const rect = canvas.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	width = rect.width;
	height = rect.height;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(canvas);

/* ---------- pointers and voices ---------- */

// pointerId -> { x, y, down, lane, instrument, voices, pulse, trail, type }
const pointers = new Map();

const laneFor = (y) => Math.min(NOTES - 1, Math.max(0, Math.floor((y / height) * NOTES)));
const volumeFor = (x) => Math.min(1, Math.max(0.05, x / width));

function pointerState(e) {
	let p = pointers.get(e.pointerId);
	if (!p) {
		p = { x: 0, y: 0, down: false, lane: -1, voices: [], pulse: 0, trail: [], type: e.pointerType, slot: freeSlot() };
		pointers.set(e.pointerId, p);
	}
	const rect = canvas.getBoundingClientRect();
	p.x = e.clientX - rect.left;
	p.y = e.clientY - rect.top;
	return p;
}

function freeSlot() {
	const used = new Set([...pointers.values()].map((p) => p.slot));
	for (let i = 0; i < MAX_SLOTS; i++) if (!used.has(i)) return i;
	return null; // more fingers than slots: still plays locally, just isn't shared
}

// Sends this player's pointers to the room (throttled in multiplayer.js).
function publish() {
	if (!session || !width || !height) return;
	const shared = {};
	for (const p of pointers.values()) {
		if (p.slot === null) continue;
		shared[p.slot] = {
			x: Math.min(1, Math.max(0, p.x / width)),
			y: Math.min(1, Math.max(0, p.y / height)),
			down: p.down,
		};
	}
	session.update({ instrument: current, pointers: shared });
}

/* ---------- other players ---------- */

// "uid:slot" -> pointer-shaped object (nx, ny normalized; x, y derived)
const remotes = new Map();

function applyRemotePlayers(players) {
	const seen = new Set();
	for (const [uid, player] of Object.entries(players)) {
		const instrument = Number.isInteger(player.instrument) ? player.instrument : 0;
		const ptrs = player.pointers && typeof player.pointers === "object" ? player.pointers : {};
		for (const [slot, ptr] of Object.entries(ptrs)) {
			if (!ptr || !Number.isFinite(ptr.x) || !Number.isFinite(ptr.y)) continue;
			const key = `${uid}:${slot}`;
			seen.add(key);
			let p = remotes.get(key);
			if (!p) {
				p = { nx: 0, ny: 0, x: 0, y: 0, down: false, lane: -1, voices: [], pulse: 0, trail: [], remote: true };
				remotes.set(key, p);
			}
			p.name = String(player.name || "?").slice(0, 20);
			p.nx = ptr.x;
			p.ny = ptr.y;
			placeRemote(p);
			const wasDown = p.down;
			p.down = ptr.down === true;
			if (p.down) p.trail.push({ x: p.x, y: p.y, t: performance.now() });
			const lane = laneFor(p.y);
			if (p.down && (!wasDown || lane !== p.lane || instrument !== p.instrument)) {
				releaseVoice(p);
				p.instrument = instrument;
				p.lane = lane;
				if (playing) playVoice(p);
			} else if (!p.down && wasDown) {
				releaseVoice(p);
			} else if (p.down) {
				setVoicesVolume(p);
			}
			p.instrument = instrument;
		}
	}
	for (const [key, p] of remotes) {
		if (!seen.has(key)) {
			releaseVoice(p);
			remotes.delete(key);
		}
	}
	updatePresence(Object.keys(players).length);
}

function placeRemote(p) {
	p.x = p.nx * width;
	p.y = p.ny * height;
}

const presence = document.getElementById("presence");
function updatePresence(others) {
	if (!session) return;
	presence.hidden = false;
	presence.textContent = others === 0
		? `room ${session.room}: just you`
		: `room ${session.room}: ${others + 1} playing`;
}

// Each pointer keeps the voices it started (a held note retriggers, so
// several overlap) so volume changes and releases reach all of them.
function playVoice(p) {
	const howl = sounds[p.instrument][p.lane];
	if (howl.state() !== "loaded") return; // failed sound: stay silent, don't queue
	const id = howl.play();
	howl.volume(volumeFor(p.x), id);
	p.voices = p.voices.filter((v) => v.howl.playing(v.id));
	p.voices.push({ howl, id });
}

function setVoicesVolume(p) {
	const vol = volumeFor(p.x);
	for (const v of p.voices) v.howl.volume(vol, v.id);
}

function releaseVoice(p) {
	for (const { howl, id } of p.voices) {
		if (!howl.playing(id)) continue;
		howl.fade(howl.volume(id), 0, RELEASE_MS, id);
		howl.once("fade", () => howl.stop(id), id);
	}
	p.voices = [];
}

canvas.addEventListener("pointerdown", (e) => {
	if (!playing) return;
	canvas.setPointerCapture(e.pointerId);
	const p = pointerState(e);
	p.down = true;
	p.instrument = current;
	p.lane = laneFor(p.y);
	p.pulse = 0;
	playVoice(p);
	hint.classList.add("gone");
	publish();
});

canvas.addEventListener("pointermove", (e) => {
	const p = pointerState(e);
	if (p.down) {
		p.trail.push({ x: p.x, y: p.y, t: performance.now() });
		const lane = laneFor(p.y);
		if (lane !== p.lane) {
			releaseVoice(p);
			p.lane = lane;
			playVoice(p);
		} else {
			setVoicesVolume(p);
		}
	}
	publish();
});

function endPointer(e) {
	const p = pointers.get(e.pointerId);
	if (!p) return;
	releaseVoice(p);
	p.down = false;
	// Touch and pen cursors vanish when lifted; the mouse cursor stays visible.
	if (e.type !== "pointerup" || p.type !== "mouse") pointers.delete(e.pointerId);
	publish();
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (e) => {
	if (!pointers.get(e.pointerId)?.down) {
		pointers.delete(e.pointerId);
		publish();
	}
});

// The beat: a held note retriggers every TEMPO_MS.
setInterval(() => {
	for (const p of pointers.values()) {
		if (p.down) playVoice(p);
	}
	if (!playing) return;
	for (const p of remotes.values()) {
		if (p.down && p.lane >= 0) playVoice(p);
	}
}, TEMPO_MS);

/* ---------- drawing ---------- */

function draw(now) {
	ctx.clearRect(0, 0, width, height);
	const laneH = height / NOTES;

	for (const p of remotes.values()) placeRemote(p);
	const everyone = [...remotes.values(), ...pointers.values()];

	// lanes held right now
	for (const p of everyone) {
		if (!p.down) continue;
		ctx.fillStyle = INSTRUMENTS[p.instrument].color + "22";
		ctx.fillRect(0, p.lane * laneH, width, laneH);
	}

	// pitch lines
	ctx.strokeStyle = "rgba(237, 255, 255, 0.08)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let i = 1; i < NOTES; i++) {
		const y = Math.round(i * laneH) + 0.5;
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
	}
	ctx.stroke();

	for (const p of everyone) {
		const color = INSTRUMENTS[p.down || p.remote ? p.instrument ?? 0 : current].color;

		// trail
		p.trail = p.trail.filter((pt) => now - pt.t < 600);
		if (p.trail.length > 1) {
			ctx.strokeStyle = color;
			ctx.lineCap = "round";
			for (let i = 1; i < p.trail.length; i++) {
				const a = p.trail[i - 1];
				const b = p.trail[i];
				ctx.globalAlpha = 1 - (now - b.t) / 600;
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}

		// cursor: a square that pulses while held
		const size = 20;
		if (p.down) p.pulse = (p.pulse + 0.25) % (Math.PI * 2);
		ctx.lineWidth = p.down ? 2 + 6 * (0.5 + 0.5 * Math.sin(p.pulse)) : 1.5;
		ctx.strokeStyle = color;
		ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);

		ctx.fillStyle = "#dfe6e2";
		ctx.font = '12px "IBM Plex Mono", monospace';
		ctx.fillText(p.remote ? p.name : username, p.x + size / 2 + 6, p.y + 4);
	}

	requestAnimationFrame(draw);
}

/* ---------- start ---------- */

document.getElementById("join").addEventListener("submit", async (e) => {
	e.preventDefault();
	username = document.getElementById("username").value.trim() || "MuseMan";
	const start = document.getElementById("start");
	start.disabled = true;

	// Browsers keep audio locked until a user gesture; this click is one.
	if (Howler.ctx && Howler.ctx.state === "suspended") Howler.ctx.resume();

	if (loaded + failed < total) {
		statusEl.dataset.waiting = "1";
		statusEl.textContent = `Loading sounds ${loaded}/${total}`;
		await allLoaded;
	}
	if (failed > 0) {
		hint.textContent = `${failed} of ${total} sounds failed to load, so some notes will be silent. Try reloading.`;
	}

	statusEl.textContent = "Joining the room...";
	session = await joinRoom({
		room: roomFromHash(),
		name: username,
		onPlayers: applyRemotePlayers,
		onStatus: (s) => presence.classList.toggle("offline", s === "offline"),
	});
	if (session) {
		updatePresence(0);
		publish();
	}

	playing = true;
	const intro = document.getElementById("intro");
	intro.classList.add("hidden");
	intro.inert = true;
	document.querySelector(".bar").inert = false;
	document.querySelector(".stage").inert = false;
	buttons[current].focus();
});

// While the intro is open, only the intro is reachable.
document.querySelector(".bar").inert = true;
document.querySelector(".stage").inert = true;

// A different room in the URL means a different session; start fresh.
window.addEventListener("hashchange", () => {
	if (session) location.reload();
});

loadSounds();
resize();
requestAnimationFrame(draw);
