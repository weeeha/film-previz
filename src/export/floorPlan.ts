// The floor plan of the export: the collider mesh cut like an architect's plan, with numbered cameras,
// stand-ins, markers and the action axis. The model and the transform are pure and unit tested.
// Only drawFloorPlan and floorPlanPng need a canvas.
import type { Scene, Shot } from "../model/types";

export const FLOOR_PLAN_FILE = "floor-plan.png";
export const CUT_HEIGHT_M = 1.0;
export const LOW_CUT_HEIGHT_M = 0.3;
export const FLOOR_PLAN_WIDTH_PX = 2000;

const DEG = Math.PI / 180;
const WEDGE_M = 1.2;
const PAD_M = 0.5;
const TITLE_STRIP_PX = 70;

export type Segment = [x1: number, z1: number, x2: number, z2: number]; // metres

/** `tri` holds 9 numbers per triangle, world frame, metres. Each triangle that crosses the plane gives one segment. */
export function sliceTriangles(tri: Float32Array, y: number): Segment[] {
  const out: Segment[] = [];
  const hit: number[] = [];
  for (let i = 0; i + 8 < tri.length; i += 9) {
    hit.length = 0;
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const ya = tri[i + a * 3 + 1]!, yb = tri[i + b * 3 + 1]!;
      if ((ya >= y) === (yb >= y)) continue; // both on the same side: the edge does not cross
      const t = (y - ya) / (yb - ya);
      hit.push(
        tri[i + a * 3]! + t * (tri[i + b * 3]! - tri[i + a * 3]!),
        tri[i + a * 3 + 2]! + t * (tri[i + b * 3 + 2]! - tri[i + a * 3 + 2]!),
      );
    }
    if (hit.length === 4) out.push([hit[0]!, hit[1]!, hit[2]!, hit[3]!]);
  }
  return out;
}

export type FloorPlan = {
  title: string; // "<scene name>, floor plan, <YYYY-MM-DD>, cut at 1.0 m"
  boundsM: { minX: number; maxX: number; minZ: number; maxZ: number }; // everything drawn, plus 0.5 m
  walls: Segment[]; low: Segment[]; hasCollider: boolean;
  cameras: { number: number; x: number; z: number; headingDeg: number; hfovDeg: number }[];
  standIns: { label: string; x: number; z: number; headingDeg: number; shots: number[] }[];
  markers: { label: string; x: number; z: number }[];
  axis: { label: string; ax: number; az: number; bx: number; bz: number } | null;
  frontHeadingDeg: number;
};

/** The world direction of a scene heading as x and z. World heading 0 looks down -z and 90 down +x (src/camera/pose.ts). */
const dir = (headingDeg: number, frontHeadingDeg: number): [number, number] => {
  const h = (headingDeg + frontHeadingDeg) * DEG;
  return [Math.sin(h), -Math.cos(h)];
};

/** Throws when the scene's scale is not confirmed. `tri` is null when no collider is loaded. */
export function buildFloorPlan(scene: Scene, shots: Shot[], tri: Float32Array | null, date: string = new Date().toISOString().slice(0, 10)): FloorPlan {
  if (!scene.scale.confirmedAt) throw new Error("Floor plan: scale not confirmed");
  const front = scene.frontHeadingDeg;
  const ordered = [...shots].sort((a, b) => a.number - b.number);
  const walls = tri ? sliceTriangles(tri, CUT_HEIGHT_M) : [];
  const low = tri ? sliceTriangles(tri, LOW_CUT_HEIGHT_M) : [];

  const cameras = ordered.map((s) => ({
    number: s.number, x: s.pose.positionM[0], z: s.pose.positionM[2], headingDeg: s.pose.headingDeg, hfovDeg: s.lens.hfovDeg,
  }));
  const places = new Map<string, FloorPlan["standIns"][number]>();
  for (const s of ordered) {
    for (const f of s.standIns) {
      const x = f.positionM[0], z = f.positionM[2];
      const key = `${f.label}|${x.toFixed(2)}|${z.toFixed(2)}`;
      const have = places.get(key);
      if (have) { if (!have.shots.includes(s.number)) have.shots.push(s.number); }
      else places.set(key, { label: f.label, x, z, headingDeg: f.headingDeg, shots: [s.number] });
    }
  }
  const standIns = [...places.values()];
  const markers = scene.markers.map((m) => ({ label: m.label, x: m.positionM[0], z: m.positionM[2] }));
  const a = scene.actionAxis;
  const axis = a ? { label: a.label, ax: a.aM[0], az: a.aM[1], bx: a.bM[0], bz: a.bM[1] } : null;

  const xs: number[] = [], zs: number[] = [];
  const add = (x: number, z: number) => { xs.push(x); zs.push(z); };
  for (const w of [...walls, ...low]) { add(w[0], w[1]); add(w[2], w[3]); }
  for (const c of cameras) {
    add(c.x, c.z);
    for (const sign of [-1, 1]) {
      const [dx, dz] = dir(c.headingDeg + (sign * c.hfovDeg) / 2, front);
      add(c.x + dx * WEDGE_M, c.z + dz * WEDGE_M);
    }
  }
  for (const s of standIns) add(s.x, s.z);
  for (const m of markers) add(m.x, m.z);
  if (axis) { add(axis.ax, axis.az); add(axis.bx, axis.bz); }
  if (!xs.length) add(0, 0);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  if (maxX - minX < 1) { const c = (minX + maxX) / 2; minX = c - 0.5; maxX = c + 0.5; }
  if (maxZ - minZ < 1) { const c = (minZ + maxZ) / 2; minZ = c - 0.5; maxZ = c + 0.5; }
  return {
    title: `${scene.name}, floor plan, ${date}, cut at ${CUT_HEIGHT_M.toFixed(1)} m`,
    boundsM: { minX: minX - PAD_M, maxX: maxX + PAD_M, minZ: minZ - PAD_M, maxZ: maxZ + PAD_M },
    walls, low, hasCollider: tri !== null && tri.length > 0,
    cameras, standIns, markers, axis, frontHeadingDeg: front,
  };
}

export type PlanTransform = { widthPx: number; heightPx: number; pxPerM: number; toPx(x: number, z: number): [number, number] };

/** Heading 0 points up the page (turned by the scene's front heading). heightPx follows the bounds, capped at 2 times widthPx. */
export function planTransform(plan: FloorPlan, widthPx = FLOOR_PLAN_WIDTH_PX, marginPx = 90): PlanTransform {
  const f = plan.frontHeadingDeg * DEG;
  const cos = Math.cos(f), sin = Math.sin(f);
  // page right u and page up v of a world point; the point along world heading `front` has u = 0 and v = 1
  const uOf = (x: number, z: number) => x * cos + z * sin;
  const vOf = (x: number, z: number) => x * sin - z * cos;
  const b = plan.boundsM;
  const corners: [number, number][] = [[b.minX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.minZ], [b.maxX, b.maxZ]];
  const us = corners.map(([x, z]) => uOf(x, z)), vs = corners.map(([x, z]) => vOf(x, z));
  const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
  const wM = maxU - minU, hM = maxV - minV;
  const maxH = 2 * widthPx;
  let pxPerM = (widthPx - 2 * marginPx) / wM;
  let heightPx = hM * pxPerM + 2 * marginPx + TITLE_STRIP_PX;
  if (heightPx > maxH) { heightPx = maxH; pxPerM = (maxH - 2 * marginPx - TITLE_STRIP_PX) / hM; }
  heightPx = Math.round(heightPx);
  // centre the content in the space left under the title strip
  const ox = widthPx / 2 - ((minU + maxU) / 2) * pxPerM;
  const oy = TITLE_STRIP_PX + (heightPx - TITLE_STRIP_PX) / 2 + ((minV + maxV) / 2) * pxPerM;
  return { widthPx, heightPx, pxPerM, toPx: (x, z) => [ox + uOf(x, z) * pxPerM, oy - vOf(x, z) * pxPerM] };
}

const INK = "#111111", GREY = "#9a9da3", CAM = "#1b5fc4", CAM_FILL = "rgba(27,95,196,0.14)", FIG = "#b3470f", AXIS = "#7a1fa2", MARK = "#2a6b3a";

export function drawFloorPlan(ctx: CanvasRenderingContext2D, plan: FloorPlan, t: PlanTransform): void {
  const f = plan.frontHeadingDeg;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, t.widthPx, t.heightPx);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const stroke = (segs: Segment[], color: string, w: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
    for (const s of segs) { const [x1, y1] = t.toPx(s[0], s[1]); const [x2, y2] = t.toPx(s[2], s[3]); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
  };
  stroke(plan.low, GREY, 1.5);
  stroke(plan.walls, INK, 3);

  const font = (px: number, weight = 400) => { ctx.font = `${weight} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`; };
  const halo = (text: string, x: number, y: number, color: string) => {
    ctx.lineWidth = 5; ctx.strokeStyle = "#ffffff"; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };

  // action axis
  if (plan.axis) {
    const a = plan.axis;
    const [x1, y1] = t.toPx(a.ax, a.az), [x2, y2] = t.toPx(a.bx, a.bz);
    ctx.strokeStyle = AXIS; ctx.lineWidth = 3; ctx.setLineDash([16, 10]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    font(24, 600); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    halo(`Action axis: ${a.label}`, (x1 + x2) / 2, (y1 + y2) / 2 - 8, AXIS);
  }

  // markers: crosses with labels
  for (const m of plan.markers) {
    const [x, y] = t.toPx(m.x, m.z);
    ctx.strokeStyle = MARK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 9, y - 9); ctx.lineTo(x + 9, y + 9); ctx.moveTo(x + 9, y - 9); ctx.lineTo(x - 9, y + 9); ctx.stroke();
    font(22); ctx.textAlign = "left"; ctx.textBaseline = "middle";
    halo(m.label, x + 14, y, MARK);
  }

  // stand-ins: circle, facing tick, label with the shots that use it
  for (const s of plan.standIns) {
    const [x, y] = t.toPx(s.x, s.z);
    const [dx, dz] = dir(s.headingDeg, f);
    const [tx, ty] = t.toPx(s.x + dx * 0.3, s.z + dz * 0.3);
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = FIG; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
    font(22, 600); ctx.textAlign = "left"; ctx.textBaseline = "top";
    halo(`${s.label} (shots ${s.shots.join(", ")})`, x + 18, y + 12, FIG);
  }

  // cameras: wedge of the horizontal field of view, circle with the shot number
  for (const c of plan.cameras) {
    const [cx, cy] = t.toPx(c.x, c.z);
    ctx.fillStyle = CAM_FILL; ctx.strokeStyle = CAM; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const [dx, dz] = dir(c.headingDeg - c.hfovDeg / 2 + (c.hfovDeg * i) / steps, f);
      const [px, py] = t.toPx(c.x + dx * WEDGE_M, c.z + dz * WEDGE_M);
      ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  for (const c of plan.cameras) {
    const [cx, cy] = t.toPx(c.x, c.z);
    ctx.fillStyle = CAM; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; font(26, 700); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(c.number), cx, cy + 1);
  }

  // title, front arrow, scale bar, notes
  font(30, 600); ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(plan.title, 40, TITLE_STRIP_PX / 2);
  const ax = t.widthPx - 70, ay = TITLE_STRIP_PX + 90;
  ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(ax, ay + 50); ctx.lineTo(ax, ay - 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax, ay - 40); ctx.lineTo(ax - 12, ay - 16); ctx.lineTo(ax + 12, ay - 16); ctx.closePath(); ctx.fill();
  font(24, 600); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("Front", ax, ay + 58);
  const bx = 40, by = t.heightPx - 50, len = t.pxPerM;
  ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + len, by); ctx.moveTo(bx, by - 9); ctx.lineTo(bx, by + 9); ctx.moveTo(bx + len, by - 9); ctx.lineTo(bx + len, by + 9); ctx.stroke();
  font(24); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText("1 m", bx + len + 14, by);
  if (!plan.hasCollider) {
    font(26); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("No collider mesh was loaded, so walls are not drawn.", t.widthPx / 2, t.heightPx - 50);
  }
  ctx.restore();
}

export function floorPlanPng(plan: FloorPlan, widthPx = FLOOR_PLAN_WIDTH_PX): Uint8Array {
  const t = planTransform(plan, widthPx);
  const canvas = document.createElement("canvas");
  canvas.width = t.widthPx;
  canvas.height = t.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for the floor plan");
  drawFloorPlan(ctx, plan, t);
  // toDataURL is synchronous, as in frameGrab.ts
  const b64 = canvas.toDataURL("image/png").split(",")[1];
  if (!b64) throw new Error("PNG encoding failed");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
