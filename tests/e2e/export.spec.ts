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
