// Muse: press and drag on the canvas to play.
// Height picks one of 16 notes, left to right sets the volume.
// Every pointer (mouse, pen, each finger) gets its own cursor and voice.
// Other players in the same room (see multiplayer.js) show up as cursors too.

import { startViz, stopViz, vizNote } from "./viz.js";
import { synthVoice } from "./synth.js";
import { joinRoom, roomFromHash, cleanRoom, watchRooms, roomTime, MAX_SLOTS, MAX_PLAYERS } from "./multiplayer.js";
import { LOOP_STEPS, Recorder, encodeLoop, decodeLoop, byStep } from "./loop.js";
import { KEYS, SCALES, DEFAULT_SETTINGS, cleanSettings, pitchFor, targetMidi } from "./scales.js";

const NOTES = 16;
const TEMPO_MS = 125; // a held note retriggers on this beat (16th notes at 120 BPM), shared by the room
const RELEASE_MS = 120;

// Names and icons describe how each sound behaves (picked by ear and from
// its spectrum: pitch, brightness, attack); the files are just ins1..ins8.
const INSTRUMENTS = [
	{ name: "Bass", color: "#A44444", icon: "M3 16 9 8v8l6-8v8l6-8" },
	{ name: "Shimmer", color: "#00FFB8", icon: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" },
	{ name: "Pad", color: "#700FD3", icon: "M2 9.5c3-4 6-4 10 0s7 4 10 0M2 15.5c3-4 6-4 10 0s7 4 10 0" },
	{ name: "Tone", color: "#10F043", icon: "M2 12c2.5-7 7.5-7 10 0s7.5 7 10 0" },
	{ name: "Breath", color: "#5a7a9e", icon: "M3 9h10a3 3 0 1 0-3-3M3 15h14a3 3 0 1 1-3 3" },
	{ name: "Warm", color: "#FFFF99", icon: "M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10M12 2v2m0 16v2M2 12h2m16 0h2" },
	{ name: "Pluck", color: "#FFAF99", icon: "M2 12h7l2-6 2 12 2-6h7" },
	{ name: "Lead", color: "#FF2B99", icon: "M3 16V8h6v8h6V8h6" },
	// Synthesized in synth.js. Indexes are shared with the room, so only append.
	{ name: "Drums", synth: "drums", color: "#F0A030", icon: "M4 9c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3m0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V9M9 3l3 5m3-5-3 5" },
	{ name: "Piano", synth: "piano", color: "#E8E2D0", icon: "M3 5h18v14H3zM8 5v14m5-14v14m5-14v14M6 5v7m4-7v7m5-7v7" },
	{ name: "Marimba", synth: "marimba", color: "#B8733E", icon: "M3 6h3v12H3zm5 2h3v8H8zm5 1h3v6h-3zm5 1h3v4h-3z" },
	{ name: "Strings", synth: "strings", color: "#4FA3E0", icon: "M5 3v18m4.5-18c-1 6 1 12 0 18M14.5 3c1 6-1 12 0 18M19 3v18" },
	{ name: "Synth", synth: "synth", color: "#E05AD8", icon: "M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16m0 8 4-5M4 21h16" },
];
const SAMPLED = INSTRUMENTS.filter((inst) => !inst.synth).length;

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
const total = SAMPLED * NOTES;
let resolveLoaded;
const allLoaded = new Promise((resolve) => (resolveLoaded = resolve));

function onSoundSettled() {
	if (loaded + failed === total) resolveLoaded();
	if (!playing && statusEl.dataset.waiting) {
		statusEl.textContent = `Loading sounds ${loaded}/${total}`;
	}
}

function loadSounds() {
	INSTRUMENTS.slice(0, SAMPLED).forEach((_, i) => {
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

// The instrument's color as pen ink: same hue, dark enough to read on paper.
function penFor(hex) {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
	}
	const l = (max + min) / 2;
	const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
	return `hsl(${Math.round((h * 60 + 360) % 360)} ${Math.round(Math.min(Math.max(sat, 0.25), 0.7) * 100)}% ${Math.round(Math.min(l, 0.32) * 100)}%)`;
}
const PENS = INSTRUMENTS.map((inst) => penFor(inst.color));
const PEN_HEX = INSTRUMENTS.map((_, i) => {
	// the visualizer wants hex; let the browser convert the hsl
	const c = document.createElement("canvas").getContext("2d");
	c.fillStyle = PENS[i];
	return c.fillStyle;
});
const buttons = INSTRUMENTS.map((inst, i) => {
	const b = document.createElement("button");
	b.type = "button";
	b.className = "ins";
	b.setAttribute("role", "radio");
	const key = i < 10 ? ` (key ${(i + 1) % 10})` : "";
	b.setAttribute("aria-label", `${inst.name}${key}`);
	b.title = `${inst.name}${key}`;
	const num = i < 10 ? `<span class="n" aria-hidden="true">${(i + 1) % 10}</span>` : "";
	b.innerHTML = `${num}${inst.name.toLowerCase()}`;
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
	// 1-9 and 0 pick the first ten; [ and ] step through all of them.
	const count = INSTRUMENTS.length;
	if (e.key === "[" || e.key === "]") {
		selectInstrument((current + (e.key === "]" ? 1 : -1) + count) % count);
		return;
	}
	if (!/^[0-9]$/.test(e.key)) return;
	const n = e.key === "0" ? 10 : Number(e.key);
	if (n <= count) selectInstrument(n - 1);
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
		// An index this version doesn't know (a newer client) falls back to the first sound.
		const instrument = Number.isInteger(player.instrument) && INSTRUMENTS[player.instrument] ? player.instrument : 0;
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
}

function placeRemote(p) {
	p.x = p.nx * width;
	p.y = p.ny * height;
}

const presence = document.getElementById("presence");
let roomState = { role: "play", place: 0, players: 1, watchers: 0 };

function updatePresence() {
	if (!session) return;
	const { role, place, players, watchers } = roomState;
	let text = players <= 1 && watchers === 0
		? `room ${session.room}: just you`
		: `room ${session.room}: ${players}/${MAX_PLAYERS} playing`;
	if (watchers > 0) text += `, ${watchers} watching`;
	if (role === "watch") text += ` (you're #${place} in line)`;
	presence.hidden = false;
	presence.textContent = text;
}

// The room is full: watch and listen until a spot opens, then play.
function applyRoom(state) {
	const was = roomState.role;
	roomState = state;
	if (state.role === "watch") {
		for (const p of pointers.values()) {
			releaseVoice(p);
			p.down = false;
		}
		hint.classList.remove("gone");
		hint.textContent = `This room is full (${MAX_PLAYERS} players). You're watching, #${state.place} in line, and you'll start playing as soon as a spot opens.`;
	} else if (was === "watch") {
		hint.classList.remove("gone");
		hint.textContent = "A spot opened up. You're playing now!";
	}
	canvas.classList.toggle("watching", state.role === "watch");
	keySelect.disabled = scaleSelect.disabled = state.role === "watch"; // players set the scale
	if (state.role === "watch") recorder.cancel();
	updateLoopUI();
	updatePresence();
}

// Each pointer keeps the voices it started (a held note retriggers, so
// several overlap) so volume changes and releases reach all of them.
// A voice is { setVolume, release, playing }, whether it's a sample or synthesized.
function playVoice(p) {
	const inst = INSTRUMENTS[p.instrument];
	p.lastPlay = performance.now();
	const volume = volumeFor(p.x);
	const voice = inst.synth ? synthNote(inst.synth, p.lane, volume) : sampleNote(p.instrument, p.lane, volume);
	if (!voice) return;
	vizNote(p.x / width, p.y / height, PEN_HEX[p.instrument], volume);
	p.voices = p.voices.filter((v) => v.playing());
	p.voices.push(voice);
}

// Samples are C pentatonic; other keys and scales play the nearest one at a nudged rate.
function sampleNote(instrument, lane, volume) {
	const { sampleLane, rate } = pitchFor(lane, settings);
	const howl = sounds[instrument][sampleLane];
	if (howl.state() !== "loaded") return null; // failed sound: stay silent, don't queue
	const id = howl.play();
	if (rate !== 1) howl.rate(rate, id);
	howl.volume(volume, id);
	return {
		setVolume: (v) => howl.volume(v, id),
		playing: () => howl.playing(id),
		release() {
			if (!howl.playing(id)) return;
			howl.fade(howl.volume(id), 0, RELEASE_MS, id);
			howl.once("fade", () => howl.stop(id), id);
		},
	};
}

// Synth voices join Howler's master gain, so the mute state and the visualizer's analyser cover them too.
function synthNote(kind, lane, volume) {
	if (!Howler.ctx || !Howler.masterGain) return null;
	// Howler suspends the context after ~30s without a Howl playing and only wakes it for Howls.
	if (Howler.ctx.state !== "running") Howler.ctx.resume();
	// Melodic synths follow the room's key and scale; drums stay one sound per lane.
	const midi = kind === "drums" ? undefined : targetMidi(lane, settings);
	return synthVoice(Howler.ctx, Howler.masterGain, { instrument: kind, lane, midi, volume });
}

function setVoicesVolume(p) {
	const vol = volumeFor(p.x);
	for (const v of p.voices) v.setVolume(vol);
}

function releaseVoice(p) {
	for (const v of p.voices) v.release();
	p.voices = [];
}

canvas.addEventListener("pointerdown", (e) => {
	if (!playing || roomState.role === "watch") return;
	canvas.setPointerCapture(e.pointerId);
	const p = pointerState(e);
	p.down = true;
	p.instrument = current;
	p.lane = laneFor(p.y);
	taps.push(heldNote(p)); // a quick tap between beats still lands in a recording
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

// The beat: a held note retriggers every TEMPO_MS, on boundaries of the
// shared room clock, so everyone's held notes land together. A note that
// was just struck skips the next beat instead of doubling up.
function retrigger(p) {
	if (performance.now() - (p.lastPlay ?? 0) > TEMPO_MS / 2) playVoice(p);
}
function beat() {
	scheduleBeat(); // first, so one bad voice can't stop the beat
	const tick = Math.floor(roomTime() / TEMPO_MS);
	for (const p of pointers.values()) {
		if (p.down) retrigger(p);
	}
	if (playing) {
		for (const p of remotes.values()) {
			if (p.down && p.lane >= 0) retrigger(p);
		}
		loopBeat(tick);
	}
}
function scheduleBeat() {
	const t = roomTime();
	setTimeout(beat, TEMPO_MS - (t % TEMPO_MS) + 1);
}
scheduleBeat();

/* ---------- loops ---------- */

// Record two bars of what you play; it then repeats on the room's beat, and
// everyone in the room hears it. Loops can also be shared as a link.
const recorder = new Recorder();
let taps = [];
let myLoop = []; // notes
let mySteps = byStep([]);
let loopOn = false;
const remoteLoops = new Map(); // uid -> notes by step
const recBtn = document.getElementById("rec");
const loopBtn = document.getElementById("loop-play");
const shareBtn = document.getElementById("loop-share");
const clearBtn = document.getElementById("loop-clear");

function heldNote(p) {
	return { lane: p.lane, instrument: p.instrument, vol: Math.round(volumeFor(p.x) * 9) };
}

function playLoopNote(n) {
	if (!width || !height) return; // canvas hidden: nothing to place the note on
	const v = Math.max(n.vol / 9, 0.05);
	const p = { x: v * width, y: (n.lane + 0.5) * (height / NOTES), lane: n.lane, instrument: n.instrument, voices: [] };
	playVoice(p);
	setTimeout(() => releaseVoice(p), TEMPO_MS * 2);
}

function loopBeat(tick) {
	const step = tick % LOOP_STEPS;
	const held = [...taps];
	taps = [];
	for (const p of pointers.values()) {
		if (p.down) held.push(heldNote(p));
	}
	const done = recorder.capture(tick, held);
	if (done) setLoop(done, true);
	if (loopOn) mySteps[step].forEach(playLoopNote);
	for (const steps of remoteLoops.values()) steps[step].forEach(playLoopNote);
	updateLoopUI(tick);
}

function setLoop(notes, on) {
	myLoop = notes;
	mySteps = byStep(notes);
	loopOn = on && notes.length > 0;
	publishLoop();
	updateLoopUI();
}

function publishLoop() {
	session?.setLoop(loopOn ? encodeLoop(myLoop) : null);
}

function applyRemoteLoops(loops) {
	remoteLoops.clear();
	for (const [uid, packed] of Object.entries(loops)) {
		const notes = decodeLoop(packed, INSTRUMENTS.length);
		if (notes.length) remoteLoops.set(uid, byStep(notes));
	}
}

function updateLoopUI(tick) {
	const step = tick === undefined ? undefined : tick % LOOP_STEPS;
	const watching = roomState.role === "watch";
	recBtn.disabled = watching;
	if (recorder.state === "armed") {
		const wait = step === undefined ? "" : ` ${Math.ceil((LOOP_STEPS - step) / 4)}`;
		recBtn.textContent = `ready${wait}`;
	} else if (recorder.state === "recording") {
		recBtn.textContent = `rec ${(recorder.progress(tick ?? recorder.startTick) / 4) | 0}/8`;
	} else {
		recBtn.textContent = "rec";
	}
	recBtn.setAttribute("aria-pressed", String(recorder.state !== "idle"));
	const has = myLoop.length > 0;
	loopBtn.hidden = shareBtn.hidden = clearBtn.hidden = !has;
	loopBtn.setAttribute("aria-pressed", String(loopOn));
}

recBtn.addEventListener("click", () => {
	if (recorder.state === "idle") recorder.arm();
	else recorder.cancel();
	updateLoopUI();
});
loopBtn.addEventListener("click", () => setLoop(myLoop, !loopOn));
clearBtn.addEventListener("click", () => setLoop([], false));
shareBtn.addEventListener("click", async () => {
	const url = new URL(location.href);
	url.search = `?loop=${encodeLoop(myLoop)}`;
	url.hash = session ? session.room : roomFromHash();
	try {
		if (navigator.share) await navigator.share({ title: "A Muse loop", url: url.href });
		else {
			await navigator.clipboard.writeText(url.href);
			hint.classList.remove("gone");
			hint.textContent = "Loop link copied. Anyone who opens it hears your loop.";
		}
	} catch {
		// share sheet dismissed, or clipboard blocked: show the link instead
		hint.classList.remove("gone");
		hint.textContent = url.href;
	}
});

// A shared link: ?loop=... loads that loop, ready to play once you start.
{
	const shared = decodeLoop(new URLSearchParams(location.search).get("loop") ?? "", INSTRUMENTS.length);
	if (shared.length) {
		myLoop = shared;
		mySteps = byStep(shared);
		loopOn = true;
	}
	updateLoopUI();
}

/* ---------- drawing ---------- */

function draw(now) {
	ctx.clearRect(0, 0, width, height);
	const laneH = height / NOTES;

	for (const p of remotes.values()) placeRemote(p);
	const everyone = [...remotes.values(), ...pointers.values()];

	// lanes held right now
	for (const p of everyone) {
		if (!p.down) continue;
		ctx.globalAlpha = 0.1;
		ctx.fillStyle = PENS[p.instrument];
		ctx.fillRect(0, p.lane * laneH, width, laneH);
		ctx.globalAlpha = 1;
	}

	// ruled pitch lines, a touch darker on each quarter note so the shared beat is visible
	const quarter = Math.floor(roomTime() / TEMPO_MS) % 4 === 0;
	ctx.strokeStyle = quarter ? "rgba(31, 58, 95, 0.34)" : "rgba(31, 58, 95, 0.22)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (let i = 1; i < NOTES; i++) {
		const y = Math.round(i * laneH) + 0.5;
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
	}
	ctx.stroke();

	for (const p of everyone) {
		const which = p.down || p.remote ? p.instrument ?? 0 : current;
		const color = PENS[which];

		// trail
		p.trail = p.trail.filter((pt) => now - pt.t < 600);
		if (p.trail.length > 1) {
			ctx.strokeStyle = color;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (let i = 1; i < p.trail.length; i++) {
				const a = p.trail[i - 1];
				const b = p.trail[i];
				ctx.globalAlpha = 1 - (now - b.t) / 600;
				ctx.lineWidth = 2.5;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}

		// cursor: a pen dot, with a ring that pulses while held
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
		ctx.fill();
		if (p.down) {
			p.pulse = (p.pulse + 0.25) % (Math.PI * 2);
			ctx.lineWidth = 2;
			ctx.strokeStyle = color;
			ctx.globalAlpha = 0.5;
			ctx.beginPath();
			ctx.arc(p.x, p.y, 9 + 5 * (0.5 + 0.5 * Math.sin(p.pulse)), 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		// name in the margin-note hand, with the sound it's playing
		ctx.font = '700 22px Caveat, "Segoe Print", cursive';
		ctx.fillText(`${p.remote ? p.name : username} \u00b7 ${INSTRUMENTS[which].name.toLowerCase()}`, p.x + 16, p.y + 6);
	}

	requestAnimationFrame(draw);
}

/* ---------- room scale ---------- */

// Everyone in a room plays in the same key and scale; anyone can change it.
let settings = { ...DEFAULT_SETTINGS };
const keySelect = document.getElementById("key");
const scaleSelect = document.getElementById("scale");
keySelect.append(...KEYS.map((k, i) => new Option(k, String(i))));
scaleSelect.append(...Object.entries(SCALES).map(([id, s]) => new Option(s.name, id)));

function applySettings(next) {
	settings = cleanSettings(next);
	keySelect.value = String(settings.key);
	scaleSelect.value = settings.scale;
}
applySettings(settings);

function changeSettings() {
	applySettings({ key: Number(keySelect.value), scale: scaleSelect.value });
	if (session && roomState.role === "play") session.setSettings(settings);
}
keySelect.addEventListener("change", changeSettings);
scaleSelect.addEventListener("change", changeSettings);

/* ---------- visualizer ---------- */

// On by default unless the viewer prefers less motion; the choice is remembered.
const vizToggle = document.getElementById("viz-toggle");
const stageEl = document.querySelector(".stage");
function vizPref() {
	try {
		const saved = localStorage.getItem("muse-viz");
		if (saved !== null) return saved === "on";
	} catch {
		// storage blocked: fall through to the default
	}
	return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}
async function setViz(on, remember) {
	vizToggle.setAttribute("aria-pressed", String(on));
	if (remember) {
		try {
			localStorage.setItem("muse-viz", on ? "on" : "off");
		} catch {
			// not saved; fine
		}
	}
	if (!on) return stopViz();
	try {
		if (!(await startViz(stageEl))) {
			vizToggle.hidden = true;
		}
	} catch (err) {
		console.warn("Muse: visualizer failed to load", err);
		vizToggle.setAttribute("aria-pressed", "false");
	}
}
vizToggle.addEventListener("click", () => {
	setViz(vizToggle.getAttribute("aria-pressed") !== "true", true);
});
setViz(vizPref(), false);

/* ---------- start ---------- */

// Room picker: the URL hash fills it in, and active rooms are one tap away.
const roomInput = document.getElementById("room");
roomInput.value = location.hash ? roomFromHash() : "";
const roomsBox = document.getElementById("rooms");
const roomList = document.getElementById("room-list");
function markPicked() {
	const picked = cleanRoom(roomInput.value);
	for (const b of roomList.querySelectorAll("button")) {
		b.setAttribute("aria-pressed", String(b.dataset.room === picked));
	}
}
roomInput.addEventListener("input", markPicked);
const stopWatchingRooms = watchRooms((rooms) => {
	roomList.replaceChildren(...rooms.slice(0, 12).map(({ room, players, watchers }) => {
		const li = document.createElement("li");
		const b = document.createElement("button");
		b.type = "button";
		b.dataset.room = room;
		const full = players >= MAX_PLAYERS;
		b.textContent = `${room} · ${players}/${MAX_PLAYERS}` + (watchers ? ` +${watchers}` : "");
		b.setAttribute("aria-label", `${room}, ${players} playing` + (watchers ? `, ${watchers} watching` : "") + (full ? ", full: you'll watch until a spot opens" : ""));
		b.addEventListener("click", () => {
			roomInput.value = room;
			markPicked();
		});
		li.append(b);
		return li;
	}));
	roomsBox.hidden = rooms.length === 0;
	markPicked();
});

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

	// Put the room in the URL so it can be shared.
	const room = cleanRoom(roomInput.value);
	history.replaceState(null, "", `#${room}`);
	stopWatchingRooms();

	statusEl.textContent = "Joining the room...";
	session = await joinRoom({
		room,
		name: username,
		onPlayers: applyRemotePlayers,
		onRoom: applyRoom,
		onLoops: applyRemoteLoops,
		onSettings: (s) => applySettings(s ?? DEFAULT_SETTINGS),
		onStatus: (s) => presence.classList.toggle("offline", s === "offline"),
	});
	if (session) {
		updatePresence();
		publish();
		publishLoop();
	} else {
		// Couldn't join (or multiplayer is off): say so instead of showing nothing.
		presence.hidden = false;
		presence.textContent = "solo";
		presence.classList.add("offline");
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
