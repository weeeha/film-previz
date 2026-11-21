import { describe, it, expect } from "vitest";
import { buildShot, aspectIdFor, stripLine, heightText, frameFileFor } from "../src/model/shotRecord";
import { validateShot } from "../src/model/schema";
import { SENSORS } from "../src/camera/sensors";
import { makeShot, HASH_A } from "./helpers/model";
import { sceneIdForHash } from "../src/model/store";

const base = {
  id: "shot-001", number: 1, sceneId: sceneIdForHash(HASH_A),
  lens: { focalMm: 35, sensor: SENSORS[0]!, aspect: 16 / 9 },
  pose: { positionM: [1, 1.6, 2] as [number, number, number], headingDeg: 20, pitchDeg: -3, rollDeg: 0 },
  scaleConfirmed: true, frame: { widthPx: 1920, heightPx: 1080 }, referencePhoto: null,
  details: { name: "Entrance", sizeLabel: "WS" as const, job: "Show the room", action: "She enters", notes: "" },
};

describe("buildShot", () => {
  it("makes a record that passes validateShot, static and without stand-ins", () => {
    const s = buildShot(base);
    expect(validateShot(s)).toEqual({ ok: true });
    expect(s.move).toEqual({ kind: "static", durationS: null, ease: null, endPose: null });
    expect(s.standIns).toEqual([]);
    expect(s.heightAboveGroundM).toBe(1.6);
    expect(s.frame.file).toBe(frameFileFor("shot-001"));
    expect(s.lens.hfovDeg).toBeCloseTo(54.43, 2);
  });
  it("passes for a 2.39:1 frame at 1920 x 803 and keeps createdAt on update", () => {
    const prev = makeShot(base.sceneId, 1, { createdAt: "2026-01-01T00:00:00.000Z" });
    const s = buildShot({ ...base, lens: { ...base.lens, aspect: 2.39 }, frame: { widthPx: 1920, heightPx: 803 }, previous: prev, scaleConfirmed: false });
    expect(validateShot(s)).toEqual({ ok: true });
    expect(s.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(s.standIns).toEqual(prev.standIns);
    expect(s.scaleConfirmed).toBe(false);
  });
});

describe("labels", () => {
  it("finds the aspect option", () => { expect(aspectIdFor(16 / 9)).toBe("16:9"); expect(aspectIdFor(2.39)).toBe("2.39:1"); expect(aspectIdFor(1.5)).toBe("3:2"); });
  it("words the height line", () => {
    expect(stripLine(makeShot("scene-aaaaaa", 1, { heightAboveGroundM: 1.6 }))).toBe("35 mm, eye 1.6 m");
    expect(stripLine(makeShot("scene-aaaaaa", 1, { heightAboveGroundM: 1.23 }))).toBe("35 mm, height 1.23 m");
    expect(stripLine(makeShot("scene-aaaaaa", 1, { heightAboveGroundM: 0.64, scaleConfirmed: false }))).toBe("35 mm, 0.64 units, unverified");
    expect(heightText(makeShot("scene-aaaaaa", 1, { heightAboveGroundM: 1.0 }))).toBe("1.0 m");
  });
});
