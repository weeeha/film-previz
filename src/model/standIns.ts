// Stand-in maths and the working set. No DOM and no meshes: the readout builds a camera only to project two points.
import * as THREE from "three";
import { applyLens } from "../camera/lens";
import { applyPose } from "../camera/pose";
import type { Sensor } from "../camera/sensors";
import type { CameraPose, StandIn } from "./types";

export const DEFAULT_HEIGHT_M = 1.75;
export const DEFAULT_HEAD_HEIGHT_M = 0.23;
export const MIN_HEIGHT_M = 0.5;
export const MAX_HEIGHT_M = 2.5;
const MIN_HEAD_M = 0.05;

export type FrameReadout = {
  state: "in-frame" | "partly-out" | "out-of-frame" | "behind-camera";
  /** Share of the frame height the figure spans, or null when it is behind the camera. */
  heightPct: number | null;
  headPct: number | null;
  /** Horizontal distance from the camera. */
  distanceM: number;
};

/**
 * How large a stand-in is in the frame. Feet and top are projected through the real lens and pose; the percent is the
 * distance between the two projected points over the frame height (NDC spans 2 on y, 2 x aspect on x, in the same units).
 */
export function standInReadout(
  s: StandIn,
  pose: CameraPose,
  lens: { focalMm: number; sensor: Sensor; aspect: number },
  frontHeadingDeg = 0,
): FrameReadout {
  const cam = new THREE.PerspectiveCamera(50, lens.aspect, 0.05, 1000);
  applyLens(cam, lens.focalMm, lens.sensor, lens.aspect);
  applyPose(cam, pose, frontHeadingDeg);
  const [x, y, z] = s.positionM;
  const feet = new THREE.Vector3(x, y, z);
  const top = new THREE.Vector3(x, y + s.heightM, z);
  const distanceM = Math.hypot(x - pose.positionM[0], z - pose.positionM[2]);

  const inCam = (p: THREE.Vector3) => p.clone().applyMatrix4(cam.matrixWorldInverse);
  const fc = inCam(feet), tc = inCam(top);
  const feetBehind = fc.z >= 0, topBehind = tc.z >= 0;
  if (feetBehind && topBehind) return { state: "behind-camera", heightPct: null, headPct: null, distanceM };

  const fn = feet.clone().project(cam), tn = top.clone().project(cam);
  // x spans 2 x aspect for the same unit as y spanning 2, so scale x by the aspect before taking the length.
  const len = Math.hypot((tn.x - fn.x) * lens.aspect, tn.y - fn.y);
  const pct = (len / 2) * 100;
  const inside = (p: THREE.Vector3) => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  let state: FrameReadout["state"];
  if (feetBehind || topBehind) state = "partly-out";
  else if (inside(fn) && inside(tn)) state = "in-frame";
  else if ((fn.x > 1 && tn.x > 1) || (fn.x < -1 && tn.x < -1) || (fn.y > 1 && tn.y > 1) || (fn.y < -1 && tn.y < -1)) state = "out-of-frame";
  else state = "partly-out";
  return { state, heightPct: pct, headPct: pct * (s.headHeightM / s.heightM), distanceM };
}

const numberOf = (id: string): number => { const m = /(\d+)$/.exec(id); return m ? Number(m[1]) : 0; };

/** "standin-1"; the highest number in the list plus 1. */
export function nextStandInId(list: Pick<StandIn, "id">[]): string {
  return `standin-${list.reduce((m, s) => Math.max(m, numberOf(s.id)), 0) + 1}`;
}

/** "Person A" to "Person Z", then "Person 27", skipping labels already used. */
export function nextStandInLabel(list: Pick<StandIn, "label">[]): string {
  const used = new Set(list.map((s) => s.label));
  for (let i = 0; ; i++) {
    const label = `Person ${i < 26 ? String.fromCharCode(65 + i) : String(i + 1)}`;
    if (!used.has(label)) return label;
  }
}

export type StandInSet = {
  list(): StandIn[];
  add(positionM: [number, number, number], headingDeg: number): StandIn;
  update(id: string, patch: Partial<Omit<StandIn, "id">>): void;
  remove(id: string): void;
  replace(list: StandIn[]): void;
  subscribe(fn: () => void): () => void;
};

const clone = (s: StandIn): StandIn => structuredClone(s);

export function createStandInSet(): StandInSet {
  let items: StandIn[] = [];
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());
  return {
    list: () => items.map(clone),
    add(positionM, headingDeg) {
      const s: StandIn = {
        id: nextStandInId(items),
        label: nextStandInLabel(items),
        heightM: DEFAULT_HEIGHT_M,
        headHeightM: DEFAULT_HEAD_HEIGHT_M,
        positionM: [...positionM],
        headingDeg,
      };
      items.push(s);
      notify();
      return clone(s);
    },
    update(id, patch) {
      const s = items.find((x) => x.id === id);
      if (!s) return;
      const next: StandIn = { ...s, ...structuredClone(patch) };
      next.heightM = Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, next.heightM));
      next.headHeightM = Math.min(next.heightM, Math.max(MIN_HEAD_M, next.headHeightM));
      Object.assign(s, next);
      notify();
    },
    remove(id) {
      items = items.filter((x) => x.id !== id);
      notify();
    },
    replace(list) {
      items = list.map(clone);
      notify();
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
