import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyPose, readPose, wrapHeading, type CameraPose } from "../src/camera/pose";

const forward = (cam: THREE.Object3D) => new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
const cam = () => new THREE.PerspectiveCamera();

describe("pose convention", () => {
  it("heading 0 looks down -z, 90 looks down +x (clockwise from above), 180 down +z, 270 down -x", () => {
    const c = cam();
    const dirs: Array<[number, [number, number, number]]> = [[0, [0, 0, -1]], [90, [1, 0, 0]], [180, [0, 0, 1]], [270, [-1, 0, 0]]];
    for (const [h, d] of dirs) {
      applyPose(c, { positionM: [0, 1, 0], headingDeg: h, pitchDeg: 0, rollDeg: 0 });
      const f = forward(c);
      expect(f.x).toBeCloseTo(d[0], 9); expect(f.y).toBeCloseTo(d[1], 9); expect(f.z).toBeCloseTo(d[2], 9);
    }
  });
  it("positive pitch looks up", () => {
    const c = cam();
    applyPose(c, { positionM: [0, 1, 0], headingDeg: 0, pitchDeg: 30, rollDeg: 0 });
    expect(forward(c).y).toBeCloseTo(Math.sin(Math.PI / 6), 9);
  });
  it("positive roll turns the camera clockwise seen from behind it: its up vector leans to the right", () => {
    const c = cam();
    applyPose(c, { positionM: [0, 0, 0], headingDeg: 0, pitchDeg: 0, rollDeg: 10 });
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    expect(up.x).toBeGreaterThan(0);
  });
  it("the scene's front heading offsets the heading", () => {
    const c = cam();
    applyPose(c, { positionM: [0, 1, 0], headingDeg: 0, pitchDeg: 0, rollDeg: 0 }, 90);
    const f = forward(c);
    expect(f.x).toBeCloseTo(1, 9); // scene front is world heading 90
  });
  it("position is copied in metres, y up", () => {
    const c = cam();
    applyPose(c, { positionM: [1.2, 1.6, 3.1], headingDeg: 215, pitchDeg: -2, rollDeg: 0 });
    expect(c.position.toArray()).toEqual([1.2, 1.6, 3.1]);
  });
});

describe("pose round trip", () => {
  const cases: CameraPose[] = [
    { positionM: [1.2, 1.6, 3.1], headingDeg: 215, pitchDeg: -2, rollDeg: 0 },
    { positionM: [-4, 0.3, 0], headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
    { positionM: [0, 2.5, -2.25], headingDeg: 359.5, pitchDeg: 45, rollDeg: 7.5 },
    { positionM: [10, 1, 10], headingDeg: 90, pitchDeg: -80, rollDeg: -12 },
    { positionM: [0.25, 1, -0.75], headingDeg: 180, pitchDeg: 88.5, rollDeg: 30 },
  ];
  for (const front of [0, 37, 270]) {
    for (const p of cases) {
      it(`front ${front}: heading ${p.headingDeg} pitch ${p.pitchDeg} roll ${p.rollDeg}`, () => {
        const c = cam();
        applyPose(c, p, front);
        const r = readPose(c, front);
        expect(r.positionM).toEqual(p.positionM);
        const dh = Math.abs(((r.headingDeg - p.headingDeg + 540) % 360) - 180);
        expect(dh).toBeLessThan(1e-9);
        expect(r.pitchDeg).toBeCloseTo(p.pitchDeg, 9);
        expect(r.rollDeg).toBeCloseTo(p.rollDeg, 9);
      });
    }
  }
  it("a read pose applied again gives the same orientation (save and restore)", () => {
    const a = cam(), b = cam();
    applyPose(a, cases[2]!, 12);
    applyPose(b, readPose(a, 12), 12);
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(1e-6);
  });
});

describe("heading wrap-around", () => {
  it("wraps into 0 up to 360", () => {
    expect(wrapHeading(370)).toBe(10);
    expect(wrapHeading(-10)).toBe(350);
    expect(wrapHeading(360)).toBe(0);
    expect(wrapHeading(720.5)).toBeCloseTo(0.5, 9);
    expect(wrapHeading(-360)).toBe(0);
    expect(Object.is(wrapHeading(-0), 0)).toBe(true);
  });
  it("headings beyond a turn read back wrapped", () => {
    const c = cam();
    applyPose(c, { positionM: [0, 1, 0], headingDeg: 370, pitchDeg: 0, rollDeg: 0 });
    expect(readPose(c).headingDeg).toBeCloseTo(10, 9);
    applyPose(c, { positionM: [0, 1, 0], headingDeg: -10, pitchDeg: 0, rollDeg: 0 });
    expect(readPose(c).headingDeg).toBeCloseTo(350, 9);
  });
});
