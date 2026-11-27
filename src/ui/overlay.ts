import type { Viewer } from "../viewer/scene";
import { el, isFocused } from "./dom";

/** Role saved with a shot (spec: referencePhoto { file, role }). The pixels are never saved. */
export const REFERENCE_ROLE = "camera position, lens and geometry; not identity";

export type CompareMode = "off" | "side" | "overlay";
/** Guide positions in percent of frame height, measured from the top edge. The ruler runs from top to bottom. */
export type Guides = { horizon: number; top: number; bottom: number };
export type GuideReadout = { horizonPct: number; heightPct: number };

export type ReferencePanel = {
  root: HTMLElement;
  /** Pass the viewport while the shot camera is looked through, or null when it is not. */
  show(viewport: HTMLElement | null): void;
  /** File name and role of the loaded photo, or null. Name only, never the pixels. */
  reference(): { file: string; role: string } | null;
  /** The four numbers the real-input test records. */
  readouts(): { photo: GuideReadout; frame: GuideReadout };
};

const DEFAULT_GUIDES: Guides = { horizon: 50, top: 30, bottom: 70 };
const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));
const readout = (g: Guides): GuideReadout => ({ horizonPct: g.horizon, heightPct: +Math.abs(g.bottom - g.top).toFixed(1) });

function isFormTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY", "A"].includes(t.tagName) || t.isContentEditable;
}

type GuideLayer = { root: HTMLElement; paint(): void };

/** Horizon line and a vertical ruler for one image. Drawn in the page, so a frame grab never holds them. */
function createGuideLayer(who: "photo" | "frame", g: Guides, onChange: () => void): GuideLayer {
  const name = who === "photo" ? "Photo" : "Frame";
  const root = el("div", { className: "cmp-guides" });
  root.dataset.who = who;

  const handle = (label: string, get: () => number, set: (n: number) => void, cls: string): HTMLElement => {
    const h = el("div", { className: `cmp-handle ${cls}`, tabIndex: 0 });
    h.setAttribute("role", "slider");
    h.setAttribute("aria-label", label);
    h.setAttribute("aria-orientation", "vertical");
    h.setAttribute("aria-valuemin", "0");
    h.setAttribute("aria-valuemax", "100");
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.focus();
    });
    h.addEventListener("pointermove", (e) => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      const r = root.getBoundingClientRect();
      if (r.height > 0) { set(clampPct(((e.clientY - r.top) / r.height) * 100)); onChange(); }
    });
    h.addEventListener("keydown", (e) => {
      const k = e.shiftKey ? 5 : 0.5;
      if (e.code === "ArrowUp") set(clampPct(get() - k));
      else if (e.code === "ArrowDown") set(clampPct(get() + k));
      else return;
      e.preventDefault();
      e.stopPropagation(); // the viewport nudge keys must not also move the camera
      onChange();
    });
    return h;
  };

  const hLine = handle(`${name} horizon`, () => g.horizon, (n) => { g.horizon = n; }, "h");
  hLine.append(el("span", { className: "cmp-line" }), el("span", { className: "cmp-tag" }));
  const rLine = el("div", { className: "cmp-ruler" }, el("span", { className: "cmp-line v" }));
  const rTop = handle(`${name} ruler top`, () => g.top, (n) => { g.top = n; }, "end");
  const rBottom = handle(`${name} ruler bottom`, () => g.bottom, (n) => { g.bottom = n; }, "end");
  rTop.append(el("span", { className: "cmp-line" }));
  rBottom.append(el("span", { className: "cmp-line" }));
  const rTag = el("span", { className: "cmp-tag mid" });
  rLine.append(rTop, rBottom, rTag);
  root.append(hLine, rLine);

  const paint = () => {
    hLine.style.top = `${g.horizon}%`;
    hLine.setAttribute("aria-valuenow", String(g.horizon));
    (hLine.querySelector(".cmp-tag") as HTMLElement).textContent = `${name} horizon ${g.horizon.toFixed(1)}%`;
    const lo = Math.min(g.top, g.bottom), hi = Math.max(g.top, g.bottom);
    rLine.style.top = `${lo}%`;
    rLine.style.height = `${hi - lo}%`;
    rTop.style.top = g.top <= g.bottom ? "0%" : "100%";
    rBottom.style.top = g.top <= g.bottom ? "100%" : "0%";
    rTop.setAttribute("aria-valuenow", String(g.top));
    rBottom.setAttribute("aria-valuenow", String(g.bottom));
    rTag.textContent = `${name} ruler ${(hi - lo).toFixed(1)}%`;
  };
  paint();
  return { root, paint };
}

/** The Reference photo section of the Stage inspector, plus the compare layer drawn over the viewport. */
export function createReferencePanel(viewer: Viewer): ReferencePanel {
  // ----- state -----
  let url: string | null = null;
  let mode: CompareMode = "overlay";
  let solo = false; // X: the photo at full opacity over the frame
  let viewport: HTMLElement | null = null;
  const guides = { photo: { ...DEFAULT_GUIDES }, frame: { ...DEFAULT_GUIDES } };

  // ----- compare layer: DOM only, never part of a grab -----
  const img = el("img", { className: "cmp-img", alt: "Reference photo", draggable: false });
  const photoGuides = createGuideLayer("photo", guides.photo, onGuides);
  const frameGuides = createGuideLayer("frame", guides.frame, onGuides);
  const photoBox = el("div", { className: "cmp-box photo" }, img, photoGuides.root);
  const liveBox = el("div", { className: "cmp-box live" }, frameGuides.root);
  const layer = el("div", { className: "cmp", id: "cmp" }, photoBox, liveBox);
  const sideTag = el("span", { className: "cmp-cap l" }, "Photo");
  const sideTag2 = el("span", { className: "cmp-cap r" }, "Frame");
  photoBox.append(sideTag);
  liveBox.append(sideTag2);

  // ----- inspector -----
  const fileInput = el("input", { type: "file", accept: "image/*", id: "ref-file", hidden: true });
  const addBtn = el("button", { className: "btn", type: "button", id: "ref-add" });
  const removeBtn = el("button", { className: "btn btn-plain", type: "button", id: "ref-remove" }, "Remove photo");
  const nameInput = el("input", { type: "text", id: "ref-name", placeholder: "Photo name" });
  const nameField = el("label", { className: "field" }, "Name", nameInput);
  const overlayBox = el("input", { type: "checkbox", id: "overlay" });
  const sideBox = el("input", { type: "checkbox", id: "side" });
  const guidesBox = el("input", { type: "checkbox", id: "ref-guides", checked: true });
  const lookNote = el("p", { className: "hint", id: "ref-look-note" }, "Turn on Look through shot camera to compare the photo with the frame.");
  const swapHint = el("p", { className: "hint" }, "Press X to swap between the frame and the photo.");

  const num = (id: string, label: string) => {
    const i = el("input", { type: "number", id, step: "0.1", min: "0", max: "100" });
    i.setAttribute("aria-label", label);
    return i;
  };
  const inputs = {
    photo: { horizon: num("ref-photo-horizon", "Photo horizon, percent from top"), top: num("ref-photo-top", "Photo ruler top, percent from top"), bottom: num("ref-photo-bottom", "Photo ruler bottom, percent from top") },
    frame: { horizon: num("ref-frame-horizon", "Frame horizon, percent from top"), top: num("ref-frame-top", "Frame ruler top, percent from top"), bottom: num("ref-frame-bottom", "Frame ruler bottom, percent from top") },
  };
  const outPhoto = el("span", { className: "mono", id: "ref-photo-out" });
  const outFrame = el("span", { className: "mono", id: "ref-frame-out" });
  const row = (label: string, a: HTMLElement, b: HTMLElement) =>
    [el("span", { className: "meta" }, label), a, b];
  const grid = el("div", { className: "cmp-grid" },
    el("span"), el("span", { className: "group-label" }, "Photo"), el("span", { className: "group-label" }, "Frame"),
    ...row("Horizon", inputs.photo.horizon, inputs.frame.horizon),
    ...row("Ruler top", inputs.photo.top, inputs.frame.top),
    ...row("Ruler bottom", inputs.photo.bottom, inputs.frame.bottom),
    ...row("Ruler height", outPhoto, outFrame),
  );
  const guideHint = el("p", { className: "hint" }, "Drag the lines, or type percents of frame height from the top. Mark the door with the ruler to read its height.");

  const fileName = el("p", { className: "mono", id: "ref-file-name" });
  fileName.style.overflowWrap = "anywhere";
  const loaded = el("div", { className: "rows", id: "ref-loaded" },
    fileName,
    el("p", { className: "meta" }, "Used for camera position and geometry only. The photo stays on this computer."),
    nameField,
    el("label", { className: "switch" }, overlayBox, " Show overlay at 50 percent"),
    el("label", { className: "switch" }, sideBox, " Show side by side"),
    swapHint,
    lookNote,
    el("label", { className: "switch" }, guidesBox, " Show guides"),
    grid,
    guideHint,
  );
  const empty = el("div", { className: "rows", id: "ref-empty" },
    el("p", { className: "meta" }, "No reference photo. Add one to compare it with the frame, side by side or as an overlay. The photo stays on this computer."),
  );
  const summaryHint = el("span", { className: "hint", id: "ref-summary" });
  const root = el("details", { className: "insp", id: "reference" },
    el("summary", {}, el("h2", { id: "h-ref" }, "Reference photo"), summaryHint),
    el("div", { className: "insp-body" }, loaded, empty, el("div", { className: "row" }, addBtn, removeBtn), fileInput),
  );

  // ----- paint -----
  function onGuides(): void { paintGuides(); }
  function paintGuides(): void {
    photoGuides.paint();
    frameGuides.paint();
    for (const who of ["photo", "frame"] as const) {
      const g = guides[who], i = inputs[who];
      if (!isFocused(i.horizon)) i.horizon.value = String(g.horizon);
      if (!isFocused(i.top)) i.top.value = String(g.top);
      if (!isFocused(i.bottom)) i.bottom.value = String(g.bottom);
    }
    const a = readout(guides.photo), b = readout(guides.frame);
    outPhoto.textContent = `${a.heightPct.toFixed(1)}%`;
    outFrame.textContent = `${b.heightPct.toFixed(1)}%`;
    layer.dataset.photoHorizon = String(a.horizonPct);
    layer.dataset.photoHeight = String(a.heightPct);
    layer.dataset.frameHorizon = String(b.horizonPct);
    layer.dataset.frameHeight = String(b.heightPct);
  }
  function paint(): void {
    const has = url !== null;
    loaded.hidden = !has;
    empty.hidden = has;
    removeBtn.hidden = !has;
    addBtn.textContent = has ? "Replace photo" : "Add reference photo";
    summaryHint.textContent = has ? nameInput.value || fileName.textContent || "" : "None yet";
    overlayBox.checked = mode === "overlay";
    sideBox.checked = mode === "side";
    const on = has && viewport !== null;
    lookNote.hidden = viewport !== null;
    for (const c of [overlayBox, sideBox, guidesBox]) c.disabled = !has;
    layer.dataset.mode = mode;
    layer.dataset.solo = solo ? "1" : "";
    layer.dataset.guides = guidesBox.checked ? "1" : "";
    if (viewport) {
      viewport.dataset.cmp = on ? mode : "off";
      viewer.frameLayout = on && mode === "side" ? { cxFrac: 0.75, availFrac: 0.5, marginX: 24 } : { cxFrac: 0.5, availFrac: 1, marginX: 32 };
      if (on && !layer.isConnected) viewport.appendChild(layer);
      if (!on) layer.remove();
    } else {
      layer.remove();
    }
    paintGuides();
  }

  function setMode(m: CompareMode): void { mode = m; solo = false; paint(); }
  overlayBox.addEventListener("change", () => setMode(overlayBox.checked ? "overlay" : "off"));
  sideBox.addEventListener("change", () => setMode(sideBox.checked ? "side" : "off"));
  guidesBox.addEventListener("change", paint);
  nameInput.addEventListener("input", paint);

  for (const who of ["photo", "frame"] as const) {
    for (const k of ["horizon", "top", "bottom"] as const) {
      inputs[who][k].addEventListener("input", () => {
        const v = inputs[who][k].valueAsNumber;
        if (Number.isFinite(v)) { guides[who][k] = clampPct(v); paintGuides(); }
      });
      inputs[who][k].addEventListener("blur", paintGuides);
    }
  }

  // ----- loader: the photo lives in memory as an object URL, never stored or sent -----
  function release(): void {
    if (url) URL.revokeObjectURL(url);
    url = null;
    img.removeAttribute("src");
  }
  addBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    release();
    url = URL.createObjectURL(f);
    img.src = url;
    fileName.textContent = f.name;
    nameInput.value = f.name;
    guides.photo = Object.assign(guides.photo, DEFAULT_GUIDES);
    solo = false;
    root.open = true;
    paint();
  });
  removeBtn.addEventListener("click", () => {
    release();
    fileName.textContent = "";
    nameInput.value = "";
    solo = false;
    root.open = false;
    paint();
  });

  // ----- swap key -----
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyX" || e.altKey || e.ctrlKey || e.metaKey || isFormTarget(e.target)) return;
    if (!url || !viewport) return;
    solo = !solo;
    e.preventDefault();
    paint();
  });

  root.open = false;
  paint();

  return {
    root,
    show(vp) { viewport = vp; if (!vp) viewer.frameLayout = { cxFrac: 0.5, availFrac: 1, marginX: 32 }; paint(); },
    reference() { return url ? { file: nameInput.value || fileName.textContent || "", role: REFERENCE_ROLE } : null; },
    readouts() { return { photo: readout(guides.photo), frame: readout(guides.frame) }; },
  };
}
