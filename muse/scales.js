// Room scales for Muse.
//
// The sampled instruments hold 16 notes of C major pentatonic, C2 to C5
// (note1.mp3 is C2). Lane 0 is the top of the canvas, the highest note.
// To play another key or scale, each lane gets a target pitch, and the
// nearest sample is played at a slightly different rate to reach it.

export const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export const SCALES = {
	pentatonic: { name: "pentatonic", steps: [0, 2, 4, 7, 9] },
	minorpent: { name: "minor pentatonic", steps: [0, 3, 5, 7, 10] },
	major: { name: "major", steps: [0, 2, 4, 5, 7, 9, 11] },
	minor: { name: "minor", steps: [0, 2, 3, 5, 7, 8, 10] },
	dorian: { name: "dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
	blues: { name: "blues", steps: [0, 3, 5, 6, 7, 10] },
};

export const DEFAULT_SETTINGS = { scale: "pentatonic", key: 0 };

const NOTES = 16;
const SAMPLE_STEPS = SCALES.pentatonic.steps;

// MIDI pitch of the sample that sits in lane `lane` (0 = top).
function sampleMidi(lane) {
	const k = NOTES - 1 - lane;
	return 36 + 12 * Math.floor(k / 5) + SAMPLE_STEPS[k % 5];
}

export function cleanSettings(s) {
	const scale = s && Object.hasOwn(SCALES, s.scale) ? s.scale : DEFAULT_SETTINGS.scale;
	const key = s && Number.isInteger(s.key) && s.key >= 0 && s.key < 12 ? s.key : DEFAULT_SETTINGS.key;
	return { scale, key };
}

/** MIDI pitch a lane plays under the room's scale and key. */
export function targetMidi(lane, settings) {
	const { steps } = SCALES[settings.scale];
	const m = steps.length;
	const k = NOTES - 1 - lane;
	const offset = (n) => 12 * Math.floor(n / m) + steps[n % m];
	// Keep the top lane near C5, landing the bottom lane on the key's root.
	const base = 12 * Math.round((72 - offset(NOTES - 1) - settings.key) / 12) + settings.key;
	return base + offset(k);
}

/** Which sample lane to play, and at what playback rate, for a canvas lane. */
export function pitchFor(lane, settings) {
	const target = targetMidi(lane, settings);
	let best = 0;
	for (let l = 1; l < NOTES; l++) {
		if (Math.abs(sampleMidi(l) - target) < Math.abs(sampleMidi(best) - target)) best = l;
	}
	return { sampleLane: best, rate: 2 ** ((target - sampleMidi(best)) / 12) };
}
