import type * as THREE from "three";
import { applyLens, lensFov } from "./lens";
import { applyPose, readPose, wrapHeading, clampPitch, type CameraPose } from "./pose";
import { SENSORS, ASPECTS, type Sensor } from "./sensors";

export type ShotLens = { focalMm: number; sensor: Sensor; aspectId: string; aspect: number };

export type ShotState = {
  readonly lens: ShotLens;
  readonly pose: CameraPose;
  setLens(patch: Partial<Pick<ShotLens, "focalMm" | "sensor">> & { aspectId?: string }): void;
  /** Set any part of the pose. Heading is wrapped into 0 to 360 and pitch is held within 89 degrees. */
  setPose(patch: Partial<Omit<CameraPose, "positionM">> & { positionM?: [number, number, number] }): void;
  /** Take the pose from the shot camera as it stands (after the scale moved it). */
  syncFromCamera(): void;
  readonly frontHeadingDeg: () => number;
  readonly fov: () => { hfovDeg: number; vfovDeg: number };
  subscribe(fn: () => void): () => void;
};

/**
 * The shot's lens and pose, in one place. Every change goes through the real `applyLens` and `applyPose`
 * onto the shot camera, so the panels, the viewport and the frame grab read the same camera.
 */
export function createShotState(camera: THREE.PerspectiveCamera, frontHeadingDeg: () => number = () => 0): ShotState {
  const ff = SENSORS[0]!;
  const asp = ASPECTS[0]!;
  const lens: ShotLens = { focalMm: 50, sensor: { ...ff }, aspectId: asp.id, aspect: asp.value };
  let pose: CameraPose = readPose(camera, frontHeadingDeg());
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());

  applyLens(camera, lens.focalMm, lens.sensor, lens.aspect);

  const state: ShotState = {
    get lens() { return lens; },
    get pose() { return pose; },
    setLens(patch) {
      const next = { ...lens };
      if (patch.focalMm !== undefined) next.focalMm = patch.focalMm;
      if (patch.sensor !== undefined) next.sensor = patch.sensor;
      if (patch.aspectId !== undefined) {
        const a = ASPECTS.find((x) => x.id === patch.aspectId);
        if (!a) throw new Error(`unknown aspect ${patch.aspectId}`);
        next.aspectId = a.id;
        next.aspect = a.value;
      }
      if (!(next.focalMm > 0) || !(next.sensor.widthMm > 0) || !(next.sensor.heightMm > 0)) return; // ignore half-typed values
      Object.assign(lens, next);
      applyLens(camera, lens.focalMm, lens.sensor, lens.aspect);
      notify();
    },
    setPose(patch) {
      const next: CameraPose = {
        positionM: patch.positionM ?? pose.positionM,
        headingDeg: wrapHeading(patch.headingDeg ?? pose.headingDeg),
        pitchDeg: clampPitch(patch.pitchDeg ?? pose.pitchDeg),
        rollDeg: patch.rollDeg ?? pose.rollDeg,
      };
      if (!next.positionM.every(Number.isFinite) || !Number.isFinite(next.headingDeg + next.pitchDeg + next.rollDeg)) return;
      pose = next;
      applyPose(camera, pose, frontHeadingDeg());
      notify();
    },
    syncFromCamera() {
      pose = readPose(camera, frontHeadingDeg());
      notify();
    },
    frontHeadingDeg,
    fov: () => lensFov(lens.focalMm, lens.sensor, lens.aspect),
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
  return state;
}
