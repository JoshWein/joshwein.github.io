// Muse visualizer: a three.js scene behind the drawing canvas.
// A ring of bars follows the live audio spectrum (an AnalyserNode on Howler's
// master output), and every note throws off a burst of sparks in its
// instrument's color, right where it was played.
//
// three.js is vendored in ./three and only loaded when the visualizer is on.

const BARS = 64;
const MAX_SPARKS = 2400;
const SPARK_LIFE = 1.4; // seconds
const SPARKS_PER_NOTE = 14;

let THREE = null;
let renderer, scene, camera, bars, ring, sparks, stars;
let analyser = null;
let freq = null;
let host = null;
let running = false;
let wanted = false; // last on/off request, so a slow load can't override a later "off"
let lastTime = 0;
let energy = 0; // fallback level when there is no analyser
const accent = { r: 0.27, g: 0.81, b: 0.58 }; // site green, drifts toward recent notes

// Spark state lives in typed arrays; a ring buffer reuses old slots.
let sparkPos, sparkVel, sparkCol, sparkBase, sparkAge;
let nextSpark = 0;

function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function connectAnalyser() {
	if (analyser || !window.Howler?.ctx || !Howler.masterGain) return;
	analyser = Howler.ctx.createAnalyser();
	analyser.fftSize = 256;
	analyser.smoothingTimeConstant = 0.8;
	Howler.masterGain.connect(analyser);
	freq = new Uint8Array(analyser.frequencyBinCount);
}

// Size of the z = 0 plane the camera sees, so screen points map onto it.
function viewSize() {
	const h = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
	return { w: h * camera.aspect, h };
}

// Adds light over the page without writing alpha, so with the transparent
// canvas a faded (black) spark simply disappears.
function glow(material) {
	material.blending = THREE.CustomBlending;
	material.blendEquation = THREE.AddEquation;
	material.blendSrc = THREE.SrcAlphaFactor;
	material.blendDst = THREE.OneFactor;
	material.blendSrcAlpha = THREE.ZeroFactor;
	material.blendDstAlpha = THREE.OneFactor;
	material.transparent = true;
	material.depthWrite = false;
	return material;
}

// A soft round dot for sparks and stars.
function dotTexture() {
	const c = document.createElement("canvas");
	c.width = c.height = 64;
	const g = c.getContext("2d");
	const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, "rgba(255,255,255,1)");
	grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
	grad.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = grad;
	g.fillRect(0, 0, 64, 64);
	return new THREE.CanvasTexture(c);
}

function build() {
	const dot = dotTexture();
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
	camera.position.set(0, 0, 14);

	// Spectrum ring
	const geo = new THREE.BoxGeometry(0.16, 1, 0.16);
	geo.translate(0, 0.5, 0); // grow outward from the ring
	const mat = glow(new THREE.MeshBasicMaterial({ opacity: 0.45 }));
	bars = new THREE.InstancedMesh(geo, mat, BARS);
	bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	const white = new THREE.Color(1, 1, 1);
	for (let i = 0; i < BARS; i++) bars.setColorAt(i, white);
	ring = new THREE.Group();
	ring.position.z = -4;
	ring.add(bars);
	scene.add(ring);

	// Sparks
	sparkPos = new Float32Array(MAX_SPARKS * 3);
	sparkVel = new Float32Array(MAX_SPARKS * 3);
	sparkCol = new Float32Array(MAX_SPARKS * 3);
	sparkBase = new Float32Array(MAX_SPARKS * 3);
	sparkAge = new Float32Array(MAX_SPARKS).fill(SPARK_LIFE);
	const sg = new THREE.BufferGeometry();
	sg.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
	sg.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
	sparks = new THREE.Points(sg, glow(new THREE.PointsMaterial({ size: 0.3, map: dot, vertexColors: true })));
	sparks.frustumCulled = false;
	scene.add(sparks);

	// A slow field of dim stars for depth
	const starPos = new Float32Array(600 * 3);
	for (let i = 0; i < 600; i++) {
		starPos[i * 3] = (Math.random() - 0.5) * 60;
		starPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
		starPos[i * 3 + 2] = -10 - Math.random() * 30;
	}
	const stg = new THREE.BufferGeometry();
	stg.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
	stars = new THREE.Points(stg, glow(new THREE.PointsMaterial({ size: 0.14, map: dot, color: 0x8f9a95, opacity: 0.6 })));
	scene.add(stars);
}

function resize() {
	if (!renderer || !host) return;
	const { width, height } = host.getBoundingClientRect();
	if (!width || !height) return;
	renderer.setSize(width, height, false);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
}

function spawn(nx, ny, color, volume) {
	const { w, h } = viewSize();
	const x = (nx - 0.5) * w;
	const y = (0.5 - ny) * h;
	const c = hexToRgb(color);
	const count = Math.round(SPARKS_PER_NOTE * (0.5 + volume));
	for (let k = 0; k < count; k++) {
		const i = nextSpark;
		nextSpark = (nextSpark + 1) % MAX_SPARKS;
		const a = Math.random() * Math.PI * 2;
		const s = 1.5 + Math.random() * 3.5 * (0.4 + volume);
		sparkPos[i * 3] = x;
		sparkPos[i * 3 + 1] = y;
		sparkPos[i * 3 + 2] = 0;
		sparkVel[i * 3] = Math.cos(a) * s;
		sparkVel[i * 3 + 1] = Math.sin(a) * s;
		sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 2;
		sparkBase[i * 3] = c.r;
		sparkBase[i * 3 + 1] = c.g;
		sparkBase[i * 3 + 2] = c.b;
		sparkAge[i] = 0;
	}
	// Recent notes tint the ring.
	accent.r += (c.r - accent.r) * 0.25;
	accent.g += (c.g - accent.g) * 0.25;
	accent.b += (c.b - accent.b) * 0.25;
	energy = Math.min(1, energy + 0.15 * (0.5 + volume));
}

const matrix = { m: null, q: null, p: null, s: null };
const tint = { c: null };

function frame(now) {
	if (!running) return;
	requestAnimationFrame(frame);
	const t = now / 1000;
	const dt = Math.min(0.05, lastTime ? t - lastTime : 0.016);
	lastTime = t;

	connectAnalyser();
	if (analyser) analyser.getByteFrequencyData(freq);
	energy *= 0.94;

	// Spectrum ring
	const { m, q, p, s } = matrix;
	const z = new THREE.Vector3(0, 0, 1);
	const view = viewSize();
	const radius = Math.min(view.h * 0.3, view.w * 0.3, 4.2);
	for (let i = 0; i < BARS; i++) {
		// Mirror the low bins around the ring so it stays symmetric.
		const bin = i < BARS / 2 ? i : BARS - 1 - i;
		const level = freq ? freq[Math.min(freq.length - 1, bin + 1)] / 255 : energy * (0.6 + 0.4 * Math.sin(t * 3 + i));
		const angle = (i / BARS) * Math.PI * 2;
		p.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
		q.setFromAxisAngle(z, angle - Math.PI / 2);
		s.set(1, 0.08 + level * 3.2, 1);
		m.compose(p, q, s);
		bars.setMatrixAt(i, m);
		tint.c.setRGB(accent.r * (0.4 + level), accent.g * (0.4 + level), accent.b * (0.4 + level));
		bars.setColorAt(i, tint.c);
	}
	bars.instanceMatrix.needsUpdate = true;
	bars.instanceColor.needsUpdate = true;
	ring.rotation.z = t * 0.05;

	// Sparks: drift, slow down, fade to black (invisible with additive blending).
	for (let i = 0; i < MAX_SPARKS; i++) {
		if (sparkAge[i] >= SPARK_LIFE) continue;
		sparkAge[i] += dt;
		const life = Math.max(0, 1 - sparkAge[i] / SPARK_LIFE);
		const drag = Math.pow(0.15, dt);
		for (let k = 0; k < 3; k++) {
			sparkVel[i * 3 + k] *= drag;
			sparkPos[i * 3 + k] += sparkVel[i * 3 + k] * dt;
			sparkCol[i * 3 + k] = sparkBase[i * 3 + k] * life;
		}
	}
	sparks.geometry.attributes.position.needsUpdate = true;
	sparks.geometry.attributes.color.needsUpdate = true;

	// A gentle sway keeps the scene alive without pulling focus.
	stars.rotation.z = t * 0.01;
	camera.position.x = Math.sin(t * 0.13) * 0.6;
	camera.position.y = Math.cos(t * 0.11) * 0.4;
	camera.lookAt(0, 0, -2);

	renderer.render(scene, camera);
}

/** Turns the visualizer on inside `container`. Returns false if WebGL is unavailable. */
export async function startViz(container) {
	host = container;
	wanted = true;
	if (!THREE) {
		THREE = await import("./three/three.module.min.js");
		matrix.m = new THREE.Matrix4();
		matrix.q = new THREE.Quaternion();
		matrix.p = new THREE.Vector3();
		matrix.s = new THREE.Vector3();
		tint.c = new THREE.Color();
	}
	if (!wanted) return true; // turned off while three.js was loading
	if (!renderer) {
		try {
			renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
		} catch (err) {
			console.warn("Muse: no WebGL, visualizer off", err);
			return false;
		}
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		renderer.setClearColor(0x000000, 0);
		renderer.domElement.className = "viz";
		renderer.domElement.setAttribute("aria-hidden", "true");
		build();
		new ResizeObserver(resize).observe(host);
	}
	host.prepend(renderer.domElement);
	resize();
	if (!running) {
		running = true;
		lastTime = 0;
		requestAnimationFrame(frame);
	}
	return true;
}

export function stopViz() {
	wanted = false;
	running = false;
	renderer?.domElement.remove();
}

/** A note was played at (nx, ny), both 0..1 across the canvas. */
export function vizNote(nx, ny, color, volume) {
	if (!running) return;
	spawn(nx, ny, color, volume);
}
