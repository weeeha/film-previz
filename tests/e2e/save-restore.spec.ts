import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const splat500k = path.resolve("scenes/set-01-500k.spz");
const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");
const haveScenes = () => fs.existsSync(splat500k) && fs.existsSync(collider) && fs.existsSync(truthFile);
const SKIP = "scenes/ is empty: run npm run make-set";

/** Under this mean absolute difference (0 to 255, per colour channel) a restored frame counts as the same frame. */
const THRESHOLD = 2;

type V = {
  setRunning(on: boolean): void;
  localToClient(p: [number, number, number]): { x: number; y: number };
  content: { position: { constructor: new (x: number, y: number, z: number) => { x: number; y: number; z: number } }; localToWorld(v: unknown): { x: number; y: number; z: number } };
  lastSettle: { ok: boolean; ms: number } | null;
};
const viewerCall = <T>(page: Page, fn: (v: V) => T) => page.evaluate(`(${fn.toString()})(window.__viewer)`) as Promise<T>;
const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];

/** A few hundred splats as a binary PLY, built here so the fast tests need no 28 MB file. */
function tinyPly(): Buffer {
  const n = 300;
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex " + n + "\n" +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  const buf = new Float32Array(n * 14);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < n; i++) {
    const o = i * 14;
    buf.set([(rnd() - 0.5) * 2, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 3, -3, -3, -3, 1, 0, 0, 0], o);
  }
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(buf.buffer)]);
}

/**
 * Go to the Scenes route without reloading. In WebKit a goto to the URL the page already has reloads it, which would
 * drop the open scene, and a hash-only goto after a reload may not fire hashchange. So load the page once, then set the hash.
 */
async function toScenes(page: Page): Promise<void> {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.locator("#splat-file")).toBeAttached({ timeout: 30_000 });
}

async function openTiny(page: Page): Promise<void> {
  await toScenes(page);
  await page.waitForFunction(() => "__viewer" in window);
  await page.setInputFiles("#splat-file", { name: "tiny.ply", mimeType: "application/octet-stream", buffer: tinyPly() });
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __session: { scene(): unknown } }).__session.scene() !== null)).toBe(true);
}

/** Mark the door with the collider and confirm a 2.00 m scale, as the Stage test does. */
async function confirmScale(page: Page): Promise<void> {
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { door: { centreX: number; heightMetric: number; max: { metric: number[] } } };
  const faceZ = truth.door.max.metric[2]!;
  await toScenes(page);
  await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  const clickLocal = async (p: [number, number, number]) => {
    const c = await page.evaluate((p) => {
      const v = (window as unknown as { __viewer: V & { renderer: { domElement: HTMLElement } } }).__viewer;
      v.renderer.domElement.scrollIntoView({ block: "start" });
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
}

async function openLarge(page: Page, withCollider: boolean): Promise<void> {
  await toScenes(page);
  await page.waitForFunction(() => "__viewer" in window);
  await page.setInputFiles("#splat-file", splat500k);
  if (withCollider) await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 120_000 });
  if (withCollider) await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __session: { scene(): unknown } }).__session.scene() !== null)).toBe(true);
  await page.waitForTimeout(1500);
  await viewerCall(page, (v) => v.setRunning(false)); // SwiftShader draws 500k splats at about 1 fps
}

type Stored = { shot: Record<string, any>; width: number; height: number };
/** The shot record and its JPEG, read straight from IndexedDB, and the JPEG's decoded size. */
async function readStored(page: Page, shotId: string): Promise<Stored> {
  return page.evaluate(async (shotId) => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const q = indexedDB.open("film-previz"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const all = <T>(store: string) => new Promise<T[]>((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result as T[]); });
    const shot = (await all<Record<string, any>>("shots")).find((s) => s.id === shotId)!;
    const raw = await new Promise<{ type: string; bytes: ArrayBuffer }>((res) => { const q = db.transaction("frames").objectStore("frames").get([shot.sceneId, shotId]); q.onsuccess = () => res(q.result); });
    const frame = new Blob([raw.bytes], { type: raw.type });
    const bmp = await createImageBitmap(frame);
    db.close();
    return { shot, width: bmp.width, height: bmp.height };
  }, shotId);
}

/** Open the shot from its row on the Shots view, grab again through Viewer.grabShot, and compare with the stored JPEG. */
async function diffAfterOpen(page: Page, shotNumber: number): Promise<{ diff: number; settleOk: boolean; w: number; h: number }> {
  await page.goto("/#/shots");
  await page.locator(`button[aria-label="Open shot ${shotNumber} on the Stage"]`).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await expect(page.locator(`#strip button[aria-current="true"]`)).toContainText(`${shotNumber} `);
  return page.evaluate(async (n) => {
    const w = window as unknown as { __viewer: { grabShot(w: number): Promise<{ blob: Blob; widthPx: number; heightPx: number }>; lastSettle: { ok: boolean } | null }; __session: { shots(): Array<{ id: string; number: number; sceneId: string }> } };
    const rec = w.__session.shots().find((s) => s.number === n)!;
    const db = await new Promise<IDBDatabase>((res, rej) => { const q = indexedDB.open("film-previz"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const raw = await new Promise<{ type: string; bytes: ArrayBuffer }>((res) => { const q = db.transaction("frames").objectStore("frames").get([rec.sceneId, rec.id]); q.onsuccess = () => res(q.result); });
    const stored = new Blob([raw.bytes], { type: raw.type });
    db.close();
    const grab = await w.__viewer.grabShot(1920);
    const px = async (b: Blob) => {
      const bmp = await createImageBitmap(b);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    };
    const a = await px(stored), b = await px(grab.blob);
    if (a.width !== b.width || a.height !== b.height) return { diff: 255, settleOk: false, w: b.width, h: b.height };
    let sum = 0, cnt = 0;
    for (let i = 0; i < a.data.length; i += 4) { for (let k = 0; k < 3; k++) { sum += Math.abs(a.data[i + k]! - b.data[i + k]!); cnt++; } }
    return { diff: sum / cnt, settleOk: w.__viewer.lastSettle?.ok === true, w: b.width, h: b.height };
  }, shotNumber);
}

async function saveShot(page: Page, expectNumber: number): Promise<void> {
  const asNew = page.locator("#save-as-new");
  if (await asNew.isVisible()) await asNew.click(); else await page.locator("#save-shot").click();
  await expect(page.locator("#save-msg")).toHaveText(new RegExp(`^Saved shot ${expectNumber},`), { timeout: 240_000 });
}

test("shots_view_save_edit_reorder_duplicate_delete_undo_and_open", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(240_000);
  // No scene open: both routes say so and saving is off.
  await page.goto("/#/shots");
  await expect(page.locator("#no-scene")).toContainText("No scene open");
  await expect(page.locator("#export-btn")).toBeDisabled();
  await page.goto("/#/stage");
  await expect(page.locator("#save-shot")).toBeDisabled();
  await expect(page.locator("#save-msg")).toHaveText("Open a scene on Scenes to save shots.");

  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await expect(page.locator(".btn-primary")).toHaveCount(1); // one filled control: Save shot
  await expect(page.locator("#save-shot")).toHaveText("Save shot");
  await expect(page.locator("#save-msg")).toHaveText("This shot will save with heights unverified.");
  await expect(page.locator("#strip")).toContainText("No shots yet.");

  const setup = async (name: string, focal: string, size: string, heading: string) => {
    await page.fill("#shot-name", name);
    await page.selectOption("#shot-size", size);
    await page.fill("#shot-job", `Job ${name}`);
    await page.fill("#shot-action", `Action ${name}`);
    await page.fill("#shot-notes", `Notes ${name}`);
    await page.locator(`label[for="f${focal}"]`).click();
    await page.fill("#cam-heading", heading);
  };
  await setup("Entrance", "35", "WS", "10");
  await saveShot(page, 1);
  await expect(page.locator("#save-shot")).toHaveText("Update shot 1");
  await expect(page.locator("#save-as-new")).toHaveText("Save as new shot");
  await expect(page.locator(".btn-primary")).toHaveCount(1);
  await setup("Cross", "50", "MS", "20");
  await saveShot(page, 2);
  await setup("At the chair", "85", "MCU", "30");
  await page.selectOption("#aspect", "3:2");
  await saveShot(page, 3);

  // strip: thumbnails in the shot's aspect, number and name, lens and height, Editing on the current one
  const strip = page.locator("#strip button.shot");
  await expect(strip).toHaveCount(3);
  await expect(strip.nth(2)).toHaveAttribute("aria-current", "true");
  await expect(strip.nth(2)).toContainText("3 At the chair");
  await expect(strip.nth(2)).toContainText("85 mm, 0.");
  await expect(strip.nth(2)).toContainText("unverified");
  await expect(strip.nth(2)).toContainText("Editing");
  expect(await strip.nth(0).locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  expect(await strip.nth(2).locator(".t").evaluate((e) => getComputedStyle(e).getPropertyValue("--ar"))).toBe("1.5");

  // open shot 1 from the strip: lens, pose and details come back
  await strip.nth(0).click();
  await expect(page.locator("#readout")).toContainText("35 mm on 36 mm");
  await expect(page.locator("#aspect")).toHaveValue("16:9");
  await expect(page.locator("#cam-heading")).toHaveValue("10");
  await expect(page.locator("#shot-name")).toHaveValue("Entrance");
  await expect(page.locator("#shot-size")).toHaveValue("WS");
  await expect(page.locator("#shot-notes")).toHaveValue("Notes Entrance");
  await expect(page.locator("#through")).toBeChecked();
  await expect(page.locator("#save-shot")).toHaveText("Update shot 1");

  // Update shot 1 keeps the number and replaces the record
  await page.fill("#shot-name", "Entrance, wide");
  await page.locator("#save-shot").click();
  await expect(page.locator("#save-msg")).toHaveText(/^Updated shot 1,/, { timeout: 120_000 });
  await expect(strip).toHaveCount(3);
  await expect(strip.nth(0)).toContainText("1 Entrance, wide");

  // Shots view
  await page.click('a[data-route="/shots"]');
  const rows = page.locator("#shots-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(page.locator("#row-count")).toHaveText("3 shots");
  await expect(page.locator("#shot-count-head")).toHaveCount(0); // the count shows once in the footer, not in the page head
  await expect(rows.nth(0).locator("td").nth(3)).toContainText("35 mm");
  await expect(rows.nth(0).locator("td").nth(3)).toContainText("Full frame, 16:9");
  await expect(rows.nth(2).locator("td").nth(3)).toContainText("Full frame, 3:2");
  await expect(rows.nth(0).locator("td").nth(4)).toContainText("units");
  await expect(rows.nth(0).locator("td").nth(4)).toContainText("Unverified");
  await expect(rows.nth(0).locator("td").nth(5).locator("select")).toHaveValue("WS");
  await expect(rows.nth(0).locator("td").nth(6)).toHaveText("Job Entrance");
  expect(await rows.nth(0).locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await expect(page.locator("#export-btn")).toBeEnabled();
  await expect(page.locator("#export")).toContainText("3 shots from tiny");
  await expect(page.locator("#export .notice.warn")).toContainText("3 of 3 shots were saved before the scale was confirmed");

  // edit in place: name by keyboard, size by select, long text clamps to two lines with the full text in title
  const name = rows.nth(1).locator(".nm-edit");
  await name.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Cross to the chair");
  await page.keyboard.press("Enter");
  await expect(rows.nth(1).locator(".nm-edit")).toHaveAttribute("title", "Cross to the chair");
  await rows.nth(1).locator("select").selectOption("CU");
  const long = "Keep the camera on the near side of the chair. The set has holes in the splats behind it, so any move that goes past the chair will show them. The door stays in frame for the whole shot.";
  const notes = rows.nth(2).locator(".ed").last();
  await notes.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(long);
  await page.keyboard.press("Tab");
  await expect(rows.nth(2).locator(".ed").last()).toHaveAttribute("title", long);
  const clampedH = await rows.nth(2).locator(".ed").last().evaluate((e) => e.getBoundingClientRect().height);
  const lineH = await rows.nth(2).locator(".ed").last().evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || 18);
  expect(clampedH).toBeLessThan(lineH * 2.6);
  const saved2 = await readStored(page, "shot-002");
  expect([saved2.shot.name, saved2.shot.sizeLabel]).toEqual(["Cross to the chair", "CU"]);

  // reorder: shot 1 down. Numbers stay 1, 2, 3 in the new order
  await rows.nth(0).getByRole("button", { name: "Move down shot 1" }).click();
  await expect(rows.nth(0).locator(".nm-edit")).toHaveAttribute("title", "Cross to the chair");
  await expect(rows.nth(1).locator(".nm-edit")).toHaveAttribute("title", "Entrance, wide");
  await expect(rows.nth(0).locator(".n")).toHaveText("1");
  await expect(rows.nth(1).locator(".n")).toHaveText("2");
  await expect(rows.nth(0).getByRole("button", { name: /Move up shot 1/ })).toBeDisabled();
  await expect(rows.nth(2).getByRole("button", { name: /Move down shot 3/ })).toBeDisabled();

  // duplicate shot 2 (Entrance, wide): copy goes last with the next number
  await rows.nth(1).getByRole("button", { name: "Duplicate shot 2" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3).locator(".nm-edit")).toHaveAttribute("title", "Entrance, wide copy");
  await expect(rows.nth(3).locator(".n")).toHaveText("4");

  // delete shot 2 with an undo notice, later shots move up
  await rows.nth(1).getByRole("button", { name: "Delete shot 2" }).click();
  await expect(page.locator("#undo-notice")).toContainText("Shot 2 deleted. The later shots moved up one number.");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2).locator(".n")).toHaveText("3");
  await expect(page.locator("#row-count")).toHaveText("3 shots");
  await page.locator("#undo-delete").click();
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#undo-notice")).toHaveCount(0);
  await expect(rows.nth(1).locator(".nm-edit")).toHaveAttribute("title", "Entrance, wide");
  await expect(rows.nth(3).locator(".nm-edit")).toHaveAttribute("title", "Entrance, wide copy");
  expect(await rows.nth(1).locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);

  // a new save after a delete and renumber gets an id that is not in use
  await rows.nth(0).getByRole("button", { name: "Delete shot 1" }).click();
  await expect(rows).toHaveCount(3);
  await page.click('a[data-route="/stage"]');
  await expect(page.locator("#save-shot")).toHaveText("Save shot"); // the edited shot was deleted, so nothing is being edited
  await saveShot(page, 4);
  const ids = await page.evaluate(() => (window as unknown as { __session: { shots(): Array<{ id: string }> } }).__session.shots().map((s) => s.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(4);

  // open from a Shots row and land on the Stage looking through
  await page.click('a[data-route="/shots"]');
  await rows.nth(0).locator("button.thumb").click();
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await expect(page.locator("#through")).toBeChecked();
  await expect(page.locator("#strip button[aria-current=true]")).toHaveCount(1);
});

test("criterion_6_stored_frame_is_1920_wide_in_the_shot_aspect", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(240_000);
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await page.selectOption("#aspect", "16:9");
  await saveShot(page, 1);
  await page.selectOption("#aspect", "2.39:1");
  await saveShot(page, 2);
  const a = await readStored(page, "shot-001");
  const b = await readStored(page, "shot-002");
  console.log("criterion 6", JSON.stringify({ a: [a.width, a.height, a.shot.frame], b: [b.width, b.height, b.shot.frame] }));
  expect([a.width, a.height]).toEqual([1920, 1080]);
  expect([b.width, b.height]).toEqual([1920, 803]);
  expect(a.shot.frame).toMatchObject({ file: "frames/shot-001.jpg", widthPx: 1920, heightPx: 1080 });
  expect(b.shot.frame).toMatchObject({ file: "frames/shot-002.jpg", widthPx: 1920, heightPx: 803 });
});

test("criterion_7_eye_preset_records_1_60_with_scale_and_presets_are_off_without", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(240_000);
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  // scale not confirmed: presets disabled, shot saved with scaleConfirmed false
  for (const id of ["low", "hip", "eye", "high"]) await expect(page.locator(`#hp-${id}`)).toBeDisabled();
  await saveShot(page, 1);
  const un = await readStored(page, "shot-001");
  expect(un.shot.scaleConfirmed).toBe(false);
  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#shots-table tbody tr").first()).toContainText("Unverified");

  // scale confirmed: presets on, the eye preset records 1.60 m
  await confirmScale(page);
  await page.click('a[data-route="/stage"]');
  for (const id of ["low", "hip", "eye", "high"]) await expect(page.locator(`#hp-${id}`)).toBeEnabled();
  await page.locator('label[for="hp-hip"]').click();
  await page.locator('label[for="hp-eye"]').click();
  await expect(page.locator("#cam-height")).toHaveValue("1.60");
  await saveShot(page, 2);
  const ok = await readStored(page, "shot-002");
  console.log("criterion 7", JSON.stringify({ scaleConfirmed: ok.shot.scaleConfirmed, heightAboveGroundM: ok.shot.heightAboveGroundM, unconfirmed: un.shot.scaleConfirmed }));
  expect(ok.shot.scaleConfirmed).toBe(true);
  expect(Math.abs(ok.shot.heightAboveGroundM - 1.6)).toBeLessThan(0.01);
  await expect(page.locator("#strip button.shot").nth(1)).toContainText("eye 1.6 m");
});

type Plan = { dx: number; dz: number; heading: string; pitch: string; focal: string; aspect: string; preset: string; name: string };
const PLANS: Plan[] = [
  { dx: 0, dz: 5, heading: "0", pitch: "0", focal: "35", aspect: "16:9", preset: "hip", name: "Door straight on" },
  { dx: 1, dz: 4, heading: "350", pitch: "2", focal: "50", aspect: "2.39:1", preset: "eye", name: "Right, tight" },
  { dx: -1, dz: 3.5, heading: "12", pitch: "-3", focal: "24", aspect: "1.85:1", preset: "hip", name: "Left, wide" },
  { dx: 0, dz: 6, heading: "0", pitch: "5", focal: "85", aspect: "3:2", preset: "eye", name: "Long lens" },
  { dx: 0.5, dz: 4.5, heading: "355", pitch: "0", focal: "18", aspect: "4:3", preset: "eye", name: "Wide, low light" },
];

async function placeAndSave(page: Page, p: Plan, door: { x: number; z: number }, n: number): Promise<void> {
  await page.locator(`label[for="f${p.focal}"]`).click();
  await page.selectOption("#aspect", p.aspect);
  await page.locator(`label[for="hp-${p.preset}"]`).click();
  await page.fill("#cam-x", (door.x + p.dx).toFixed(3));
  await page.fill("#cam-z", (door.z + p.dz).toFixed(3));
  await page.fill("#cam-heading", p.heading);
  await page.fill("#cam-pitch", p.pitch);
  await page.fill("#shot-name", p.name);
  await saveShot(page, n);
}

async function sceneWithScale(page: Page): Promise<{ x: number; z: number }> {
  await openLarge(page, true);
  await confirmScale(page);
  await viewerCall(page, (v) => v.setRunning(false));
  const door = await viewerCall(page, (v) => { const V3 = v.content.position.constructor; return v.content.localToWorld(new V3(0.4, -0.08, -1.59)); });
  return { x: door.x, z: door.z };
}

test("criterion_8_saved_shot_reopens_to_the_same_frame_and_a_5_degree_heading_fault_is_caught", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(900_000);
  const t0 = Date.now();
  const mark = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
  const door = await sceneWithScale(page);
  mark("scene loaded and scale confirmed");
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  await placeAndSave(page, PLANS[1]!, door, 1);
  mark("shot saved");

  // reload the page, reopen the same file (scale and shots come back through the scene record), open the shot
  await page.reload();
  await openLarge(page, false);
  mark("reloaded and reopened");
  await expect(page.locator("#scale-chip")).toHaveText("Scale confirmed, door 2.00 m");
  const same = await diffAfterOpen(page, 1);
  console.log("criterion 8 mean abs diff", JSON.stringify(same));
  expect(same.settleOk).toBe(true);
  expect([same.w, same.h]).toEqual([1920, 803]);
  expect(same.diff).toBeLessThan(THRESHOLD);

  // planted fault: the stored heading is 5 degrees off, so the restored camera looks somewhere else
  const orig = await readStored(page, "shot-001");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => { const q = indexedDB.open("film-previz"); q.onsuccess = () => res(q.result); });
    const tx = db.transaction("shots", "readwrite");
    const st = tx.objectStore("shots");
    const rec = await new Promise<Record<string, any>>((res) => { const q = st.getAll(); q.onsuccess = () => res(q.result[0]); });
    rec.pose.headingDeg = (rec.pose.headingDeg + 5) % 360;
    st.put(rec);
    await new Promise((res) => { tx.oncomplete = () => res(null); });
    db.close();
    await (window as unknown as { __session: { refresh(): Promise<void> } }).__session.refresh();
  });
  const faulty = await diffAfterOpen(page, 1);
  console.log("planted fault (heading + 5 degrees) mean abs diff", JSON.stringify(faulty), "stored heading was", orig.shot.pose.headingDeg);
  expect(faulty.diff).toBeGreaterThan(THRESHOLD);

  // revert
  await page.evaluate(async (orig) => {
    const db = await new Promise<IDBDatabase>((res) => { const q = indexedDB.open("film-previz"); q.onsuccess = () => res(q.result); });
    const tx = db.transaction("shots", "readwrite");
    tx.objectStore("shots").put(orig);
    await new Promise((res) => { tx.oncomplete = () => res(null); });
    db.close();
    await (window as unknown as { __session: { refresh(): Promise<void> } }).__session.refresh();
  }, orig.shot);
  const back = await diffAfterOpen(page, 1);
  console.log("after revert mean abs diff", JSON.stringify(back));
  expect(back.diff).toBeLessThan(THRESHOLD);
});

test("five_shots_saved_reloaded_each_opens_to_the_same_frame", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(1_500_000);
  const door = await sceneWithScale(page);
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  for (let i = 0; i < PLANS.length; i++) await placeAndSave(page, PLANS[i]!, door, i + 1);
  await page.reload();
  await openLarge(page, false);
  const diffs: number[] = [];
  for (let n = 1; n <= PLANS.length; n++) {
    const d = await diffAfterOpen(page, n);
    diffs.push(+d.diff.toFixed(4));
    expect(d.settleOk).toBe(true);
    expect(d.diff).toBeLessThan(THRESHOLD);
  }
  console.log("five shots mean abs diffs", JSON.stringify(diffs));
});

test("a_shot_saved_with_a_stand_in_reopens_to_the_same_frame", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(900_000);
  const door = await sceneWithScale(page);
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  await page.locator('label[for="f24"]').click();
  await page.locator('label[for="hp-eye"]').click();
  await page.fill("#cam-x", (door.x + 0.5).toFixed(3));
  await page.fill("#cam-z", (door.z + 4).toFixed(3));
  await page.fill("#cam-heading", "0");
  await page.fill("#cam-pitch", "0");
  await page.fill("#shot-name", "With a stand-in");
  await page.click("#standin-add");
  await page.fill("#si-name", "Anna");
  await saveShot(page, 1);
  const stored = await readStored(page, "shot-001");
  expect(stored.shot.standIns).toHaveLength(1);
  expect(stored.shot.standIns[0]).toMatchObject({ label: "Anna", heightM: 1.75, headHeightM: 0.23 });

  await page.reload();
  await openLarge(page, false);
  const d = await diffAfterOpen(page, 1);
  console.log("stand-in shot mean abs diff", JSON.stringify(d));
  expect(d.settleOk).toBe(true);
  expect(d.diff).toBeLessThan(THRESHOLD);
  const n = await page.evaluate(() => (window as unknown as { __standIns: { list(): unknown[] } }).__standIns.list().length);
  expect(n).toBe(1);
});
