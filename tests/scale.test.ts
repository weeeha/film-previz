import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { scaleFromReference, fromMarbleMetadata, applyScale, heightPresetsState, noScale, manualScale } from "../src/scale/scale";
import { createScaleStore } from "../src/scale/store";
import { saveScale, loadScale, scaleKey, type StorageLike } from "../src/scale/persist";

describe("scaleFromReference", () => {
  it("returns 2.5 for a 0.8 raw door of 2.0 m", () => {
    expect(scaleFromReference(0.8, 2.0)).toBeCloseTo(2.5, 12);
  });
  it("throws on a zero or negative measured distance", () => {
    expect(() => scaleFromReference(0, 2.0)).toThrow();
    expect(() => scaleFromReference(-1, 2.0)).toThrow();
  });
  it("throws on a known length that is not positive and finite", () => {
    expect(() => scaleFromReference(0.8, 0)).toThrow();
    expect(() => scaleFromReference(0.8, NaN)).toThrow();
  });
});

describe("fromMarbleMetadata", () => {
  it("is none when both values are null", () => {
    expect(fromMarbleMetadata({ metric_scale_factor: null, ground_plane_offset: null }).source).toBe("none");
  });
  it("is none when the factor is exactly 1.0, because the schema says scale was not inferred", () => {
    expect(fromMarbleMetadata({ metric_scale_factor: 1.0, ground_plane_offset: 0 }).source).toBe("none");
  });
  it("is marble with the factor and the offset otherwise", () => {
    const r = fromMarbleMetadata({ metric_scale_factor: 2.4, ground_plane_offset: -0.1 });
    expect(r).toEqual({ factor: 2.4, groundOffsetM: -0.1, source: "marble" });
  });
  it("treats a null offset as 0 when the factor is set", () => {
    expect(fromMarbleMetadata({ metric_scale_factor: 2.4, ground_plane_offset: null }).groundOffsetM).toBe(0);
  });
});

describe("applyScale", () => {
  it("scales the group and shifts it so the floor is y = 0", () => {
    const g = new THREE.Group();
    const floorLocalY = -0.48; // raw units, as in the test set
    const factor = 2.5;
    applyScale(g, factor, factor * floorLocalY); // groundOffsetM = factor * floorLocalY, subtracted after scaling
    const p = g.localToWorld(new THREE.Vector3(0, floorLocalY, 0));
    expect(p.y).toBeCloseTo(0, 9);
    expect(g.scale.x).toBe(2.5);
    expect(g.scale.y).toBe(2.5);
    expect(g.scale.z).toBe(2.5);
  });
  it("can be applied twice without compounding", () => {
    const g = new THREE.Group();
    applyScale(g, 2, 0.5);
    applyScale(g, 3, 0.9);
    expect(g.scale.x).toBe(3);
    expect(g.position.y).toBeCloseTo(-0.9, 12);
  });
});

describe("height presets", () => {
  it("unconfirmed_scale_disables_height_presets", () => {
    const s = heightPresetsState(noScale());
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/scale/i);
    expect(s.presets.every((p) => !p.enabled)).toBe(true);
  });
  it("a marble scale the user has not confirmed also disables them", () => {
    const s = heightPresetsState({ ...noScale(), source: "marble", metricScaleFactor: 2.4, confirmedAt: null });
    expect(s.enabled).toBe(false);
  });
  it("a confirmed manual scale enables all four presets", () => {
    const s = heightPresetsState(manualScale(2.5, 1.2, { label: "door", knownLengthM: 2, measuredRaw: 0.8 }, "2026-11-21T00:00:00Z"));
    expect(s.enabled).toBe(true);
    expect(s.reason).toBeNull();
    expect(s.presets.map((p) => p.id)).toEqual(["low", "hip", "eye", "high"]);
    expect(s.presets.every((p) => p.enabled)).toBe(true);
  });
});

describe("scale store", () => {
  it("notifies subscribers and stops after unsubscribe", () => {
    const store = createScaleStore();
    const seen: string[] = [];
    const off = store.subscribe((s) => seen.push(s.source));
    store.set(manualScale(2.5, 1.2, null, "t"));
    off();
    store.set(noScale());
    expect(seen).toEqual(["manual"]);
    expect(store.get().source).toBe("none");
  });
});

describe("scale persistence", () => {
  const mem = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  };
  it("round trips a record under a key that holds the hash", () => {
    const st = mem();
    const rec = manualScale(2.5, 1.2, { label: "door", knownLengthM: 2, measuredRaw: 0.8 }, "2026-11-21T00:00:00Z");
    saveScale("abc123", { scale: rec, figureXZ: [1, 2] }, st);
    expect([...st.data.keys()][0]).toContain("abc123");
    expect(loadScale("abc123", st)).toEqual({ scale: rec, figureXZ: [1, 2] });
    expect(loadScale("other", st)).toBeNull();
    expect(scaleKey("abc123")).toContain("abc123");
  });
  it("returns null for a damaged record", () => {
    const st = mem();
    st.setItem(scaleKey("h"), "{not json");
    expect(loadScale("h", st)).toBeNull();
    st.setItem(scaleKey("h"), JSON.stringify({ scale: { source: "manual" } }));
    expect(loadScale("h", st)).toBeNull();
  });
});
