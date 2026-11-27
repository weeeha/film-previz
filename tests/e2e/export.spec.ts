import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { validateShot } from "../../src/model/schema";

const splat500k = path.resolve("scenes/set-01-500k.spz");
const haveScenes = () => fs.existsSync(splat500k);
const SKIP = "scenes/ is empty: run npm run make-set";

type V = { setRunning(on: boolean): void };
const viewerCall = <T>(page: Page, fn: (v: V) => T) => page.evaluate(`(${fn.toString()})(window.__viewer)`) as Promise<T>;

/** Load the page once, then set the hash: a goto to the current URL reloads in WebKit and would drop the open scene. */
async function toScenes(page: Page): Promise<void> {
  if (page.url() === "about:blank") await page.goto("/");
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.locator("#splat-file")).toBeAttached({ timeout: 30_000 });
}

async function openLarge(page: Page): Promise<void> {
  await toScenes(page);
  await page.waitForFunction(() => "__viewer" in window);
  await page.setInputFiles("#splat-file", splat500k);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __session: { scene(): unknown } }).__session.scene() !== null)).toBe(true);
  await page.waitForTimeout(1500);
  await viewerCall(page, (v) => v.setRunning(false)); // SwiftShader draws 500k splats at about 1 fps
}

async function saveShot(page: Page, expectNumber: number): Promise<void> {
  const asNew = page.locator("#save-as-new");
  if (await asNew.isVisible()) await asNew.click(); else await page.locator("#save-shot").click();
  await expect(page.locator("#save-msg")).toHaveText(new RegExp(`^Saved shot ${expectNumber},`), { timeout: 240_000 });
}

/** True when `needle` occurs anywhere in `hay`. */
function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).includes(Buffer.from(needle));
}

/** The scene's first 64 bytes must be in neither the zip as written nor any file inside it once unpacked. */
function sceneBytesFound(zip: Uint8Array, files: Record<string, Uint8Array>, head: Uint8Array): string[] {
  const hits: string[] = [];
  if (contains(zip, head)) hits.push("(zip)");
  for (const [name, bytes] of Object.entries(files)) if (contains(bytes, head)) hits.push(name);
  return hits;
}

test("export_three_shots_downloads_a_zip_with_frames_records_and_no_scene_bytes", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(600_000);
  await openLarge(page);
  await page.click('a[data-route="/stage"]');
  const shots: Array<[string, string, string]> = [["Entrance", "35", "10"], ["Cross", "50", "20"], ["At the chair", "85", "30"]];
  let n = 0;
  for (const [name, focal, heading] of shots) {
    await page.fill("#shot-name", name);
    await page.locator(`label[for="f${focal}"]`).click();
    await page.fill("#cam-heading", heading);
    await saveShot(page, ++n);
  }

  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#shots-table tbody tr")).toHaveCount(3);
  const done = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("#export-btn").click();
  const download = await done;
  expect(download.suggestedFilename()).toBe("set-01-500k-previz.zip");
  await expect(page.locator("#export-done")).toContainText("3 shots exported.");
  const zip = new Uint8Array(fs.readFileSync((await download.path())!));
  if (process.env.EXPORT_KEEP_DIR) { // for the by-hand film-craft fit check: keep the download
    fs.mkdirSync(process.env.EXPORT_KEEP_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.EXPORT_KEEP_DIR, download.suggestedFilename()), zip);
  }
  const files = unzipSync(zip);
  const folder = "set-01-500k-previz/";
  const names = Object.keys(files).sort();
  console.log("zip entries", JSON.stringify(names), "bytes", zip.byteLength);
  expect(names).toEqual([
    "frames/shot-001.jpg", "frames/shot-002.jpg", "frames/shot-003.jpg", "location-sheet.md", "scene-ref.json", "shot-list.md", "shots.json",
  ].map((f) => folder + f));

  for (const i of [1, 2, 3]) {
    const jpg = files[`${folder}frames/shot-00${i}.jpg`]!;
    expect([jpg[0], jpg[1], jpg[2]]).toEqual([0xff, 0xd8, 0xff]); // JPEG magic bytes
    expect([jpg[jpg.length - 2], jpg[jpg.length - 1]]).toEqual([0xff, 0xd9]);
  }
  const records = JSON.parse(strFromU8(files[`${folder}shots.json`]!)) as Array<Record<string, any>>;
  expect(records).toHaveLength(3);
  for (const r of records) expect(validateShot(r), JSON.stringify(r.id)).toEqual({ ok: true });
  expect(records.map((r) => r.frame.file)).toEqual(["frames/shot-001.jpg", "frames/shot-002.jpg", "frames/shot-003.jpg"]);
  const list = strFromU8(files[`${folder}shot-list.md`]!);
  const rows = list.split("\n").filter((l) => /^\| \d+ \|/.test(l));
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("height unverified"); // no collider and no scale here
  expect(strFromU8(files[`${folder}location-sheet.md`]!)).toContain("set-01-500k.spz");
  const ref = JSON.parse(strFromU8(files[`${folder}scene-ref.json`]!)) as Record<string, unknown>;
  expect(Object.keys(ref).sort()).toEqual(["fileName", "name", "scaleSource", "sha256"]);

  const head = new Uint8Array(fs.readFileSync(splat500k)).subarray(0, 64);
  expect(sceneBytesFound(zip, files, head)).toEqual([]);
  // the check has teeth: the same check on a zip with the scene's first bytes inside finds them
  const planted = { ...files, [`${folder}planted.bin`]: head };
  expect(sceneBytesFound(zip, planted, head)).toEqual([`${folder}planted.bin`]);
});


// ----- floor plan (P4-5) -----
const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");
type VV = { localToClient(p: [number, number, number]): { x: number; y: number }; renderer: { domElement: HTMLElement }; clearCollider(): void };
const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];

/** A few hundred almost transparent splats as a binary PLY: a fast scene for the tests that do not need the 500k set. */
function tinyPly(): Buffer {
  const n = 300;
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex " + n + "\n" +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  const buf = new Float32Array(n * 14);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < n; i++) buf.set([(rnd() - 0.5) * 2, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, -8, -3, -3, -3, 1, 0, 0, 0], i * 14);
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(buf.buffer)]);
}

async function openTiny(page: Page): Promise<void> {
  await toScenes(page);
  await page.waitForFunction(() => "__viewer" in window);
  await page.setInputFiles("#splat-file", { name: "tiny.ply", mimeType: "application/octet-stream", buffer: tinyPly() });
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __session: { scene(): unknown } }).__session.scene() !== null)).toBe(true);
}

/** Load the collider, mark the door and confirm a 2.00 m scale, as the Stage tests do. */
async function confirmScale(page: Page): Promise<void> {
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { door: { centreX: number; heightMetric: number; max: { metric: number[] } } };
  const faceZ = truth.door.max.metric[2]!;
  await toScenes(page);
  await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  const clickLocal = async (p: [number, number, number]) => {
    const c = await page.evaluate((p) => {
      const v = (window as unknown as { __viewer: VV }).__viewer;
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

async function exportZip(page: Page): Promise<Record<string, Uint8Array>> {
  await page.click('a[data-route="/shots"]');
  const done = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("#export-btn").click();
  const download = await done;
  return unzipSync(new Uint8Array(fs.readFileSync((await download.path())!)));
}

const SHARED = { room: { x: 3, z: 4 } };

test("export_with_floor_plan", async ({ page }) => {
  test.skip(!haveScenes() || !fs.existsSync(collider) || !fs.existsSync(truthFile), SKIP);
  test.setTimeout(900_000);
  await openLarge(page);
  await confirmScale(page);
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  // two stand-ins and an action axis between them, then three shots from different sides
  await page.evaluate(() => {
    const set = (window as unknown as { __standIns: { add(p: number[], h: number): void } }).__standIns;
    set.add([-1.5, 0, -1.0], 90);
    set.add([1.2, 0, 0.8], 270);
  });
  await expect(page.locator("#standin-count")).toHaveText("2 on this scene");
  await expect(page.locator("#axis-none")).toBeHidden();
  await page.locator("#axis-set").click();
  await expect(page.locator("#axis-line")).toHaveText("Action axis: Person A to Person B");
  const cams: Array<[string, string, string]> = [["0", "3", "0"], ["-2.6", "0", "90"], ["2.2", "-3", "200"]];
  let n = 0;
  for (const [x, z, heading] of cams) {
    await page.fill("#shot-name", `Side ${n + 1}`);
    await page.fill("#cam-x", x);
    await page.fill("#cam-z", z);
    await page.fill("#cam-heading", heading);
    await saveShot(page, ++n);
  }
  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#export .files li", { hasText: "floor-plan.png" })).toContainText("Top-down view with numbered cameras.");
  const files = await exportZip(page);
  const folder = "set-01-500k-previz/";
  expect(Object.keys(files)).toContain(`${folder}floor-plan.png`);
  const png = files[`${folder}floor-plan.png`]!;
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const sheet = strFromU8(files[`${folder}location-sheet.md`]!);
  expect(sheet).toContain("floor-plan.png, cameras numbered as in shot-list.md, action axis: Person A to Person B");
  fs.mkdirSync("reference/app/phase-4", { recursive: true });
  fs.writeFileSync("reference/app/phase-4/floor-plan.png", png);

  // decode the PNG in the page and compare it with the room the truth file gives
  const r = await page.evaluate(async (b64) => {
    const w = window as unknown as { __session: { scene(): any; shots(): any[] }; __viewer: { colliderTriangles(): Float32Array | null } };
    const url = "/src/export/floorPlan.ts";
    const mod = (await import(/* @vite-ignore */ url)) as any;
    const plan = mod.buildFloorPlan(w.__session.scene(), w.__session.shots(), w.__viewer.colliderTriangles());
    const t = mod.planTransform(plan);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    /** Darkest luminance within 4 px of a point. */
    const darkest = (x: number, z: number) => {
      const [px, py] = t.toPx(x, z);
      const d = ctx.getImageData(Math.round(px) - 4, Math.round(py) - 4, 9, 9).data;
      let m = 255;
      for (let i = 0; i < d.length; i += 4) m = Math.min(m, (d[i]! + d[i + 1]! + d[i + 2]!) / 3);
      return m;
    };
    // the test marks the door a little short, so the confirmed factor is not exactly 2.5: the room is the truth file's times factor / 2.5
    const k = w.__session.scene().scale.metricScaleFactor / 2.5;
    const xs = plan.walls.flatMap((s: number[]) => [s[0]!, s[2]!]), zs = plan.walls.flatMap((s: number[]) => [s[1]!, s[3]!]);
    return {
      k, width: bmp.width, height: bmp.height, cameras: plan.cameras.map((q: any) => q.number),
      walls: plan.walls.length,
      minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
      cam1: darkest(plan.cameras[0].x, plan.cameras[0].z),
      backWall: darkest(-1, -4 * k), rightWall: darkest(3 * k, 1), emptyFloor: darkest(0, -2),
    };
  }, Buffer.from(png).toString("base64"));
  console.log("floor plan check", JSON.stringify(r));
  expect(r.width).toBe(2000);
  expect(r.cameras).toEqual([1, 2, 3]);
  expect(r.walls).toBeGreaterThan(8);
  // the walls cut from the collider land on the room of the truth file (x +-3, z -4 to 4), in the frame of the shot poses
  expect(r.k).toBeGreaterThan(0.95); expect(r.k).toBeLessThan(1.05);
  expect(r.minX).toBeCloseTo(-SHARED.room.x * r.k, 1); expect(r.maxX).toBeCloseTo(SHARED.room.x * r.k, 1);
  expect(r.minZ).toBeCloseTo(-SHARED.room.z * r.k, 1); expect(r.maxZ).toBeCloseTo(SHARED.room.z * r.k, 1);
  expect(r.cam1).toBeLessThan(120); // camera 1 is drawn where shot 1 stands
  expect(r.backWall).toBeLessThan(80);
  expect(r.rightWall).toBeLessThan(80);
  expect(r.emptyFloor).toBeGreaterThan(250); // and the floor between is white
});

test("export_without_collider", async ({ page }) => {
  test.skip(!haveScenes() || !fs.existsSync(collider) || !fs.existsSync(truthFile), SKIP);
  test.setTimeout(300_000);
  await openTiny(page);
  await confirmScale(page);
  await page.evaluate(() => (window as unknown as { __viewer: VV }).__viewer.clearCollider());
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  await saveShot(page, 1);
  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#export .files li", { hasText: "floor-plan.png" })).toContainText("Walls are not drawn without a collider mesh.");
  const files = await exportZip(page);
  const key = Object.keys(files).find((k) => k.endsWith("/floor-plan.png"));
  expect(key, "floor-plan.png in the zip").toBeDefined();
  expect(Array.from(files[key!]!.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("export_without_scale", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(300_000);
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await saveShot(page, 1);
  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#export .files li", { hasText: "floor-plan.png" })).toContainText("Left out until the scale is confirmed.");
  const files = await exportZip(page);
  expect(Object.keys(files).some((k) => k.endsWith("floor-plan.png"))).toBe(false);
  const sheetKey = Object.keys(files).find((k) => k.endsWith("location-sheet.md"))!;
  expect(strFromU8(files[sheetKey]!)).toContain("not included: scale not confirmed");
});

/** Width and height from the first start-of-frame marker of a JPEG. */
function jpegSize(b: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5]! << 8) | b[i + 6]!, w: (b[i + 7]! << 8) | b[i + 8]! };
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  throw new Error("no start of frame in the JPEG");
}

test("push_in_exports_two_frames", async ({ page }) => {
  test.skip(!haveScenes(), SKIP);
  test.setTimeout(300_000);
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  // a figure in front of the camera, so the start and end frames differ
  await page.evaluate(() => (window as unknown as { __standIns: { add(p: number[], h: number): void } }).__standIns.add([0, 0, -2.5], 0));
  await page.selectOption("#move-kind", "push-in");
  await page.fill("#move-amount", "1.2");
  await page.fill("#move-duration", "4");
  await saveShot(page, 1);
  await expect(page.locator("#save-msg")).toContainText("with an end frame");
  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#export .files li", { hasText: "frames/shot-001.jpg" })).toContainText("1 end frame is included");
  const files = await exportZip(page);
  const folder = "tiny-previz/";
  const a = files[`${folder}frames/shot-001.jpg`]!, b = files[`${folder}frames/shot-001-end.jpg`]!;
  expect(a, "start frame").toBeDefined();
  expect(b, "end frame").toBeDefined();
  const rec = JSON.parse(strFromU8(files[`${folder}shots.json`]!)) as Array<{ frame: { widthPx: number; heightPx: number }; endFrame: { file: string; widthPx: number; heightPx: number } }>;
  expect(rec[0]!.endFrame.file).toBe("frames/shot-001-end.jpg");
  for (const j of [a, b]) {
    expect([j[0], j[1], j[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpegSize(j)).toEqual({ w: rec[0]!.frame.widthPx, h: rec[0]!.frame.heightPx });
  }
  expect([rec[0]!.endFrame.widthPx, rec[0]!.endFrame.heightPx]).toEqual([rec[0]!.frame.widthPx, rec[0]!.frame.heightPx]);
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  const row = strFromU8(files[`${folder}shot-list.md`]!).split("\n").find((l) => /^\| 1 \|/.test(l))!;
  expect(row).toContain("push-in 1.2 units over 4 s at 0.30 units/s, ease in and out");
});
