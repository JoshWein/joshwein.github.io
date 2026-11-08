// The room's tempo. The beat is a count of 8th-note steps on the shared room
// clock. A change keeps that count going from the next step on, so loops stay
// on their bar and everyone's held notes still land together:
//   clock = { bpm, at, tick }: step `tick` starts at room time `at`.

export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const DEFAULT_BPM = 100;
export const DEFAULT_CLOCK = { bpm: DEFAULT_BPM, at: 0, tick: 0 };

/** Milliseconds per step (an 8th note) at this tempo. */
export const stepMs = (bpm) => 30000 / bpm;

export const clampBpm = (bpm) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));

/** The step number playing at room time t. */
export function tickAt(clock, t) {
	return clock.tick + Math.floor((t - clock.at) / stepMs(clock.bpm));
}

/** Room time when the step after the one at t starts. */
export function nextBeatAt(clock, t) {
	return clock.at + (tickAt(clock, t) + 1 - clock.tick) * stepMs(clock.bpm);
}

/** A new clock at this tempo, taking over from the next step. */
export function changeTempo(clock, bpm, t) {
	return { bpm: clampBpm(bpm), at: Math.round(nextBeatAt(clock, t)), tick: tickAt(clock, t) + 1 };
}

/** Checks a clock from the room or a link; anything odd falls back to the default. */
export function cleanClock(raw) {
	if (!raw || typeof raw !== "object") return DEFAULT_CLOCK;
	const { bpm, at, tick } = raw;
	if (!Number.isInteger(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return DEFAULT_CLOCK;
	if (!Number.isFinite(at) || !Number.isInteger(tick) || tick < 0) return DEFAULT_CLOCK;
	return { bpm, at, tick };
}

/**
 * Tap tempo: call tap() on each tap. After two taps it returns the tempo of
 * the recent taps; a pause of two seconds starts over.
 */
export class TapTempo {
	constructor() {
		this.times = [];
	}

	tap(now) {
		if (this.times.length && now - this.times.at(-1) > 2000) this.times = [];
		this.times.push(now);
		this.times = this.times.slice(-5);
		if (this.times.length < 2) return null;
		const beat = (this.times.at(-1) - this.times[0]) / (this.times.length - 1);
		return clampBpm(60000 / beat);
	}
}
