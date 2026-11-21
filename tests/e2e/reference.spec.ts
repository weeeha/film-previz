import { test, expect, type Page } from "@playwright/test";

const ORIGIN = "http://localhost:5185";

/** A flat magenta PNG drawn in the page, so no image file is needed in the repo. 600 x 400, which is not the shot's 16:9. */
async function magentaPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600; c.height = 400;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 600, 400);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

const box = (page: Page, sel: string) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const opacity = (page: Page) => page.locator(".cmp-img").evaluate((e) => getComputedStyle(e).opacity);

test("reference_compare_side_by_side_overlay_swap_and_no_leaks", async ({ page }) => {
  test.setTimeout(120_000);
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));

  await page.goto("/#/stage");
  await page.waitForFunction(() => "__viewer" in window);
  // Look through starts on, as in the draft. This test begins from the walk view.
  await expect(page.locator("#through")).toBeChecked();
  await page.locator("#through").uncheck();

  // empty state, then load through the real file input
  await expect(page.locator("#ref-summary")).toHaveText("None yet");
  await expect(page.locator("#reference")).not.toHaveAttribute("open", "");
  await expect(page.locator("#ref-empty")).toContainText("No reference photo.");
  const png = await magentaPng(page);
  await page.setInputFiles("#ref-file", { name: "test-photo.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#reference")).toHaveAttribute("open", "");
  await expect(page.locator("#ref-file-name")).toHaveText("test-photo.png");
  await expect(page.locator("#ref-name")).toHaveValue("test-photo.png");
  await expect(page.getByText("Used for camera position and geometry only.")).toBeVisible();
  await expect(page.locator(".cmp")).toHaveCount(0); // not looking through yet
  await expect(page.locator("#ref-look-note")).toBeVisible();

  await page.selectOption("#aspect", "16:9");
  await page.locator("#through").check();
  await expect(page.locator(".cmp")).toHaveCount(1);
  await expect(page.locator("#ref-look-note")).toBeHidden();

  // overlay is the default: the photo sits on the frame at 50 percent, in the shot's aspect
  await expect(page.locator("#overlay")).toBeChecked();
  expect(await opacity(page)).toBe("0.5");
  const frame = await box(page, "#frame");
  const photo = await box(page, ".cmp-box.photo");
  expect(Math.abs(photo.x - frame.x)).toBeLessThan(1.5);
  expect(Math.abs(photo.w - frame.w)).toBeLessThan(1.5);
  expect(Math.abs(photo.w / photo.h - 16 / 9)).toBeLessThan(0.02);
  const fit = await page.locator(".cmp-img").evaluate((e) => getComputedStyle(e).objectFit);
  expect(fit).toBe("cover"); // 3:2 photo cropped to the 16:9 frame

  // swap key: full opacity photo, then back
  await page.locator("#viewport").focus();
  await page.keyboard.press("x");
  expect(await opacity(page)).toBe("1");
  await page.keyboard.press("x");
  expect(await opacity(page)).toBe("0.5");

  // side by side: photo left, live frame right, same size, same aspect
  await page.locator("#side").check();
  await expect(page.locator("#overlay")).not.toBeChecked();
  expect(await opacity(page)).toBe("1");
  const f2 = await box(page, "#frame");
  const p2 = await box(page, ".cmp-box.photo");
  const l2 = await box(page, ".cmp-box.live");
  expect(p2.x + p2.w).toBeLessThanOrEqual(f2.x + 1);
  expect(Math.abs(p2.w - f2.w)).toBeLessThan(1.5);
  expect(Math.abs(p2.h - f2.h)).toBeLessThan(1.5);
  expect(Math.abs(p2.w / p2.h - 16 / 9)).toBeLessThan(0.02);
  expect(Math.abs(l2.x - f2.x)).toBeLessThan(1.5);
  expect(Math.abs(p2.y - f2.y)).toBeLessThan(1.5);
  // the viewer draws the live frame in the same place as the page mask
  const fs = await page.evaluate(() => (window as unknown as { __viewer: { frameSize(): { w: number; h: number }; frameLayout: { cxFrac: number } } }).__viewer);
  expect(fs.frameLayout.cxFrac).toBe(0.75);

  // guides: set by number, readable as numbers, and draggable
  await page.fill("#ref-photo-horizon", "42.5");
  await page.fill("#ref-frame-horizon", "50");
  await page.fill("#ref-photo-top", "20");
  await page.fill("#ref-photo-bottom", "80");
  await expect(page.locator("#ref-photo-out")).toHaveText("60.0%");
  await expect(page.locator(".cmp")).toHaveAttribute("data-photo-horizon", "42.5");
  await expect(page.locator(".cmp")).toHaveAttribute("data-photo-height", "60");
  const h = page.locator('.cmp-guides[data-who="frame"] .cmp-handle.h');
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + f2.h * 0.1, { steps: 4 });
  await page.mouse.up();
  const dragged = Number(await page.locator(".cmp").getAttribute("data-frame-horizon"));
  expect(dragged).toBeGreaterThan(58);
  expect(dragged).toBeLessThan(62);
  await expect(page.locator("#ref-frame-horizon")).toHaveValue(String(dragged));

  // frame grab with overlay and guides on holds none of them; the page itself does (control)
  await page.locator("#overlay").check();
  await expect(page.locator("#ref-guides")).toBeChecked();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.click("#save-frame")]);
  const grabB64 = (await import("node:fs")).readFileSync((await dl.path())!).toString("base64");
  const shotB64 = (await page.locator("#viewport").screenshot({ type: "png" })).toString("base64");
  const magenta = (b64: string, mime: string) => page.evaluate(async ([b64, mime]) => {
    const bin = Uint8Array.from(atob(b64!), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 120 && d[i + 2]! > 120 && d[i + 1]! < 60) n++;
    return n;
  }, [b64, mime] as const);
  expect(await magenta(shotB64, "image/png")).toBeGreaterThan(1000); // control: the viewport shows the photo
  expect(await magenta(grabB64, "image/jpeg")).toBe(0);

  // the app reports file name and role only
  const ref = await page.evaluate(() => (document.querySelector("#ref-name") as HTMLInputElement).value);
  expect(ref).toBe("test-photo.png");

  // remove: back to the empty state, layer gone
  await page.click("#ref-remove");
  await expect(page.locator("#ref-summary")).toHaveText("None yet");
  await expect(page.locator(".cmp")).toHaveCount(0);

  // network: only the app's own origin, plain GETs with no body (blob and data URLs are in-page)
  for (const r of requests) {
    const local = r.url.startsWith(ORIGIN) || r.url.startsWith("blob:") || r.url.startsWith("data:");
    expect(local, r.url).toBe(true);
    expect(r.body, r.url).toBeNull();
    expect(r.method, r.url).toBe("GET");
  }
});
