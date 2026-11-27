// tests/lens.test.ts
import { describe, it, expect } from "vitest";
import { PerspectiveCamera } from "three";
import { lensFov, applyLens } from "../src/camera/lens";
import { SENSORS } from "../src/camera/sensors";

function sensor(id: string) {
  const s = SENSORS.find(x => x.id === id);
  if (!s) throw new Error(`no sensor ${id}`);
  return s;
}

const FF = sensor("full-frame");

// Reference values computed independently: 2 * atan(side / (2 * f)).
const cases = [
  { f: 24, a: 3 / 2, h: 73.74, v: 53.13 },
  { f: 35, a: 3 / 2, h: 54.43, v: 37.85 },
  { f: 50, a: 3 / 2, h: 39.60, v: 26.99 },
  { f: 85, a: 3 / 2, h: 23.91, v: 16.07 },
  { f: 24, a: 16 / 9, h: 73.74, v: 45.75 },
  { f: 35, a: 16 / 9, h: 54.43, v: 32.27 },
  { f: 50, a: 16 / 9, h: 39.60, v: 22.90 },
  { f: 85, a: 16 / 9, h: 23.91, v: 13.59 },
];

describe("lensFov", () => {
  for (const c of cases) {
    it(`${c.f} mm at ${c.a.toFixed(2)}`, () => {
      const r = lensFov(c.f, FF, c.a);
      expect(r.hfovDeg).toBeCloseTo(c.h, 2);
      expect(r.vfovDeg).toBeCloseTo(c.v, 2);
    });
  }
  it("rejects portrait aspect", () => {
    expect(() => lensFov(35, FF, 0.8)).toThrow();
  });
});

describe("applyLens", () => {
  it("sets the camera vertical fov and reads back the focal length", () => {
    const cam = new PerspectiveCamera();
    applyLens(cam, 35, FF, 16 / 9);
    expect(cam.fov).toBeCloseTo(32.27, 2);
    expect(cam.getFocalLength()).toBeCloseTo(35, 2);
    expect(cam.filmGauge).toBe(36);
  });
  it("rejects_portrait_aspect", () => {
    expect(() => applyLens(new PerspectiveCamera(), 35, FF, 0.8)).toThrow();
  });
  it("a Super 35 sensor gives a narrower field than full frame at the same focal length", () => {
    const s35 = sensor("super-35");
    expect(lensFov(35, s35, 16 / 9).hfovDeg).toBeLessThan(lensFov(35, FF, 16 / 9).hfovDeg);
  });
});
