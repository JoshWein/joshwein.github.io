// Loops for Muse: record two bars, then they repeat on the room's beat.
//
// A loop is a list of { step, lane, instrument, vol } notes on a 32-step
// grid (two bars of 16th notes). It packs into a short string, four
// characters per note, so it fits in a share link or one database value:
//   step (base 36, 0..v)  lane (hex)  instrument (hex)  volume (0..9)

export const LOOP_STEPS = 32;
export const MAX_LOOP_NOTES = 160;

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
	for (let i = 0; i + 4 <= text.length && notes.length < MAX_LOOP_NOTES; i += 4) {
		const step = parseInt(text[i], 36);
		const lane = parseInt(text[i + 1], 16);
		const instrument = parseInt(text[i + 2], 16);
		const vol = parseInt(text[i + 3], 10);
		if (!(step >= 0 && step < LOOP_STEPS) || !(lane >= 0 && lane < 16)) continue;
		if (!(instrument >= 0 && instrument < instrumentCount) || !(vol >= 0 && vol <= 9)) continue;
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
 * then capture(step, held) is called every beat until the loop is full.
 */
export class Recorder {
	constructor() {
		this.state = "idle"; // idle | armed | recording
		this.notes = [];
		this.taken = 0;
		this.seen = new Set();
	}

	arm() {
		this.state = "armed";
		this.notes = [];
		this.taken = 0;
		this.seen.clear();
	}

	cancel() {
		this.state = "idle";
	}

	/** Called on each beat. Returns the finished notes once two bars are captured. */
	capture(step, held) {
		if (this.state === "armed" && step === 0) this.state = "recording";
		if (this.state !== "recording") return null;
		for (const n of held) {
			const key = `${step}:${n.lane}:${n.instrument}`;
			if (this.seen.has(key) || this.notes.length >= MAX_LOOP_NOTES) continue;
			this.seen.add(key);
			this.notes.push({ step, ...n });
		}
		this.taken++;
		if (this.taken < LOOP_STEPS) return null;
		this.state = "idle";
		return this.notes;
	}
}
