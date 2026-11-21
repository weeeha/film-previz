// Synthetic stand-in for a Marble export. Deterministic. No network, no spend.
// Writes scenes/set-01-{2m,500k}.ply (+ .spz if Spark can encode in Node),
// scenes/set-01-collider.glb and scenes/set-01-truth.json.
//
// The room is built in the final metric frame (three.js axes, y up, meters,
// floor at y = 0). Files are stored the way a Marble export is assumed to be:
// OpenCV axes and raw units. Raw = ( x, -(y - 1.2), -z ) / 2.5.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "..", "scenes");
fs.mkdirSync(outDir, { recursive: true });

const Y_OFFSET = 1.2;
const SCALE = 2.5;
const toRaw = ([x, y, z]) => [x / SCALE, -(y - Y_OFFSET) / SCALE, -z / SCALE];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- geometry in the metric frame -------------------------------------
const W = 6, D = 8, H = 3;
const hx = W / 2, hz = D / 2;
const C = {
  floor: [0.50, 0.44, 0.36],
  ceiling: [0.80, 0.80, 0.76],
  back: [0.55, 0.62, 0.68],
  front: [0.66, 0.60, 0.54],
  left: [0.58, 0.66, 0.56],
  right: [0.66, 0.56, 0.62],
  door: [0.78, 0.12, 0.10],
  chair: [0.12, 0.30, 0.78],
  panel: [0.93, 0.90, 0.80],
  ink: [0.05, 0.05, 0.06],
};
// quad: origin o, edge vectors u and v, colour, tile modulation
const quads = [];
const q = (name, o, u, v, color, tile = 0) => quads.push({ name, o, u, v, color, tile });
q("floor", [-hx, 0, -hz], [W, 0, 0], [0, 0, D], C.floor, 0.5);
q("ceiling", [-hx, H, -hz], [W, 0, 0], [0, 0, D], C.ceiling);
q("wall_back", [-hx, 0, -hz], [W, 0, 0], [0, H, 0], C.back);
q("wall_front", [-hx, 0, hz], [W, 0, 0], [0, H, 0], C.front);
q("wall_left", [-hx, 0, -hz], [0, 0, D], [0, H, 0], C.left);
q("wall_right", [hx, 0, -hz], [0, 0, D], [0, H, 0], C.right);

// door slab: 0.90 wide, 2.00 tall, 0.05 proud of the back wall, centred x = 1.0
const door = { cx: 1.0, w: 0.9, h: 2.0, t: 0.05 };
{
  const x0 = door.cx - door.w / 2, x1 = door.cx + door.w / 2, z0 = -hz, z1 = -hz + door.t;
  q("door_front", [x0, 0, z1], [door.w, 0, 0], [0, door.h, 0], C.door);
  q("door_top", [x0, door.h, z0], [door.w, 0, 0], [0, 0, door.t], C.door);
  q("door_left", [x0, 0, z0], [0, 0, door.t], [0, door.h, 0], C.door);
  q("door_right", [x1, 0, z0], [0, 0, door.t], [0, door.h, 0], C.door);
}
// chair seat box: 0.45 x 0.45 footprint, 0.45 high, at x = -1.5, z = -2
const chair = { cx: -1.5, cz: -2, s: 0.45, h: 0.45 };
{
  const x0 = chair.cx - chair.s / 2, x1 = chair.cx + chair.s / 2;
  const z0 = chair.cz - chair.s / 2, z1 = chair.cz + chair.s / 2;
  q("chair_top", [x0, chair.h, z0], [chair.s, 0, 0], [0, 0, chair.s], C.chair);
  q("chair_front", [x0, 0, z1], [chair.s, 0, 0], [0, chair.h, 0], C.chair);
  q("chair_back", [x0, 0, z0], [chair.s, 0, 0], [0, chair.h, 0], C.chair);
  q("chair_left", [x0, 0, z0], [0, 0, chair.s], [0, chair.h, 0], C.chair);
  q("chair_right", [x1, 0, z0], [0, 0, chair.s], [0, chair.h, 0], C.chair);
}
// sign: pale panel 0.01 m proud, letter F 0.02 m proud. Seen from inside the
// room facing the back wall (looking toward -z), +x is to the right, so a
// correct F has its stem on the smaller x and its bars reaching toward +x.
const F = { cx: -1.5, bottom: 1.8, h: 0.6, w: 0.4, stroke: 0.1 };
const fx0 = F.cx - F.w / 2; // stem left edge
const panel = { x0: F.cx - 0.4, x1: F.cx + 0.4, y0: F.bottom - 0.1, y1: F.bottom + F.h + 0.1 };
q("sign_panel", [panel.x0, panel.y0, -hz + 0.01], [panel.x1 - panel.x0, 0, 0], [0, panel.y1 - panel.y0, 0], C.panel);
const fz = -hz + 0.02;
const fTop = F.bottom + F.h;
const fBars = [
  { name: "F_stem", x0: fx0, x1: fx0 + F.stroke, y0: F.bottom, y1: fTop },
  { name: "F_top_bar", x0: fx0, x1: fx0 + F.w, y0: fTop - F.stroke, y1: fTop },
  { name: "F_mid_bar", x0: fx0, x1: fx0 + F.w * 0.75, y0: F.bottom + 0.3 - F.stroke / 2 + 0.05 - 0.05, y1: F.bottom + 0.3 + F.stroke / 2 },
];
for (const b of fBars) q(b.name, [b.x0, b.y0, fz], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0], C.ink);

const len = (v) => Math.hypot(...v);
const area = (qd) => len(qd.u) * len(qd.v);
const totalArea = quads.reduce((s, qd) => s + area(qd), 0);

// ---- splat sampling ------------------------------------------------------
function makeSplats(target, seed) {
  const rand = rng(seed);
  const s = Math.sqrt(totalArea / target); // grid spacing, meters
  const sigma = s * 0.75; // isotropic splat size, meters
  const pts = [];
  for (const qd of quads) {
    const nu = Math.max(1, Math.round(len(qd.u) / s));
    const nv = Math.max(1, Math.round(len(qd.v) / s));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = (i + rand()) / nu, b = (j + rand()) / nv;
      const p = [0, 1, 2].map((k) => qd.o[k] + qd.u[k] * a + qd.v[k] * b);
      let shade = 0.93 + 0.14 * rand();
      if (qd.tile) {
        const ti = Math.floor((a * len(qd.u)) / qd.tile) + Math.floor((b * len(qd.v)) / qd.tile);
        shade *= ti % 2 ? 0.88 : 1.0;
      }
      pts.push({ p, c: qd.color.map((v) => Math.min(1, v * shade)) });
    }
  }
  return { pts, sigma };
}

const SH_C0 = 0.28209479177387814;
function writePly(file, { pts, sigma }) {
  const n = pts.length;
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    `element vertex ${n}\n` +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
      .map((k) => `property float ${k}`).join("\n") +
    "\nend_header\n";
  const buf = new Float32Array(n * 14);
  const rawSigma = sigma / SCALE;
  const ls = Math.log(rawSigma);
  const op = Math.log(0.95 / 0.05);
  for (let i = 0; i < n; i++) {
    const r = toRaw(pts[i].p), c = pts[i].c, o = i * 14;
    buf[o] = r[0]; buf[o + 1] = r[1]; buf[o + 2] = r[2];
    buf[o + 3] = (c[0] - 0.5) / SH_C0; buf[o + 4] = (c[1] - 0.5) / SH_C0; buf[o + 5] = (c[2] - 0.5) / SH_C0;
    buf[o + 6] = op;
    buf[o + 7] = ls; buf[o + 8] = ls; buf[o + 9] = ls;
    buf[o + 10] = 1; buf[o + 11] = 0; buf[o + 12] = 0; buf[o + 13] = 0;
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(buf.buffer)]));
  return n;
}

// ---- collider GLB (raw OpenCV frame, same as the splats) --------------------
function writeGlb(file) {
  const pos = [], idx = [];
  const addQuad = (o, u, v) => {
    const base = pos.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]])
      pos.push(...toRaw([0, 1, 2].map((k) => o[k] + u[k] * a + v[k] * b)));
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // double sided: write both windings, so culling never hides a face
  for (const qd of quads) {
    if (qd.name.startsWith("F_") || qd.name === "sign_panel") continue;
    addQuad(qd.o, qd.u, qd.v);
    addQuad(qd.o, qd.u, qd.v);
    for (let k = idx.length - 6; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const P = new Float32Array(pos), I = new Uint32Array(idx);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const bin = Buffer.concat([Buffer.from(P.buffer), Buffer.from(I.buffer)]);
  const json = {
    asset: { version: "2.0", generator: "film-previz make-sample-set.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "collider" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 },
      { buffer: 0, byteOffset: P.byteLength, byteLength: I.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length / 3, type: "VEC3", min: mn, max: mx },
      { bufferView: 1, componentType: 5125, count: I.length, type: "SCALAR" },
    ],
  };
  let js = Buffer.from(JSON.stringify(json), "utf8");
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const total = 12 + 8 + js.length + 8 + binPad.length;
  const h = Buffer.alloc(12); h.write("glTF", 0, "ascii"); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const ch = (len, type, data) => { const x = Buffer.alloc(8); x.writeUInt32LE(len, 0); x.write(type, 4, "ascii"); return Buffer.concat([x, data]); };
  fs.writeFileSync(file, Buffer.concat([h, ch(js.length, "JSON", js), ch(binPad.length, "BIN\0", binPad)]));
  return { vertices: P.length / 3, triangles: I.length / 3 };
}

// ---- run -------------------------------------------------------------------
const sets = [["set-01-2m", 2_000_000, 1], ["set-01-500k", 500_000, 2]];
const files = {};
for (const [name, target, seed] of sets) {
  const s = makeSplats(target, seed);
  const f = path.join(outDir, name + ".ply");
  const n = writePly(f, s);
  files[name + ".ply"] = { splats: n, bytes: fs.statSync(f).size, splatSigmaMeters: +s.sigma.toFixed(5), seed };
  console.log(name + ".ply", n, "splats", fs.statSync(f).size, "bytes");
}
const glbInfo = writeGlb(path.join(outDir, "set-01-collider.glb"));
files["set-01-collider.glb"] = { ...glbInfo, bytes: fs.statSync(path.join(outDir, "set-01-collider.glb")).size, frame: "raw (OpenCV axes, raw units), same as the splats" };
console.log("collider", glbInfo);

// SPZ through Spark's own transcoder, only if it runs in Node.
let spzNote = "";
try {
  const { transcodeSpz, SplatFileType } = await import("@sparkjsdev/spark");
  for (const [name] of sets) {
    const bytes = fs.readFileSync(path.join(outDir, name + ".ply"));
    const r = await transcodeSpz({ inputs: [{ fileBytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), fileType: SplatFileType.PLY }] });
    const f = path.join(outDir, name + ".spz");
    fs.writeFileSync(f, r.fileBytes);
    files[name + ".spz"] = { bytes: fs.statSync(f).size, encoder: "Spark transcodeSpz (PLY in)" };
    console.log(name + ".spz", fs.statSync(f).size, "bytes");
  }
} catch (e) {
  spzNote = "SPZ not written: " + (e && e.message ? e.message : e);
  console.log(spzNote);
}

const m = (p) => ({ metric: p, raw: toRaw(p) });
const truth = {
  note: "Synthetic set. Metric frame: three.js axes, y up, meters, floor at y = 0. Files are stored in raw: raw = (x, -(y - 1.2), -z) / 2.5 (OpenCV axes, y down, z forward). Correct scale factor to metric: 2.5.",
  transform: { yOffsetMeters: Y_OFFSET, flipY: true, flipZ: true, divisor: SCALE, scaleFactorToMetric: SCALE },
  room: { widthX: [-hx, hx], depthZ: [-hz, hz], heightY: [0, H], floorMetric: 0, floorRawY: toRaw([0, 0, 0])[1], ceilingRawY: toRaw([0, H, 0])[1] },
  walls: { back: "z = -4", front: "z = 4", left: "x = -3", right: "x = 3" },
  door: { widthMetric: door.w, heightMetric: door.h, heightRaw: door.h / SCALE, thicknessMetric: door.t, centreX: door.cx, baseY: 0, topY: door.h, onWall: "back (z = -4)", min: m([door.cx - door.w / 2, 0, -hz]), max: m([door.cx + door.w / 2, door.h, -hz + door.t]) },
  chairSeat: { sizeMetric: [chair.s, chair.h, chair.s], heightMetric: chair.h, heightRaw: chair.h / SCALE, centre: m([chair.cx, chair.h / 2, chair.cz]), topCentre: m([chair.cx, chair.h, chair.cz]) },
  signF: { letter: "F", heightMetric: F.h, bottomY: F.bottom, topY: fTop, centreX: F.cx, stemOnSmallerX: true, barsReachTowardPositiveX: true, readingNote: "seen from inside the room facing the back wall (looking toward -z), +x is right, so stem left and bars to the right is a correct F", stemMetric: { x: [fx0, fx0 + F.stroke], y: [F.bottom, fTop] }, topBarMetric: { x: [fx0, fx0 + F.w], y: [fTop - F.stroke, fTop] }, bboxMin: m([fx0, F.bottom, fz]), bboxMax: m([fx0 + F.w, fTop, fz]) },
  walkCameraMetric: { position: [0, 1.6, 2.0], lookAt: [0, 1.6, -4], note: "inside the room, facing the back wall; after conversion the world position is (0, 0.16, 0.8) in raw units" },
  files,
  spzNote: spzNote || "SPZ written with Spark transcodeSpz",
};
fs.writeFileSync(path.join(outDir, "set-01-truth.json"), JSON.stringify(truth, null, 2));
console.log("truth written");
