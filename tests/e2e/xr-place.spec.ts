import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");
const SKIP = "scenes/ is empty: run npm run make-set";

type V = {
  localToClient(p: [number, number, number]): { x: number; y: number };
};
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


type Handle = { end(): Promise<void>; onEnd(fn: () => void): void; onSelect(fn: (h: unknown) => void): void };

test("shots_placed_in_vr_are_saved_after_the_session_ends_and_the_stage_is_as_it_was", async ({ page }) => {
  test.skip(!fs.existsSync(truthFile) || !fs.existsSync(collider), SKIP);
  test.setTimeout(240_000);
  await openTiny(page);
  await confirmScale(page);
  await page.goto("/#/stage");
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await page.waitForFunction(() => "__xrSession" in window);
  // the Stage as the person left it: 35 mm lens, a pose, a name in the details
  await page.locator('label[for="f35"]').click();
  await page.fill("#shot-name", "Working name");
  const before = await page.evaluate(() => JSON.stringify((window as unknown as { __shot: { pose: unknown } }).__shot.pose));
  // a stand-in for the headset: two trigger presses, then the session ends
  await page.evaluate(() => {
    const ends: Array<() => void> = [], selects: Array<(h: unknown) => void> = [];
    const h: Handle = { end: async () => { ends.forEach((f) => f()); }, onEnd: (f) => { ends.push(f); }, onSelect: (f) => { selects.push(f); } };
    (window as unknown as { __xrSession(h: Handle): void; __fakeXr: Handle; __fakeSelects: Array<(h: unknown) => void> }).__xrSession(h);
    const w = window as unknown as { __fakeXr: Handle; __fakeSelects: Array<(h: unknown) => void> };
    w.__fakeXr = h; w.__fakeSelects = selects;
    const s = Math.SQRT1_2; // yaw of 90 degrees to the right: quaternion about y by -90
    selects.forEach((f) => f({ position: [1, 1.62, 2], quaternion: [0, -s, 0, s] }));
    selects.forEach((f) => f({ position: [-1, 1.5, 0.5], quaternion: [0, 0, 0, 1] }));
  });
  await page.evaluate(() => (window as unknown as { __fakeXr: Handle }).__fakeXr.end());
  await expect(page.locator("#save-msg")).toHaveText("2 shots placed in VR were saved.", { timeout: 120_000 });
  const shots = await page.evaluate(() => (window as unknown as { __session: { shots(): Array<Record<string, any>> } }).__session.shots().map((s) => ({ n: s.name, num: s.number, h: s.pose.headingDeg, p: s.pose.pitchDeg, r: s.pose.rollDeg, pos: s.pose.positionM, hg: s.heightAboveGroundM, f: s.lens.focalLengthMm, m: s.move.kind, w: s.frame.widthPx, sc: s.scaleConfirmed })));
  expect(shots.map((s) => s.n)).toEqual(["From headset 1", "From headset 2"]);
  expect(shots[0]!.h).toBeCloseTo(90, 6); expect(shots[0]!.r).toBe(0); expect(shots[0]!.hg).toBe(1.62); expect(shots[0]!.pos).toEqual([1, 1.62, 2]);
  expect(shots[1]!.h).toBeCloseTo(0, 6); expect(shots[1]!.hg).toBe(1.5);
  for (const s of shots) { expect(s.f).toBe(35); expect(s.m).toBe("static"); expect(s.w).toBe(1920); expect(s.sc).toBe(true); }
  // the Stage's working pose, lens and details are back
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { __shot: { pose: unknown } }).__shot.pose))).toBe(before);
  await expect(page.locator("#shot-name")).toHaveValue("Working name");
  await expect(page.locator("#save-shot")).toHaveText("Save shot");
  await expect(page.locator("#strip button.shot")).toHaveCount(2);
});

test("a_session_with_no_placed_shots_says_none_were_saved_and_changes_nothing", async ({ page }) => {
  test.skip(!fs.existsSync(truthFile) || !fs.existsSync(collider), SKIP);
  test.setTimeout(240_000);
  await openTiny(page);
  await confirmScale(page);
  await page.goto("/#/stage");
  await page.waitForFunction(() => "__xrSession" in window);
  await page.evaluate(() => {
    const ends: Array<() => void> = [];
    (window as unknown as { __xrSession(h: unknown): void; __e: Array<() => void> }).__xrSession({ end: async () => {}, onEnd: (f: () => void) => { ends.push(f); }, onSelect: () => {} });
    (window as unknown as { __e: Array<() => void> }).__e = ends;
    ends.forEach((f) => f());
  });
  await expect(page.locator("#save-msg")).toHaveText("0 shots placed in VR were saved.");
  expect(await page.evaluate(() => (window as unknown as { __session: { shots(): unknown[] } }).__session.shots().length)).toBe(0);
});
