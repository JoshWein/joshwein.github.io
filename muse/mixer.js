// The master chain under Howler: a short, soft reverb and a gentle
// compressor, so note releases and changes blur together instead of
// stopping dead, and many players at once don't clip.
//   Howler.masterGain -> dry --------------> compressor -> speakers
//                     -> reverb -> wet ---/

let ready = false;

// A synthetic room: decaying stereo noise, about 1.6 s long.
function impulse(ctx, seconds = 1.6, decay = 3) {
	const len = Math.floor(ctx.sampleRate * seconds);
	const buf = ctx.createBuffer(2, len, ctx.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const data = buf.getChannelData(ch);
		for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
	}
	return buf;
}

/** Inserts the reverb and compressor once Howler's audio context exists. Safe to call often. */
export function setupMixer() {
	if (ready || !window.Howler?.ctx || !Howler.masterGain) return;
	const ctx = Howler.ctx;
	const master = Howler.masterGain;

	const comp = ctx.createDynamicsCompressor();
	comp.threshold.value = -12;
	comp.knee.value = 10;
	comp.ratio.value = 3;
	comp.attack.value = 0.005;
	comp.release.value = 0.25;

	const reverb = ctx.createConvolver();
	reverb.buffer = impulse(ctx);
	const wet = ctx.createGain();
	wet.gain.value = 0.22;

	master.disconnect(ctx.destination);
	master.connect(comp);
	master.connect(reverb);
	reverb.connect(wet);
	wet.connect(comp);
	comp.connect(ctx.destination);
	ready = true;
}
