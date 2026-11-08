// Loops for Muse: record four bars, then they repeat on the room's beat.
//
// A loop is a list of { step, lane, instrument, vol } notes on a 32-step
// grid (four bars of 8th notes). It packs into a short string, four
// characters per note, so it fits in a share link or one database value:
//   step (base 36, 0..v)  lane (hex)  instrument (hex)  volume (0..9)

export const LOOP_STEPS = 32;
export const MAX_LOOP_NOTES = 160;
export const MAX_NOTES_PER_STEP = 8; // keeps a crafted loop from stacking hundreds of voices on one beat

export function encodeLoop(notes) {
	return notes
		.slice(0, MAX_LOOP_NOTES)
		.map((n) => n.step.toString(36) + n.lane.toString(16) + n.instrument.toString(16) + n.vol)
		.join("");
}

/** Parses a packed loop, skipping anything malformed. */
export function decodeLoop(text, instrumentCount) {
	const notes = [];
	if (typeof text !== "string") return notes;
	const perStep = new Array(LOOP_STEPS).fill(0);
	for (let i = 0; i + 4 <= text.length && notes.length < MAX_LOOP_NOTES; i += 4) {
		const step = parseInt(text[i], 36);
		const lane = parseInt(text[i + 1], 16);
		const instrument = parseInt(text[i + 2], 16);
		const vol = parseInt(text[i + 3], 10);
		if (!(step >= 0 && step < LOOP_STEPS) || !(lane >= 0 && lane < 16)) continue;
		if (!(instrument >= 0 && instrument < instrumentCount) || !(vol >= 0 && vol <= 9)) continue;
		if (perStep[step] >= MAX_NOTES_PER_STEP) continue;
		perStep[step]++;
		notes.push({ step, lane, instrument, vol });
	}
	return notes;
}

/** Notes grouped by step, for quick lookup on each beat. */
export function byStep(notes) {
	const steps = Array.from({ length: LOOP_STEPS }, () => []);
	for (const n of notes) steps[n.step].push(n);
	return steps;
}

/**
 * Records what is held on each beat. arm() waits for the next loop start,
 * then capture(tick, held) is called every beat (tick = absolute beat number
 * on the room clock) until four bars of ticks have passed, even if the tab
 * skipped some beats.
 */
export class Recorder {
	constructor() {
		this.state = "idle"; // idle | armed | recording
		this.notes = [];
		this.startTick = 0;
		this.lastTick = -1;
		this.seen = new Set();
		this.perStep = [];
	}

	arm() {
		this.state = "armed";
		this.notes = [];
		this.lastTick = -1;
		this.seen.clear();
		this.perStep = new Array(LOOP_STEPS).fill(0);
	}

	cancel() {
		this.state = "idle";
	}

	/** Beats recorded so far (0..LOOP_STEPS). */
	progress(tick) {
		return this.state === "recording" ? Math.min(LOOP_STEPS, tick - this.startTick) : 0;
	}

	/** Called on each beat. Returns the finished notes once the loop is captured. */
	capture(tick, held) {
		if (tick === this.lastTick) return null; // a timer fired twice in one beat
		this.lastTick = tick;
		const step = tick % LOOP_STEPS;
		if (this.state === "armed" && step === 0) {
			this.state = "recording";
			this.startTick = tick;
		}
		if (this.state !== "recording") return null;
		if (tick - this.startTick >= LOOP_STEPS) {
			this.state = "idle";
			return this.notes;
		}
		for (const n of held) {
			const key = `${step}:${n.lane}:${n.instrument}`;
			if (this.seen.has(key) || this.notes.length >= MAX_LOOP_NOTES || this.perStep[step] >= MAX_NOTES_PER_STEP) continue;
			this.seen.add(key);
			this.perStep[step]++;
			this.notes.push({ step, ...n });
		}
		if (tick - this.startTick < LOOP_STEPS - 1) return null;
		this.state = "idle";
		return this.notes;
	}
}
