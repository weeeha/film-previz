import type { Viewer } from "../viewer/scene";
import type { ShotState } from "../camera/shotState";
import type { ScaleStore } from "../scale/store";
import { heightPresetsState } from "../scale/scale";
import { clampPitch } from "../camera/pose";
import { createLensPanel } from "./lensPanel";
import { createCameraPanel, nudgeHeightStep } from "./cameraPanel";
import { createReferencePanel } from "./overlay";
import type { Session } from "../model/session";
import { nextShotIdFor } from "../model/store";
import { buildShot, aspectIdFor, stripLine, shotTitle, type ShotDetails } from "../model/shotRecord";
import { SIZE_LABELS, type Shot, type SizeLabel } from "../model/types";
import { el, labelled } from "./dom";

export const FRAME_GRAB_WIDTH_PX = 1920;

export type Stage = {
  root: HTMLElement;
  /** File name and role of the loaded reference photo, or null. Saved with a shot later; the pixels never are. */
  reference(): { file: string; role: string } | null;
  /** Put a saved shot's lens, pose and details on the Stage and look through the shot camera. */
  openShot(rec: Shot): void;
  /** Call when the route becomes Stage (true) or something else (false). Takes the viewport in and gives it back. */
  setActive(active: boolean, viewport: HTMLElement): void;
};

const NUDGE_DEG = 1;

function isFormTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY", "A"].includes(t.tagName) || t.isContentEditable;
}

/** The Stage route, built from draft/stage.html. */
export function createStage(viewer: Viewer, shot: ShotState, store: ScaleStore, session: Session): Stage {
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

  // ----- shot strip: the saved shots of the open scene -----
  const strip = el("div", { className: "strip", id: "strip" });
  strip.setAttribute("aria-label", "Shots on this scene");

  // ----- inspector -----
  const nameIn = el("input", { type: "text", id: "shot-name", placeholder: "Shot name" });
  const sizeSel = el("select", { id: "shot-size", innerHTML: ["Not set", ...SIZE_LABELS].map((o) => `<option>${o}</option>`).join("") });
  const jobIn = el("input", { type: "text", id: "shot-job", placeholder: "What this shot must do" });
  const actionIn = el("input", { type: "text", id: "shot-action", placeholder: "What happens in the frame" });
  const notesIn = el("textarea", { id: "shot-notes", rows: 3 });
  const shotDetails = el("section", { className: "insp", id: "save" },
    el("h2", { id: "h-shot" }, "Shot details"),
    el("div", { className: "fields two" }, labelled("Name", nameIn), labelled("Size", sizeSel)),
    labelled("Job", jobIn),
    labelled("Decisive action", actionIn),
    labelled("Notes", notesIn),
  );
  const readDetails = (): ShotDetails => ({
    name: nameIn.value.trim(),
    sizeLabel: sizeSel.value === "Not set" ? null : (sizeSel.value as SizeLabel),
    job: jobIn.value.trim(),
    action: actionIn.value.trim(),
    notes: notesIn.value.trim(),
  });
  const writeDetails = (d: ShotDetails): void => {
    nameIn.value = d.name; sizeSel.value = d.sizeLabel ?? "Not set"; jobIn.value = d.job; actionIn.value = d.action; notesIn.value = d.notes;
  };
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
  const referencePanel = createReferencePanel(viewer);
  const reference = referencePanel.root;

  const scroll = el("div", { className: "inspector-scroll" }, shotDetails, lens.root, camera.root, standins, reference);
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Shot, lens and camera settings");

  // ----- footer: one filled control. "Save shot", or "Update shot N" while a saved shot is being edited -----
  const primaryBtn = el("button", { className: "btn btn-primary", type: "button", id: "save-shot" }, "Save shot");
  const asNewBtn = el("button", { className: "btn", type: "button", id: "save-as-new", hidden: true }, "Save as new shot");
  const saveBtn = el("button", { className: "btn", type: "button", id: "save-frame" }, "Save frame");
  saveBtn.title = "Download the frame as a JPEG file. Nothing is saved to the scene.";
  const saveMsg = el("p", { className: "hint", id: "save-msg" });
  saveMsg.setAttribute("aria-live", "polite");
  const foot = el("div", { className: "insp-foot" }, saveMsg, el("div", { className: "row" }, primaryBtn, asNewBtn, saveBtn));
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
    referencePanel.show(viewer.lookThrough ? viewportEl : null);
  }
  const sceneOpen = () => session.scene() !== null;
  function paintScale(): void {
    const ok = heightPresetsState(store.get()).enabled;
    saveMsg.dataset.unverified = ok ? "" : "1";
    if (saveMsg.dataset.busy || saveMsg.dataset.note) return;
    saveMsg.textContent = !sceneOpen() ? "Open a scene on Scenes to save shots." : ok ? "" : "This shot will save with heights unverified.";
  }
  const say = (text: string): void => { saveMsg.textContent = text; saveMsg.dataset.note = "1"; };
  const clearNote = (): void => { delete saveMsg.dataset.note; paintScale(); };

  const editingShot = (): Shot | null => session.shots().find((x) => x.id === session.editingId()) ?? null;
  function paintStrip(): void {
    const list = session.shots();
    const editing = session.editingId();
    if (!list.length) {
      strip.replaceChildren(el("p", { className: "empty-state" }, sceneOpen() ? "No shots yet. Set the camera and lens, then save the first shot." : "No scene open. Open a scene on Scenes, then save shots here."));
      return;
    }
    strip.replaceChildren(...list.map((r) => {
      const url = session.frameUrl(r);
      const thumb = el("span", { className: "t" });
      thumb.style.setProperty("--ar", String(r.lens.aspect));
      if (url) thumb.append(Object.assign(el("img"), { src: url, alt: "" }));
      const a = el("a", { className: "shot", href: "#/stage" }, thumb, el("b", {}, shotTitle(r)), el("span", { className: r.scaleConfirmed ? "" : "wrap" }, stripLine(r)));
      a.title = shotTitle(r);
      a.dataset.shotId = r.id;
      if (editing === r.id) { a.setAttribute("aria-current", "true"); a.append(el("span", {}, el("strong", {}, "Editing"))); }
      a.addEventListener("click", (e) => { e.preventDefault(); openShot(r); });
      return a;
    }));
  }
  function paintFoot(): void {
    const cur = editingShot();
    primaryBtn.textContent = cur ? `Update shot ${cur.number}` : "Save shot";
    asNewBtn.hidden = !cur;
    const off = !sceneOpen();
    primaryBtn.disabled = off; asNewBtn.disabled = off;
    paintScale();
  }
  function paintSession(): void { paintStrip(); paintFoot(); }

  let active = false;
  let viewportEl: HTMLElement | null = null;
  through.addEventListener("change", paintMode);
  shot.subscribe(paint);
  store.subscribe(clearNote);
  session.subscribe(paintSession);
  paint();
  paintSession();

  function openShot(rec: Shot): void {
    shot.setLens({ focalMm: rec.lens.focalLengthMm, sensor: { ...rec.lens.sensor }, aspectId: aspectIdFor(rec.lens.aspect) });
    shot.setPose({ positionM: [...rec.pose.positionM], headingDeg: rec.pose.headingDeg, pitchDeg: rec.pose.pitchDeg, rollDeg: rec.pose.rollDeg });
    writeDetails({ name: rec.name, sizeLabel: rec.sizeLabel, job: rec.job, action: rec.action, notes: rec.notes });
    through.checked = true;
    session.setEditing(rec.id);
    clearNote();
    paintMode();
  }

  /** Grab the frame, write the shot record and its JPEG, then show it in the strip. */
  async function saveShotRecord(mode: "new" | "update"): Promise<void> {
    const sc = session.scene();
    if (!sc) { say("Open a scene on Scenes to save shots."); return; }
    const prev = mode === "update" ? editingShot() : null;
    for (const b of [primaryBtn, asNewBtn, saveBtn]) b.disabled = true;
    delete saveMsg.dataset.note;
    saveMsg.dataset.busy = "1";
    saveMsg.textContent = "Saving shot";
    try {
      const g = await viewer.grabShot(FRAME_GRAB_WIDTH_PX);
      const db = await session.store();
      const ids = prev ? { number: prev.number, id: prev.id } : nextShotIdFor(await db.listShots(sc.id));
      const rec = buildShot({
        ...ids,
        sceneId: sc.id,
        lens: { focalMm: shot.lens.focalMm, sensor: shot.lens.sensor, aspect: shot.lens.aspect },
        pose: shot.pose,
        scaleConfirmed: heightPresetsState(store.get()).enabled,
        frame: { widthPx: g.widthPx, heightPx: g.heightPx },
        referencePhoto: referencePanel.reference(),
        details: readDetails(),
        previous: prev ?? undefined,
      });
      await db.saveShot(rec, g.blob);
      session.setEditing(rec.id);
      await session.refresh();
      delete saveMsg.dataset.busy;
      say(`${prev ? "Updated" : "Saved"} shot ${rec.number}, ${g.widthPx} x ${g.heightPx} px`);
      saveMsg.dataset.savedShot = rec.id;
    } catch (err) {
      delete saveMsg.dataset.busy;
      say("Could not save the shot: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      delete saveMsg.dataset.busy;
      saveBtn.disabled = false;
      paintFoot();
    }
  }
  primaryBtn.addEventListener("click", () => { void saveShotRecord(editingShot() ? "update" : "new"); });
  asNewBtn.addEventListener("click", () => { void saveShotRecord("new"); });

  // ----- Save frame: one JPEG, 1920 px wide in the shot's aspect -----
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    delete saveMsg.dataset.note;
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
      say(`Saved ${name}, ${g.widthPx} x ${g.heightPx} px`);
      saveMsg.dataset.saved = name;
      saveMsg.dataset.size = `${g.widthPx}x${g.heightPx}`;
    } catch (err) {
      say("Could not save the frame: " + (err instanceof Error ? err.message : String(err)));
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
    openShot,
    reference: () => referencePanel.reference(),
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
