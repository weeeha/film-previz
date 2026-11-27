import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const splat = path.resolve("scenes/set-01-500k.spz");
const collider = path.resolve("scenes/set-01-collider.glb");

test("a splat file chosen in the file input renders splats", async ({ page }) => {
  test.skip(!fs.existsSync(splat), "scenes/set-01-500k.spz is missing: run npm run make-set");
  await page.goto("/#/");
  await page.setInputFiles("#splat-file", splat);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 60_000 });
  const n = Number(await page.locator("#scene-status").getAttribute("data-splats"));
  expect(n).toBeGreaterThan(400_000);
  await expect.poll(
    () => page.evaluate(() => (window as unknown as { __viewer: { hasContent(): boolean } }).__viewer.hasContent()),
    { timeout: 30_000, message: "canvas still shows only the clear colour" },
  ).toBe(true);
});

test("a collider GLB loads without error", async ({ page }) => {
  test.skip(!fs.existsSync(collider), "scenes/set-01-collider.glb is missing: run npm run make-set");
  await page.goto("/#/");
  await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
});
