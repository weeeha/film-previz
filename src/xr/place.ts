import * as THREE from "three";
import { clampPitch, wrapHeading, type CameraPose } from "../camera/pose";
import type { Shot } from "../model/types";

const DEG = Math.PI / 180;

/**
 * Heading and pitch from the head's forward vector, by the convention in src/camera/pose.ts
 * (heading clockwise from above, 0 = the scene front, positive pitch looks up). Roll is 0 whatever the head's tilt,
 * so a slightly tilted head does not make a tilted shot. The position is taken as given, in the metric world frame.
 */
export function poseFromHeadset(
  positionM: [number, number, number],
  quaternion: [number, number, number, number],
  frontHeadingDeg = 0,
): CameraPose {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...quaternion));
  const worldHeading = Math.atan2(f.x, -f.z) / DEG;
  const pitch = Math.asin(Math.max(-1, Math.min(1, f.y))) / DEG;
  return {
    positionM: [...positionM],
    headingDeg: wrapHeading(worldHeading - frontHeadingDeg),
    pitchDeg: Object.is(pitch, -0) ? 0 : clampPitch(pitch),
    rollDeg: 0,
  };
}

/** `heightAboveGroundM` is the headset's y in the world frame (rig y plus head y in local-floor). */
export type PlacedPose = { pose: CameraPose; heightAboveGroundM: number };

export function createPlacementQueue(): { add(p: PlacedPose): void; drain(): PlacedPose[]; size(): number } {
  let items: PlacedPose[] = [];
  return {
    add(p) { items.push(p); },
    drain() { const out = items; items = []; return out; },
    size() { return items.length; },
  };
}

/**
 * After the session: save each queued pose, in order, as a new shot through `save` (the path the "Save shot" button
 * uses). A failed save does not stop the rest. Each failure goes to `onError` with the pose's index; with no
 * `onError` the failures are thrown together as an AggregateError after every pose has been tried.
 */
export async function savePlacedShots(
  queue: PlacedPose[],
  save: (p: PlacedPose, index: number) => Promise<Shot>,
  onError?: (err: unknown, index: number) => void,
): Promise<Shot[]> {
  const saved: Shot[] = [];
  const errors: unknown[] = [];
  for (let i = 0; i < queue.length; i++) {
    try {
      saved.push(await save(queue[i]!, i));
    } catch (err) {
      if (onError) onError(err, i); else errors.push(err);
    }
  }
  if (errors.length) throw new AggregateError(errors, `${errors.length} placed shot(s) could not be saved`);
  return saved;
}
