import type { Viewer } from "../viewer/scene";
import type { ScalePanel } from "./scalePanel";
import { sha256Bytes } from "../scale/persist";
import { appStore, type OpenResult } from "../model/store";
import { sceneScale, type ScaleStore } from "../scale/store";
import { heightPresetsState } from "../scale/scale";
import { SOURCE_KINDS, type Scene } from "../model/types";
import { el, labelled } from "./dom";
import { createMarkers } from "./markers";
import { classifyLoadError, fileKind, formatOf, megabytes, sizeText } from "./loadError";

export type Scenes = {
  root: HTMLElement;
  /** The viewport takes its place in the preview when Scenes is the route. */
  setActive(active: boolean, viewport: HTMLElement): void;
};

const SOURCE_LABELS: Record<Scene["sourceKind"], string> = {
  text: "Text prompt",
  photo: "Photo",
  still: "Still image",
  video: "Video",
  other: "Other, such as an invented set",
};

type Opened = { name: string; bytes: number; sha: string; splats: number; firstFrameS: number; file: File };
type Mismatch = { saved: Scene; savedShots: number; expected: string; actual: string };
type Loading = { name: string; total: number; read: number; phase: "reading" | "parsing" };
type Notice =
  | { kind: "unsupported"; name: string }
  | { kind: "parse"; file: File; message: string }
  | { kind: "toolarge"; file: File }
  | { kind: "collider"; name: string; message: string };
type ColliderInfo = { name: string; bytes: number; sha: string | null; state: "reading" | "read" | "error"; seq: number };

const short = (sha: string) => sha.slice(0, 12);

/** Read a file in chunks so the Scenes view can show how far it is. Resolves null when `signal` aborts. */
async function readBytes(f: File, onProgress: (n: number) => void, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  const out = new Uint8Array(f.size);
  const reader = f.stream().getReader();
  let n = 0;
  for (;;) {
    if (signal.aborted) { await reader.cancel().catch(() => undefined); return null; }
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, n);
    n += value.length;
    onProgress(n);
  }
  return out;
}

/** The Scenes route, built from draft/index.html: file, scale, markers, scene details and the past scenes list. */
export function createScenes(
  viewer: Viewer,
  panel: ScalePanel,
  onSceneName: (name: string) => void,
  onSceneRecord: (sceneId: string | null) => void = () => {},
  scale: ScaleStore = sceneScale,
): Scenes {
  // ----- inputs: always in the page, opened by the buttons -----
  const splatInput = el("input", { type: "file", id: "splat-file", accept: ".spz,.ply", hidden: true });
  const colliderInput = el("input", { type: "file", id: "collider-file", accept: ".glb", hidden: true });
  const againInput = el("input", { type: "file", id: "splat-file-again", accept: ".spz,.ply", hidden: true });
  splatInput.tabIndex = colliderInput.tabIndex = againInput.tabIndex = -1;

  // ----- state -----
  let opened: Opened | null = null;
  let rec: Scene | null = null; // the record the details, collider and markers belong to
  let attached = false; // false in the hash mismatch state: the shots stay on the saved scene
  let mismatch: Mismatch | null = null;
  let loading: Loading | null = null;
  let notice: Notice | null = null;
  let collider: ColliderInfo | null = null;
  let seq = 0; // counts splat files opened, so a collider chosen for an earlier scene is dropped
  let abort: AbortController | null = null;
  let againFor: string | null = null;

  // ----- skeleton -----
  const status = el("section", { className: "", id: "scene-status" });
  status.setAttribute("aria-labelledby", "h-file");
  const fileTitle = el("h2", { id: "h-file", className: "panel-title" }, "Scene file");
  const body = el("div", {});
  status.append(fileTitle, body);
  const preview = el("div", { className: "preview-slot" });
  const placeholder = el("section", { className: "scale-block" }, el("h2", {}, "Scale"), el("p", { className: "meta" }, "The scale step opens after a scene has loaded."));
  placeholder.setAttribute("aria-label", "Scale");

  const markers = createMarkers(viewer, panel, scale, (list) => {
    if (!rec || !attached) return;
    void updateScene((s) => ({ ...s, markers: list }));
  });

  // Open Stage sits in the scale block's row of buttons, as in the draft.
  const stageLink = el("a", { className: "btn", href: "#/stage", id: "open-stage" }, "Open Stage without scale");
  panel.actions.append(stageLink);

  // ----- scene details (the draft's aside) -----
  const nameIn = el("textarea", { id: "scene-name-in", rows: 2, className: "two-rows" });
  const frontIn = el("input", { type: "number", id: "scene-front", step: "1", value: "0" });
  const kindSel = el("select", { id: "scene-source-kind" });
  for (const k of SOURCE_KINDS) kindSel.append(el("option", { value: k }, SOURCE_LABELS[k]));
  const noteIn = el("textarea", { id: "scene-source-note", rows: 2, placeholder: "The prompt, or a description of the photo. No client material." });
  const lightIn = el("textarea", { id: "scene-light-note", rows: 4 });
  const groundFloor = el("dd", { id: "ground-floor" });
  const groundOffset = el("dd", { id: "ground-offset" });
  const saveDetails = el("button", { className: "btn", type: "button", id: "save-details" }, "Save details");
  saveDetails.style.justifySelf = "start";
  const detailsMsg = el("p", { className: "hint", id: "details-msg" });
  detailsMsg.setAttribute("aria-live", "polite");
  const groundLabel = el("p", { className: "group-label" }, "Ground");
  groundLabel.style.margin = "0";
  const side = el("form", { className: "side-form" },
    labelled("Scene name", nameIn),
    labelled("Front direction, degrees", frontIn),
    el("div", { className: "fields" }, groundLabel, el("dl", { className: "kv" }, el("dt", {}, "Floor height"), groundFloor, el("dt", {}, "Offset removed"), groundOffset)),
    labelled("Source", kindSel),
    labelled("Source note", noteIn),
    labelled("Light note", lightIn),
    saveDetails,
    detailsMsg,
  );
  side.addEventListener("submit", (e) => e.preventDefault());
  frontIn.after(el("span", { className: "hint" }, "Heading 0 on the Stage points this way."));
  lightIn.after(el("span", { className: "hint" }, "Copied into the location sheet."));
  noteIn.after(el("span", { className: "hint" }, "Copied into the location sheet."));
  const aside = el("aside", {}, el("h2", { id: "h-details", className: "panel-title" }, "Scene details"), side);
  aside.setAttribute("aria-labelledby", "h-details");

  // ----- past scenes -----
  const pastBody = el("div", {});
  const past = el("section", {}, el("h2", { id: "h-past", className: "panel-title" }, "Past scenes"), pastBody);
  past.setAttribute("aria-labelledby", "h-past");

  const left = el("div", {}, status, preview, placeholder, panel.root, markers.root);
  const grid = el("div", { className: "scenes-grid" }, left, aside);
  const head = el("div", { className: "page-head" }, el("h1", {}, "Scenes"));
  const root = el("div", { className: "page" }, head, grid, past, splatInput, colliderInput, againInput);

  // ----- helpers -----
  const pickSplat = () => splatInput.click();
  const pickCollider = () => colliderInput.click();
  const btn = (label: string, onClick: () => void, primary = false, id?: string) => {
    const b = el("button", { className: primary ? "btn btn-primary" : "btn", type: "button" }, label);
    if (id) b.id = id;
    b.addEventListener("click", onClick);
    return b;
  };
  const mono = (t: string) => el("span", { className: "mono" }, t);
  const confirmed = () => heightPresetsState(scale.get()).enabled;

  async function updateScene(change: (s: Scene) => Scene): Promise<void> {
    if (!rec) return;
    const id = rec.id;
    try {
      const store = await appStore();
      const cur = (await store.getScene(id)) ?? rec;
      const next = change(cur);
      await store.saveScene(next);
      if (rec && rec.id === id) rec = next;
      await refreshPast();
      if (attached) onSceneRecord(id);
    } catch (e) {
      console.warn("could not save the scene record", e);
      detailsMsg.textContent = "Could not save: " + (e instanceof Error ? e.message : String(e));
    }
  }

  // ----- rendering of the file section -----
  let progressEl: HTMLProgressElement | null = null;
  let readLine: HTMLElement | null = null;
  const readText = (l: Loading): string => l.phase === "reading"
    ? `Reading the file: ${(l.read / 1e6).toFixed(1)} of ${(l.total / 1e6).toFixed(1)} MB (${l.total ? Math.floor((l.read / l.total) * 100) : 100} percent). Next: parse, upload, first frame.`
    : `Read ${megabytes(l.total)}. Parsing and uploading the splats. This step cannot be cancelled.`;

  function facts(o: Opened): HTMLElement {
    const f = (dt: string, dd: string) => el("div", {}, el("dt", {}, dt), el("dd", {}, dd));
    return el("dl", { className: "facts" }, f("Size", megabytes(o.bytes)), f("Splats", o.splats.toLocaleString("en-US")), f("First frame", `${o.firstFrameS.toFixed(1)} s`));
  }

  function colliderLine(): HTMLElement {
    if (collider) {
      const t = collider.state === "reading" ? "reading" : collider.state === "error" ? "not read" : "read";
      const p = el("p", { className: "meta", id: "collider-line" }, "Collider mesh: ", mono(collider.name), `, ${sizeText(collider.bytes)}${collider.state === "read" && collider.sha ? ". SHA-256 " : `, ${t}.`}`);
      if (collider.state === "read" && collider.sha) p.append(mono(short(collider.sha)), ".");
      return p;
    }
    const saved = rec?.colliderFile;
    if (saved) return el("p", { className: "meta", id: "collider-line" }, "Collider mesh: ", mono(saved.name), ", not loaded in this session. Choose it again to mark points. Files stay on this computer.");
    return el("p", { className: "meta", id: "collider-line" }, "No collider mesh. Marking a distance and placing markers need one. Files stay on this computer.");
  }

  function noticeEl(n: Notice): HTMLElement {
    const box = el("div", { className: "notice err", role: "alert" });
    const actions = el("div", { className: "actions" });
    if (n.kind === "unsupported") {
      box.append(
        el("p", {}, el("strong", {}, "Unsupported file."), " ", mono(n.name), " is not a splat file."),
        el("p", {}, "Open an SPZ or PLY file. A GLB file works only as a collider mesh, next to a splat file."),
      );
      actions.append(btn("Choose another file", pickSplat, true, "notice-choose"));
    } else if (n.kind === "parse") {
      const fmt = formatOf(n.file.name).toUpperCase();
      box.append(
        el("p", {}, el("strong", {}, `This ${fmt} file could not be read.`), " ", mono(n.file.name), ` failed to load: ${n.message}`),
        el("p", {}, fmt === "SPZ" ? "The file may be cut short. If it is a PLY file with the wrong extension, read it as PLY." : "The file may be cut short or may not be a Gaussian splat PLY."),
      );
      if (fmt === "SPZ") actions.append(btn("Try as PLY", () => { void openFile(n.file, { asType: "ply" }); }, true, "notice-try-ply"));
      actions.append(btn("Choose another file", pickSplat, fmt !== "SPZ", "notice-choose"));
    } else if (n.kind === "toolarge") {
      box.append(
        el("p", {}, el("strong", {}, "This scene is too large for this computer's memory."), " ", mono(n.file.name), `, ${megabytes(n.file.size)}, stopped the browser.`),
        el("p", {}, "Export a smaller version from Marble, such as the 2 m or the 500k set, and open that file."),
      );
      actions.append(btn("Choose another file", pickSplat, true, "notice-choose"));
    } else {
      box.append(el("p", {}, el("strong", {}, "This collider mesh could not be read."), " ", mono(n.name), `: ${n.message}`), el("p", {}, "Open a GLB file that holds the room as one mesh."));
      actions.append(btn("Choose another collider", pickCollider, true, "notice-choose"));
    }
    box.append(actions);
    return box;
  }

  function mismatchEl(m: Mismatch, o: Opened): HTMLElement {
    const box = el("div", { className: "notice warn", role: "alert", id: "mismatch" },
      el("p", {}, el("strong", {}, "This file is not the saved scene."), ` The saved scene "${m.saved.name}" expects SHA-256 `, mono(short(m.expected)), ". The file you opened, ", mono(o.name), ", has ", mono(short(m.actual)), "."),
      el("p", {}, `The ${m.savedShots} ${m.savedShots === 1 ? "shot saved on that scene stays" : "shots saved on that scene stay"} attached to the original file.`),
      el("div", { className: "actions" },
        btn("Open as a new scene", () => { void adoptAsNew(o); }, true, "mismatch-new"),
        btn("Choose the original file", () => { againFor = m.saved.id; againInput.click(); }, false, "mismatch-original"),
      ),
    );
    return box;
  }

  function render(): void {
    progressEl = null; readLine = null;
    const parts: Node[] = [];
    if (loading) {
      const l = loading;
      readLine = el("p", { className: "meta", id: "load-line" }, readText(l));
      progressEl = el("progress", { max: Math.max(1, l.total), value: l.read }) as HTMLProgressElement;
      progressEl.setAttribute("aria-label", "Bytes read");
      if (l.phase === "parsing") progressEl.removeAttribute("value");
      const cancel = btn("Cancel", () => abort?.abort(), false, "load-cancel");
      cancel.disabled = l.phase !== "reading";
      const row = el("div", { className: "file-row", role: "status" },
        el("div", { className: "grow" }, el("p", { className: "file-name" }, l.name), readLine, ...(collider ? [colliderLine()] : []), progressEl),
        cancel,
      );
      parts.push(row);
    } else {
      if (notice) parts.push(noticeEl(notice));
      if (opened && mismatch) {
        parts.push(mismatchEl(mismatch, opened), facts(opened));
      } else if (opened) {
        const chooseCollider = btn(collider || rec?.colliderFile ? "Change collider mesh" : "Choose collider mesh", pickCollider, false, "choose-collider");
        parts.push(
          el("div", { className: "file-row" },
            el("div", { className: "grow" },
              el("p", { className: "file-name", id: "file-name" }, opened.name),
              el("p", { className: "meta" }, "SHA-256 ", mono(short(opened.sha)), ". Files stay on this computer."),
              colliderLine(),
            ),
            el("div", { className: "actions" }, chooseCollider, btn("Choose a different file", pickSplat, false, "choose-file")),
          ),
          facts(opened),
        );
      } else if (!notice) {
        parts.push(el("div", { className: "dropzone", id: "dropzone" },
          el("h3", {}, "No scene is open"),
          el("p", { className: "meta wide" }, "Choose an SPZ or PLY file exported from Marble. Add a GLB collider mesh if you have one, so you can mark a known distance. Files stay on this computer."),
          btn("Choose scene file", pickSplat, true, "choose-file"),
          el("p", { className: "hint" }, "You can also drop the file on this page."),
        ));
      }
    }
    body.replaceChildren(...parts);

    const sceneShown = !!opened && !loading;
    preview.hidden = !sceneShown;
    placeholder.hidden = sceneShown;
    panel.root.hidden = !sceneShown;
    markers.root.hidden = !(sceneShown && attached);
    aside.hidden = !(sceneShown && rec);
    paintStageLink();
    paintGround();
  }

  function paintProgress(): void {
    if (!loading) return;
    if (readLine) readLine.textContent = readText(loading);
    if (progressEl && loading.phase === "reading") progressEl.value = loading.read;
  }

  function paintStageLink(): void {
    const ok = confirmed();
    stageLink.textContent = ok ? "Open Stage" : "Open Stage without scale";
    stageLink.className = ok && !mismatch ? "btn btn-primary" : "btn";
  }

  function paintGround(): void {
    const s = scale.get();
    const ok = confirmed();
    groundFloor.textContent = ok ? "0.000 m after scaling" : "Not set until the scale is confirmed";
    groundOffset.textContent = ok ? `${s.groundPlaneOffsetM.toFixed(3)} m` : "None";
  }
  scale.subscribe(() => { paintStageLink(); paintGround(); });

  function writeDetails(s: Scene): void {
    nameIn.value = s.name;
    frontIn.value = String(s.frontHeadingDeg);
    kindSel.value = s.sourceKind;
    noteIn.value = s.sourceNote;
    lightIn.value = s.lightNote;
    detailsMsg.textContent = "";
  }

  saveDetails.addEventListener("click", () => {
    if (!rec) return;
    const name = nameIn.value.trim();
    const front = Number(frontIn.value);
    if (!name) { detailsMsg.textContent = "A scene needs a name."; nameIn.focus(); return; }
    if (!Number.isFinite(front)) { detailsMsg.textContent = "Front direction must be a number of degrees."; frontIn.focus(); return; }
    const frontDeg = ((front % 360) + 360) % 360;
    detailsMsg.textContent = "Saving";
    void updateScene((s) => ({ ...s, name, frontHeadingDeg: frontDeg, sourceKind: kindSel.value as Scene["sourceKind"], sourceNote: noteIn.value.trim(), lightNote: lightIn.value.trim() }))
      .then(() => {
        if (detailsMsg.textContent === "Saving") detailsMsg.textContent = "Saved.";
        frontIn.value = String(frontDeg);
        if (rec) onSceneName(rec.name);
      });
  });

  // ----- past scenes list -----
  async function refreshPast(): Promise<void> {
    let list: Awaited<ReturnType<Awaited<ReturnType<typeof appStore>>["listScenes"]>> = [];
    try { list = (await (await appStore()).listScenes()).reverse(); } catch (e) { console.warn("could not read the past scenes", e); }
    if (!list.length) {
      pastBody.replaceChildren(el("div", { className: "empty-state" }, el("p", {}, "No scenes yet. A scene you open is listed here with its hash and shot count, so you can open it again and keep its shots.")));
      return;
    }
    const rows = list.map(({ scene, shotCount }) => {
      const again = btn("Choose file again", () => { againFor = scene.id; againInput.click(); });
      again.setAttribute("aria-label", `Choose file again for ${scene.name}`);
      const tr = el("tr", {},
        el("td", {}, el("span", { className: "trunc", title: scene.name }, scene.name)),
        el("td", { className: "mono" }, short(scene.file.sha256)),
        el("td", { className: "num" }, String(shotCount)),
        el("td", {}, again),
      );
      tr.dataset.sceneId = scene.id;
      return tr;
    });
    const table = el("table", { className: "past" },
      el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "SHA-256"), el("th", { className: "num" }, "Shots"), el("th", {}, el("span", { className: "sr" }, "Action")))),
      el("tbody", {}, ...rows),
    );
    const wrap = el("div", { className: "table-wrap", id: "past-scenes" }, table);
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Past scenes");
    pastBody.replaceChildren(wrap);
  }

  // ----- opening a scene file -----
  const setStatusData = (splats: number | null) => {
    if (splats === null) delete status.dataset.splats; else status.dataset.splats = String(splats);
  };

  async function openFile(f: File, opts: { forSceneId?: string; asType?: "ply" | "spz" } = {}): Promise<void> {
    if (loading) { console.warn("a scene is already loading"); return; }
    if (fileKind(f.name) !== "splat") {
      // Nothing is read and nothing is loaded.
      notice = { kind: "unsupported", name: f.name };
      render();
      return;
    }
    const mine = ++seq;
    if (collider && !opened) collider.seq = mine; // a collider chosen before any scene belongs to the first one
    const t0 = performance.now();
    if (collider && opened && collider.seq < mine) { viewer.clearCollider(); collider = null; delete status.dataset.colliderTriangles; panel.refresh(); markers.refresh(); }
    notice = null;
    abort = new AbortController();
    const signal = abort.signal;
    loading = { name: f.name, total: f.size, read: 0, phase: "reading" };
    setStatusData(null);
    render();
    let lastPaint = 0;
    try {
      const bytes = await readBytes(f, (n) => {
        if (!loading) return;
        loading.read = n;
        const now = performance.now();
        if (now - lastPaint > 80) { lastPaint = now; paintProgress(); }
      }, signal);
      if (!bytes) { loading = null; setStatusData(opened?.splats ?? null); render(); return; } // cancelled while reading
      const sha = await sha256Bytes(bytes);
      const store = await appStore();
      const result = await store.openSceneFile({ name: f.name, bytes: f.size, sha256: sha }, opts.forSceneId);
      loading = { ...loading!, read: f.size, phase: "parsing" };
      render();
      const splats = await viewer.loadSplat(f, opts.asType);
      await Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), new Promise<void>((r) => setTimeout(r, 2000))]);
      const o: Opened = { name: f.name, bytes: f.size, sha, splats, firstFrameS: (performance.now() - t0) / 1000, file: f };
      loading = null;
      await adopt(result, o);
    } catch (err) {
      console.error(err);
      loading = null;
      setStatusData(opened?.splats ?? null); // the scene that was open before is still open
      notice = classifyLoadError(err) === "toolarge" ? { kind: "toolarge", file: f } : { kind: "parse", file: f, message: err instanceof Error ? err.message : String(err) };
      render();
    }
  }

  /** The file is loaded in the viewer. Tie it to a scene record, or to the hash mismatch state. */
  async function adopt(result: OpenResult, o: Opened): Promise<void> {
    const store = await appStore();
    opened = o;
    mismatch = null;
    let scene: Scene;
    if (result.kind === "hash-mismatch") {
      const savedShots = (await store.listShots(result.scene.id)).length;
      mismatch = { saved: result.scene, savedShots, expected: result.expectedSha256, actual: result.actualSha256 };
      rec = result.scene;
      attached = false;
      await panel.setScene(o.sha); // no record for this file: the scale starts unconfirmed
      viewer.resetWalkView(result.scene.frontHeadingDeg, false);
      markers.setScene(null);
      onSceneRecord(null); // the shots stay on the saved scene and are not attached
      onSceneName(result.scene.name);
      writeDetails(result.scene);
      setStatusData(o.splats);
      render();
      await refreshPast();
      return;
    }
    if (result.kind === "new") { await store.saveScene(result.draft); scene = result.draft; } else scene = result.scene;
    rec = scene;
    attached = true;
    await panel.setScene(o.sha);
    const stored = (await store.getScene(scene.id)) ?? scene;
    rec = stored;
    viewer.resetWalkView(stored.frontHeadingDeg, stored.scale.source !== "none" && stored.scale.confirmedAt !== null);
    markers.setScene(stored.markers);
    writeDetails(stored);
    onSceneRecord(stored.id);
    onSceneName(stored.name);
    setStatusData(o.splats);
    render();
    markers.refresh();
    await saveColliderRecord();
    await refreshPast();
  }

  /** "Open as a new scene" in the mismatch state: the file is already in the viewer, so only the record is made. */
  async function adoptAsNew(o: Opened): Promise<void> {
    try {
      const store = await appStore();
      const result = await store.openSceneFile({ name: o.name, bytes: o.bytes, sha256: o.sha });
      await adopt(result, o);
    } catch (e) {
      console.error(e);
      notice = { kind: "parse", file: o.file, message: e instanceof Error ? e.message : String(e) };
      render();
    }
  }

  // ----- collider -----
  async function saveColliderRecord(): Promise<void> {
    if (!rec || !attached || !collider || collider.state !== "read" || !collider.sha) return;
    const c = collider;
    if (rec.colliderFile?.sha256 === c.sha) return;
    await updateScene((s) => ({ ...s, colliderFile: { name: c.name, bytes: c.bytes, sha256: c.sha! } }));
  }

  async function openCollider(f: File): Promise<void> {
    if (fileKind(f.name) !== "collider") { notice = { kind: "collider", name: f.name, message: "a collider mesh must be a GLB file." }; render(); return; }
    const mine = seq;
    notice = notice?.kind === "collider" ? null : notice;
    collider = { name: f.name, bytes: f.size, sha: null, state: "reading", seq: mine };
    render();
    try {
      collider.sha = await sha256Bytes(await f.arrayBuffer());
      const tris = await viewer.loadCollider(f);
      collider = { ...collider, state: "read" };
      status.dataset.colliderTriangles = String(tris);
      panel.refresh();
      markers.refresh();
      render();
      await saveColliderRecord();
    } catch (err) {
      console.error(err);
      collider = { ...collider!, state: "error" };
      notice = { kind: "collider", name: f.name, message: err instanceof Error ? err.message : String(err) };
      render();
    }
  }

  // ----- wiring -----
  const firstOf = (input: HTMLInputElement): File | null => { const f = input.files?.[0] ?? null; return f; };
  splatInput.addEventListener("change", () => {
    const f = firstOf(splatInput);
    if (!f) return;
    void openFile(f).finally(() => { splatInput.value = ""; });
  });
  againInput.addEventListener("change", () => {
    const f = firstOf(againInput);
    const id = againFor;
    againFor = null;
    if (!f) return;
    void openFile(f, id ? { forSceneId: id } : {}).finally(() => { againInput.value = ""; });
  });
  colliderInput.addEventListener("change", () => {
    const f = firstOf(colliderInput);
    if (!f) return;
    void openCollider(f).finally(() => { colliderInput.value = ""; });
  });
  root.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  root.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const splat = files.find((f) => fileKind(f.name) === "splat");
    const glb = files.find((f) => fileKind(f.name) === "collider");
    if (splat) void openFile(splat).then(() => glb ? openCollider(glb) : undefined);
    else if (glb) void openCollider(glb);
    else void openFile(files[0]!); // unsupported: shows the error and loads nothing
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __viewer: Viewer }).__viewer = viewer;
    // Dev only, for by-hand checks: ?src=/scenes/<file>&collider=/scenes/<file>
    const q = new URLSearchParams(location.search);
    const load = async (u: string) => new File([await (await fetch(u)).blob()], u.split("/").pop() ?? "file");
    const src = q.get("src"), col = q.get("collider");
    if (src) void load(src).then((f) => openFile(f)).then(() => col ? load(col).then((c) => openCollider(c)) : undefined).catch(console.error);
    else if (col) void load(col).then((c) => openCollider(c)).catch(console.error);
  }

  render();
  void refreshPast();

  return {
    root,
    setActive(on, viewport) {
      if (on) {
        viewport.removeAttribute("tabindex");
        viewport.setAttribute("aria-label", "Preview of the scene");
        preview.appendChild(viewport);
        void refreshPast();
      } else {
        markers.cancel();
      }
    },
  };
}
