import type { Viewer } from "../viewer/scene";
import type { ShotState } from "../camera/shotState";
import type { ScaleStore } from "../scale/store";
import { heightPresetsState } from "../scale/scale";
import { clampPitch } from "../camera/pose";
import { createLensPanel } from "./lensPanel";
import { createCameraPanel, nudgeHeightStep } from "./cameraPanel";
import { el, labelled } from "./dom";

export const FRAME_GRAB_WIDTH_PX = 1920;

export type Stage = {
  root: HTMLElement;
  /** Call when the route becomes Stage (true) or something else (false). Takes the viewport in and gives it back. */
  setActive(active: boolean, viewport: HTMLElement): void;
};

const NUDGE_DEG = 1;

function isFormTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY", "A"].includes(t.tagName) || t.isContentEditable;
}

/** The Stage route, built from draft/stage.html. */
export function createStage(viewer: Viewer, shot: ShotState, store: ScaleStore): Stage {
  // ----- bar -----
  const through = el("input", { type: "checkbox", id: "through" });
  const maskText = el("span", { className: "meta", id: "mask-text" });
  const walkHint = el("span", { className: "meta spacer", id: "vp-hint" });
  const bar = el("div", { className: "stage-bar" },
    el("h1", {}, "Stage"),
    el("label", { className: "switch" }, through, " Look through shot camera"),
    maskText,
    walkHint,
  );

  // ----- viewport frame mask: DOM only, never part of a grab -----
  const frameTag = el("span", { className: "tag", id: "frame-tag" });
  const frame = el("div", { className: "frame", id: "frame" }, frameTag, el("span", { className: "centre" }));

  // ----- shot strip: the empty state until shot records arrive -----
  const strip = el("div", { className: "strip" }, el("p", { className: "empty-state" }, "No shots yet. Set the camera and lens, then save the first shot."));
  strip.setAttribute("aria-label", "Shots on this scene");

  // ----- inspector -----
  const shotDetails = el("section", { className: "insp", id: "save" },
    el("h2", { id: "h-shot" }, "Shot details"),
    el("div", { className: "fields two" },
      labelled("Name", el("input", { type: "text", placeholder: "Shot name" })),
      labelled("Size", Object.assign(el("select"), { innerHTML: ["Not set", "ECU", "CU", "MCU", "MS", "MWS", "WS", "EWS"].map((o) => `<option>${o}</option>`).join("") })),
    ),
    labelled("Job", el("input", { type: "text", placeholder: "What this shot must do" })),
    labelled("Decisive action", el("input", { type: "text", placeholder: "What happens in the frame" })),
    labelled("Notes", Object.assign(el("textarea"), { rows: 3 })),
    el("p", { className: "hint" }, "Shot records arrive in a later step, so these fields are not saved yet."),
  );
  shotDetails.setAttribute("aria-labelledby", "h-shot");

  const lens = createLensPanel(shot);
  const camera = createCameraPanel(shot, viewer, store);

  const later = (id: string, title: string, text: string) => {
    const d = el("details", { className: "insp", id },
      el("summary", {}, el("h2", {}, title), el("span", { className: "hint" }, "Later step")),
      el("div", { className: "insp-body" }, el("p", { className: "meta" }, text)),
    );
    return d;
  };
  const standins = later("standins", "Stand-ins", "Stand-ins arrive in a later step. They will show how large a person is in the frame.");
  const reference = later("reference", "Reference photo", "Reference photos arrive in a later step. The photo will stay on this computer.");

  const scroll = el("div", { className: "inspector-scroll" }, shotDetails, lens.root, camera.root, standins, reference);
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Shot, lens and camera settings");

  // ----- footer: the one working action for now -----
  const saveBtn = el("button", { className: "btn btn-primary", type: "button", id: "save-frame" }, "Save frame");
  const saveMsg = el("p", { className: "hint", id: "save-msg" });
  saveMsg.setAttribute("aria-live", "polite");
  const foot = el("div", { className: "insp-foot" }, saveMsg, el("div", { className: "row" }, saveBtn));
  const inspector = el("aside", { className: "inspector" }, scroll, foot);
  inspector.setAttribute("aria-label", "Inspector");

  const main = el("div", { className: "stage-main" }, bar, strip);
  const root = el("div", { className: "stage" }, main, inspector);

  // ----- state to DOM -----
  const aspectLabel = () => shot.lens.aspectId;
  function paint(): void {
    const label = aspectLabel();
    maskText.textContent = `Frame mask ${label}`;
    frameTag.textContent = `${label}, ${+shot.lens.focalMm.toFixed(2)} mm`;
    viewportEl?.style.setProperty("--ar", String(shot.lens.aspect));
  }
  function paintMode(): void {
    walkHint.textContent = through.checked ? "Arrow keys nudge the shot camera." : "Drag to look. W A S D to move.";
    viewer.lookThrough = active && through.checked;
    viewer.walk.enabled = !viewer.lookThrough;
    viewportEl?.classList.toggle("walk", !viewer.lookThrough);
    if (viewer.lookThrough) { if (!frame.isConnected) viewportEl?.appendChild(frame); } else frame.remove();
  }
  function paintScale(): void {
    const ok = heightPresetsState(store.get()).enabled;
    saveMsg.dataset.unverified = ok ? "" : "1";
    if (!saveMsg.dataset.busy) saveMsg.textContent = ok ? "" : "Heights are unverified until the scale is confirmed.";
  }

  let active = false;
  let viewportEl: HTMLElement | null = null;
  through.addEventListener("change", paintMode);
  shot.subscribe(paint);
  store.subscribe(paintScale);
  paint();
  paintScale();

  // ----- Save frame: one JPEG, 1920 px wide in the shot's aspect -----
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveMsg.dataset.busy = "1";
    saveMsg.textContent = "Saving frame";
    try {
      const g = await viewer.grabShot(FRAME_GRAB_WIDTH_PX);
      const name = `frame-${+shot.lens.focalMm.toFixed(2)}mm-${shot.lens.aspectId.replace(":", "x")}.jpg`;
      const url = URL.createObjectURL(g.blob);
      const a = el("a", { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      saveMsg.textContent = `Saved ${name}, ${g.widthPx} x ${g.heightPx} px`;
      saveMsg.dataset.saved = name;
      saveMsg.dataset.size = `${g.widthPx}x${g.heightPx}`;
    } catch (err) {
      saveMsg.textContent = "Could not save the frame: " + (err instanceof Error ? err.message : String(err));
    } finally {
      delete saveMsg.dataset.busy;
      saveBtn.disabled = false;
    }
  });

  // ----- nudge keys: with the viewport focused -----
  const onKey = (e: KeyboardEvent) => {
    if (!active || isFormTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.shiftKey ? 5 : 1;
    const p = shot.pose;
    switch (e.code) {
      case "ArrowLeft": shot.setPose({ headingDeg: p.headingDeg - NUDGE_DEG * k }); break;
      case "ArrowRight": shot.setPose({ headingDeg: p.headingDeg + NUDGE_DEG * k }); break;
      case "ArrowUp": shot.setPose({ pitchDeg: clampPitch(p.pitchDeg + NUDGE_DEG * k) }); break;
      case "ArrowDown": shot.setPose({ pitchDeg: clampPitch(p.pitchDeg - NUDGE_DEG * k) }); break;
      case "PageUp": case "PageDown": {
        const step = nudgeHeightStep(heightPresetsState(store.get()).enabled) * k * (e.code === "PageUp" ? 1 : -1);
        const [x, y, z] = p.positionM;
        shot.setPose({ positionM: [x, y + step, z] });
        break;
      }
      default: return;
    }
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  return {
    root,
    setActive(on, viewport) {
      active = on;
      if (on) {
        viewportEl = viewport;
        viewport.tabIndex = 0;
        viewport.setAttribute("aria-label", "Viewport");
        main.insertBefore(viewport, strip);
        viewport.style.setProperty("--ar", String(shot.lens.aspect));
      }
      paintMode();
      if (!on) viewportEl = null;
    },
  };
}
