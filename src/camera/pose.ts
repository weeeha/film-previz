import * as THREE from "three";

// The one place where the spec's pose (section 4) meets a three.js camera.
//   headingDeg: clockwise seen from above, 0 = the scene front. The scene front is the heading
//               `frontHeadingDeg` in world terms; world heading 0 looks down -z, 90 looks down +x.
//   pitchDeg:   positive looks up.
//   rollDeg:    positive turns the camera clockwise seen from behind it (up vector leans right).
//   positionM:  world position, y up. Metres once the scene's scale is confirmed.

import type { CameraPose } from "../model/types";
export type { CameraPose };

const DEG = Math.PI / 180;

/** Wrap an angle into 0 up to (not including) 360. Never returns -0. */
export function wrapHeading(deg: number): number {
  const w = ((deg % 360) + 360) % 360;
  return w === 0 || w >= 360 ? 0 : w;
}

type Posed = Pick<THREE.Object3D, "position" | "quaternion" | "rotation" | "updateMatrixWorld">;

/** Set the camera's position and orientation from a pose. Leaves the lens alone. */
export function applyPose(camera: Posed, pose: CameraPose, frontHeadingDeg = 0): void {
  camera.position.set(...pose.positionM);
  camera.rotation.order = "YXZ";
  const yaw = -(pose.headingDeg + frontHeadingDeg) * DEG;
  camera.rotation.set(pose.pitchDeg * DEG, yaw, -pose.rollDeg * DEG, "YXZ");
  camera.updateMatrixWorld(true);
}

/** Read the pose back from a camera. Heading is in 0 up to 360. Pitch is exact up to plus or minus 90. */
export function readPose(camera: Pick<THREE.Object3D, "position" | "quaternion">, frontHeadingDeg = 0): CameraPose {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  const clean = (n: number) => (Object.is(n, -0) ? 0 : n);
  return {
    positionM: [camera.position.x, camera.position.y, camera.position.z],
    headingDeg: wrapHeading(-e.y / DEG - frontHeadingDeg),
    pitchDeg: clean(e.x / DEG),
    rollDeg: clean(-e.z / DEG),
  };
}

export const MAX_PITCH_DEG = 89;

export function clampPitch(deg: number): number {
  return Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, deg));
}
