import type { Viewer } from "../viewer/scene";
import type { ShotState } from "../camera/shotState";
import type { ScaleStore } from "../scale/store";
import { heightPresetsState } from "../scale/scale";
import { applyPose, clampPitch } from "../camera/pose";
import { createLensPanel } from "./lensPanel";
import { createCameraPanel, nudgeHeightStep } from "./cameraPanel";
import { createReferencePanel } from "./overlay";
import type { Session } from "../model/session";
import { nextShotIdFor } from "../model/store";
import { buildShot, aspectIdFor, stripLine, shotTitle, type ShotDetails } from "../model/shotRecord";
import { SIZE_LABELS, type Shot, type SizeLabel } from "../model/types";
import { createStandInSet } from "../model/standIns";
import { createStandInsPanel } from "./standIns";
import { createMovesPanel } from "./moves";
import { createXrButton } from "./xrButton";
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
  const through = el("input", { type: "checkbox", id: "through", checked: true });
  const maskText = el("span", { className: "meta", id: "mask-text" });
  const walkHint = el("span", { className: "meta spacer", id: "vp-hint" });
  const xrButton = createXrButton(viewer, () => heightPresetsState(store.get()).enabled, () => { /* shots placed from the headset: task 26 */ });
  const bar = el("div", { className: "stage-bar" },
    el("h1", {}, "Stage"),
    el("label", { className: "switch" }, through, " Look through shot camera"),
    maskText,
    xrButton.root,
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

  const standInSet = createStandInSet();
  const standInsPanel = createStandInsPanel(viewer, shot, standInSet, () => heightPresetsState(store.get()).enabled, session);
  const standins = standInsPanel.root;
  if (import.meta.env.DEV) (window as unknown as { __standIns: typeof standInSet }).__standIns = standInSet;
  const movesPanel = createMovesPanel(viewer, shot, () => heightPresetsState(store.get()).enabled, (busy) => {
    // the lens and camera sections ignore input while the shot camera is off its start pose
    lens.root.inert = busy; camera.root.inert = busy;
    paintMode();
  });
  const referencePanel = createReferencePanel(viewer);
  const reference = referencePanel.root;

  const scroll = el("div", { className: "inspector-scroll" }, shotDetails, lens.root, camera.root, movesPanel.root, standins, reference);
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
  // Two rows in every state, so the footer does not jump: the filled control (and "Save as new shot"), then "Save frame".
  const foot = el("div", { className: "insp-foot" }, saveMsg, el("div", { className: "row" }, primaryBtn, asNewBtn), el("div", { className: "row" }, saveBtn));
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
    const open = sceneOpen();
    through.disabled = !open;
    maskText.hidden = !open;
    root.dataset.scene = open ? "open" : "none";
    viewer.lookThrough = active && open && (through.checked || movesPanel.isPreviewing());
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
      const a = el("button", { className: "shot", type: "button" }, thumb, el("b", {}, shotTitle(r)), el("span", { className: r.scaleConfirmed ? "" : "wrap" }, stripLine(r)));
      a.title = shotTitle(r);
      a.dataset.shotId = r.id;
      if (editing === r.id) { a.setAttribute("aria-current", "true"); a.append(el("span", {}, el("strong", {}, "Editing"))); }
      a.addEventListener("click", () => openShot(r));
      return a;
    }));
  }
  function paintFoot(): void {
    const cur = editingShot();
    primaryBtn.textContent = cur ? `Update shot ${cur.number}` : "Save shot";
    asNewBtn.hidden = !cur;
    const off = !sceneOpen();
    primaryBtn.disabled = off; asNewBtn.disabled = off; saveBtn.disabled = off;
    paintScale();
  }
  let lastSceneId: string | null = null;
  function paintSession(): void {
    const id = session.scene()?.id ?? null;
    if (id !== lastSceneId) { lastSceneId = id; standInSet.replace([]); movesPanel.reset(); } // stand-ins and the move belong to a scene
    paintStrip(); paintFoot(); paintMode();
  }

  let active = false;
  let viewportEl: HTMLElement | null = null;
  through.addEventListener("change", paintMode);
  shot.subscribe(paint);
  store.subscribe(clearNote);
  store.subscribe(() => { void xrButton.refresh(); });
  void xrButton.refresh();
  store.subscribe(movesPanel.stop); // a scale change moves the shot camera: end a preview first
  store.subscribe(movesPanel.refresh);
  store.subscribe(standInsPanel.refresh);
  session.subscribe(paintSession);
  paint();
  paintSession();

  function openShot(rec: Shot): void {
    shot.setLens({ focalMm: rec.lens.focalLengthMm, sensor: { ...rec.lens.sensor }, aspectId: aspectIdFor(rec.lens.aspect) });
    shot.setPose({ positionM: [...rec.pose.positionM], headingDeg: rec.pose.headingDeg, pitchDeg: rec.pose.pitchDeg, rollDeg: rec.pose.rollDeg });
    standInSet.replace(rec.standIns);
    movesPanel.setFromShot(rec);
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
    if (movesPanel.isPreviewing()) { say("Stop the move preview before saving."); return; }
    const prev = mode === "update" ? editingShot() : null;
    for (const b of [primaryBtn, asNewBtn, saveBtn]) b.disabled = true;
    delete saveMsg.dataset.note;
    saveMsg.dataset.busy = "1";
    saveMsg.textContent = "Saving shot";
    try {
      const g = await viewer.grabShot(FRAME_GRAB_WIDTH_PX);
      const move = movesPanel.move();
      // a move with an end pose gets a second grab from that pose, same size; the camera goes back to the start pose after
      let end: Awaited<ReturnType<typeof viewer.grabShot>> | null = null;
      if (move.endPose) {
        saveMsg.textContent = "Saving shot and end frame";
        applyPose(viewer.shotCamera, move.endPose, shot.frontHeadingDeg());
        try { end = await viewer.grabShot(FRAME_GRAB_WIDTH_PX); } finally { applyPose(viewer.shotCamera, shot.pose, shot.frontHeadingDeg()); }
      }
      const db = await session.store();
      const ids = prev ? { number: prev.number, id: prev.id } : nextShotIdFor(await db.listShots(sc.id));
      const rec = buildShot({
        ...ids,
        sceneId: sc.id,
        lens: { focalMm: shot.lens.focalMm, sensor: shot.lens.sensor, aspect: shot.lens.aspect },
        pose: shot.pose,
        move,
        endFrame: end ? { widthPx: end.widthPx, heightPx: end.heightPx } : null,
        standIns: standInSet.list(),
        scaleConfirmed: heightPresetsState(store.get()).enabled,
        frame: { widthPx: g.widthPx, heightPx: g.heightPx },
        referencePhoto: referencePanel.reference(),
        details: readDetails(),
        previous: prev ?? undefined,
      });
      await db.saveShot(rec, g.blob, end?.blob);
      session.setEditing(rec.id);
      await session.refresh();
      delete saveMsg.dataset.busy;
      say(`${prev ? "Updated" : "Saved"} shot ${rec.number}, ${g.widthPx} x ${g.heightPx} px${end ? ", with an end frame" : ""}`);
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
    if (movesPanel.isPreviewing()) { say("Stop the move preview before saving."); return; }
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
      saveBtn.disabled = !sceneOpen();
    }
  });

  // ----- nudge keys: with the viewport focused -----
  const onKey = (e: KeyboardEvent) => {
    if (!active || movesPanel.isPreviewing() || isFormTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
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
