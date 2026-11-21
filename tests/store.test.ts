import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { openStore, type Store } from "../src/model/store";
import { validateShot, validateScene } from "../src/model/schema";
import { lensFov } from "../src/camera/lens";
import { HASH_A, HASH_B, makeScene, makeShot } from "./helpers/model";

let store: Store;
beforeEach(async () => { store = await openStore(new IDBFactory()); });

describe("scenes and shots", () => {
  it("saves a scene and a shot and reads them back equal", async () => {
    const scene = makeScene();
    const shot = makeShot(scene.id);
    await store.saveScene(scene);
    await store.saveShot(shot);
    expect(await store.getScene(scene.id)).toEqual(scene);
    expect(await store.getShot(scene.id, shot.id)).toEqual(shot);
    expect(await store.getSceneByHash(HASH_A)).toEqual(scene);
  });

  it("rejects a shot whose scene does not exist, and stores nothing", async () => {
    const shot = makeShot(makeScene(HASH_B).id);
    await expect(store.saveShot(shot, new Blob(["x"]))).rejects.toThrow(/No scene/);
    expect(await store.listShots(shot.sceneId)).toEqual([]);
    expect(await store.getFrame(shot.sceneId, shot.id)).toBeNull();
  });

  it("rejects an invalid shot or scene", async () => {
    const scene = makeScene();
    await store.saveScene(scene);
    const bad = makeShot(scene.id);
    bad.lens.aspect = 0.8;
    await expect(store.saveShot(bad)).rejects.toThrow(/aspect/);
    await expect(store.saveScene({ ...scene, id: "nope" })).rejects.toThrow(/id/);
  });

  it("lists scenes with shot counts and shots ordered by number", async () => {
    const a = makeScene(HASH_A), b = makeScene(HASH_B, { createdAt: "2026-11-21T11:00:00.000Z" });
    await store.saveScene(a); await store.saveScene(b);
    await store.saveShot(makeShot(a.id, 3)); await store.saveShot(makeShot(a.id, 1)); await store.saveShot(makeShot(a.id, 2));
    await store.saveShot(makeShot(b.id, 1)); // same shot id in another scene does not collide
    expect((await store.listScenes()).map((s) => [s.scene.id, s.shotCount])).toEqual([[a.id, 3], [b.id, 1]]);
    expect((await store.listShots(a.id)).map((s) => s.number)).toEqual([1, 2, 3]);
    expect((await store.listShots(b.id)).length).toBe(1);
  });

  it("gives the next shot number and id", async () => {
    const a = makeScene();
    await store.saveScene(a);
    expect(await store.nextShotId(a.id)).toEqual({ number: 1, id: "shot-001" });
    await store.saveShot(makeShot(a.id, 1)); await store.saveShot(makeShot(a.id, 2));
    expect(await store.nextShotId(a.id)).toEqual({ number: 3, id: "shot-003" });
  });

  it("keeps the frame blob apart from the shot record", async () => {
    const a = makeScene();
    await store.saveScene(a);
    const shot = makeShot(a.id);
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" });
    await store.saveShot(shot, jpeg);
    const got = await store.getFrame(a.id, shot.id);
    expect(got?.type).toBe("image/jpeg");
    expect([...new Uint8Array(await got!.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(JSON.stringify(await store.getShot(a.id, shot.id))).not.toContain("255,216");
    await expect(store.saveFrame(a.id, "shot-009", jpeg)).rejects.toThrow(/No shot/);
  });

  it("reorders, duplicates and deletes", async () => {
    const a = makeScene();
    await store.saveScene(a);
    for (const n of [1, 2, 3]) await store.saveShot(makeShot(a.id, n), new Blob([`f${n}`], { type: "image/jpeg" }));
    const re = await store.reorderShots(a.id, ["shot-003", "shot-001", "shot-002"]);
    expect(re.map((s) => [s.id, s.number])).toEqual([["shot-003", 1], ["shot-001", 2], ["shot-002", 3]]);
    expect((await store.listShots(a.id)).map((s) => s.id)).toEqual(["shot-003", "shot-001", "shot-002"]);
    await expect(store.reorderShots(a.id, ["shot-001"])).rejects.toThrow(/every shot/);
    await expect(store.reorderShots(a.id, ["shot-001", "shot-001", "shot-002"])).rejects.toThrow(/every shot/);

    const copy = await store.duplicateShot(a.id, "shot-002");
    expect(copy.id).toBe("shot-004");
    expect(copy.number).toBe(4);
    expect(copy.name).toBe("Shot 2 copy");
    expect(copy.frame.file).toBe("shot-004.jpg");
    expect(await (await store.getFrame(a.id, "shot-004"))!.text()).toBe("f2");
    expect(validateShot(copy)).toEqual({ ok: true });

    await store.deleteShot(a.id, "shot-001");
    expect(await store.getShot(a.id, "shot-001")).toBeNull();
    expect(await store.getFrame(a.id, "shot-001")).toBeNull();
    expect((await store.listShots(a.id)).map((s) => s.number)).toEqual([1, 3, 4]);
    expect(await store.nextShotNumber(a.id)).toBe(5);
  });
});

describe("re-opening a file", () => {
  const file = (sha256: string) => ({ name: "set-01-2m.spz", bytes: 1234, sha256 });

  it("returns a new scene draft for an unknown file", async () => {
    const r = await store.openSceneFile(file(HASH_A));
    expect(r.kind).toBe("new");
    if (r.kind !== "new") return;
    expect(validateScene(r.draft)).toEqual({ ok: true });
    expect(r.draft.name).toBe("set-01-2m");
    expect(r.draft.file.format).toBe("spz");
  });

  it("matches by hash and attaches the shots", async () => {
    const a = makeScene();
    await store.saveScene(a); await store.saveShot(makeShot(a.id));
    const r = await store.openSceneFile(file(HASH_A));
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.shots.map((s) => s.id)).toEqual(["shot-001"]);
  });

  it("raises a hash mismatch, with no shots, when a file with a different hash is opened for a stored scene", async () => {
    const a = makeScene();
    await store.saveScene(a); await store.saveShot(makeShot(a.id));
    // The planted fault: one character of the hash changed.
    const altered = HASH_A.slice(0, -1) + "2";
    const r = await store.openSceneFile(file(altered), a.id);
    expect(r.kind).toBe("hash-mismatch");
    expect("shots" in r).toBe(false);
    if (r.kind === "hash-mismatch") {
      expect(r.expectedSha256).toBe(HASH_A);
      expect(r.actualSha256).toBe(altered);
      expect(r.scene.id).toBe(a.id);
    }
    // Without naming a scene the same file is simply new, and the stored shots are not touched.
    expect((await store.openSceneFile(file(altered))).kind).toBe("new");
    expect((await store.listShots(a.id)).length).toBe(1);
  });
});

describe("schema", () => {
  const sceneId = makeScene().id;
  it("accepts a good shot and a good scene", () => {
    expect(validateShot(makeShot(sceneId))).toEqual({ ok: true });
    expect(validateScene(makeScene())).toEqual({ ok: true });
  });
  it("rejects an aspect under 1", () => {
    const s = makeShot(sceneId);
    s.lens.aspect = 0.75;
    const r = validateShot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toContain("lens.aspect");
  });
  const fails = (mutate: (s: ReturnType<typeof makeShot>) => void, text: string) => {
    const s = makeShot(sceneId); mutate(s);
    const r = validateShot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toContain(text);
  };
  it("rejects bad labels, ids and numbers", () => {
    fails((s) => { (s as { sizeLabel: string }).sizeLabel = "XL"; }, "sizeLabel");
    fails((s) => { s.id = "shot-1"; }, "id");
    fails((s) => { s.sceneId = "scene-xyz"; }, "sceneId");
    fails((s) => { s.pose.headingDeg = NaN; }, "pose.headingDeg");
    fails((s) => { s.heightAboveGroundM = Infinity; }, "heightAboveGroundM");
    fails((s) => { s.move.ease = "bounce" as never; }, "move.ease");
  });
  it("accepts a null size label", () => {
    const s = makeShot(sceneId, 1, { sizeLabel: null });
    expect(validateShot(s)).toEqual({ ok: true });
  });
  it("checks the frame size against the aspect within one pixel", () => {
    const ok = makeShot(sceneId); ok.lens.aspect = 2.39; Object.assign(ok.lens, lensFov(35, ok.lens.sensor, 2.39));
    ok.frame = { file: "a.jpg", widthPx: 1920, heightPx: 803 };
    expect(validateShot(ok)).toEqual({ ok: true });
    fails((s) => { s.frame.heightPx = 1000; }, "frame.heightPx");
  });
  it("checks the derived field of view within 0.01 degrees", () => {
    const s = makeShot(sceneId); s.lens.hfovDeg += 0.009; s.lens.vfovDeg -= 0.009;
    expect(validateShot(s)).toEqual({ ok: true });
    fails((s) => { s.lens.hfovDeg += 0.02; }, "lens.hfovDeg");
    fails((s) => { s.lens.vfovDeg += 0.02; }, "lens.vfovDeg");
    fails((s) => { s.lens.focalLengthMm = 50; }, "lens.hfovDeg");
  });
  it("rejects a scene with a bad scale source, factor or hash", () => {
    const r = (m: (s: ReturnType<typeof makeScene>) => void) => { const s = makeScene(); m(s); return validateScene(s); };
    expect(r((s) => { (s.scale as { source: string }).source = "auto"; }).ok).toBe(false);
    expect(r((s) => { s.scale.metricScaleFactor = 0; }).ok).toBe(false);
    expect(r((s) => { s.file.sha256 = "abc"; }).ok).toBe(false);
    expect(r((s) => { s.file.format = "glb" as never; }).ok).toBe(false);
  });
  it("rejects things that are not objects", () => {
    expect(validateShot(null).ok).toBe(false);
    expect(validateScene("x").ok).toBe(false);
  });
});

describe("legacy localStorage scale", () => {
  const mem = () => {
    const d = new Map<string, string>();
    return { d, get length() { return d.size; }, key: (i: number) => [...d.keys()][i] ?? null, getItem: (k: string) => d.get(k) ?? null, removeItem: (k: string) => { d.delete(k); }, setItem: (k: string, v: string) => { d.set(k, v); } };
  };
  const scale = { source: "manual", metricScaleFactor: 2.5, groundPlaneOffsetM: 1.2, reference: { label: "door", knownLengthM: 2, measuredRaw: 0.8 }, confirmedAt: "2026-11-20T00:00:00.000Z" };

  it("moves entries once, removes them, and applies a pending scale to the scene made later", async () => {
    const st = mem();
    st.setItem(`film-previz.scale.${HASH_A}`, JSON.stringify({ scale, figureXZ: [1, 2] }));
    st.setItem(`film-previz.scale.${HASH_B}`, "{broken");
    st.setItem("unrelated", "keep");
    expect(await store.migrateLegacyScales(st)).toBe(1);
    expect([...st.d.keys()]).toEqual(["unrelated"]);
    expect(await store.migrateLegacyScales(st)).toBe(0);

    const r = await store.openSceneFile({ name: "set-01-2m.spz", bytes: 1, sha256: HASH_A });
    expect(r.kind).toBe("new");
    if (r.kind !== "new") return;
    expect(r.draft.scale).toEqual(scale);
    await store.saveScene(r.draft);
    expect(await store.getFigure(r.draft.id)).toEqual([1, 2]);
    // The pending entry is used up.
    expect(await store.migrateLegacyScales(mem())).toBe(0);
  });

  it("updates a scene that already exists", async () => {
    const a = makeScene();
    await store.saveScene(a);
    const st = mem();
    st.setItem(`film-previz.scale.${HASH_A}`, JSON.stringify({ scale, figureXZ: null }));
    expect(await store.migrateLegacyScales(st)).toBe(1);
    expect((await store.getScene(a.id))!.scale).toEqual(scale);
  });
});
