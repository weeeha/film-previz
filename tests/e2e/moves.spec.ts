import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");
const haveScenes = () => fs.existsSync(collider) && fs.existsSync(truthFile);
const SKIP = "scenes/ is empty: run npm run make-set";

/** A few hundred almost transparent splats as a binary PLY, so these tests need no 28 MB file. */
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

async function stage(page: Page): Promise<void> {
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await page.locator("#through").check();
}

async function saveShot(page: Page, expectNumber: number): Promise<void> {
  const asNew = page.locator("#save-as-new");
  if (await asNew.isVisible()) await asNew.click(); else await page.locator("#save-shot").click();
  await expect(page.locator("#save-msg")).toHaveText(new RegExp(`^Saved shot ${expectNumber},`), { timeout: 240_000 });
}

type Cam = { pos: [number, number, number]; fov: number; aspect: number; focal: number };
const cam = (page: Page): Promise<Cam> => page.evaluate(() => {
  const w = window as unknown as { __viewer: { shotCamera: { position: { x: number; y: number; z: number }; fov: number; aspect: number; getFocalLength(): number } } };
  const c = w.__viewer.shotCamera;
  return { pos: [c.position.x, c.position.y, c.position.z] as [number, number, number], fov: c.fov, aspect: c.aspect, focal: c.getFocalLength() };
});
const shotPose = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __shot: { pose: unknown } }).__shot.pose)) as unknown);
const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** In the page: wait for the preview to start, then sample the shot camera every frame until it ends. */
const sampler = (page: Page) => page.evaluate(() => new Promise<{ startMs: number; endMs: number; samples: Array<{ t: number; pos: number[]; fov: number; focal: number }> }>((resolve, reject) => {
  const root = document.getElementById("moves")!;
  const c = (window as unknown as { __viewer: { shotCamera: { position: { x: number; y: number; z: number }; fov: number; getFocalLength(): number } } }).__viewer.shotCamera;
  const samples: Array<{ t: number; pos: number[]; fov: number; focal: number }> = [];
  let startMs = -1;
  const give = performance.now() + 60_000;
  const step = () => {
    const now = performance.now();
    if (now > give) { reject(new Error("preview never finished")); return; }
    const state = root.dataset.state;
    if (state === "playing") {
      if (startMs < 0) startMs = now;
      samples.push({ t: now - startMs, pos: [c.position.x, c.position.y, c.position.z], fov: c.fov, focal: c.getFocalLength() });
    } else if (startMs >= 0) { resolve({ startMs, endMs: now, samples }); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));

test.beforeEach(() => { test.skip(!haveScenes(), SKIP); });

test("push_in_preview_moves_by_the_recorded_distance", async ({ page }) => {
  test.setTimeout(240_000);
  await stage(page);
  await page.selectOption("#move-kind", "push-in");
  await page.fill("#move-amount", "1.2");
  await page.fill("#move-duration", "2");
  const before = await cam(page);
  const poseBefore = await shotPose(page);

  // the end pose, held: 1.2 from the start, same lens
  await page.click("#move-show-end");
  const atEnd = await cam(page);
  expect(dist(before.pos, atEnd.pos)).toBeGreaterThan(1.19);
  expect(dist(before.pos, atEnd.pos)).toBeLessThan(1.21);
  expect(atEnd.pos[1]).toBe(before.pos[1]);
  expect([atEnd.fov, atEnd.focal, atEnd.aspect]).toEqual([before.fov, before.focal, before.aspect]);
  await page.click("#move-show-end");
  expect(await cam(page)).toEqual(before);

  // the preview: samples never leave the path, the lens never changes, and the camera ends on the start pose exactly
  const sampled = sampler(page);
  await page.click("#move-preview");
  const { samples } = await sampled;
  expect(samples.length).toBeGreaterThan(2);
  let last = -1;
  for (const s of samples) {
    const d = dist(before.pos, s.pos as [number, number, number]);
    expect(d).toBeLessThan(1.21);
    expect(d).toBeGreaterThanOrEqual(last - 1e-9);
    last = d;
    expect([s.fov, s.focal]).toEqual([before.fov, before.focal]);
  }
  expect(await cam(page)).toEqual(before);
  expect(last).toBeGreaterThan(0.6); // the camera did travel along the path
  expect(await shotPose(page)).toEqual(poseBefore);
});

test("preview_takes_the_set_time", async ({ page }) => {
  test.setTimeout(240_000);
  await stage(page);
  await page.selectOption("#move-kind", "push-in");
  await page.fill("#move-duration", "2");
  const sampled = sampler(page);
  await page.click("#move-preview");
  const { startMs, endMs } = await sampled;
  const took = (endMs - startMs) / 1000;
  console.log("preview took", took.toFixed(2), "s");
  expect(took).toBeGreaterThan(1.9);
  expect(took).toBeLessThan(3.5);
});

test("move_is_saved_and_restored", async ({ page }) => {
  test.setTimeout(300_000);
  await stage(page);
  await page.selectOption("#move-kind", "pan");
  await page.fill("#move-amount", "30");
  await page.fill("#move-duration", "4");
  await page.selectOption("#move-ease", "linear");
  await saveShot(page, 1);
  const saved = await page.evaluate(() => (window as unknown as { __session: { shots(): Array<{ move: unknown }> } }).__session.shots()[0]!.move) as { kind: string; endPose: { headingDeg: number } };
  expect(saved.kind).toBe("pan");
  expect(saved.endPose.headingDeg).toBeCloseTo(30, 6);

  await page.reload();
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await expect(page.locator("#strip button.shot")).toHaveCount(1);
  await page.locator("#strip button.shot").first().click();
  await expect(page.locator("#move-kind")).toHaveValue("pan");
  await expect(page.locator("#move-amount")).toHaveValue("30");
  await expect(page.locator("#move-duration")).toHaveValue("4");
  await expect(page.locator("#move-ease")).toHaveValue("linear");
});

test("static_shot_is_unchanged", async ({ page }) => {
  test.setTimeout(240_000);
  await stage(page);
  await expect(page.locator("#move-kind")).toHaveValue("static");
  await expect(page.locator("#move-preview")).toBeDisabled();
  await saveShot(page, 1);
  const move = await page.evaluate(() => (window as unknown as { __session: { shots(): Array<{ move: unknown }> } }).__session.shots()[0]!.move);
  expect(move).toEqual({ kind: "static", durationS: null, ease: null, endPose: null });
});
