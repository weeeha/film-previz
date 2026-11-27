import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { networkViolations, isLocalScheme, type Req } from "../helpers/network";

const splat500k = path.resolve("scenes/set-01-500k.spz");
const ply2m = path.resolve("scenes/set-01-2m.ply");
const collider = path.resolve("scenes/set-01-collider.glb");
const SKIP = "scenes/ is empty: run npm run make-set";

/** Every request the page and its workers make, from before the first navigation, and every WebSocket it opens. */
function record(page: Page): { reqs: Req[]; local: string[] } {
  const reqs: Req[] = [];
  const local: string[] = [];
  page.context().on("request", (r) => {
    if (isLocalScheme(r.url())) local.push(r.url().slice(0, 60));
    reqs.push({ url: r.url(), method: r.method(), body: r.postDataBuffer() });
  });
  page.on("websocket", (ws) => reqs.push({ url: ws.url(), method: "GET", body: null }));
  return { reqs, local };
}

function summary(reqs: Req[], local: string[]): string {
  const hosts = new Map<string, number>();
  for (const r of reqs) if (!isLocalScheme(r.url)) { const h = new URL(r.url).host; hosts.set(h, (hosts.get(h) ?? 0) + 1); }
  const bodies = reqs.filter((r) => r.body).map((r) => r.body!.byteLength);
  return `${reqs.length} requests (${[...hosts].map(([h, n]) => `${n} to ${h}`).join(", ")}), ${local.length} blob or data or about URLs not counted, ${bodies.length} with a body, largest body ${Math.max(0, ...bodies)} bytes`;
}

async function toScenes(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.locator("#splat-file")).toBeAttached({ timeout: 30_000 });
  await page.waitForFunction(() => "__viewer" in window);
}

test("network_only_the_apps_own_origin_and_no_scene_bytes_through_load_save_and_export", async ({ page, baseURL }) => {
  test.skip(!fs.existsSync(splat500k) || !fs.existsSync(collider), SKIP);
  test.setTimeout(600_000);
  const origin = new URL(baseURL!).host;
  const head = new Uint8Array(fs.readFileSync(splat500k)).subarray(0, 64);
  const { reqs, local } = record(page);

  await toScenes(page);
  await page.setInputFiles("#splat-file", splat500k);
  await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 120_000 });
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __session: { scene(): unknown } }).__session.scene() !== null)).toBe(true);
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as unknown as { __viewer: { setRunning(on: boolean): void } }).__viewer.setRunning(false)); // SwiftShader draws 500k splats at about 1 fps
  const loadedAt = reqs.length;

  // a shot, then the export
  await page.click('a[data-route="/stage"]');
  await page.fill("#shot-name", "Entrance");
  await page.click("#save-shot");
  await expect(page.locator("#save-msg")).toHaveText(/^Saved shot 1,/, { timeout: 240_000 });
  await page.click('a[data-route="/shots"]');
  await expect(page.locator("#shots-table tbody tr")).toHaveCount(1);
  const done = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("#export-btn").click();
  await done;
  await expect(page.locator("#export-done")).toContainText("1 shot exported.");
  await page.waitForTimeout(500);

  console.log(`scene ${path.basename(splat500k)} ${fs.statSync(splat500k).size} bytes; ${summary(reqs, local)}; ${reqs.length - loadedAt} requests after the scene loaded`);
  expect(reqs.length).toBeGreaterThan(0);
  expect(reqs.some((r) => !isLocalScheme(r.url) && new URL(r.url).host === origin)).toBe(true); // the log saw the app load
  expect(networkViolations(reqs, origin, head)).toEqual([]);
});

test("network_largest_available_file_loads_with_no_upload", async ({ page, baseURL }) => {
  test.skip(!fs.existsSync(ply2m), SKIP);
  test.setTimeout(900_000);
  const origin = new URL(baseURL!).host;
  const size = fs.statSync(ply2m).size;
  const head = new Uint8Array(fs.readFileSync(ply2m)).subarray(0, 64);
  const { reqs, local } = record(page);
  await toScenes(page);
  await page.setInputFiles("#splat-file", ply2m);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 600_000 });
  await page.waitForTimeout(1000);
  console.log(`scene ${path.basename(ply2m)} ${size} bytes (${(size / 1e6).toFixed(1)} MB); ${summary(reqs, local)}`);
  expect(size).toBeGreaterThan(100e6);
  expect(networkViolations(reqs, origin, head)).toEqual([]);
});
