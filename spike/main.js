import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh, SplatFileType } from "@sparkjsdev/spark";

const status = document.getElementById("status");
const resultsEl = document.getElementById("results");
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x111111, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200);

// Walk camera start pose. The files are in raw units (metric / 2.5) and scale is not
// applied in this task. Eye height 1.6 m = 0.16 raw above the raw origin, 2.0 m from the
// room centre toward the front wall = 0.8 raw. It looks toward -z, the back wall.
const START_POS = new THREE.Vector3(0, 0.16, 0.8);
const START_TARGET = new THREE.Vector3(0, 0.16, 0);
camera.position.copy(START_POS);
camera.lookAt(START_TARGET);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(START_TARGET);
controls.update();

const spark = new SparkRenderer({ renderer });
scene.add(spark);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let current = null;
function setMesh(mesh) {
  if (current) { scene.remove(current); current.dispose?.(); }
  current = mesh;
  // Axis conversion: OpenCV axes (y down, z forward) to three.js (y up, z toward viewer)
  // is a 180 degree turn about x. It flips y and z.
  mesh.rotation.x = Math.PI;
  scene.add(mesh);
}

function fileTypeFor(name) {
  const ext = name.split(".").pop().toLowerCase();
  return { ply: SplatFileType.PLY, spz: SplatFileType.SPZ, splat: SplatFileType.SPLAT, ksplat: SplatFileType.KSPLAT }[ext];
}

// ---- axes check by number -------------------------------------------------
// Ink splats (near black) are the letter F. Everything is read from the splat data after
// the rotation, so this checks what the file really contains, not what we hoped.
function axesReport(mesh) {
  mesh.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  const ink = [];
  mesh.forEachSplat((i, center, scales, quat, opacity, color) => {
    v.copy(center).applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(v);
    if (color.r < 0.12 && color.g < 0.12 && color.b < 0.12) ink.push(v.x, v.y, v.z);
  });
  const out = {
    bboxMin: box.min.toArray().map((n) => +n.toFixed(4)),
    bboxMax: box.max.toArray().map((n) => +n.toFixed(4)),
    cameraStart: START_POS.toArray(),
    floorBelowCamera: box.min.y < START_POS.y,
    ceilingAboveCamera: box.max.y > START_POS.y,
    cameraInsideBox: box.containsPoint(START_POS),
    inkSplats: ink.length / 3,
  };
  if (ink.length) {
    // Project the ink through a camera at the start pose, as a viewer would see it.
    const cam = camera.clone();
    cam.position.copy(START_POS); cam.up.set(0, 1, 0); cam.lookAt(START_TARGET);
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const pts = [];
    for (let i = 0; i < ink.length; i += 3) { v.set(ink[i], ink[i + 1], ink[i + 2]).project(cam); pts.push([v.x, v.y]); }
    const ys = pts.map((p) => p[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys), h = maxY - minY;
    const mean = (a) => a.reduce((s, n) => s + n, 0) / (a.length || 1);
    const lower = pts.filter((p) => p[1] < minY + 0.3 * h).map((p) => p[0]);   // stem only
    const bar = pts.filter((p) => p[1] > maxY - 0.15 * h).map((p) => p[0]);    // top bar
    const barMinX = Math.min(...bar), barMaxX = Math.max(...bar);
    out.fScreen = {
      stemMeanNdcX: +mean(lower).toFixed(4),
      topBarMeanNdcX: +mean(bar).toFixed(4),
      topBarNdcY: +maxY.toFixed(4),
      stemBottomNdcY: +minY.toFixed(4),
      upright: maxY > minY,
      notMirrored: mean(bar) > mean(lower) && barMaxX - mean(lower) > mean(lower) - barMinX,
    };
  }
  return out;
}

// ---- first frame with splat pixels -----------------------------------------
const gl = renderer.getContext();
const px = new Uint8Array(4);
function canvasHasContent() {
  // Sample a grid of pixels. The camera is inside a closed room, so any pixel that is not
  // the clear colour is a splat pixel.
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) {
    gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[0] !== 17 || px[1] !== 17 || px[2] !== 17) return true;
  }
  return false;
}

let frameHook = null;
renderer.setAnimationLoop((t) => {
  controls.update();
  renderer.render(scene, camera);
  if (frameHook) frameHook(t);
});

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

// ---- manual loading from the file input ------------------------------------
async function loadFile(file) {
  status.textContent = "loading " + file.name;
  const url = URL.createObjectURL(file);
  const mesh = new SplatMesh({ url, fileType: fileTypeFor(file.name) });
  await mesh.initialized;
  setMesh(mesh);
  const rep = axesReport(mesh);
  status.textContent = `${file.name}: ${mesh.numSplats} splats`;
  resultsEl.textContent = JSON.stringify({ file: file.name, splats: mesh.numSplats, axes: rep }, null, 2);
  window.__axes = rep;
  URL.revokeObjectURL(url);
}

document.getElementById("file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) loadFile(f).catch((err) => { status.textContent = "failed: " + err.message; console.error(err); });
});

// ---- automated run: ?src=/scenes/<file>&auto=1 ------------------------------
async function runAuto(src) {
  const name = src.split("/").pop();
  const res = {
    file: name, userAgent: navigator.userAgent,
    browser: params.get("browser"), run: params.get("run"),
    orbitSeconds: 10, fpsWindowSeconds: 5,
  };
  status.textContent = "auto run: " + name;
  const t0 = performance.now();
  const resp = await fetch(src, { cache: "no-store" });
  const bytes = await resp.arrayBuffer();
  const tFetch = performance.now();
  status.textContent = `auto run: ${name} read, parsing`;
  res.bytes = bytes.byteLength;
  res.fileReadMs = Math.round(tFetch - t0);

  const mesh = new SplatMesh({ fileBytes: new Uint8Array(bytes), fileType: fileTypeFor(name), fileName: name });
  await mesh.initialized;
  res.parseMs = Math.round(performance.now() - tFetch);
  res.splats = mesh.numSplats;
  setMesh(mesh);
  status.textContent = `auto run: ${name} parsed, waiting for first frame`;

  // first frame that shows splat pixels
  let first = null;
  await new Promise((resolve) => {
    frameHook = () => { if (!first && canvasHasContent()) { first = performance.now(); frameHook = null; resolve(); } };
  });
  res.firstFrameMs = Math.round(first - t0);
  res.firstFrameAfterParseMs = Math.round(first - tFetch);

  // 10 s of slow orbit inside the room, fps over the last 5 s
  controls.enabled = false;
  const radius = START_POS.z - START_TARGET.z;
  const stamps = [];
  const tStart = performance.now();
  await new Promise((resolve) => {
    frameHook = () => {
      const now = performance.now();
      const a = 0.3 * ((now - tStart) / 1000); // 0.3 rad/s
      camera.position.set(START_TARGET.x + radius * Math.sin(a), START_TARGET.y, START_TARGET.z + radius * Math.cos(a));
      camera.lookAt(START_TARGET);
      stamps.push(now);
      if (now - tStart >= 10000) { frameHook = null; resolve(); }
    };
  });
  const end = stamps[stamps.length - 1];
  const last = stamps.filter((s) => s >= end - 5000);
  res.framesTotal = stamps.length;
  res.framesLast5s = last.length - 1;
  res.fpsLast5s = +(((last.length - 1) * 1000) / (last[last.length - 1] - last[0])).toFixed(1);

  // axes checks, after timing so they do not disturb it
  camera.position.copy(START_POS); camera.lookAt(START_TARGET);
  res.axes = axesReport(mesh);
  return res;
}

async function post(res) {
  try {
    const r = await fetch("/__results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(res) });
    res.posted = r.ok;
  } catch (e) { res.posted = false; }
}

const src = params.get("src");
if (src && params.get("auto")) {
  runAuto(src).then(async (res) => {
    await post(res);
    window.__results = res;
    resultsEl.textContent = JSON.stringify(res, null, 2);
    status.textContent = "auto run done";
  }).catch((err) => {
    window.__results = { error: String(err && err.message || err) };
    resultsEl.textContent = "failed: " + window.__results.error;
    console.error(err);
  });
} else if (src) {
  (async () => {
    const name = src.split("/").pop();
    status.textContent = "loading " + name;
    const mesh = new SplatMesh({ url: src, fileType: fileTypeFor(name) });
    await mesh.initialized;
    setMesh(mesh);
    const rep = axesReport(mesh);
    window.__axes = rep;
    status.textContent = `${name}: ${mesh.numSplats} splats`;
    resultsEl.textContent = JSON.stringify({ file: name, splats: mesh.numSplats, axes: rep }, null, 2);
  })().catch((err) => { status.textContent = "failed: " + err.message; console.error(err); });
}
