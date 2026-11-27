import type { ShotState } from "../camera/shotState";
import { readPose } from "../camera/pose";
import { HEIGHT_PRESETS } from "../camera/sensors";
import { heightPresetsState, type SceneScale } from "../scale/scale";
import type { ScaleStore } from "../scale/store";
import type { Viewer } from "../viewer/scene";
import { el, labelled, fmt, isFocused } from "./dom";

/** Height step of the nudge keys: 0.05 m with confirmed scale, 0.02 model units without (unverified). */
export const nudgeHeightStep = (metric: boolean) => (metric ? 0.05 : 0.02);

/** The Camera section of the Stage inspector, from the approved draft. */
export function createCameraPanel(shot: ShotState, viewer: Viewer, store: ScaleStore): { root: HTMLElement } {
  const notice = el("div", { className: "notice warn", id: "scale-notice" },
    el("p", {}, el("strong", {}, "Scale not confirmed."), " Heights are in model units, so the presets are off."),
    el("p", {}, el("a", { href: "#/" }, "Set scale"), " to turn them on."),
  );
  notice.setAttribute("role", "status");

  const chips = el("div", { className: "chips c4", id: "height-presets" });
  chips.setAttribute("role", "radiogroup");
  chips.setAttribute("aria-labelledby", "lbl-height");
  const presetInputs = new Map<string, HTMLInputElement>();
  for (const p of HEIGHT_PRESETS) {
    const r = el("input", { type: "radio", name: "hp", id: `hp-${p.id}`, value: String(p.metres) });
    r.setAttribute("aria-describedby", "preset-reason");
    presetInputs.set(p.id, r);
    chips.append(r, el("label", { htmlFor: r.id }, p.label, el("small", {}, `${p.metres.toFixed(1)} m`)));
  }
  const reason = el("p", { className: "sr", id: "preset-reason" });
  const presetHint = el("p", { className: "hint" }, "Presets are assumptions. Eye height changes from person to person.");
  presetHint.style.marginTop = "var(--s2)";

  const mkNum = (id: string, step: string) => el("input", { type: "number", id, step });
  const heightIn = mkNum("cam-height", "0.01");
  const headingIn = mkNum("cam-heading", "1");
  const pitchIn = mkNum("cam-pitch", "0.5");
  const rollIn = mkNum("cam-roll", "0.5");
  const xIn = mkNum("cam-x", "0.05");
  const zIn = mkNum("cam-z", "0.05");
  const heightLabel = labelled("Height above ground, m", heightIn);

  const moveHere = el("button", { className: "btn", type: "button", id: "move-here" }, "Move camera here");
  moveHere.style.justifySelf = "start";
  const posHint = el("p", { className: "hint", id: "pos-hint" });
  const nudgeHint = el("p", { className: "hint", id: "nudge-hint" });

  const root = el("section", { className: "insp", id: "camera" },
    el("h2", { id: "h-camera" }, "Camera"),
    notice,
    el("div", {}, el("span", { className: "group-label", id: "lbl-height" }, "Height preset"), chips, reason, presetHint),
    el("div", { className: "fields two" }, heightLabel, labelled("Heading, degrees", headingIn), labelled("Pitch, degrees", pitchIn), labelled("Roll, degrees", rollIn)),
    el("div", { className: "fields two" }, labelled("X", xIn), labelled("Z", zIn)),
    posHint,
    moveHere,
    nudgeHint,
  );
  root.setAttribute("aria-labelledby", "h-camera");

  function paintScale(s: SceneScale): void {
    const st = heightPresetsState(s);
    notice.hidden = st.enabled;
    reason.textContent = st.reason ?? "";
    for (const p of st.presets) {
      const r = presetInputs.get(p.id)!;
      r.disabled = !p.enabled;
    }
    heightLabel.firstChild!.textContent = st.enabled ? "Height above ground, m" : "Height, model units";
    const unit = st.enabled ? "metres" : "model units";
    posHint.textContent = `X and Z are ${unit} from the scene origin. Height is the vertical position, measured from the floor once scale is confirmed.`;
    const step = nudgeHeightStep(st.enabled);
    nudgeHint.textContent = `Nudge keys, with the viewport focused: arrow keys turn and tilt by 1 degree, Page Up and Page Down raise and lower by ${st.enabled ? `${step.toFixed(2)} m` : `${step.toFixed(2)} units`}. Hold Shift for 5 times as much.`;
    paintPose();
  }

  function paintPose(): void {
    const { positionM: [x, y, z], headingDeg, pitchDeg, rollDeg } = shot.pose;
    const enabled = heightPresetsState(store.get()).enabled;
    if (!isFocused(heightIn)) heightIn.value = fmt(y, 2);
    if (!isFocused(headingIn)) headingIn.value = fmt(headingDeg, 1, true);
    if (!isFocused(pitchIn)) pitchIn.value = fmt(pitchDeg, 1);
    if (!isFocused(rollIn)) rollIn.value = fmt(rollDeg, 1);
    if (!isFocused(xIn)) xIn.value = fmt(x, 2);
    if (!isFocused(zIn)) zIn.value = fmt(z, 2);
    for (const p of HEIGHT_PRESETS) presetInputs.get(p.id)!.checked = enabled && Math.abs(y - p.metres) < 0.005;
  }

  const pos = (patch: { x?: number; y?: number; z?: number }): [number, number, number] => {
    const [x, y, z] = shot.pose.positionM;
    return [patch.x ?? x, patch.y ?? y, patch.z ?? z];
  };
  const onNum = (input: HTMLInputElement, fn: (v: number) => void) => input.addEventListener("input", () => {
    if (input.value.trim() !== "" && Number.isFinite(Number(input.value))) fn(Number(input.value));
  });
  onNum(heightIn, (v) => shot.setPose({ positionM: pos({ y: v }) }));
  onNum(xIn, (v) => shot.setPose({ positionM: pos({ x: v }) }));
  onNum(zIn, (v) => shot.setPose({ positionM: pos({ z: v }) }));
  onNum(headingIn, (v) => shot.setPose({ headingDeg: v }));
  onNum(pitchIn, (v) => shot.setPose({ pitchDeg: v }));
  onNum(rollIn, (v) => shot.setPose({ rollDeg: v }));
  // Leaving a field puts back the clean value (wrapped heading, clamped pitch).
  for (const i of [heightIn, headingIn, pitchIn, rollIn, xIn, zIn]) i.addEventListener("blur", paintPose);

  for (const p of HEIGHT_PRESETS) {
    presetInputs.get(p.id)!.addEventListener("change", () => shot.setPose({ positionM: pos({ y: p.metres }) }));
  }

  moveHere.addEventListener("click", () => {
    viewer.camera.updateMatrixWorld(true);
    const w = readPose(viewer.camera, shot.frontHeadingDeg());
    shot.setPose({ positionM: w.positionM, headingDeg: w.headingDeg, pitchDeg: w.pitchDeg, rollDeg: 0 });
  });

  shot.subscribe(paintPose);
  store.subscribe(paintScale);
  paintScale(store.get());
  return { root };
}
