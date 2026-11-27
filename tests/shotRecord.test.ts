import { describe, it, test, expect } from "vitest";
import { buildShot, aspectIdFor, stripLine, heightText, frameFileFor } from "../src/model/shotRecord";
import { validateShot } from "../src/model/schema";
import { SENSORS } from "../src/camera/sensors";
import { makeShot, HASH_A } from "./helpers/model";
import { sceneIdForHash } from "../src/model/store";
import type { StandIn } from "../src/model/types";

const base = {
  id: "shot-001", number: 1, sceneId: sceneIdForHash(HASH_A),
  lens: { focalMm: 35, sensor: SENSORS[0]!, aspect: 16 / 9 },
  standIns: [] as StandIn[],
  move: { kind: "static" as const, durationS: null, ease: null, endPose: null },
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
    expect(s.scaleConfirmed).toBe(false);
  });
});

describe("move", () => {
  it("writes the move it is given, as a copy", () => {
    const move = { kind: "pan" as const, durationS: 4, ease: "linear" as const, endPose: { positionM: [1, 1.6, 2] as [number, number, number], headingDeg: 50, pitchDeg: -3, rollDeg: 0 } };
    const s = buildShot({ ...base, move });
    expect(s.move).toEqual(move);
    expect(s.move.endPose).not.toBe(move.endPose);
    expect(validateShot(s)).toEqual({ ok: true });
  });
});

describe("stand-ins", () => {
  const figA: StandIn = { id: "standin-1", label: "Person A", heightM: 1.75, headHeightM: 0.23, positionM: [0, 0, -4], headingDeg: 0 };
  const figB: StandIn = { id: "standin-2", label: "Person B", heightM: 1.62, headHeightM: 0.23, positionM: [1, 0, -5], headingDeg: 180 };
  test("update_keeps_the_stage_stand_ins", () => {
    const previous = buildShot({ ...base, standIns: [figA, figB] });
    const updated = buildShot({ ...base, previous, standIns: [figA] });
    expect(updated.standIns).toEqual([figA]);
    expect(updated.standIns[0]).not.toBe(figA);
    expect(validateShot(updated)).toEqual({ ok: true });
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
