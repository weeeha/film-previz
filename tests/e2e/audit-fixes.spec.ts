import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { makeShot } from "../helpers/model";

// Task 20 fixes, measured in the running app: first-screen action, footer rows, page scroll, size select, keyboard.

const splat500k = path.resolve("scenes/set-01-500k.spz");
const collider = path.resolve("scenes/set-01-collider.glb");
const truthFile = path.resolve("scenes/set-01-truth.json");

type W = {
  __viewer: { setRunning(on: boolean): void; localToClient(p: [number, number, number]): { x: number; y: number }; renderer: { domElement: HTMLElement } };
  __session: { scene(): { id: string } | null; refresh(): Promise<void>; store(): Promise<{ saveShot(s: unknown): Promise<void> }> };
};

function tinyPly(seed = 7, n = 300): Buffer {
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex " + n + "\n" +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  const buf = new Float32Array(n * 14);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let i = 0; i < n; i++) buf.set([(rnd() - 0.5) * 2, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 3, -3, -3, -3, 1, 0, 0, 0], i * 14);
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(buf.buffer)]);
}

const saveShots = (page: Page, shots: unknown[]) => page.evaluate(async (list) => {
  const w = window as unknown as W;
  const store = await w.__session.store();
  for (const s of list) await store.saveShot(s);
  await w.__session.refresh();
}, shots);

const box = (page: Page, sel: string) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });

test("audit_fixes_first_screen_footer_rows_page_scroll_size_select_and_ground_text", async ({ page }) => {
  test.skip(!fs.existsSync(splat500k) || !fs.existsSync(collider) || !fs.existsSync(truthFile), "scenes/ is empty: run npm run make-set");
  test.setTimeout(420_000);
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as { door: { centreX: number; heightMetric: number; max: { metric: number[] } } };
  const faceZ = truth.door.max.metric[2]!;
  const toLocal = (m: [number, number, number]): [number, number, number] => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/#/");
  await page.setInputFiles("#splat-file", splat500k);
  await page.setInputFiles("#collider-file", collider);
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 120_000 });
  await expect(page.locator("#scene-status")).toHaveAttribute("data-collider-triangles", /^\d+$/, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as W).__viewer.setRunning(false));
  const clickLocal = async (p: [number, number, number]) => {
    const c = await page.evaluate((p) => {
      const v = (window as unknown as W).__viewer;
      v.renderer.domElement.scrollIntoView({ block: "center" });
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
  await expect(page.locator("#open-stage")).toHaveText("Open Stage");

  // item 1: the next action is on the first screen, scrolled to the top
  await page.evaluate(() => { document.getElementById("main")!.scrollTop = 0; });
  const open = await box(page, "#open-stage");
  console.log("open-stage rect", JSON.stringify(open));
  expect(open.top).toBeLessThanOrEqual(800);
  expect(open.bottom).toBeLessThanOrEqual(900);

  // item 15: a magnitude and a direction in words
  await expect(page.locator("#ground-offset")).toHaveText(/^Floor was \d+\.\d{3} m (above|below) the origin$/);

  // item 13 (Scenes): "Open Stage" is a button that changes the route
  expect(await page.locator("#open-stage").evaluate((e) => e.tagName)).toBe("BUTTON");

  // shots for the rest: 3 with one named "Update shot" territory (number 40) so the longest footer label shows
  const id = await page.evaluate(() => (window as unknown as W).__session.scene()!.id);
  await saveShots(page, [makeShot(id, 1, { sizeLabel: null }), makeShot(id, 2), makeShot(id, 40, { sizeLabel: null })]);

  // item 2: the Size select shows "Not set" whole
  await page.evaluate(() => { location.hash = "#/shots"; });
  await expect(page.locator("#shots-table tbody tr")).toHaveCount(3);
  const sel = page.locator("#shots-table tbody tr").first().locator("select.size-edit");
  const fit = await sel.evaluate((e) => {
    const cs = getComputedStyle(e);
    const c = document.createElement("canvas").getContext("2d")!;
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const widest = Math.max(...[...(e as HTMLSelectElement).options].map((o) => c.measureText(o.text).width));
    return { selectWidth: e.getBoundingClientRect().width, widest };
  });
  console.log("size select", JSON.stringify(fit));
  expect(fit.selectWidth).toBeGreaterThanOrEqual(fit.widest + 20); // text plus the chevron
  // item 7: the count is in the footer and the Export line, not in the page head
  await expect(page.locator("#shot-count-head")).toHaveCount(0);
  await expect(page.locator("#row-count")).toHaveText("3 shots");
  // item 8: export copy
  await expect(page.locator("#export")).toContainText("Saved at the shot's aspect, without overlays.");
  await expect(page.locator("#export")).not.toContainText("Exact aspect, no interface");

  // item 14: the Stage document does not scroll in a 900 px window
  await page.evaluate(() => { location.hash = "#/stage"; });
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  const doc = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, inner: innerHeight }));
  console.log("stage document", JSON.stringify(doc));
  expect(doc.scrollHeight).toBeLessThanOrEqual(doc.inner);

  // item 10: the footer has two rows in every state: the filled control, then Save frame
  const rowsOf = async () => {
    const a = await box(page, "#save-shot"), f = await box(page, "#save-frame");
    return { primaryTop: a.top, frameTop: f.top, frameBelow: f.top >= a.bottom - 0.5, frameWidth: f.width, primaryWidth: a.width };
  };
  const fresh = await rowsOf();
  expect(fresh.frameBelow).toBe(true);
  await page.locator('#strip button.shot[data-shot-id="shot-040"]').click();
  await expect(page.locator("#save-shot")).toHaveText("Update shot 40");
  await expect(page.locator("#save-as-new")).toBeVisible();
  const editing = await rowsOf();
  console.log("footer", JSON.stringify({ fresh, editing }));
  expect(editing.frameBelow).toBe(true);
  const asNew = await box(page, "#save-as-new"), upd = await box(page, "#save-shot");
  expect(Math.abs(asNew.top - upd.top)).toBeLessThan(1); // the two filled and outlined controls share a row
  expect(asNew.right).toBeLessThanOrEqual(await page.locator(".inspector").evaluate((e) => e.getBoundingClientRect().right));

  // item 11: the scroll area has room under its last row, so content can scroll clear of the footer
  const pad = await page.locator(".inspector-scroll").evaluate((e) => parseFloat(getComputedStyle(e).paddingBottom));
  expect(pad).toBeGreaterThanOrEqual(16);
  await page.locator(".inspector-scroll").evaluate((e) => { e.scrollTop = e.scrollHeight; });
  const last = await box(page, ".inspector-scroll > :last-child"), foot = await box(page, ".insp-foot");
  expect(last.bottom).toBeLessThanOrEqual(foot.top - 8);
});

test("audit_fixes_plain_tab_reaches_open_stage_and_a_strip_shot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => "__viewer" in window);
  await page.setInputFiles("#splat-file", { name: "tiny.ply", mimeType: "application/octet-stream", buffer: tinyPly() });
  await expect(page.locator("#scene-status")).toHaveAttribute("data-splats", /^\d+$/, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__session.scene()?.id ?? null)).not.toBeNull();

  const tabTo = async (sel: string, max = 80): Promise<number> => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((s) => !!document.activeElement?.matches(s), sel)) return i;
    }
    throw new Error(`plain Tab never reached ${sel} in ${max} presses`);
  };

  // Shots with no shots: "Open Stage" is a stop and Enter opens the Stage
  await page.evaluate(() => { location.hash = "#/shots"; });
  await expect(page.locator("#no-shots")).toBeVisible();
  console.log("Tab presses to Open Stage on Shots:", await tabTo("#no-shots button"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();

  // item 14 with the scale notice showing (scene open, scale not confirmed): the Stage document still does not scroll
  await expect(page.locator("#scale-notice")).toBeVisible();
  const doc = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, inner: innerHeight }));
  console.log("stage document, notice showing", JSON.stringify(doc));
  expect(doc.scrollHeight).toBeLessThanOrEqual(doc.inner);

  // Stage with a saved shot: the strip shot is a stop and Enter opens it
  const id = await page.evaluate(() => (window as unknown as W).__session.scene()!.id);
  await saveShots(page, [makeShot(id, 1), makeShot(id, 2)]);
  await expect(page.locator("#strip button.shot")).toHaveCount(2);
  console.log("Tab presses to the first strip shot:", await tabTo("#strip button.shot"));
  await page.keyboard.press("Enter");
  await expect(page.locator("#strip button.shot").first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#save-shot")).toHaveText("Update shot 1");

  // Scenes: "Open Stage" is a stop
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.locator("#open-stage")).toBeVisible();
  console.log("Tab presses to Open Stage on Scenes:", await tabTo("#open-stage"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();

  // Shots with no scene: "Open Scenes" is a stop
  await page.reload();
  await page.evaluate(() => { location.hash = "#/shots"; });
  await expect(page.locator("#no-scene")).toBeVisible();
  console.log("Tab presses to Open Scenes on Shots:", await tabTo("#no-scene button"));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Scenes" })).toBeVisible();
});
