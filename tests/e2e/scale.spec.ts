import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const splat = path.resolve("scenes/set-01-500k.spz");
const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");

type V = {
  renderer: { setAnimationLoop(f: null): void };
  content: { scale: { x: number }; position: { y: number } };
  scene: { getObjectByName(n: string): { layers: { mask: number }; position: { y: number }; geometry: { boundingBox: { min: { y: number }; max: { y: number } } | null; computeBoundingBox(): void } } | undefined };
  localToClient(p: [number, number, number]): { x: number; y: number };
};
const viewerCall = <T>(page: Page, fn: (v: V) => T) =>
  page.evaluate(`(${fn.toString()})(window.__viewer)`) as Promise<T>;

/** Door points in content-local raw units. Metric (x, y, z) maps to (x, y - 1.2, z) / 2.5 (see set-01-truth.json). */
const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];

async function open(page: Page, withCollider: boolean): Promise<void> {
  await page.goto("/#/stage");
  await page.setInputFiles("#splat-file", splat);
  if (withCollider) await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#stage-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 90_000 });
  if (withCollider) await expect(page.locator("#stage-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await page.waitForTimeout(1500); // let Spark finish its first sort
  // Chromium on SwiftShader draws 500k splats at about 1 fps: stop the loop so clicks and checks are not starved.
  await viewerCall(page, (v) => v.renderer.setAnimationLoop(null));
  await page.locator("#scale-panel").scrollIntoViewIfNeeded();
}

const clickLocal = async (page: Page, p: [number, number, number]) => {
  // Clicking a panel button scrolls the page; bring the canvas back so the point is inside the window.
  const c = await page.evaluate((p) => {
    const v = (window as unknown as { __viewer: V & { renderer: { domElement: HTMLElement } } }).__viewer;
    v.renderer.domElement.scrollIntoView({ block: "start" });
    return v.localToClient(p);
  }, p);
  expect(c.y).toBeGreaterThan(0);
  expect(c.y).toBeLessThan(720);
  await page.mouse.click(c.x, c.y);
};

test("scale_two_point_marking_then_measure_and_restore", async ({ page }) => {
  test.skip(!fs.existsSync(splat) || !fs.existsSync(collider) || !fs.existsSync(truthFile), "scenes/ is empty: run npm run make-set");
  test.setTimeout(240_000);
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { door: { centreX: number; heightMetric: number; max: { metric: number[] } } };
  const faceZ = truth.door.max.metric[2]!; // the door face, 0.05 m in front of the wall
  // Aim at the floor in front of the door and a little inside the door face, 0.05 m under its top edge.
  // The distance between these two hits is sqrt(1.95^2 + 0.05^2) = 1.9506 m, not 2.00 m, so the factor
  // comes out 2.5 * 2.00 / 1.9506 = 2.563 and not 2.5. Typing 2.00 anyway is what a user does with a rough mark.
  const base: [number, number, number] = [truth.door.centreX, 0, faceZ + 0.05];
  const top: [number, number, number] = [truth.door.centreX, truth.door.heightMetric - 0.05, faceZ];
  const expectedFactor = 2.5 * 2.0 / Math.hypot(1.95, 0.05);

  await open(page, true);
  await page.click("#scale-mark");
  await clickLocal(page, toLocal(base));
  await clickLocal(page, toLocal(top));
  await expect(page.locator("#scale-raw")).toContainText("units");
  await page.fill("#scale-known", "2.00");
  await page.click("#scale-apply");

  await expect(page.locator("#scale-badge")).toContainText(/manual/i);
  const factorText = await page.locator("#scale-factor").innerText();
  const factor = Number(factorText.split(" ")[0]);
  expect(factor).toBeGreaterThan(expectedFactor - 0.02);
  expect(factor).toBeLessThan(expectedFactor + 0.02);

  // Floor is y = 0: the floor point (metric y 0) sits at world y 0.
  const floorY = await viewerCall(page, (v) => v.content.scale.x * ((0 - 1.2) / 2.5) + v.content.position.y);
  expect(Math.abs(floorY)).toBeLessThan(0.01);

  // The reference figure stands on the floor, 1.75 m tall, on the helper layer.
  const fig = await viewerCall(page, (v) => {
    const f = v.scene.getObjectByName("reference-figure")!;
    f.geometry.computeBoundingBox();
    const b = f.geometry.boundingBox!;
    return { height: b.max.y - b.min.y, baseY: f.position.y + b.min.y, mask: f.layers.mask };
  });
  expect(fig.height).toBeCloseTo(1.75, 2);
  expect(Math.abs(fig.baseY)).toBeLessThan(0.001);
  expect(fig.mask).toBe(2); // helper layer only

  // The check line, and the measure tool with two new real clicks at the same two points.
  const check = Number(await page.locator("#scale-check").getAttribute("data-m"));
  expect(Math.abs(check - 2.0)).toBeLessThan(0.02);
  await clickLocal(page, toLocal(base));
  await clickLocal(page, toLocal(top));
  await expect(page.locator("#scale-measure")).toHaveAttribute("data-m", /^\d/);
  const measured = Number(await page.locator("#scale-measure").getAttribute("data-m"));
  console.log("scale factor", factor, "expected", expectedFactor, "measure tool", measured);
  expect(Math.abs(measured - 2.0)).toBeLessThan(0.02);

  // Reload, open the same file again, the scale is restored.
  await page.reload();
  await open(page, false);
  await expect(page.locator("#scale-badge")).toContainText(/manual/i);
  const factor2 = Number((await page.locator("#scale-factor").innerText()).split(" ")[0]);
  expect(factor2).toBeCloseTo(factor, 3);
  expect(await viewerCall(page, (v) => v.content.scale.x)).toBeCloseTo(factor, 3);
  expect(await viewerCall(page, (v) => v.scene.getObjectByName("reference-figure") !== undefined)).toBe(true);
});

test("scale_marking_needs_a_collider_and_says_so", async ({ page }) => {
  await page.goto("/#/stage");
  await expect(page.locator("#scale-mark")).toBeDisabled();
  await expect(page.locator("#scale-msg")).toContainText("collider");
  await expect(page.locator("#scale-badge")).toContainText("Not confirmed");
});
