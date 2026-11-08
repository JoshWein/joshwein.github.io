// Synthesized instruments for Muse: a drum kit and four melodic voices,
// built from Web Audio nodes at play time (no sample files).
//
//   const v = synthVoice(ctx, destination, { instrument: "piano", lane, volume });
//   v.setVolume(0.5); v.release(); v.playing();
//
// Lane 0 is the top of the canvas. Melodic lanes follow the same C major
// pentatonic run as the sampled instruments (lane 15 = C2 up to lane 0 = C5).
// Drum lanes go from cymbals at the top down to the kick at the bottom.

const LANES = 16;
const RELEASE_S = 0.45; // matches the sample fade-out in script.js
const PENTATONIC = [0, 2, 4, 7, 9];

export const DRUM_NAMES = [
	"crash", "ride", "open hat", "closed hat", "shaker", "cowbell", "woodblock", "clap",
	"rimshot", "snare", "high tom", "mid tom", "low tom", "floor tom", "808", "kick",
];

/** MIDI note for a lane: lane 15 is C2 (36), lane 0 is C5 (72). */
export function laneMidi(lane) {
	const step = LANES - 1 - lane;
	return 36 + 12 * Math.floor(step / 5) + PENTATONIC[step % 5];
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/* ---------- per-context shared nodes ---------- */

const shared = new WeakMap();

// Every synth voice goes through one gentle compressor so stacked
// retriggers and chords don't clip, then on to the destination.
function bus(ctx, destination) {
	let s = shared.get(ctx);
	if (!s) {
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.knee.value = 12;
		comp.ratio.value = 4;
		comp.attack.value = 0.003;
		comp.release.value = 0.2;
		comp.connect(destination);
		s = { comp, noise: null, plucks: new Map() };
		shared.set(ctx, s);
	}
	return s;
}

function noiseBuffer(ctx, s) {
	if (!s.noise) {
		const len = ctx.sampleRate * 2;
		s.noise = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = s.noise.getChannelData(0);
		for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
	}
	return s.noise;
}

// Karplus-Strong plucked string, rendered once per pitch and cached.
function pluckBuffer(ctx, s, lane, midi) {
	let buf = s.plucks.get(midi);
	if (buf) return buf;
	const rate = ctx.sampleRate;
	const f = hz(midi);
	const seconds = 2.4 - lane * 0.02; // low strings ring a bit longer
	const len = Math.floor(rate * seconds);
	const period = rate / f;
	// Loop delay = n taps + 0.5 (the averaging filter) + frac (the allpass).
	// Keeping frac in [0.5, 1.5) keeps the allpass well behaved.
	const n = Math.max(2, Math.floor(period - 1));
	const frac = period - 0.5 - n;
	buf = ctx.createBuffer(1, len, rate);
	const out = buf.getChannelData(0);
	// Excite with filtered noise so the attack isn't harsh.
	const line = new Float32Array(n);
	let last = 0;
	for (let i = 0; i < n; i++) {
		last = 0.6 * last + 0.4 * (Math.random() * 2 - 1);
		line[i] = last;
	}
	const decay = 0.996 - Math.max(0, 15 - lane) * 0.0002; // tiny extra damping on high strings
	let idx = 0;
	let prev = 0;
	let ap = 0; // allpass state for the fractional part
	const c = (1 - frac) / (1 + frac);
	for (let i = 0; i < len; i++) {
		const cur = line[idx];
		const avg = decay * 0.5 * (cur + prev);
		prev = cur;
		const y = c * avg + ap;
		ap = avg - c * y;
		line[idx] = y;
		out[i] = cur;
		idx = idx === n - 1 ? 0 : idx + 1;
	}
	// Fade the tail so the buffer ends at silence.
	const tail = Math.floor(rate * 0.05);
	for (let i = 0; i < tail; i++) out[len - 1 - i] *= i / tail;
	s.plucks.set(midi, buf);
	return buf;
}

/* ---------- voice plumbing ---------- */

// A voice: sources -> amp (the instrument's envelope) -> level (player volume) -> bus.
function makeVoice(ctx, s, volume) {
	const level = ctx.createGain();
	level.gain.value = volume;
	level.connect(s.comp);
	const sources = [];
	let end = ctx.currentTime;
	let longest = null;
	let released = false;
	return {
		level,
		t: ctx.currentTime + 0.005,
		add(node, start, stop) {
			node.start(start);
			node.stop(stop);
			sources.push(node);
			if (stop >= end) {
				end = stop;
				longest = node;
			}
			return node;
		},
		finish() {
			if (longest) longest.onended = () => level.disconnect();
		},
		api: {
			setVolume(v) {
				if (!released) level.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
			},
			release() {
				if (released) return;
				released = true;
				const now = ctx.currentTime;
				level.gain.cancelScheduledValues(now);
				level.gain.setValueAtTime(level.gain.value, now);
				// An exponential tail sounds like a natural decay, not a cut.
				level.gain.setTargetAtTime(0, now, RELEASE_S / 4);
				const stopAt = now + RELEASE_S + 0.05;
				if (stopAt < end) {
					for (const src of sources) {
						try { src.stop(stopAt); } catch { /* already stopped */ }
					}
					end = stopAt;
				}
			},
			playing() {
				return !released && ctx.currentTime < end;
			},
		},
	};
}

function env(param, t, peak, attack, decay, floor = 0.0001) {
	param.setValueAtTime(0.0001, t);
	param.exponentialRampToValueAtTime(peak, t + attack);
	param.exponentialRampToValueAtTime(floor, t + attack + decay);
}

function osc(ctx, type, freq) {
	const o = ctx.createOscillator();
	o.type = type;
	o.frequency.value = freq;
	return o;
}

/* ---------- melodic instruments ---------- */

function piano(ctx, v, lane, s, midi) {
	const t = v.t;
	const f = hz(midi);
	const decay = 1.1 + lane * 0.1; // high notes (low lane numbers) fade faster
	const amp = ctx.createGain();
	env(amp.gain, t, 0.5, 0.004, decay);
	const tone = ctx.createBiquadFilter();
	tone.type = "lowpass";
	tone.Q.value = 0.5;
	tone.frequency.setValueAtTime(Math.min(12000, f * 9), t);
	tone.frequency.exponentialRampToValueAtTime(Math.min(8000, f * 2.5), t + 0.6);
	tone.connect(amp).connect(v.level);
	// A few slightly stretched partials for a soft, felt-hammer piano.
	[[1, 1, "triangle"], [2.003, 0.35, "sine"], [3.008, 0.12, "sine"], [1.0015, 0.5, "sine"]].forEach(([ratio, g, type]) => {
		const o = osc(ctx, type, f * ratio);
		const gn = ctx.createGain();
		gn.gain.value = g;
		o.connect(gn).connect(tone);
		v.add(o, t, t + decay + 0.1);
	});
}

function marimba(ctx, v, lane, s, midi) {
	const t = v.t;
	const f = hz(midi + 12); // marimba sits an octave up
	const decay = 1.1 - (15 - lane) * 0.04;
	const amp = ctx.createGain();
	amp.connect(v.level);
	const fund = osc(ctx, "sine", f);
	const g1 = ctx.createGain();
	env(g1.gain, t, 0.6, 0.002, decay);
	fund.connect(g1).connect(amp);
	v.add(fund, t, t + decay + 0.05);
	// The tuned 4th partial gives the woody "tok", and dies fast.
	const over = osc(ctx, "sine", f * 3.98);
	const g2 = ctx.createGain();
	env(g2.gain, t, 0.18, 0.001, 0.12);
	over.connect(g2).connect(amp);
	v.add(over, t, t + 0.2);
	const over2 = osc(ctx, "sine", f * 9.9);
	const g3 = ctx.createGain();
	env(g3.gain, t, 0.05, 0.001, 0.04);
	over2.connect(g3).connect(amp);
	v.add(over2, t, t + 0.08);
}

function strings(ctx, v, lane, s, midi) {
	const t = v.t;
	const src = ctx.createBufferSource();
	src.buffer = pluckBuffer(ctx, s, lane, midi);
	const tone = ctx.createBiquadFilter();
	tone.type = "lowpass";
	tone.frequency.value = 6000;
	const amp = ctx.createGain();
	amp.gain.value = 0.8;
	src.connect(tone).connect(amp).connect(v.level);
	v.add(src, t, t + src.buffer.duration);
}

function warmSynth(ctx, v, lane, s, midi) {
	const t = v.t;
	const f = hz(midi);
	const length = 0.9;
	const amp = ctx.createGain();
	amp.gain.setValueAtTime(0.0001, t);
	amp.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
	amp.gain.exponentialRampToValueAtTime(0.12, t + 0.25);
	amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
	const filt = ctx.createBiquadFilter();
	filt.type = "lowpass";
	filt.Q.value = 3;
	filt.frequency.setValueAtTime(Math.min(9000, f * 2), t);
	filt.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 6 + 400), t + 0.06);
	filt.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 2.5 + 200), t + length);
	filt.connect(amp).connect(v.level);
	for (const cents of [-9, 9]) {
		const o = osc(ctx, "sawtooth", f);
		o.detune.value = cents;
		const g = ctx.createGain();
		g.gain.value = 0.45;
		o.connect(g).connect(filt);
		v.add(o, t, t + length);
	}
	const sub = osc(ctx, "sine", f / 2);
	const sg = ctx.createGain();
	sg.gain.value = 0.5;
	sub.connect(sg).connect(filt);
	v.add(sub, t, t + length);
}

/* ---------- drums ---------- */

function noiseHit(ctx, v, s, { type, freq, q = 1, peak, decay, attack = 0.001, at = 0 }) {
	const t = v.t + at;
	const src = ctx.createBufferSource();
	src.buffer = noiseBuffer(ctx, s);
	const filt = ctx.createBiquadFilter();
	filt.type = type;
	filt.frequency.value = freq;
	filt.Q.value = q;
	const g = ctx.createGain();
	env(g.gain, t, peak, attack, decay);
	src.connect(filt).connect(g).connect(v.level);
	v.add(src, t, t + attack + decay + 0.02);
	return g;
}

function toneHit(ctx, v, { type = "sine", from, to, sweep, peak, decay, at = 0 }) {
	const t = v.t + at;
	const o = osc(ctx, type, from);
	o.frequency.setValueAtTime(from, t);
	o.frequency.exponentialRampToValueAtTime(to, t + sweep);
	const g = ctx.createGain();
	env(g.gain, t, peak, 0.002, decay);
	o.connect(g).connect(v.level);
	v.add(o, t, t + decay + 0.03);
}

// Six detuned squares through a highpass: the classic metallic cymbal source.
function metal(ctx, v, { base, hp, peak, decay }) {
	const t = v.t;
	const filt = ctx.createBiquadFilter();
	filt.type = "highpass";
	filt.frequency.value = hp;
	const band = ctx.createBiquadFilter();
	band.type = "peaking";
	band.frequency.value = hp * 1.4;
	band.gain.value = 6;
	const g = ctx.createGain();
	env(g.gain, t, peak, 0.001, decay);
	filt.connect(band).connect(g).connect(v.level);
	for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
		const o = osc(ctx, "square", base * r);
		o.connect(filt);
		v.add(o, t, t + decay + 0.03);
	}
}

const DRUMS = [
	/* crash */ (c, v, s) => { metal(c, v, { base: 52, hp: 5000, peak: 0.12, decay: 1.6 }); noiseHit(c, v, s, { type: "highpass", freq: 6000, peak: 0.25, decay: 1.4 }); },
	/* ride */ (c, v, s) => { metal(c, v, { base: 66, hp: 6500, peak: 0.16, decay: 0.9 }); toneHit(c, v, { from: 2400, to: 2380, sweep: 0.5, peak: 0.05, decay: 0.7 }); },
	/* open hat */ (c, v) => metal(c, v, { base: 40, hp: 7000, peak: 0.32, decay: 0.42 }),
	/* closed hat */ (c, v) => metal(c, v, { base: 40, hp: 7500, peak: 0.4, decay: 0.06 }),
	/* shaker */ (c, v, s) => noiseHit(c, v, s, { type: "bandpass", freq: 7500, q: 1.2, peak: 0.45, decay: 0.08, attack: 0.02 }),
	/* cowbell */ (c, v) => {
		const t = v.t;
		const bp = c.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 800;
		bp.Q.value = 1.5;
		const g = c.createGain();
		env(g.gain, t, 0.35, 0.001, 0.35);
		bp.connect(g).connect(v.level);
		for (const f of [540, 800]) v.add(osc(c, "square", f), t, t + 0.4).connect(bp);
	},
	/* woodblock */ (c, v) => toneHit(c, v, { from: 1250, to: 1150, sweep: 0.03, peak: 0.45, decay: 0.07 }),
	/* clap */ (c, v, s) => {
		for (const at of [0, 0.01, 0.022]) noiseHit(c, v, s, { type: "bandpass", freq: 1200, q: 1.1, peak: 0.6, decay: 0.012, at });
		noiseHit(c, v, s, { type: "bandpass", freq: 1100, q: 1, peak: 0.5, decay: 0.18, at: 0.032 });
	},
	/* rimshot */ (c, v, s) => { toneHit(c, v, { type: "triangle", from: 1700, to: 800, sweep: 0.01, peak: 0.4, decay: 0.04 }); noiseHit(c, v, s, { type: "highpass", freq: 3000, peak: 0.25, decay: 0.03 }); },
	/* snare */ (c, v, s) => { toneHit(c, v, { type: "triangle", from: 260, to: 180, sweep: 0.05, peak: 0.45, decay: 0.12 }); noiseHit(c, v, s, { type: "highpass", freq: 1500, peak: 0.45, decay: 0.2 }); },
	/* high tom */ (c, v) => toneHit(c, v, { from: 300, to: 200, sweep: 0.15, peak: 0.6, decay: 0.3 }),
	/* mid tom */ (c, v) => toneHit(c, v, { from: 220, to: 145, sweep: 0.18, peak: 0.65, decay: 0.35 }),
	/* low tom */ (c, v) => toneHit(c, v, { from: 160, to: 105, sweep: 0.2, peak: 0.7, decay: 0.42 }),
	/* floor tom */ (c, v) => toneHit(c, v, { from: 120, to: 78, sweep: 0.22, peak: 0.75, decay: 0.5 }),
	/* 808 */ (c, v) => toneHit(c, v, { from: 120, to: 45, sweep: 0.08, peak: 0.85, decay: 1.2 }),
	/* kick */ (c, v, s) => { toneHit(c, v, { from: 160, to: 48, sweep: 0.07, peak: 0.95, decay: 0.38 }); noiseHit(c, v, s, { type: "lowpass", freq: 3000, peak: 0.2, decay: 0.008 }); },
];

/* ---------- entry point ---------- */

const MELODIC = { piano, marimba, strings, synth: warmSynth };

export const SYNTH_KINDS = ["drums", ...Object.keys(MELODIC)];

/**
 * Starts one note (or drum hit) now. Returns { setVolume(v), release(), playing() }.
 * instrument: "drums" | "piano" | "marimba" | "strings" | "synth"
 * midi: the pitch for melodic instruments (the room's scale); defaults to the lane's pentatonic note.
 */
export function synthVoice(ctx, destination, { instrument, lane, midi, volume = 1 }) {
	const s = bus(ctx, destination);
	const v = makeVoice(ctx, s, volume);
	lane = Math.min(LANES - 1, Math.max(0, lane | 0));
	if (instrument === "drums") DRUMS[lane](ctx, v, s);
	else (MELODIC[instrument] || piano)(ctx, v, lane, s, Number.isFinite(midi) ? midi : laneMidi(lane));
	v.finish();
	return v.api;
}
