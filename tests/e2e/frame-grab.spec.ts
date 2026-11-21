import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type Res = { widthPx: number; heightPx: number; decodedW: number; decodedH: number; magentaPx: number; canvasW: number; canvasH: number; canvasAfter: [number, number] };
const run = (page: Page, f: number, a: number, o: object = {}) =>
  page.evaluate(([f, a, o]) => (window as unknown as { __box: { run: (f: number, a: number, o: object) => Promise<Res> } }).__box.run(f as number, a as number, o as object), [f, a, o] as const);

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/harness/box.html");
  await page.waitForFunction(() => "__box" in window);
});

test("frame_grab_has_no_overlays", async ({ page }) => {
  const r = await run(page, 50, 16 / 9, { helper: true });
  expect(r.magentaPx).toBe(0);
});

test("frame_grab_overlay_check_can_see_magenta", async ({ page }) => {
  // Control: the same scene rendered with the helper layer visible must show magenta, so a zero above means something.
  const r = await page.evaluate(() => (window as unknown as { __box: { liveMagenta(): number } }).__box.liveMagenta());
  expect(r).toBeGreaterThan(0);
});

test("frame_grab_sizes", async ({ page }) => {
  const a = await run(page, 50, 16 / 9);
  expect([a.widthPx, a.heightPx, a.decodedW, a.decodedH]).toEqual([1920, 1080, 1920, 1080]);
  const b = await run(page, 50, 2.39);
  expect([b.widthPx, b.heightPx, b.decodedW, b.decodedH]).toEqual([1920, 803, 1920, 803]);
});

test("frame_grab_leaves_renderer_unchanged", async ({ page }) => {
  const r = await run(page, 50, 2.39);
  expect(r.canvasAfter).toEqual([r.canvasW, r.canvasH]);
});

const splat = path.resolve("scenes/set-01-500k.spz");
test("frame_grab_of_a_loaded_splat_scene_is_not_blank", async ({ page }) => {
  test.skip(!fs.existsSync(splat), "scenes/set-01-500k.spz is missing: run npm run make-set");
  test.setTimeout(120_000);
  await page.goto("/#/");
  await page.setInputFiles("#splat-file", splat);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 60_000 });
  await page.waitForTimeout(1500); // let Spark sort for the walk pose
  const r = await page.evaluate(async () => {
    const url = "/src/camera/frameGrab.ts";
    const { grabFrame } = await import(/* @vite-ignore */ url);
    const v = (window as unknown as { __viewer: { setRunning(on: boolean): void; renderer: never; scene: never; camera: never } }).__viewer;
    v.setRunning(false); // the grab is the only render in flight: Chromium renders 500k splats slowly here
    const g = await grabFrame(v.renderer as never, v.scene, v.camera, 640, 16 / 9);
    const bmp = await createImageBitmap(g.blob);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const m = d[i]! + d[i + 1]! + d[i + 2]!; sum += m; if (m > 90) lit++; }
    return { w: g.widthPx, h: g.heightPx, litShare: lit / (d.length / 4) };
  });
  console.log("splat grab", JSON.stringify(r));
  expect(r.litShare).toBeGreaterThan(0.05);
});
