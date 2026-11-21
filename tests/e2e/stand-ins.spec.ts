import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");
const splat500k = path.resolve("scenes/set-01-500k.spz");
const haveScenes = () => fs.existsSync(collider) && fs.existsSync(truthFile);
const SKIP = "scenes/ is empty: run npm run make-set";

type V = {
  setRunning(on: boolean): void;
  localToClient(p: [number, number, number]): { x: number; y: number };
  currentCamera(): { updateMatrixWorld(f: boolean): void; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } };
};
type SI = { id: string; label: string; heightM: number; positionM: [number, number, number]; headingDeg: number };
const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];

/** A few hundred almost transparent splats as a binary PLY, so the fast tests need no 28 MB file and no splat tints a figure. */
function tinyPly(): Buffer {
  const n = 300;
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex " + n + "\n" +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  const buf = new Float32Array(n * 14);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < n; i++) {
    buf.set([(rnd() - 0.5) * 2, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, -8, -3, -3, -3, 1, 0, 0, 0], i * 14);
  }
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

/** Mark the door with the collider and confirm a 2.00 m scale, as the Stage tests do. */
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

async function stageWithScale(page: Page): Promise<void> {
  await openTiny(page);
  await confirmScale(page);
  await page.click('a[data-route="/stage"]');
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  await page.locator("#through").check();
}

const setOf = (page: Page) => page.evaluate(() => (window as unknown as { __standIns: { list(): SI[] } }).__standIns.list());
const pct = async (page: Page): Promise<number> => {
  const t = (await page.locator("#standin-list .standin .pct").first().textContent()) ?? "";
  const m = /^(\d+\.\d)% of frame height/.exec(t);
  expect(m, `readout text "${t}"`).not.toBeNull();
  return Number(m![1]);
};

/** Grab the shot camera twice-comparable: pixels kept in the page under `key`, size returned. */
async function grab(page: Page, key: string): Promise<{ w: number; h: number }> {
  return page.evaluate(async (key) => {
    const w = window as unknown as { __viewer: { grabShot(w: number): Promise<{ blob: Blob }> }; __px?: Record<string, ImageData> };
    const g = await w.__viewer.grabShot(640);
    const bmp = await createImageBitmap(g.blob);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    (w.__px ??= {})[key] = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { w: bmp.width, h: bmp.height };
  }, key);
}
const meanDiff = (page: Page, a: string, b: string) => page.evaluate(([a, b]) => {
  const px = (window as unknown as { __px: Record<string, ImageData> }).__px;
  let sum = 0, n = 0;
  for (let i = 0; i < px[a!]!.data.length; i += 4) for (let k = 0; k < 3; k++) { sum += Math.abs(px[a!]!.data[i + k]! - px[b!]!.data[i + k]!); n++; }
  return sum / n;
}, [a, b] as const);
const pixelAt = (page: Page, key: string, u: number, v: number) => page.evaluate(([key, u, v]) => {
  const im = (window as unknown as { __px: Record<string, ImageData> }).__px[key as string]!;
  const x = Math.round((u as number) * (im.width - 1)), y = Math.round((v as number) * (im.height - 1));
  const o = (y * im.width + x) * 4;
  return [im.data[o]!, im.data[o + 1]!, im.data[o + 2]!];
}, [key, u, v] as const);

/** Centre of the first figure in the shot frame, as shares of the frame width and height (0 to 1, y down). */
const figureCentreInFrame = (page: Page, atM?: number) => page.evaluate((atM) => {
  const w = window as unknown as { __viewer: { shotCamera: { updateMatrixWorld(f: boolean): void; matrixWorldInverse: unknown; projectionMatrix: unknown } }; __standIns: { list(): SI[] } };
  const s = w.__standIns.list()[0]!;
  const cam = w.__viewer.shotCamera as unknown as { updateMatrixWorld(f: boolean): void; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } };
  cam.updateMatrixWorld(true);
  const v = [s.positionM[0], s.positionM[1] + (atM ?? s.heightM / 2), s.positionM[2], 1];
  const mul = (m: number[], p: number[]) => [0, 1, 2, 3].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]! * p[3]!);
  const c = mul(cam.projectionMatrix.elements, mul(cam.matrixWorldInverse.elements, v));
  return { u: (c[0]! / c[3]! + 1) / 2, v: (1 - c[1]! / c[3]!) / 2 };
}, atM);

async function saveShot(page: Page, expectNumber: number): Promise<void> {
  const asNew = page.locator("#save-as-new");
  if (await asNew.isVisible()) await asNew.click(); else await page.locator("#save-shot").click();
  await expect(page.locator("#save-msg")).toHaveText(new RegExp(`^Saved shot ${expectNumber},`), { timeout: 240_000 });
}

test.beforeEach(() => { test.skip(!haveScenes(), SKIP); });

test("add_shows_the_readout", async ({ page }) => {
  test.setTimeout(240_000);
  await stageWithScale(page);
  await expect(page.locator("#standin-empty")).toContainText("No stand-ins on this scene. Add one to check how large a person is in the frame.");
  await expect(page.locator("#standin-count")).toHaveText("None yet");
  await page.click("#standin-add");
  await expect(page.locator("#standin-count")).toHaveText("1 on this scene");
  await expect(page.locator("#standin-list .standin b")).toHaveText("Person A");
  await expect(page.locator("#standin-list .standin .pct")).toHaveText(/^\d+\.\d% of frame height/);
  await expect(page.locator("#standin-list .standin .hint").first()).toContainText("1.75 m tall, 3.0 m away");
  await expect(page.locator("#standin-assumption")).toHaveText("Head height of 0.23 m is an assumption. Use these readouts to check face size against the shot size.");
  const [s] = await setOf(page);
  expect(s!.heightM).toBe(1.75);
  expect(s!.positionM[1]).toBeCloseTo(0, 2); // on the floor
  // the row opens in place with the editor fields
  await expect(page.locator("#si-name")).toHaveValue("Person A");
  await expect(page.locator("#si-height")).toHaveValue("1.75");
  await page.fill("#si-height", "1.62");
  await expect(page.locator("#standin-list .standin .hint").first()).toContainText("1.62 m tall");
  await page.fill("#si-name", "Anna");
  await expect(page.locator("#standin-list .standin b")).toHaveText("Anna");
  await page.locator("#si-remove").click();
  await expect(page.locator("#standin-count")).toHaveText("None yet");
});

test("readout_follows_the_lens", async ({ page }) => {
  test.setTimeout(240_000);
  await stageWithScale(page);
  await page.click("#standin-add");
  await page.locator('label[for="f35"]').click();
  const p35 = await pct(page);
  await page.locator('label[for="f85"]').click();
  const p85 = await pct(page);
  expect(Math.abs(p85 - (p35 * 85) / 35)).toBeLessThan(0.2);
});

test("add_is_disabled_without_scale", async ({ page }) => {
  test.setTimeout(240_000);
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await expect(page.locator("#standin-add")).toBeDisabled();
  await expect(page.locator("#standin-noscale")).toBeVisible();
  await expect(page.locator("#standin-noscale")).toHaveText("Confirm the scale to add stand-ins. Their heights are in metres.");
});

test("figure_is_in_the_frame_grab", async ({ page }) => {
  test.setTimeout(240_000);
  await stageWithScale(page);
  await page.fill("#f-free", "24");
  await page.click("#standin-add");
  const c = await figureCentreInFrame(page);
  expect(c.u).toBeGreaterThan(0.2); expect(c.u).toBeLessThan(0.8);
  expect(c.v).toBeGreaterThan(0.2); expect(c.v).toBeLessThan(0.8);
  await grab(page, "with");
  const above = await figureCentreInFrame(page, 1.95); // where the name label would sit
  const [px, py, pz] = await pixelAt(page, "with", c.u, c.v) as number[];
  for (const [got, want] of [[px, 217], [py, 220], [pz, 225]] as const) expect(Math.abs(got! - want)).toBeLessThanOrEqual(12);
  await page.evaluate(() => (window as unknown as { __standIns: { replace(l: SI[]): void } }).__standIns.replace([]));
  await grab(page, "without");
  expect(await meanDiff(page, "with", "without")).toBeGreaterThan(0.2);
  // the name label sits 0.2 m above the head and is not in the grab: that pixel is the same with and without the figure
  expect(above.v).toBeGreaterThan(0.05);
  expect(await pixelAt(page, "with", above.u, above.v)).toEqual(await pixelAt(page, "without", above.u, above.v));
});

test("grab_is_the_same_with_and_without_selection", async ({ page }) => {
  test.setTimeout(240_000);
  await stageWithScale(page);
  await page.fill("#f-free", "14"); // wide enough that the ring on the floor and the label above the head are inside the frame
  await page.click("#standin-add");
  await expect(page.locator("#si-name")).toBeVisible(); // selected after Add
  await grab(page, "selected");
  await page.locator("#standin-list .standin-open").click(); // closes the row, so nothing is selected
  await expect(page.locator("#si-name")).toHaveCount(0);
  await grab(page, "plain");
  expect(await meanDiff(page, "selected", "plain")).toBeLessThan(0.005);
});

test("drag_moves_the_figure_on_the_floor", async ({ page }) => {
  test.setTimeout(240_000);
  await stageWithScale(page);
  await page.fill("#f-free", "24");
  await page.click("#standin-add");
  await page.locator("#standin-list .standin-open").click(); // deselect: the drag itself must select
  const x0 = (await setOf(page))[0]!.positionM[0];
  const pose0 = await page.evaluate(() => JSON.stringify((window as unknown as { __shot: { pose: unknown } }).__shot.pose));
  const at = await page.evaluate(() => {
    const w = window as unknown as { __viewer: V & { renderer: { domElement: HTMLElement }; currentCamera(): { updateMatrixWorld(f: boolean): void; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } } }; __standIns: { list(): SI[] } };
    w.__viewer.renderer.domElement.scrollIntoView({ block: "start" });
    const s = w.__standIns.list()[0]!;
    const cam = w.__viewer.currentCamera();
    cam.updateMatrixWorld(true);
    const mul = (m: number[], p: number[]) => [0, 1, 2, 3].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]! * p[3]!);
    const c = mul(cam.projectionMatrix.elements, mul(cam.matrixWorldInverse.elements, [s.positionM[0], s.positionM[1] + 0.8, s.positionM[2], 1]));
    const r = w.__viewer.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((c[0]! / c[3]! + 1) / 2) * r.width, y: r.top + ((1 - c[1]! / c[3]!) / 2) * r.height };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 100, at.y, { steps: 5 });
  await page.mouse.move(at.x + 200, at.y, { steps: 5 });
  await page.mouse.up();
  const [s] = await setOf(page);
  expect(s!.positionM[0]).toBeGreaterThan(x0 + 0.05);
  expect(Math.abs(s!.positionM[1])).toBeLessThan(0.01);
  await expect(page.locator("#si-x")).toHaveValue(s!.positionM[0].toFixed(2));
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { __shot: { pose: unknown } }).__shot.pose))).toBe(pose0); // no look drag
});

test("opening_a_shot_replaces_the_working_set", async ({ page }) => {
  test.setTimeout(300_000);
  await stageWithScale(page);
  await page.click("#standin-add");
  await page.click("#standin-add");
  await expect(page.locator("#standin-count")).toHaveText("2 on this scene");
  await saveShot(page, 1);
  await page.locator("#si-remove").click();
  await page.locator("#standin-list .standin-open").click();
  await page.locator("#si-remove").click();
  await expect(page.locator("#standin-count")).toHaveText("None yet");
  await saveShot(page, 2);
  const strip = page.locator("#strip button.shot");
  await strip.nth(0).click();
  await expect(page.locator("#standin-list .standin")).toHaveCount(2);
  await strip.nth(1).click();
  await expect(page.locator("#standin-count")).toHaveText("None yet");
  await expect(page.locator("#standin-list .standin")).toHaveCount(0);
  await strip.nth(0).click();
  await expect(page.locator("#standin-list .standin")).toHaveCount(2);
});

test("stand_ins_survive_a_reload", async ({ page }) => {
  test.setTimeout(300_000);
  await stageWithScale(page);
  await page.click("#standin-add");
  await page.fill("#si-name", "Anna");
  await page.fill("#si-x", "0.6");
  await page.fill("#si-facing", "90");
  await page.click("#standin-add");
  await page.fill("#si-name", "Cop 1");
  await page.fill("#si-height", "1.9");
  await page.fill("#si-z", "-1.5");
  const before = await setOf(page);
  expect(before).toHaveLength(2);
  await saveShot(page, 1);
  await page.reload();
  await openTiny(page);
  await page.click('a[data-route="/stage"]');
  await expect(page.locator("#strip button.shot")).toHaveCount(1);
  await page.locator("#strip button.shot").first().click();
  const after = await setOf(page);
  expect(after.map((s) => s.label)).toEqual(["Anna", "Cop 1"]);
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 3; k++) expect(Math.abs(after[i]!.positionM[k]! - before[i]!.positionM[k]!)).toBeLessThan(0.001);
    expect(after[i]!.heightM).toBe(before[i]!.heightM);
    expect(after[i]!.headingDeg).toBe(before[i]!.headingDeg);
  }
});

test("figure_behind_the_chair_among_the_splats", async ({ page }) => {
  test.skip(!fs.existsSync(splat500k), SKIP);
  test.setTimeout(420_000);
  // Measures, does not assert, how a figure sits among the splats. The chair seat is at (-1.5, 0.45, -2) in metres.
  await toScenes(page);
  await page.waitForFunction(() => "__viewer" in window);
  await page.setInputFiles("#splat-file", splat500k);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 120_000 });
  await confirmScale(page);
  await page.click('a[data-route="/stage"]');
  await page.locator("#through").check();
  await page.fill("#cam-x", "-1.5");
  await page.fill("#cam-z", "1");
  await page.fill("#cam-heading", "0");
  await page.locator('label[for="hp-low"]').click();
  await page.fill("#f-free", "35");
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as unknown as { __viewer: V }).__viewer.setRunning(false));
  // figure 0.5 m behind the chair seat, seen over it
  await page.evaluate(() => (window as unknown as { __standIns: { add(p: number[], h: number): void } }).__standIns.add([-1.5, 0, -2.6], 0));
  await grab(page, "behind");
  // Walk the centre column of the figure from its head to its feet and count the pixels that still show the figure's grey.
  const col = await page.evaluate(() => {
    const w = window as unknown as { __viewer: { shotCamera: { updateMatrixWorld(f: boolean): void; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } } }; __standIns: { list(): SI[] }; __px: Record<string, ImageData> };
    const s = w.__standIns.list()[0]!;
    const cam = w.__viewer.shotCamera;
    cam.updateMatrixWorld(true);
    const mul = (m: number[], p: number[]) => [0, 1, 2, 3].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]! * p[3]!);
    const proj = (y: number) => { const c = mul(cam.projectionMatrix.elements, mul(cam.matrixWorldInverse.elements, [s.positionM[0], y, s.positionM[2], 1])); return { u: (c[0]! / c[3]! + 1) / 2, v: (1 - c[1]! / c[3]!) / 2 }; };
    const top = proj(s.heightM * 0.95), feet = proj(0.05);
    const im = w.__px.behind!;
    const x = Math.round(top.u * (im.width - 1));
    const y0 = Math.max(0, Math.round(top.v * (im.height - 1))), y1 = Math.min(im.height - 1, Math.round(feet.v * (im.height - 1)));
    let grey = 0, total = 0, firstCovered = -1;
    for (let y = y0; y <= y1; y++) {
      const o = (y * im.width + x) * 4;
      const isGrey = Math.abs(im.data[o]! - 217) <= 12 && Math.abs(im.data[o + 1]! - 220) <= 12 && Math.abs(im.data[o + 2]! - 225) <= 12;
      total++; if (isGrey) grey++; else if (firstCovered < 0) firstCovered = y - y0;
    }
    return { grey, total, firstCovered };
  });
  console.log("figure behind the chair, centre column head to feet", JSON.stringify(col));
});
