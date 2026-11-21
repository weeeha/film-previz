import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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

// Splat and collider live in one group, so scale and floor shift apply to both together.
const world = new THREE.Group();
scene.add(world);

let current = null;
function setMesh(mesh) {
  if (current) { world.remove(current); current.dispose?.(); }
  current = mesh;
  // Axis conversion: OpenCV axes (y down, z forward) to three.js (y up, z toward viewer)
  // is a 180 degree turn about x. It flips y and z.
  mesh.rotation.x = Math.PI;
  world.add(mesh);
}

// ---- collider mesh: invisible by default, same rotation, wireframe on demand ----
let collider = null;
const colliderMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
async function loadColliderUrl(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error("no mesh in collider file");
  mesh.material = colliderMat;
  mesh.visible = false; // raycasting does not look at visibility, so it still picks
  if (collider) { world.remove(collider); collider.geometry.dispose(); }
  collider = mesh;
  mesh.rotation.x = Math.PI; // same axis conversion as the splat
  world.add(mesh);
  return mesh;
}
function setWireframe(on) { if (collider) collider.visible = on; wireBtn.textContent = "Collider wireframe: " + (on ? "on" : "off") + " (W)"; }
function worldTransformMatrix() { world.updateMatrix(); return world.matrix.clone(); }

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


// ---- scale from a known length, picking, measuring -------------------------------
const wireBtn = document.getElementById("wire");
const readout = document.getElementById("readout");
const raycaster = new THREE.Raycaster();
const markers = new THREE.Group();
scene.add(markers);
let mode = "idle";          // idle | mark | measure
let picks = [];             // world points picked in the current mode
let lastRawLength = null;   // raw distance of the last two-point mark
let scaleApplied = false;
let lastLowPoint = null;    // the lower of the two marked points (world), used to set the floor

const say = (t) => { readout.textContent = t; };

function pickCollider(ndc) {
  if (!collider) return null;
  world.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(collider, false)[0];
  return hit ? hit.point.clone() : null;
}
function addMarker(p) {
  const r = 0.01 * world.scale.x;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2255, depthTest: false }));
  m.renderOrder = 10; m.position.copy(p); markers.add(m);
}
function clearMarkers() { markers.clear(); picks = []; }

// Scale about the world origin, then shift so a chosen world y lands at 0. The camera and its
// orbit target get the same transform, so the view does not change.
function applyScale(factor, floorY) {
  const before = worldTransformMatrix();
  world.scale.multiplyScalar(factor);
  world.position.multiplyScalar(factor);
  if (floorY != null) world.position.y -= factor * floorY;
  const after = worldTransformMatrix();
  const R = after.multiply(before.invert());
  camera.position.applyMatrix4(R);
  controls.target.applyMatrix4(R);
  camera.near *= factor; camera.far *= factor; camera.updateProjectionMatrix();
  controls.update();
  world.updateMatrixWorld(true);
  clearMarkers();
}

function onPick(ndc) {
  if (mode === "idle") return;
  const p = pickCollider(ndc);
  if (!p) { say("no collider hit there (load a collider first, or click a surface)"); return; }
  picks.push(p); addMarker(p);
  if (picks.length < 2) { say(`point 1: y ${p.y.toFixed(4)}. Pick the second point.`); return; }
  const d = picks[0].distanceTo(picks[1]);
  if (mode === "mark") {
    lastRawLength = d;
    lastLowPoint = picks[0].y <= picks[1].y ? picks[0].clone() : picks[1].clone();
    say(`measured ${d.toFixed(4)} (current units). Type the known length and press Apply. Floor goes to the lower point.`);
  } else {
    const dy = Math.abs(picks[0].y - picks[1].y);
    say(`distance ${d.toFixed(4)}, vertical ${dy.toFixed(4)} (${scaleApplied ? "meters" : "scene units, not metric until Apply"})`);
    window.__measure = { distance: d, vertical: dy, a: picks[0].toArray(), b: picks[1].toArray() };
  }
  picks = [];
}
function setMode(m) {
  mode = m; picks = [];
  document.getElementById("mark").classList.toggle("on", m === "mark");
  document.getElementById("measure").classList.toggle("on", m === "measure");
  say(m === "mark" ? "click point 1 on the floor at the door base, then point 2 at the door top edge" : m === "measure" ? "click two points to read the distance" : "");
}
document.getElementById("mark").addEventListener("click", () => { clearMarkers(); setMode("mark"); });
document.getElementById("measure").addEventListener("click", () => { clearMarkers(); setMode("measure"); });
document.getElementById("clear").addEventListener("click", () => { clearMarkers(); setMode("idle"); });
document.getElementById("apply").addEventListener("click", () => {
  const known = parseFloat(document.getElementById("known").value);
  if (!lastRawLength || !(known > 0)) { say("mark two points and enter a known length first"); return; }
  const factor = known / lastRawLength;
  applyScale(factor, lastLowPoint.y);
  window.__applied = { raw: lastRawLength, known, factor, scale: world.scale.x, positionY: world.position.y };
  scaleApplied = true;
  const msg = `raw ${lastRawLength.toFixed(4)}, known ${known.toFixed(2)}, factor ${factor.toFixed(4)}. Floor at y = 0. Pick two points for a second distance.`;
  lastRawLength = null; setMode("measure"); say(msg);
});
wireBtn.addEventListener("click", () => setWireframe(!(collider && collider.visible)));
addEventListener("keydown", (e) => { if (e.key === "w" || e.key === "W") { if (document.activeElement.tagName !== "INPUT") wireBtn.click(); } });

// click, not drag: a click is a press and release within 5 px
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  onPick(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
});
document.getElementById("collider-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f);
  try { await loadColliderUrl(url); say("collider loaded: " + f.name); } catch (err) { say("collider failed: " + err.message); }
  URL.revokeObjectURL(url);
});

// ---- automated scale run: ?autoscale=1&known=2.00 ----------------------------------
// The points come from the truth file, are projected to the screen with the camera, and then
// the collider is raycast through those screen points. The raycast hits are what is measured.
const nowMs = () => performance.now();
async function runAutoScale(colliderUrl) {
  const truth = await (await fetch("/scenes/set-01-truth.json", { cache: "no-store" })).json();
  const T = truth.transform;
  // truth metric (x, y, z) to the world frame of the unscaled scene: (x, y - 1.2, z) / 2.5
  const toWorld = (m) => new THREE.Vector3(m[0], m[1] - T.yOffsetMeters, m[2]).divideScalar(T.divisor);
  const known = parseFloat(params.get("known") || "2.00");
  const res = { kind: "scale", set: "synthetic", file: params.get("src"), collider: colliderUrl, known, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent };

  const toNdc = (metric) => {
    const w = toWorld(metric).applyMatrix4(world.matrixWorld);
    return w.project(camera);
  };
  const pickAt = (label, metric) => {
    const ndc = toNdc(metric);
    const hit = pickCollider(new THREE.Vector2(ndc.x, ndc.y));
    return { label, aim: metric, ndc: [+ndc.x.toFixed(4), +ndc.y.toFixed(4)], onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1, hit };
  };
  world.updateMatrixWorld(true); camera.updateMatrixWorld(true);

  // 1. door base and top, raw
  const d = truth.door;
  const faceZ = d.max.metric[2];
  const base = pickAt("door base", [d.centreX, d.baseY, faceZ]);
  const top = pickAt("door top", [d.centreX, d.topY, faceZ]);
  if (!base.hit || !top.hit) throw new Error("door picks missed the collider");
  const rawDoor = base.hit.distanceTo(top.hit);
  const factor = known / rawDoor;
  res.doorBase = { aim: base.aim, ndc: base.ndc, hitWorldRaw: base.hit.toArray() };
  res.doorTop = { aim: top.aim, ndc: top.ndc, hitWorldRaw: top.hit.toArray() };
  res.rawDoorHeight = rawDoor;
  res.factor = factor;
  res.trueFactor = T.scaleFactorToMetric;
  res.factorErrorPct = +(100 * (factor / T.scaleFactorToMetric - 1)).toFixed(3);
  const lowY = Math.min(base.hit.y, top.hit.y);

  // 2. apply to splat and collider, floor to y = 0 at the lower marked point
  applyScale(factor, lowY);
  res.floorRule = "floor set to y = 0 at the lower of the two marked door points";
  res.appliedScale = world.scale.x; res.worldPositionY = world.position.y;
  world.updateMatrixWorld(true); camera.updateMatrixWorld(true);

  // 3. second distances, measured from new raycasts after scale
  const seatTop = pickAt("seat top", [-1.5, 0.45, -1.9]);
  const seatFloor = pickAt("floor in front of seat", [-1.5, 0, -1.7]);
  const dl = pickAt("door left edge, 1 m up", [d.min.metric[0], 1, faceZ]);
  const dr = pickAt("door right edge, 1 m up", [d.max.metric[0], 1, faceZ]);
  const second = {};
  if (seatTop.hit && seatFloor.hit) {
    const m = seatTop.hit.y - seatFloor.hit.y;
    second.chairSeatHeight = { measured: +m.toFixed(4), truth: truth.chairSeat.heightMetric, errorM: +(m - truth.chairSeat.heightMetric).toFixed(4), seatTopY: +seatTop.hit.y.toFixed(4), floorHitY: +seatFloor.hit.y.toFixed(4) };
  }
  if (dl.hit && dr.hit) {
    const m = dl.hit.distanceTo(dr.hit);
    second.doorWidth = { measured: +m.toFixed(4), truth: d.widthMetric, errorM: +(m - d.widthMetric).toFixed(4) };
  }
  const topAfter = pickAt("door top after", [d.centreX, d.topY, faceZ]);
  const baseAfter = pickAt("door base after", [d.centreX, d.baseY, faceZ]);
  if (topAfter.hit && baseAfter.hit) {
    const m = topAfter.hit.distanceTo(baseAfter.hit);
    second.doorHeight = { measured: +m.toFixed(4), truth: d.heightMetric, errorM: +(m - d.heightMetric).toFixed(4), doorTopY: +topAfter.hit.y.toFixed(4) };
  }
  res.second = second;
  res.within015 = Object.values(second).filter((x) => x.errorM != null).every((x) => Math.abs(x.errorM) <= 0.15);

  // 4. splat picking, after scale
  res.picking = await runSplatPicking(truth, pickAt);
  res.colliderFit = colliderFit(truth);
  return res;
}


// ---- step 6 by number: how far each splat centre sits from the collider surface -----
function closestOnTri(p, a, b, c, out) {
  // Ericson, Real-Time Collision Detection, closest point on a triangle
  const ab = _ab.subVectors(b, a), ac = _ac.subVectors(c, a), ap = _ap.subVectors(p, a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  const bp = _bp.subVectors(p, b); const d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(ab, d1 / (d1 - d3));
  const cp = _cp.subVectors(p, c); const d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) return out.copy(b).addScaledVector(_cb.subVectors(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return out.copy(a).addScaledVector(ab, vb * den).addScaledVector(ac, vc * den);
}
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _ap = new THREE.Vector3(), _bp = new THREE.Vector3(), _cp = new THREE.Vector3(), _cb = new THREE.Vector3();
function colliderFit(truth) {
  world.updateMatrixWorld(true);
  const geo = collider.geometry, pos = geo.attributes.position, idx = geo.index;
  const tris = [];
  for (let i = 0; i < idx.count; i += 3) {
    tris.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + k)).applyMatrix4(collider.matrixWorld)));
  }
  const T = truth.transform, sg = truth.signF;
  const v = new THREE.Vector3(), cp = new THREE.Vector3();
  const all = [], noSign = [];
  const t0 = nowMs();
  current.forEachSplat((i, center) => {
    v.copy(center).applyMatrix4(current.matrixWorld);
    let best = Infinity;
    for (const t of tris) { const d = v.distanceToSquared(closestOnTri(v, t[0], t[1], t[2], cp)); if (d < best) best = d; }
    best = Math.sqrt(best);
    all.push(best);
    // the sign panel (0.01 m proud) and the F (0.02 m proud) are in the splats but not in the collider
    const onSign = v.x > sg.bboxMin.metric[0] - 0.45 && v.x < sg.bboxMax.metric[0] + 0.45 && v.y > sg.bboxMin.metric[1] - 0.15 && v.y < sg.bboxMax.metric[1] + 0.15 && v.z < truth.room.depthZ[0] + 0.05;
    if (!onSign) noSign.push(best);
  });
  const stat = (a) => { const s2 = Float64Array.from(a).sort(); const n = s2.length; return { n, meanM: +(s2.reduce((x, y) => x + y, 0) / n).toFixed(6), p99M: +s2[Math.floor(0.99 * (n - 1))].toFixed(6), maxM: +s2[n - 1].toFixed(6) }; };
  return { what: "distance from each splat centre to the nearest collider triangle, meters after scale", allSplats: stat(all), excludingSignArea: stat(noSign), signSplatsExcluded: all.length - noSign.length, triangles: tris.length, ms: Math.round(nowMs() - t0) };
}

async function runSplatPicking(truth, pickAt) {
  const out = { supported: typeof current.raycast === "function", minRaycastOpacity: current.minRaycastOpacity, raycastable: current.raycastable };
  const splatHit = (ndc) => {
    raycaster.setFromCamera(ndc, camera);
    const t0 = nowMs();
    const hits = raycaster.intersectObject(current, false);
    const ms = nowMs() - t0;
    return { hit: hits.length ? hits[0] : null, n: hits.length, ms };
  };
  const targets = [
    ["door face", [1.0, 1.0, truth.door.max.metric[2]]],
    ["floor", [0, 0, -2]],
    ["left wall", [-3, 1.5, -3]],
    ["left wall, second point", [-3, 1.2, -2.2]],
    ["right wall", [3, 1.5, -3]],
    ["chair seat top", [-1.5, 0.45, -1.9]],
  ];
  out.targets = [];
  for (const [label, metric] of targets) {
    const pc = pickAt(label, metric);
    const ndc = new THREE.Vector2(pc.ndc[0], pc.ndc[1]);
    const sh = splatHit(ndc);
    const row = { label, aimMetric: metric, onScreen: pc.onScreen, colliderHit: pc.hit && pc.hit.toArray().map((n) => +n.toFixed(4)), splatHits: sh.n, splatRayMs: +sh.ms.toFixed(1) };
    if (sh.hit) {
      const p = sh.hit.point;
      row.splatHit = p.toArray().map((n) => +n.toFixed(4));
      if (pc.hit) row.offsetFromColliderM = +p.distanceTo(pc.hit).toFixed(4);
      row.offsetFromTruthM = +p.distanceTo(new THREE.Vector3(...metric)).toFixed(4);
      row.alongRayVsColliderM = pc.hit ? +(sh.hit.distance - camera.position.distanceTo(pc.hit)).toFixed(4) : null;
    }
    out.targets.push(row);
  }
  // grid of rays across the view: collider hit against splat hit along the same ray
  const diffs = []; let missCollider = 0, missSplat = 0, rays = 0, worst = null;
  const nx = 17, ny = 9;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ndc = new THREE.Vector2(-0.9 + 1.8 * i / (nx - 1), -0.9 + 1.8 * j / (ny - 1));
    rays++;
    const c = pickCollider(ndc); const sh = splatHit(ndc);
    if (!c) { missCollider++; continue; }
    if (!sh.hit) { missSplat++; continue; }
    const dd = sh.hit.distance - camera.position.distanceTo(c); // splat minus collider along the ray, meters
    diffs.push(dd);
    if (!worst || Math.abs(dd) > Math.abs(worst.diffM)) {
      const trueBackWall = c.z < truth.room.depthZ[0] + 0.1; // collider hit within 0.1 m of the back wall plane
      worst = { ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)], diffM: +dd.toFixed(4), colliderHit: c.toArray().map((n) => +n.toFixed(3)), onBackWall: trueBackWall };
    }
    await Promise.resolve();
  }
  const abs = diffs.map(Math.abs).sort((a, b) => a - b);
  const q = (p) => abs.length ? +abs[Math.min(abs.length - 1, Math.floor(p * abs.length))].toFixed(4) : null;
  out.grid = { rays, bothHit: diffs.length, colliderMisses: missCollider, splatMisses: missSplat, absDiffMeanM: abs.length ? +(abs.reduce((s, n) => s + n, 0) / abs.length).toFixed(4) : null, absDiffMedianM: q(0.5), absDiffP95M: q(0.95), absDiffMaxM: q(1), worst, note: "difference along the same ray, splat hit minus collider hit, meters after scale" };
  return out;
}

window.__spike = { camera, world, THREE }; // debug hook for the headless runner

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
    const cUrl = params.get("collider");
    if (cUrl) { await loadColliderUrl(cUrl); status.textContent += ", collider loaded"; }
    if (params.get("wire")) setWireframe(true);
    if (params.get("autoscale")) {
      for (let i = 0; i < 5; i++) await nextFrame(); // let Spark finish its first update
      const res = await runAutoScale(cUrl);
      await post(res);
      window.__results = res;
      resultsEl.textContent = JSON.stringify(res, null, 2);
      status.textContent = "autoscale run done";
    }
  })().catch((err) => { window.__results = { error: String(err && err.message || err) }; status.textContent = "failed: " + err.message; console.error(err); });
}
