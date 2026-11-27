// States walk for Task 20 (phase 3). NOT part of the test suite: run with `npm run audit:states`.
// Drives the real app (real file inputs, clicks and keys) in Chromium and WebKit, light and dark, and writes
// 1440 x 900 PNGs to reference/app/audit/<view>-<state>-<browser>-<theme>.png. The approved draft is shot the same way
// as draft-<view>-<state>-chromium-<theme>.png. Findings go in manifest.json and console.json next to the PNGs.
// Options: --browser chromium|webkit  --theme light|dark  --skip-draft  --skip-app  --only-nowebgl
import { chromium, webkit } from "@playwright/test";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "reference/app/audit");
const APP_PORT = 5185;
const DRAFT_PORT = 5191;
const APP = `http://localhost:${APP_PORT}`;
const DRAFT = `http://localhost:${DRAFT_PORT}`;
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const flag = (k) => argv.includes(`--${k}`);
const browsers = opt("browser") ? [opt("browser")] : ["chromium", "webkit"];
const themes = opt("theme") ? [opt("theme")] : ["light", "dark"];
const SWIFTSHADER = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]; // same flags as the e2e chromium project

const splat500k = path.join(ROOT, "scenes/set-01-500k.spz");
const splat2m = path.join(ROOT, "scenes/set-01-2m.spz");
const collider = path.join(ROOT, "scenes/set-01-collider.glb");
const truthFile = path.join(ROOT, "scenes/set-01-truth.json");
for (const f of [splat500k, splat2m, collider, truthFile]) if (!fs.existsSync(f)) throw new Error(`${f} is missing: run npm run make-set`);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const servers = [];
function stopAll() { for (const p of procs) { try { p.kill("SIGTERM"); } catch {} } for (const s of servers) { try { s.close(); } catch {} } }
process.on("SIGINT", () => { stopAll(); process.exit(130); });

async function up(url) { try { return (await fetch(url)).ok; } catch { return false; } }

async function startApp() {
  if (await up(APP)) throw new Error(`port ${APP_PORT} is already in use: stop that server first`);
  const p = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "ignore" });
  procs.push(p);
  for (let i = 0; i < 60 && !(await up(APP)); i++) await sleep(1000);
  if (!(await up(APP))) throw new Error("dev server did not start");
}

function startDraft() {
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
  const s = http.createServer((req, res) => {
    const u = new URL(req.url, DRAFT);
    const f = path.join(ROOT, "draft", path.normalize(u.pathname === "/" ? "/index.html" : u.pathname));
    if (!f.startsWith(path.join(ROOT, "draft")) || !fs.existsSync(f)) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  servers.push(s);
  return new Promise((r) => s.listen(DRAFT_PORT, r));
}

// ---------- evidence ----------
const manifest = { shots: [], notes: [], tabStops: {}, pixels: [], loading: [] };
const consoleLog = [];
let currentState = "boot";
const note = (n) => { manifest.notes.push(n); console.log("  note:", n); };

function attachConsole(page, tag) {
  page.on("console", (m) => { if (["warning", "error"].includes(m.type())) consoleLog.push({ tag, state: currentState, type: m.type(), text: m.text().slice(0, 400), at: m.location().url }); });
  page.on("pageerror", (e) => consoleLog.push({ tag, state: currentState, type: "pageerror", text: String(e).slice(0, 400) }));
  page.on("requestfailed", (r) => consoleLog.push({ tag, state: currentState, type: "requestfailed", text: `${r.url()} ${r.failure()?.errorText}` }));
}

/** 1440 x 900 viewport PNG, plus a -full PNG when the document is taller (Scenes and Shots scroll). */
async function shot(page, name, tag, { settle = false, full = true, soft = false, timeout = 120000 } = {}) {
  if (soft) { // mid-load captures can hang while the page is busy: bounded wait, and say so
    try { await shot(page, name, tag, { settle, full, soft: false, timeout: 25000 }); }
    catch (e) { note(`${tag}: ${name} not captured, the page did not answer a screenshot within 25 s while busy`); }
    return;
  }
  currentState = name;
  await page.evaluate(() => { window.scrollTo(0, 0); const m = document.querySelector("main"); if (m) m.scrollTop = 0; }).catch(() => {});
  if (settle) await settleViewer(page);
  else await sleep(350);
  const file = `${name}-${tag}.png`;
  await page.screenshot({ path: path.join(OUT, file), timeout });
  manifest.shots.push(file);
  if (full) {
    // The app's <main> scrolls inside a fixed shell, so a full capture needs a taller window for a moment.
    const d = await page.evaluate(() => { const m = document.querySelector("main"); return m ? { sh: m.scrollHeight, ch: m.clientHeight, top: m.getBoundingClientRect().top } : { sh: 0, ch: 0, top: 0 }; }).catch(() => ({ sh: 0, ch: 0, top: 0 }));
    if (name.startsWith("stage") && d.sh > d.ch) manifest.notes.push(`${tag}: ${name}: <main> scrolls on the Stage, content ${d.sh} px in a ${d.ch} px box`);
    if (d.sh > d.ch + 4) {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.width, height: Math.min(6000, Math.ceil(d.top + d.sh) + 2) });
      await sleep(600);
      if (settle) await settleViewer(page);
      const ff = `${name}-${tag}-full.png`;
      await page.screenshot({ path: path.join(OUT, ff), timeout });
      manifest.shots.push(ff);
      await page.setViewportSize(vp);
      await sleep(500);
    }
  }
  console.log("  shot", file);
}

/** The render loop is paused after load (SwiftShader draws about 1 fps): run it just long enough to draw one frame. */
async function settleViewer(page) {
  const has = await page.evaluate(() => !!window.__viewer).catch(() => false);
  if (!has) { await sleep(350); return; }
  await page.evaluate(() => window.__viewer.setRunning(true));
  await sleep(2200);
  await page.evaluate(() => window.__viewer.setRunning(false));
  await sleep(150);
}

async function go(page, route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  await page.waitForFunction((r) => location.hash === r, route);
  await sleep(500);
}
async function goRedirected(page, route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  await page.waitForFunction(() => location.hash === "#/");
  await sleep(500);
}
const gotoScenes = (p) => go(p, "#/");
const gotoStage = (p) => go(p, "#/stage");
const gotoShots = (p) => go(p, "#/shots");

// ---------- focus walk ----------
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';
async function tabWalk(page, view, tag) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.__auditStops = []; window.scrollTo(0, 0); });
  await page.mouse.click(1, 1).catch(() => {}); // neutral spot in the page margin, not a control
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  const stops = [];
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return { body: true };
      window.__auditStops.push(e);
      const cs = getComputedStyle(e);
      const ow = parseFloat(cs.outlineWidth) || 0;
      const ring = (cs.outlineStyle !== "none" && ow > 0) || (cs.boxShadow && cs.boxShadow !== "none");
      const r = e.getBoundingClientRect();
      const label = e.getAttribute("aria-label") || e.getAttribute("title") || (e.innerText || "").trim().replace(/\s+/g, " ") || e.getAttribute("placeholder") || e.value || "";
      const matches = e.matches(":focus-visible");
      return { tag: e.tagName.toLowerCase(), id: e.id || "", cls: String(e.className || "").slice(0, 40), label: label.slice(0, 60), type: e.getAttribute("type") || "", ring: !!ring, ringStyle: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}; shadow ${cs.boxShadow === "none" ? "none" : "set"}`, focusVisible: matches, w: Math.round(r.width), h: Math.round(r.height) };
    });
    if (s.body) { stops.push({ body: true }); break; }
    if (stops.length && stops[0].id === s.id && stops[0].label === s.label && stops[0].tag === s.tag && stops.length > 2) break;
    stops.push(s);
  }
  const missing = await page.evaluate((sel) => {
    const stops = new Set(window.__auditStops);
    const out = [];
    for (const e of document.querySelectorAll(sel)) {
      if (e.disabled || e.hidden || e.closest("[hidden]") || e.closest("[inert]")) continue;
      if (e.getAttribute("tabindex") === "-1") continue;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if ((r.width === 0 && r.height === 0) || cs.visibility === "hidden" || cs.display === "none") continue;
      if (e.tagName === "INPUT" && e.type === "hidden") continue;
      if (e.closest("details:not([open])") && e.tagName !== "SUMMARY" && !e.closest("summary")) continue;
      if (e.type === "radio" && e.name && [...document.querySelectorAll(`input[type=radio][name="${e.name}"]`)].some((r) => stops.has(r))) continue; // a radio group is one Tab stop, the rest by arrow keys
      if (!stops.has(e)) out.push({ tag: e.tagName.toLowerCase(), id: e.id || "", label: (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || "").trim().slice(0, 50) });
    }
    return out;
  }, INTERACTIVE);
  manifest.tabStops[`${view}-${tag}`] = { stops, unreachable: missing };
  console.log(`  tab walk ${view}: ${stops.length} stops, ${missing.length} not reached, ${stops.filter((s) => s.ring === false).length} without a ring`);
  return stops;
}

/** Tab (real key presses) until the first filled control has focus; compare a crop with and without focus. */
async function focusPrimary(page, view, tag) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  let found = false;
  for (let i = 0; i < 120 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.classList?.contains("btn-primary") ?? false);
  }
  let what = "the filled control";
  if (!found) {
    // WebKit's default skips links when Tab is pressed, and the filled control on Scenes is a link: fall back to the first button.
    note(`${view} focus ${tag}: no filled control reached by Tab, so the focus state is shown on the first button instead`);
    what = "the first button";
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    for (let i = 0; i < 120 && !found; i++) {
      await page.keyboard.press("Tab");
      found = await page.evaluate(() => document.activeElement?.tagName === "BUTTON");
    }
    if (!found) { note(`${view} focus ${tag}: no button reached by Tab either`); return; }
  }
  const box = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, id: document.activeElement.id }; });
  const clip = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 };
  const withFocus = await page.screenshot({ clip });
  await shot(page, `${view}-focus`, tag, { full: false });
  await page.evaluate(() => document.activeElement.blur());
  await sleep(200);
  const without = await page.screenshot({ clip });
  const differs = !withFocus.equals(without);
  manifest.tabStops[`${view}-primary-crop-${tag}`] = { on: what, id: box.id, focusRingVisibleByCropDiff: differs };
  console.log(`  focus crop diff ${view}: ${differs}`);
}

// ---------- pixel read ----------
async function readViewportGrey(page, view, tag) {
  const png = await page.screenshot();
  const out = await page.evaluate(async ({ b64, rect }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    const pts = [[rect.x + 6, rect.y + 6], [rect.x + rect.width - 7, rect.y + 6], [rect.x + 6, rect.y + rect.height - 7], [rect.x + rect.width - 7, rect.y + rect.height - 7]];
    return pts.map(([x, y]) => at(x, y));
  }, { b64: png.toString("base64"), rect: await page.evaluate(() => { const r = document.querySelector("#viewport canvas, #viewport").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  manifest.pixels.push({ view, tag, corners: out });
  console.log(`  viewport corner pixels ${view} ${tag}:`, JSON.stringify(out));
}

// ---------- in-page helpers (data made through the store, as the Stage would) ----------
async function addShots(page, items) {
  return page.evaluate(async (items) => {
    const rec = await import("/src/model/shotRecord.ts");
    const sens = await import("/src/camera/sensors.ts");
    const session = window.__session;
    const store = await session.store();
    const sceneId = session.scene().id;
    if (!window.__auditFrame) {
      const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(c.width, c.height);
      let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s & 255; };
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] = rnd(); img.data[i + 1] = rnd(); img.data[i + 2] = rnd(); img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      window.__auditFrame = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
    }
    const sensor = sens.SENSORS[0];
    for (const it of items) {
      const { number, id } = await store.nextShotId(sceneId);
      const shot = rec.buildShot({
        id, number, sceneId,
        lens: { focalMm: it.focal, sensor, aspect: 16 / 9 },
        pose: { positionM: [0.3 * number, it.height, -0.2 * number], headingDeg: (number * 17) % 360, pitchDeg: 0, rollDeg: 0 },
        move: { kind: "static", durationS: null, ease: null, endPose: null },
        standIns: number === 1 ? [{ id: "standin-1", label: "Person A", heightM: 1.75, headHeightM: 0.23, positionM: [0.3, 0, -3], headingDeg: 180 }] : [],
        scaleConfirmed: it.confirmed, frame: { widthPx: 1280, heightPx: 720 }, referencePhoto: null,
        details: { name: it.name, sizeLabel: it.size ?? null, job: it.job ?? "", action: it.action ?? "", notes: it.notes ?? "" },
      });
      await store.saveShot(shot, window.__auditFrame);
    }
    await session.refresh();
    return session.shots().length;
  }, items);
}
async function deleteAllShots(page) {
  await page.evaluate(async () => {
    const session = window.__session; const store = await session.store();
    for (const s of session.shots()) await store.deleteShot(s.sceneId, s.id);
    await session.refresh();
  });
}

async function confirmScale(page) {
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
  const faceZ = truth.door.max.metric[2];
  const toLocal = (m) => [m[0] / 2.5, (m[1] - 1.2) / 2.5, m[2] / 2.5];
  await gotoScenes(page);
  const clickLocal = async (p) => {
    const c = await page.evaluate((p) => { const v = window.__viewer; v.renderer.domElement.scrollIntoView({ block: "start" }); return v.localToClient(p); }, p);
    await page.mouse.click(c.x, c.y);
  };
  await page.click("#scale-mark");
  await clickLocal(toLocal([truth.door.centreX, 0, faceZ + 0.05]));
  await clickLocal(toLocal([truth.door.centreX, truth.door.heightMetric - 0.05, faceZ]));
  await page.fill("#scale-known", "2.00");
  await page.click("#scale-apply");
  await page.waitForFunction(() => document.querySelector("#scale-chip")?.textContent === "Scale confirmed, door 2.00 m", null, { timeout: 15000 });
}

async function waitScene(page, timeout = 180000) {
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector("#scene-status")?.dataset.splats ?? ""), null, { timeout });
  await page.waitForFunction(() => window.__session.scene() !== null, null, { timeout: 30000 });
  await sleep(1200);
}

// one CDP session per page: a throttle set on one session is not reset from another
const cdps = new WeakMap();
async function throttle(page, ctx, rate) {
  let c = cdps.get(page);
  if (!c) { c = await ctx.newCDPSession(page); cdps.set(page, c); }
  await c.send("Emulation.setCPUThrottlingRate", { rate });
}

function tinyPly() {
  const n = 300;
  const header = "ply\nformat binary_little_endian 1.0\nelement vertex " + n + "\n" +
    ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"].map((k) => `property float ${k}`).join("\n") + "\nend_header\n";
  const buf = new Float32Array(n * 14);
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < n; i++) buf.set([(rnd() - 0.5) * 2, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, 3, -3, -3, -3, 1, 0, 0, 0], i * 14);
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(buf.buffer)]);
}

/** Stage with the empty Reference photo panel open, then with the Stand-ins panel open, each scrolled into view. */
async function stageExtras(page, tag) {
  const toggle = async (sel, open) => { const d = page.locator(sel); if ((await d.getAttribute("open")) !== null !== open) await d.locator("summary").click(); };
  const toBottom = () => page.evaluate(() => { const s = document.querySelector(".inspector-scroll"); if (s) s.scrollTop = s.scrollHeight; });
  await toggle("#reference", true); await toBottom(); await shot(page, "stage-noref", tag, { settle: true });
  await toggle("#reference", false);
  await toggle("#standins", true); await toBottom(); await shot(page, "stage-nostandins", tag, { settle: true });
  await toggle("#standins", false);
}

/** --only-extras: redo just those two Stage states (scene open, scale not confirmed, three unverified shots). */
async function extrasPass(type, name, scheme) {
  const tag = `${name}-${scheme}`;
  console.log(`\n== extras ${tag}`);
  const browser = await type.launch(name === "chromium" ? { args: SWIFTSHADER } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    attachConsole(page, tag + "-extras");
    await page.goto(APP + "/");
    await page.waitForFunction(() => "__viewer" in window && "__session" in window);
    await page.setInputFiles("#splat-file", splat500k);
    await waitScene(page);
    await page.evaluate(() => window.__viewer.setRunning(false));
    await addShots(page, [{ name: "Entrance", focal: 35, height: 0.64, confirmed: false }, { name: "Cross to chair", focal: 50, height: 0.64, confirmed: false }, { name: "At the chair", focal: 85, height: 0.4, confirmed: false }]);
    if (!fs.existsSync(path.join(OUT, `scenes-focus-${tag}.png`))) { await gotoScenes(page); await focusPrimary(page, "scenes", tag); }
    await gotoStage(page);
    await stageExtras(page, tag);
    await ctx.close();
  } finally { await browser.close(); }
}

// ---------- one browser x theme ----------
async function appPass(type, name, scheme) {
  const tag = `${name}-${scheme}`;
  console.log(`\n== app ${tag}`);
  const browser = await type.launch(name === "chromium" ? { args: SWIFTSHADER } : {});
  try {
    // ---- WebGL2 missing: getContext("webgl2") returns null through an init script ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
      await ctx.addInitScript(() => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (t, ...a) { return t === "webgl2" ? null : orig.call(this, t, ...a); };
      });
      const page = await ctx.newPage();
      attachConsole(page, tag + "-nowebgl");
      await page.goto(APP + "/#/");
      await page.waitForSelector("#no-webgl", { timeout: 20000 }).catch(() => note(`${tag}: #no-webgl did not appear with webgl2 stubbed out`));
      await shot(page, "scenes-nowebgl", tag);
      // Without WebGL 2 the app sends the Stage and Shots routes back to Scenes (src/main.ts), so the hash ends as "#/".
      await goRedirected(page, "#/stage"); await shot(page, "stage-nowebgl", tag);
      await goRedirected(page, "#/shots"); await shot(page, "shots-nowebgl", tag);
      await ctx.close();
    }
    if (flag("only-nowebgl")) return;

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, acceptDownloads: true });
    const page = await ctx.newPage();
    attachConsole(page, tag);
    await page.goto(APP + "/");
    await page.waitForSelector("#splat-file", { state: "attached", timeout: 30000 });
    await page.waitForFunction(() => "__viewer" in window && "__session" in window);

    // ---- empty: no scene yet ----
    await shot(page, "scenes-empty", tag);
    await gotoStage(page); await shot(page, "stage-noscene", tag);
    await gotoShots(page); await shot(page, "shots-noscene", tag);
    await gotoScenes(page);

    // ---- error: unsupported file, cut-short SPZ ----
    await page.setInputFiles("#splat-file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a splat file") });
    await page.waitForSelector(".notice.err", { timeout: 25000 });
    await shot(page, "scenes-error", tag);
    const cut = fs.readFileSync(splat500k).subarray(0, 20000);
    await page.setInputFiles("#splat-file", { name: "cut-short.spz", mimeType: "application/octet-stream", buffer: cut });
    await page.waitForSelector("#notice-try-ply", { timeout: 60000 }).catch(() => note(`${tag}: cut-short SPZ did not offer Try as PLY`));
    await shot(page, "scenes-error-spz", tag);

    // ---- loading: the 2 m file, a screenshot as soon as the load line shows ----
    if (name === "chromium") { await throttle(page, ctx, 6); manifest.loading.push(`${tag}: CPU throttled 6x (CDP) while the 2 m file loads, to widen the loading window`); }
    await page.setInputFiles("#splat-file", splat2m);
    const sawLoad = await page.waitForSelector("#load-line", { timeout: 4000 }).then(() => true).catch(() => false);
    if (sawLoad) {
      const text = await page.locator("#load-line").textContent().catch(() => null);
      manifest.loading.push(`${tag}: scene load captured, line was "${text}"`);
      await shot(page, "scenes-loading", tag, { full: false, soft: true });
    } else manifest.loading.push(`${tag}: scene load too fast to capture (no #load-line within 4 s of the file input)`);
    await waitScene(page);
    if (name === "chromium") { await throttle(page, ctx, 1); }

    // ---- the 500k scene for the rest ----
    await page.setInputFiles("#splat-file", splat500k);
    await page.waitForFunction(() => document.querySelector("#scene-status")?.dataset.splats !== undefined && document.querySelector("#load-line") === null, null, { timeout: 180000 });
    await waitScene(page);
    await page.evaluate(() => window.__viewer.setRunning(false));
    await page.setInputFiles("#collider-file", collider);
    const sawCol = await page.waitForSelector('#collider-line:has-text("reading")', { timeout: 1500 }).then(() => true).catch(() => false);
    manifest.loading.push(sawCol ? `${tag}: collider reading state seen` : `${tag}: collider load too fast to capture (no "reading" line within 1.5 s)`);
    if (sawCol) await shot(page, "scenes-loading-collider", tag, { full: false, soft: true });
    await page.waitForFunction(() => document.querySelector("#scene-status")?.dataset.colliderTriangles !== undefined, null, { timeout: 60000 });
    await sleep(1000);

    // ---- scale not confirmed ----
    await shot(page, "scenes-noscale", tag, { settle: true });
    await gotoShots(page); await shot(page, "shots-empty", tag);
    await gotoStage(page); await shot(page, "stage-noshots", tag, { settle: true });
    await addShots(page, [
      { name: "Entrance", focal: 35, height: 0.64, confirmed: false, size: "WS" },
      { name: "Cross to chair", focal: 50, height: 0.64, confirmed: false },
      { name: "At the chair", focal: 85, height: 0.4, confirmed: false },
    ]);
    await sleep(400);
    await shot(page, "stage-noscale", tag, { settle: true });
    await stageExtras(page, tag);
    await gotoShots(page); await shot(page, "shots-unverified", tag);

    // ---- confirm the scale, four confirmed shots ----
    await deleteAllShots(page);
    await confirmScale(page);
    await addShots(page, [
      { name: "Entrance", focal: 35, height: 1.6, confirmed: true, size: "WS", job: "Show the room before anyone enters", action: "Door opens" },
      { name: "Cross to chair", focal: 50, height: 1.6, confirmed: true, size: "MS" },
      { name: "At the chair", focal: 85, height: 1.0, confirmed: true, size: "CU" },
      { name: "Chair, low", focal: 24, height: 0.3, confirmed: true },
    ]);
    await gotoScenes(page); await shot(page, "scenes-default", tag, { settle: true });
    await readViewportGrey(page, "scenes", tag);
    await gotoStage(page); await shot(page, "stage-default", tag, { settle: true });
    await readViewportGrey(page, "stage", tag);
    await gotoShots(page); await shot(page, "shots-default", tag);

    // ---- keyboard focus ----
    await gotoScenes(page); await focusPrimary(page, "scenes", tag); await tabWalk(page, "scenes", tag);
    await gotoStage(page); await focusPrimary(page, "stage", tag); await tabWalk(page, "stage", tag);
    await gotoShots(page); await focusPrimary(page, "shots", tag); await tabWalk(page, "shots", tag);

    // ---- deleted, with undo ----
    await page.locator('button[aria-label="Delete shot 4"]').click();
    await page.waitForSelector("#undo-notice", { timeout: 5000 }).catch(() => note(`${tag}: no undo notice after delete`));
    await shot(page, "shots-deleted", tag);
    await page.locator("#undo-delete").click().catch(() => {});
    await sleep(500);

    // ---- long content: 80 character scene name, 40 shots, 600 character note ----
    const longName = "Warehouse loading bay with the shutters half open and the late afternoon light low".slice(0, 80);
    await gotoScenes(page);
    await page.fill("#scene-name-in", longName);
    await page.click("#save-details");
    await sleep(800);
    await shot(page, "scenes-long", tag, { settle: true });
    const note600 = ("The camera starts behind the chair and drifts forward while the door opens. ").repeat(9).slice(0, 600);
    const more = [];
    for (let i = 5; i <= 40; i++) more.push({ name: i === 7 ? "Entrance, wide, alternate with the shutters closed and the light from the left" : `Shot name number ${i}`, focal: [14, 18, 24, 28, 35, 50, 85, 100, 135][i % 9], height: [0.3, 1.0, 1.6, 2.5][i % 4], confirmed: true, size: ["WS", "MS", "CU"][i % 3], job: i % 5 === 0 ? "Show the whole room and where the chair sits before anything moves in the frame" : "", action: i % 7 === 0 ? "The lead crosses to the chair and stops" : "", notes: i === 40 ? note600 : "" });
    const total = await addShots(page, more);
    note(`${tag}: ${total} shots in the store for the long-content state (made through the store, frames are noise JPEGs)`);
    await gotoShots(page); await shot(page, "shots-long", tag);
    await page.evaluate(() => { const t = document.querySelector(".table-wrap"); if (t) t.scrollTop = t.scrollHeight; });
    await shot(page, "shots-long-bottom", tag, { full: false }); // rows 33 to 40: the 600 character note is on row 40
    await gotoStage(page);
    await page.locator("#strip a").last().click().catch(() => note(`${tag}: could not click the last strip item`));
    await sleep(800);
    await shot(page, "stage-long", tag, { settle: true });

    // ---- export in progress and done ----
    await gotoShots(page);
    if (name === "chromium") { await throttle(page, ctx, 20); }
    const dl = page.waitForEvent("download", { timeout: 180000 });
    await page.locator("#export-btn").click();
    const sawExp = await page.waitForSelector("#export-progress", { timeout: 3000 }).then(() => true).catch(() => false);
    if (sawExp) {
      const t = await page.locator("#export-progress").textContent().catch(() => "");
      manifest.loading.push(`${tag}: export in progress captured ("${t}")`);
      await shot(page, "shots-exporting", tag, { full: false, soft: true });
    } else manifest.loading.push(`${tag}: export finished before #export-progress could be seen`);
    await dl;
    if (name === "chromium") { await throttle(page, ctx, 1); }
    await page.waitForSelector("#export-done", { timeout: 60000 }).catch(() => note(`${tag}: no #export-done after the download`));
    await shot(page, "shots-exported", tag);

    // ---- small screen: 880 x 800, every route with a scene open ----
    await page.setViewportSize({ width: 880, height: 800 });
    await sleep(500);
    for (const [v, fn] of [["scenes", gotoScenes], ["stage", gotoStage], ["shots", gotoShots]]) { await fn(page); await shot(page, `${v}-small`, tag, { full: false }); }
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(500);

    // ---- hash mismatch: Choose file again on the 40-shot scene, with a file the store has not seen ----
    await gotoScenes(page);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('tr:has(td.num:text-is("40")) button').first().click(),
    ]);
    // A file whose hash is already saved opens that scene (a "matched" result), so the mismatch needs a file never opened before: a small PLY.
    await chooser.setFiles({ name: "other-room.ply", mimeType: "application/octet-stream", buffer: tinyPly() });
    await page.waitForSelector("#mismatch", { timeout: 180000 }).catch(() => note(`${tag}: no #mismatch after re-opening with a different file`));
    await sleep(1000);
    await shot(page, "scenes-mismatch", tag, { settle: true });
    await ctx.close();
  } finally {
    await browser.close();
  }
}

// ---------- draft pass (chromium, both themes) ----------
const DRAFT_STATES = {
  index: { view: "scenes", states: ["default", "empty", "loading", "error", "error-spz", "nowebgl", "toolarge", "mismatch", "long"] },
  stage: { view: "stage", states: ["default", "noscale", "nostandins", "noref", "noshots", "long"] },
  shots: { view: "shots", states: ["default", "empty", "exporting", "exported", "deleted", "unverified", "long"] },
};
async function draftPass(scheme) {
  const tag = `chromium-${scheme}`;
  console.log(`\n== draft ${tag}`);
  const browser = await chromium.launch({ args: SWIFTSHADER });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    attachConsole(page, "draft-" + tag);
    for (const [file, { view, states }] of Object.entries(DRAFT_STATES)) {
      for (const st of states) {
        await page.goto(`${DRAFT}/${file}.html${st === "default" ? "" : `?state=${st}`}`);
        await sleep(250);
        const n = `draft-${view}-${st}`;
        currentState = n;
        await page.screenshot({ path: path.join(OUT, `${n}-${tag}.png`) });
        manifest.shots.push(`${n}-${tag}.png`);
        const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
        if (h > 905) { await page.screenshot({ path: path.join(OUT, `${n}-${tag}-full.png`), fullPage: true }); manifest.shots.push(`${n}-${tag}-full.png`); }
      }
      // focus on the first filled control, by Tab, and a tab walk of the default page
      await page.goto(`${DRAFT}/${file}.html`);
      await page.evaluate(() => { document.activeElement?.blur?.(); });
      let found = false;
      for (let i = 0; i < 120 && !found; i++) { await page.keyboard.press("Tab"); found = await page.evaluate(() => document.activeElement?.classList?.contains("btn-primary") ?? false); }
      await page.screenshot({ path: path.join(OUT, `draft-${view}-focus-${tag}.png`) });
      manifest.shots.push(`draft-${view}-focus-${tag}.png`);
      if (scheme === "light") { await page.goto(`${DRAFT}/${file}.html`); await page.evaluate(() => { window.__auditStops = []; }); await tabWalk(page, "draft-" + view, tag); }
    }
    // draft small window
    await page.setViewportSize({ width: 880, height: 800 });
    for (const [file, { view }] of Object.entries(DRAFT_STATES)) {
      await page.goto(`${DRAFT}/${file}.html`); await sleep(250);
      await page.screenshot({ path: path.join(OUT, `draft-${view}-small-${tag}.png`) });
      manifest.shots.push(`draft-${view}-small-${tag}.png`);
    }
    await ctx.close();
  } finally { await browser.close(); }
}

// ---------- main ----------
try {
  if (!flag("skip-draft")) { await startDraft(); for (const s of themes) await draftPass(s); }
  if (!flag("skip-app")) {
    await startApp();
    for (const b of browsers) for (const s of themes) {
      try { if (flag("only-extras")) { await extrasPass(b === "webkit" ? webkit : chromium, b, s); continue; } await appPass(b === "webkit" ? webkit : chromium, b, s); }
      catch (e) { note(`${b}-${s}: pass stopped at "${currentState}": ${String(e).split("\n")[0]}`); console.error(e); }
    }
  }
} finally {
  stopAll();
  const suffix = [opt("browser"), opt("theme"), flag("only-extras") ? "extras" : null].filter(Boolean).join("-");
  fs.writeFileSync(path.join(OUT, `manifest${suffix ? "-" + suffix : ""}.json`), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(OUT, `console${suffix ? "-" + suffix : ""}.json`), JSON.stringify(consoleLog, null, 1));
  console.log(`\n${manifest.shots.length} screenshots, ${consoleLog.length} console entries, ${manifest.notes.length} notes`);
  process.exit(0);
}
