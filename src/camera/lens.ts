import type { PerspectiveCamera } from "three";
import type { Sensor } from "./sensors";

const RAD = 180 / Math.PI;

/** Field of view in degrees across one sensor side: 2 * atan(side / (2 * f)). */
export function fovDeg(focalMm: number, sensorSideMm: number): number {
  return 2 * Math.atan(sensorSideMm / (2 * focalMm)) * RAD;
}

function checkAspect(aspect: number): void {
  if (!(aspect >= 1)) throw new Error(`aspect must be 1 or more, got ${aspect}`);
}

/**
 * The frame uses the full sensor width and a height of width / aspect,
 * so the horizontal field comes from the sensor width and the vertical from the cropped height.
 */
export function lensFov(focalMm: number, sensor: Sensor, aspect: number): { hfovDeg: number; vfovDeg: number } {
  checkAspect(aspect);
  return {
    hfovDeg: fovDeg(focalMm, sensor.widthMm),
    vfovDeg: fovDeg(focalMm, sensor.widthMm / aspect),
  };
}

export function applyLens(camera: PerspectiveCamera, focalMm: number, sensor: Sensor, aspect: number): void {
  checkAspect(aspect);
  camera.aspect = aspect;
  camera.filmGauge = sensor.widthMm;
  camera.setFocalLength(focalMm);
  camera.updateProjectionMatrix();
}
