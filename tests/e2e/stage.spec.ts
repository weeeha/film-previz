import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const splat = path.resolve("scenes/set-01-500k.spz");
const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");

type V = {
  setRunning(on: boolean): void;
  localToClient(p: [number, number, number]): { x: number; y: number };
  content: { position: { constructor: new (x: number, y: number, z: number) => { x: number; y: number; z: number } }; localToWorld(v: unknown): { x: number; y: number; z: number } };
  lastSettle: { ok: boolean; ms: number } | null;
};
const viewerCall = <T>(page: Page, fn: (v: V) => T) => page.evaluate(`(${fn.toString()})(window.__viewer)`) as Promise<T>;
const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];

test("stage_lens_readout_matches_the_draft_and_presets_are_off_without_scale", async ({ page }) => {
  await page.goto("/#/stage");
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  // header: scene name and scale chip on every route
  await expect(page.locator("#scale-chip")).toHaveText("Scale not confirmed");
  await expect(page.locator("#scene-name")).toHaveText("No scene loaded");
  // presets disabled, with the draft's wording
  for (const id of ["low", "hip", "eye", "high"]) await expect(page.locator(`#hp-${id}`)).toBeDisabled();
  await expect(page.locator("#scale-notice")).toContainText("Scale not confirmed. Heights are in model units, so the presets are off.");
  await expect(page.getByText("Height, model units")).toBeVisible();
  // lens panel
  await page.locator('label[for="f35"]').click();
  await expect(page.locator("#readout")).toHaveText("35 mm on 36 mm: 54.43 degrees horizontal, 32.27 vertical");
  await expect(page.locator("#frame-size")).toHaveText("Frame on the sensor: 36 x 20.25 mm");
  await expect(page.locator("#mask-text")).toHaveText("Frame mask 16:9");
  await page.selectOption("#aspect", "2.39:1");
  await expect(page.locator("#mask-text")).toHaveText("Frame mask 2.39:1");
  await page.selectOption("#sensor", "super-35");
  await expect(page.locator("#readout")).toContainText("35 mm on 24.89 mm");
  // free focal length
  await page.fill("#f-free", "40");
  await expect(page.locator("#readout")).toContainText("40 mm on 24.89 mm");
  // Save frame is the single filled control
  await expect(page.locator(".btn-primary")).toHaveCount(1);
  await expect(page.locator("#save-frame")).toHaveText("Save frame");
});

test("stage_camera_fields_drive_the_shot_camera_and_heading_wraps", async ({ page }) => {
  await page.goto("/#/stage");
  await page.fill("#cam-heading", "370");
  await page.locator("#cam-x").focus(); // leaving the field puts back the wrapped value
  await expect(page.locator("#cam-heading")).toHaveValue("10");
  await page.fill("#cam-pitch", "-2");
  await page.fill("#cam-x", "1.2");
  await page.fill("#cam-z", "3.1");
  const pose = await page.evaluate(() => (window as unknown as { __shot: { pose: unknown } }).__shot.pose);
  expect(pose).toMatchObject({ headingDeg: 10, pitchDeg: -2, positionM: [1.2, expect.any(Number), 3.1] });
  // nudge keys with the viewport focused
  await page.locator("#viewport").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#cam-heading")).toHaveValue("11");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator("#cam-heading")).toHaveValue("6");
});

test("stage_lens_accurate_still_35mm_then_85mm_from_the_same_pose", async ({ page }) => {
  test.skip(!fs.existsSync(splat) || !fs.existsSync(collider) || !fs.existsSync(truthFile), "scenes/ is empty: run npm run make-set");
  test.setTimeout(420_000);
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { door: { centreX: number; heightMetric: number; max: { metric: number[] } } };
  const faceZ = truth.door.max.metric[2]!;

  // Scenes route: load the set and its collider, then confirm the scale by marking the door.
  await page.goto("/#/");
  await page.setInputFiles("#splat-file", splat);
  await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 90_000 });
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await expect(page.locator("#scene-name")).toHaveText("set-01-500k.spz");
  await page.waitForTimeout(1500);
  await viewerCall(page, (v) => v.setRunning(false)); // SwiftShader draws 500k splats at about 1 fps

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
  await expect(page.locator("#scale-badge")).toContainText(/manual/i);
  await expect(page.locator("#scale-chip")).toHaveText("Scale confirmed, door 2.00 m");

  // Stage: 35 mm, full frame, 16:9, eye preset, look through.
  await page.click('a[data-route="/stage"]');
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await expect(page.locator("#scale-chip")).toHaveText("Scale confirmed, door 2.00 m");
  for (const id of ["low", "hip", "eye", "high"]) await expect(page.locator(`#hp-${id}`)).toBeEnabled();
  await page.locator('label[for="f35"]').click();
  await page.selectOption("#sensor", "full-frame");
  await page.selectOption("#aspect", "16:9");
  await page.locator('label[for="hp-eye"]').click();
  await expect(page.locator("#cam-height")).toHaveValue("1.60");
  await page.locator("#through").check();
  await expect(page.locator("#through")).toBeChecked();
  await expect(page.locator("#frame")).toBeVisible();
  await expect(page.locator("#readout")).toContainText("54.43 degrees horizontal, 32.27 vertical");
  await expect(page.locator("#frame-size")).toHaveText("Frame on the sensor: 36 x 20.25 mm");

  // Aim at the door from inside the room: 5 m from the door face, hip height, straight on.
  const door = await viewerCall(page, (v) => { const V3 = v.content.position.constructor; return v.content.localToWorld(new V3(0.4, -0.08, -1.59)); });
  await page.locator('label[for="hp-hip"]').click();
  await page.fill("#cam-x", door.x.toFixed(3));
  await page.fill("#cam-z", (door.z + 5).toFixed(3));
  await page.fill("#cam-heading", "0");
  await page.fill("#cam-pitch", "0");
  await page.fill("#cam-roll", "0");

  const grab = async (focal: string) => {
    await page.locator(`label[for="f${focal}"]`).click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 240_000 }), page.click("#save-frame")]);
    const file = await dl.path();
    const b64 = fs.readFileSync(file).toString("base64");
    const settle = await viewerCall(page, (v) => v.lastSettle);
    expect(settle?.ok).toBe(true);
    // decode in the page, and measure the red door slab on rows around the middle of the frame
    const res = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: "image/jpeg" }));
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(bmp, 0, 0);
      const widths: number[] = [];
      for (const fy of [0.4, 0.45, 0.5, 0.55, 0.6]) {
        const row = ctx.getImageData(0, Math.floor(bmp.height * fy), bmp.width, 1).data;
        let n = 0, first = -1, last = -1;
        for (let x = 0; x < bmp.width; x++) {
          const r = row[x * 4]!, g = row[x * 4 + 1]!, b = row[x * 4 + 2]!;
          if (r > 110 && r > 2 * g && r > 2 * b) { n++; if (first < 0) first = x; last = x; }
        }
        widths.push(n > 0 ? last - first + 1 : 0);
      }
      widths.sort((a, b) => a - b);
      return { w: bmp.width, h: bmp.height, widthPx: widths[2]!, all: widths };
    }, b64);
    return { filename: dl.suggestedFilename(), ...res };
  };

  const a = await grab("35");
  console.log("35 mm", JSON.stringify(a));
  expect([a.w, a.h]).toEqual([1920, 1080]);
  expect(a.widthPx).toBeGreaterThan(150);
  const b = await grab("85");
  console.log("85 mm", JSON.stringify(b));
  expect([b.w, b.h]).toEqual([1920, 1080]);
  const ratio = b.widthPx / a.widthPx;
  console.log("door width ratio", ratio, "expected", 85 / 35);
  expect(Math.abs(ratio / (85 / 35) - 1)).toBeLessThan(0.03);
  expect(b.filename).toBe("frame-85mm-16x9.jpg");
});
