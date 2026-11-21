import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { makeShot } from "../helpers/model";

const splat500k = path.resolve("scenes/set-01-500k.spz");
const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");
const haveScenes = () => fs.existsSync(splat500k) && fs.existsSync(collider) && fs.existsSync(truthFile);
const SKIP = "scenes/ is empty: run npm run make-set";

type W = {
  __viewer: {
    camera: { position: { x: number; y: number; z: number }; getWorldDirection(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } };
    splatBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
    splatCount: number;
    hasCollider: boolean;
    setRunning(on: boolean): void;
    localToClient(p: [number, number, number]): { x: number; y: number };
    renderer: { domElement: HTMLElement };
  };
  __session: { scene(): { id: string; name: string; markers: Array<{ id: string; label: string; positionM: number[] }>; frontHeadingDeg: number; scale: { source: string }; colliderFile: unknown } | null; shots(): unknown[]; store(): Promise<{ saveShot(s: unknown): Promise<void> }> };
  __shot: { frontHeadingDeg(): number };
};

/** A few hundred splats as a binary PLY. `seed` makes a different file, so a different hash. */
function tinyPly(seed = 7, n = 300): Buffer {
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex " + n + "\n" +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  const buf = new Float32Array(n * 14);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < n; i++) buf.set([(rnd() - 0.5) * 2, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 3, -3, -3, -3, 1, 0, 0, 0], i * 14);
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(buf.buffer)]);
}
const plyFile = (name: string, seed?: number) => ({ name, mimeType: "application/octet-stream", buffer: tinyPly(seed) });

async function toScenes(page: Page): Promise<void> {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.locator("#splat-file")).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(() => "__viewer" in window);
}

const loaded = (page: Page, timeout = 60_000) => expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout });
const sceneId = (page: Page) => page.evaluate(() => (window as unknown as W).__session.scene()?.id ?? null);

/** Choose a file for a row of the past scenes list ("Choose file again"). */
async function chooseAgain(page: Page, rowName: string, file: Parameters<Page["setInputFiles"]>[1]): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: `Choose file again for ${rowName}` }).click()]);
  await chooser.setFiles(file as string);
}

test("scenes_empty_state_matches_the_draft", async ({ page }) => {
  await toScenes(page);
  await expect(page.getByRole("heading", { level: 1, name: "Scenes" })).toBeVisible();
  await expect(page.locator("#dropzone")).toContainText("No scene is open");
  await expect(page.locator("#dropzone")).toContainText("Files stay on this computer.");
  await expect(page.locator("#dropzone")).toContainText("You can also drop the file on this page.");
  // the only filled control is the way forward: Choose scene file
  await expect(page.locator(".btn-primary:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Choose scene file" })).toHaveClass(/btn-primary/);
  await expect(page.getByText("The scale step opens after a scene has loaded.")).toBeVisible();
  await expect(page.locator("#scale-panel")).toBeHidden();
  await expect(page.locator("#h-details")).toBeHidden();
  await expect(page.getByText("No scenes yet.")).toBeVisible();
  await expect(page.locator("#scene-name")).toHaveText("No scene loaded");
  // the scene input takes SPZ and PLY only, the collider input GLB only
  await expect(page.locator("#splat-file")).toHaveAttribute("accept", ".spz,.ply");
  await expect(page.locator("#collider-file")).toHaveAttribute("accept", ".glb");
});

test("scenes_unsupported_file_shows_the_error_and_loads_nothing", async ({ page }) => {
  await toScenes(page);
  await page.setInputFiles("#splat-file", { name: "street-scan.obj", mimeType: "text/plain", buffer: Buffer.from("v 0 0 0\n") });
  const n = page.locator(".notice.err");
  await expect(n).toContainText("Unsupported file.");
  await expect(n).toContainText("street-scan.obj");
  await expect(n).toContainText("A GLB file works only as a collider mesh");
  await expect(n.getByRole("button", { name: "Choose another file" })).toBeVisible();
  await expect(page.locator("#scene-status")).not.toHaveAttribute("data-splats", /.*/);
  expect(await sceneId(page)).toBeNull();
  expect(await page.evaluate(() => (window as unknown as W).__viewer.splatCount)).toBe(0);
  await expect(page.locator("#scale-panel")).toBeHidden();
  // a GLB in the scene input is also not a splat file
  await page.setInputFiles("#splat-file", { name: "room.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("glTF") });
  await expect(n).toContainText("room.glb");
  expect(await page.evaluate(() => (window as unknown as W).__viewer.splatCount)).toBe(0);
});

test("scenes_tiny_scene_loaded_state_details_and_past_list", async ({ page }) => {
  await toScenes(page);
  await page.setInputFiles("#splat-file", plyFile("tiny-a.ply"));
  await loaded(page);
  await expect(page.locator("#file-name")).toHaveText("tiny-a.ply");
  const facts = page.locator(".facts");
  await expect(facts).toContainText("Splats");
  await expect(facts.locator("dd").nth(1)).toHaveText("300");
  await expect(facts.locator("dd").nth(2)).toHaveText(/^(\d+\.\d s|under 0\.1 s)$/);
  // no collider: said plainly, with a way to choose one
  await expect(page.locator("#collider-line")).toContainText("No collider mesh.");
  await expect(page.getByRole("button", { name: "Choose collider mesh" })).toBeVisible();
  await expect(page.locator("#scale-panel")).toBeVisible();
  await expect(page.locator("#scale-mark")).toBeDisabled();
  await expect(page.locator("#marker-add")).toBeDisabled();
  await expect(page.locator("#marker-msg")).toContainText("collider");
  await expect(page.locator("#open-stage")).toHaveText("Open Stage without scale");
  await expect(page.locator(".btn-primary:visible")).toHaveCount(0);
  await expect(page.locator("#scene-name")).toHaveText("tiny-a");
  // (c) the preview opens inside the splat bounds, looking down -z (heading 0), not at a wall from outside
  const view = await page.evaluate(() => {
    const v = (window as unknown as W).__viewer;
    const b = v.splatBounds()!;
    const d = v.camera.getWorldDirection(new (v.camera.position.constructor as new () => { x: number; y: number; z: number })());
    const p = v.camera.position;
    return { inside: p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z, dir: [d.x, d.y, d.z] };
  });
  expect(view.inside).toBe(true);
  expect(view.dir[2]).toBeLessThan(-0.99);

  // details: save, then they come back from the record
  await page.fill("#scene-name-in", "Test room, 2 m set");
  await page.fill("#scene-front", "90");
  await page.selectOption("#scene-source-kind", "text");
  await page.fill("#scene-source-note", "a small room with a door");
  await page.fill("#scene-light-note", "Soft light from the left.");
  await page.click("#save-details");
  await expect(page.locator("#details-msg")).toHaveText("Saved.");
  await expect(page.locator("#scene-name")).toHaveText("Test room, 2 m set");
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__shot.frontHeadingDeg())).toBe(90);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__session.scene()?.frontHeadingDeg)).toBe(90);
  await page.fill("#scene-name-in", "   ");
  await page.click("#save-details");
  await expect(page.locator("#details-msg")).toHaveText("A scene needs a name.");

  // past scenes list, then a reload and "Choose file again" with the same file
  await expect(page.locator("#past-scenes tbody tr")).toHaveCount(1);
  await expect(page.locator("#past-scenes tbody tr").first()).toContainText("Test room, 2 m set");
  await page.reload();
  await toScenes(page);
  await expect(page.locator("#past-scenes tbody tr")).toHaveCount(1);
  await expect(page.locator("#dropzone")).toBeVisible();
  await chooseAgain(page, "Test room, 2 m set", plyFile("tiny-a.ply"));
  await loaded(page);
  await expect(page.locator("#mismatch")).toHaveCount(0);
  await expect(page.locator("#scene-name-in")).toHaveValue("Test room, 2 m set");
  await expect(page.locator("#scene-front")).toHaveValue("90");
  await expect(page.locator("#scene-source-kind")).toHaveValue("text");
  await expect(page.locator("#scene-source-note")).toHaveValue("a small room with a door");
  await expect(page.locator("#scene-light-note")).toHaveValue("Soft light from the left.");
  await expect(page.locator("#scene-name")).toHaveText("Test room, 2 m set");
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__shot.frontHeadingDeg())).toBe(90);
});

test("scenes_hash_mismatch_keeps_the_shots_and_attaches_none", async ({ page }) => {
  await toScenes(page);
  await page.setInputFiles("#splat-file", plyFile("tiny-a.ply", 7));
  await loaded(page);
  await expect.poll(() => sceneId(page)).not.toBeNull();
  const savedId = (await sceneId(page))!;
  await page.evaluate(async (shot) => { await (await (window as unknown as W).__session.store()).saveShot(shot); }, makeShot(savedId, 1));
  await page.reload();
  await toScenes(page);
  await expect(page.locator("#past-scenes tbody tr").first().locator("td.num")).toHaveText("1");

  // a different file chosen for the saved scene
  await chooseAgain(page, "tiny-a", plyFile("tiny-b.ply", 99));
  await loaded(page);
  const warn = page.locator("#mismatch");
  await expect(warn).toContainText("This file is not the saved scene.");
  await expect(warn).toContainText('The saved scene "tiny-a" expects SHA-256');
  await expect(warn).toContainText("The 1 shot saved on that scene stays attached to the original file.");
  await expect(warn.getByRole("button", { name: "Open as a new scene" })).toHaveClass(/btn-primary/);
  await expect(page.locator(".btn-primary:visible")).toHaveCount(1);
  await expect(page.locator("#scale-badge")).toHaveText("Not confirmed");
  await expect(page.locator("#scene-name")).toHaveText("tiny-a");
  expect(await sceneId(page)).toBeNull(); // not attached
  expect(await page.evaluate(() => (window as unknown as W).__session.shots().length)).toBe(0);
  await expect(page.locator("#past-scenes tbody tr")).toHaveCount(1); // no scene was made

  // the original file brings the scene and its shot back
  await chooseAgain(page, "tiny-a", plyFile("tiny-a.ply", 7));
  await expect(page.locator("#mismatch")).toHaveCount(0);
  await expect.poll(() => sceneId(page)).toBe(savedId);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__session.shots().length)).toBe(1);

  // and "Open as a new scene" makes a second scene, leaving the first one's shot where it was
  await chooseAgain(page, "tiny-a", plyFile("tiny-c.ply", 5));
  await expect(page.locator("#mismatch")).toBeVisible();
  await page.getByRole("button", { name: "Open as a new scene" }).click();
  await expect(page.locator("#mismatch")).toHaveCount(0);
  await expect.poll(async () => { const id = await sceneId(page); return id !== null && id !== savedId; }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as W).__session.shots().length)).toBe(0);
  await expect(page.locator("#past-scenes tbody tr")).toHaveCount(2);
  await expect(page.locator(`#past-scenes tr[data-scene-id="${savedId}"] td.num`)).toHaveText("1");
});

test("scenes_unreadable_spz_offers_try_as_ply", async ({ page }) => {
  await toScenes(page);
  // PLY bytes under an .spz name: the SPZ reader cannot read it
  await page.setInputFiles("#splat-file", { name: "wrong-name.spz", mimeType: "application/octet-stream", buffer: tinyPly(3) });
  const n = page.locator(".notice.err");
  await expect(n).toContainText("This SPZ file could not be read.", { timeout: 60_000 });
  await expect(n).toContainText("wrong-name.spz");
  // the filled control is "Choose another file"; "Try as PLY" is outlined, and the reader's own message sits on a smaller second line
  await expect(n.getByRole("button", { name: "Choose another file" })).toHaveClass(/btn-primary/);
  await expect(n.getByRole("button", { name: "Try as PLY" })).not.toHaveClass(/btn-primary/);
  await expect(n.locator("#parse-message")).toContainText("Reader message:");
  await expect(n.locator("p").first()).not.toContainText("Reader message");
  await expect(page.locator("#scene-status")).not.toHaveAttribute("data-splats", /.*/);
  expect(await sceneId(page)).toBeNull();
  await n.getByRole("button", { name: "Try as PLY" }).click();
  await loaded(page);
  await expect(page.locator(".notice.err")).toHaveCount(0);
  await expect(page.locator("#file-name")).toHaveText("wrong-name.spz");
  expect(await page.evaluate(() => (window as unknown as W).__viewer.splatCount)).toBe(300);
});

test("scenes_a_failed_open_leaves_the_open_scene_in_place", async ({ page }) => {
  await toScenes(page);
  await page.setInputFiles("#splat-file", plyFile("tiny-a.ply"));
  await loaded(page);
  const id = await sceneId(page);
  await page.setInputFiles("#splat-file", { name: "broken.ply", mimeType: "application/octet-stream", buffer: Buffer.from("ply\nformat ascii 1.0\nelement vertex 5\nend_header\n1 2\n") });
  await expect(page.locator(".notice.err")).toContainText("could not be read", { timeout: 60_000 });
  await expect(page.locator("#file-name")).toHaveText("tiny-a.ply");
  expect(await sceneId(page)).toBe(id);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", "300");
});

test("scenes_without_webgl2_says_so_on_every_route", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2") return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto("/");
  const n = page.locator("#no-webgl");
  await expect(n).toContainText("This browser cannot show scenes.");
  await expect(n).toContainText("film-previz needs WebGL 2");
  await page.evaluate(() => { location.hash = "#/stage"; });
  await expect(page.locator("#no-webgl")).toBeVisible();
  // the Stage and Shots routes go to Scenes, so the Scenes tab is the current one
  await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText("Scenes");
  expect(await page.evaluate(() => location.hash)).toBe("#/");
  await page.evaluate(() => { location.hash = "#/shots"; });
  await expect(page.locator('.tabs a[aria-current="page"]')).toHaveText("Scenes");
  await expect(page.locator("#no-webgl")).toBeVisible();
  await page.evaluate(() => { location.hash = "#/"; });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.locator("#check-msg")).toHaveText("This browser still does not offer WebGL 2.");
});

test("scenes_a_ply_header_that_claims_more_splats_than_the_file_holds_is_unreadable_not_too_large", async ({ page }) => {
  // A header that announces 4 billion splats with a few bytes of data. Spark checks the count against the data and says so,
  // so this is the "could not be read" state. The "too large for memory" state needs a real allocation failure, which
  // this app cannot cause on purpose; the classifier for it is unit tested (tests/loadError.test.ts).
  await toScenes(page);
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex 4000000000\n" + ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  await page.setInputFiles("#splat-file", { name: "huge.ply", mimeType: "application/octet-stream", buffer: Buffer.concat([Buffer.from(header, "ascii"), Buffer.alloc(560)]) });
  const n = page.locator(".notice.err");
  await expect(n).toContainText("This PLY file could not be read.", { timeout: 60_000 });
  await expect(n).not.toContainText("too large");
  await expect(page.locator("#scene-status")).not.toHaveAttribute("data-splats", /.*/);
});

test("scenes_scale_is_saved_before_the_badge_says_confirmed_then_markers_persist", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(600_000);
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { door: { centreX: number; heightMetric: number; max: { metric: number[] } } };
  const faceZ = truth.door.max.metric[2]!;
  const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];

  // Record when each IndexedDB write to the scenes store completes, and when the header chip first reads confirmed.
  await page.addInitScript(() => {
    const w = window as unknown as { __txDone: Array<{ t: number; scale: string | null }>; __chipAt: number | null };
    w.__txDone = []; w.__chipAt = null;
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "scenes") {
        const src = (value as { scale?: { source?: string } }).scale?.source ?? null;
        this.transaction.addEventListener("complete", () => w.__txDone.push({ t: performance.now(), scale: src }));
      }
      return origPut.call(this, value, key as IDBValidKey);
    };
    new MutationObserver(() => {
      const chip = document.getElementById("scale-chip");
      if (w.__chipAt === null && chip && /^Scale confirmed/.test(chip.textContent ?? "")) w.__chipAt = performance.now();
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  await toScenes(page);
  await page.setInputFiles("#splat-file", splat500k);
  await page.setInputFiles("#collider-file", collider);
  await loaded(page, 120_000);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await expect(page.locator("#collider-line")).toContainText("set-01-collider.glb");
  await page.evaluate(() => (window as unknown as W).__viewer.setRunning(false));
  await expect(page.locator("#marker-add")).toBeDisabled(); // scale first
  await expect(page.locator("#marker-msg")).toContainText("Confirm the scale first");

  const clickLocal = async (p: [number, number, number]) => {
    const c = await page.evaluate((p) => {
      const v = (window as unknown as W).__viewer;
      v.renderer.domElement.scrollIntoView({ block: "center" });
      return v.localToClient(p);
    }, p);
    await page.mouse.click(c.x, c.y);
  };

  await page.click("#scale-mark");
  await clickLocal(toLocal([truth.door.centreX, 0, faceZ + 0.05]));
  await clickLocal(toLocal([truth.door.centreX, truth.door.heightMetric - 0.05, faceZ]));
  await page.fill("#scale-known", "2.00");
  await page.click("#scale-apply");
  await expect(page.locator("#scale-chip")).toHaveText("Scale confirmed, door 2.00 m");
  // (e) the write to the scenes store had completed by the time the chip first said confirmed
  const order = await page.evaluate(() => (window as unknown as { __txDone: Array<{ t: number; scale: string | null }>; __chipAt: number }).__txDone.filter((d) => d.scale === "manual").map((d) => d.t).concat([(window as unknown as { __chipAt: number }).__chipAt]));
  console.log("manual-scale write complete at, chip confirmed at:", order.map((n) => n.toFixed(1)).join(", "));
  expect(order.length).toBeGreaterThanOrEqual(2);
  expect(Math.min(...order.slice(0, -1))).toBeLessThanOrEqual(order[order.length - 1]!);
  await expect(page.locator("#open-stage")).toHaveText("Open Stage");
  await expect(page.locator("#open-stage")).toHaveClass(/btn-primary/);
  await expect(page.locator("#ground-floor")).toHaveText("0.000 m after scaling");

  // markers: click the chair top, name it, then the door foot
  await expect(page.locator("#marker-add")).toBeEnabled();
  await page.click("#marker-add");
  await clickLocal(toLocal([-1.5, 0.45, -2]));
  await expect(page.locator("#marker-form")).toBeVisible();
  await page.click("#marker-save");
  await expect(page.locator("#marker-msg")).toContainText("Type a name");
  await page.fill("#marker-name", "chair");
  await page.keyboard.press("Enter");
  await expect(page.locator("#marker-list .marker-row")).toHaveCount(1);
  await page.click("#marker-add");
  await clickLocal(toLocal([truth.door.centreX, 0, faceZ + 0.05]));
  await page.fill("#marker-name", "door");
  await page.click("#marker-save");
  await expect(page.locator("#marker-list .marker-row")).toHaveCount(2);
  // the measure tool did not take those clicks
  await expect(page.locator("#scale-measure")).not.toHaveAttribute("data-m", /.*/);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__session.scene()!.markers.map((m) => m.label))).toEqual(["chair", "door"]);
  const rec = await page.evaluate(() => (window as unknown as W).__session.scene()!.markers);
  const chair = rec[0]!.positionM, door = rec[1]!.positionM;
  expect(Math.hypot(chair[0]! + 1.5, chair[1]! - 0.45, chair[2]! + 2)).toBeLessThan(0.15);
  expect(Math.hypot(door[0]! - truth.door.centreX, door[1]!, door[2]! - (faceZ + 0.05))).toBeLessThan(0.15);

  // remove one, add nothing: the list and the record follow
  await page.getByRole("button", { name: "Remove marker chair" }).click();
  await expect(page.locator("#marker-list .marker-row")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__session.scene()!.markers.map((m) => m.label))).toEqual(["door"]);

  // reload, open the same file again: scale, collider note and the marker come back
  await page.reload();
  await toScenes(page);
  await chooseAgain(page, "set-01-500k", splat500k);
  await loaded(page, 120_000);
  await expect(page.locator("#scale-chip")).toHaveText("Scale confirmed, door 2.00 m");
  await expect(page.locator("#marker-list .marker-row")).toHaveCount(1);
  await expect(page.locator("#marker-list .marker-row")).toContainText("door");
  await expect(page.locator("#collider-line")).toContainText("not loaded in this session");
  await expect(page.locator("#marker-msg")).toContainText("collider");
  // (c) with the scale confirmed the preview eye is at 1.6 m, inside the room
  const eye = await page.evaluate(() => {
    const v = (window as unknown as W).__viewer;
    const b = v.splatBounds()!;
    return { y: v.camera.position.y, inside: v.camera.position.x >= b.min.x && v.camera.position.x <= b.max.x && v.camera.position.z >= b.min.z && v.camera.position.z <= b.max.z };
  });
  expect(eye.y).toBeCloseTo(1.6, 2);
  expect(eye.inside).toBe(true);
});
