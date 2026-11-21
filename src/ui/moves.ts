import type { Viewer } from "../viewer/scene";
import type { ShotState } from "../camera/shotState";
import { applyPose, type CameraPose } from "../camera/pose";
import {
  DEFAULT_DURATION_S, DEFAULT_EASE, MAX_DURATION_S, MAX_PAN_DEG, MIN_DURATION_S,
  amountIsAngle, buildMove, defaultAmount, hasEndPose, interpolatePose, moveSentence, settingFromMove,
  type MoveKind, type MoveSetting,
} from "../camera/move";
import { EASES, MOVE_KINDS, type Move, type Shot } from "../model/types";
import { el, isFocused } from "./dom";

const KIND_LABELS: Record<MoveKind, string> = {
  static: "Static", "push-in": "Push-in", "pull-out": "Pull-out", pan: "Pan", tilt: "Tilt", track: "Track", handheld: "Handheld",
};
const EASE_LABELS: Record<NonNullable<Move["ease"]>, string> = { "ease-in-out": "Ease in and out", linear: "Linear" };

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export type MovesPanel = {
  root: HTMLElement;
  /** The move as set now, with its end pose worked out from the shot's current pose. */
  move(): Move;
  /** Take the kind, amount, duration and ease from a saved shot. */
  setFromShot(rec: Shot): void;
  /** Back to static. */
  reset(): void;
  /** True while the preview plays or the end pose is held: the shot camera is off the start pose. */
  isPreviewing(): boolean;
  /** End a preview or a held end pose and put the camera back on the start pose. */
  stop(): void;
  /** Repaint after something outside changed, such as the scale. */
  refresh(): void;
  dispose(): void;
};

/**
 * The Move section of the Stage inspector. The shot's own pose in `ShotState` is the start pose and is never
 * written by a preview: the preview moves the shot camera only, and puts it back on the start pose when it ends.
 */
export function createMovesPanel(
  viewer: Viewer, shot: ShotState, scaleConfirmed: () => boolean, onBusyChange: (busy: boolean) => void = () => undefined,
): MovesPanel {
  // amounts are kept per kind of unit, so switching Push-in to Static to Track keeps the distance typed
  const memo = { metres: defaultAmount("push-in"), degrees: defaultAmount("pan") };
  let setting: MoveSetting = { kind: "static", amount: 0, durationS: DEFAULT_DURATION_S, ease: DEFAULT_EASE };
  const amountOf = (kind: MoveKind): number => (!hasEndPose(kind) ? 0 : amountIsAngle(kind) ? memo.degrees : memo.metres);
  const sync = (): void => { setting = { ...setting, amount: amountOf(setting.kind) }; };

  const kindSel = el("select", { id: "move-kind" });
  for (const k of MOVE_KINDS) kindSel.append(el("option", { value: k }, KIND_LABELS[k]));
  const amountIn = el("input", { type: "number", id: "move-amount", step: "0.1" });
  const durationIn = el("input", { type: "number", id: "move-duration", step: "0.5", min: String(MIN_DURATION_S), max: String(MAX_DURATION_S) });
  const easeSel = el("select", { id: "move-ease" });
  for (const e of EASES) easeSel.append(el("option", { value: e }, EASE_LABELS[e]));

  const field = (id: string, input: HTMLElement): { label: HTMLLabelElement; text: Text } => {
    const text = document.createTextNode("");
    const label = el("label", { className: "field" }, text);
    label.id = id;
    label.append(input);
    return { label, text };
  };
  const kindF = field("move-kind-field", kindSel);
  const amountF = field("move-amount-field", amountIn);
  const durationF = field("move-duration-field", durationIn);
  const easeF = field("move-ease-field", easeSel);
  kindF.text.data = "Kind";
  durationF.text.data = "Duration, seconds";
  easeF.text.data = "Ease";

  const readout = el("p", { className: "hint", id: "move-readout" });
  readout.setAttribute("aria-live", "polite");
  const previewBtn = el("button", { className: "btn", type: "button", id: "move-preview" }, "Preview move");
  const endBtn = el("button", { className: "btn", type: "button", id: "move-show-end" }, "Show end");
  endBtn.setAttribute("aria-pressed", "false");
  const buttons = el("div", { className: "row-actions", id: "move-buttons" }, previewBtn, endBtn);
  buttons.style.gap = "var(--s2)";

  const root = el("section", { className: "insp", id: "moves" },
    el("h2", { id: "h-moves" }, "Move"),
    el("div", { className: "fields two" }, kindF.label, amountF.label),
    el("div", { className: "fields two" }, durationF.label, easeF.label),
    readout,
    buttons,
  );
  root.setAttribute("aria-labelledby", "h-moves");
  root.dataset.state = "idle";

  const front = (): number => shot.frontHeadingDeg();
  const move = (): Move => buildMove(setting, shot.pose, front());

  // ----- preview -----
  type Run = { start: CameraPose; end: CameraPose; durationMs: number; ease: NonNullable<Move["ease"]>; t0: number };
  let run: Run | null = null;
  let holding = false;
  let raf = 0;

  const showPose = (p: CameraPose): void => applyPose(viewer.shotCamera, p, front());
  function busy(): void {
    const on = run !== null || holding;
    root.dataset.state = run ? "playing" : holding ? "end" : "idle";
    previewBtn.textContent = run ? "Stop" : "Preview move";
    endBtn.textContent = holding ? "Show start" : "Show end";
    endBtn.setAttribute("aria-pressed", String(holding));
    onBusyChange(on);
    paint();
  }
  function stop(): void {
    if (!run && !holding) return;
    cancelAnimationFrame(raf);
    run = null;
    holding = false;
    showPose(shot.pose);
    busy();
  }
  function tick(): void {
    if (!run) return;
    const t = (performance.now() - run.t0) / run.durationMs;
    if (t >= 1) { stop(); return; }
    showPose(interpolatePose(run.start, run.end, t, run.ease));
    raf = requestAnimationFrame(tick);
  }
  function play(): void {
    const m = move();
    if (!m.endPose || m.durationS === null) return;
    stop();
    run = { start: shot.pose, end: m.endPose, durationMs: m.durationS * 1000, ease: m.ease ?? DEFAULT_EASE, t0: performance.now() };
    busy();
    raf = requestAnimationFrame(tick);
  }
  function hold(): void {
    const m = move();
    if (!m.endPose) return;
    stop();
    holding = true;
    showPose(m.endPose);
    busy();
  }
  previewBtn.addEventListener("click", () => { if (run) stop(); else play(); });
  endBtn.addEventListener("click", () => { if (holding) stop(); else hold(); });

  // ----- inputs -----
  function paint(): void {
    const k = setting.kind;
    const ends = hasEndPose(k);
    kindSel.value = k;
    amountF.label.hidden = !ends;
    durationF.label.hidden = k === "static";
    easeF.label.hidden = !ends;
    if (ends) {
      const angle = amountIsAngle(k);
      amountF.text.data = angle
        ? `Angle, degrees (${k === "pan" ? "negative is left" : "negative is down"})`
        : `Distance, ${scaleConfirmed() ? "m" : "units"}${k === "track" ? " (negative is left)" : ""}`;
      amountIn.min = k === "push-in" || k === "pull-out" ? "0" : "";
      amountIn.step = angle ? "1" : "0.1";
      if (!isFocused(amountIn)) amountIn.value = String(+setting.amount.toFixed(3));
    }
    if (!isFocused(durationIn)) durationIn.value = String(+setting.durationS.toFixed(3));
    easeSel.value = setting.ease;
    const m = move();
    readout.textContent = cap(moveSentence(m, shot.pose, scaleConfirmed(), front()));
    const off = run !== null || holding;
    kindSel.disabled = off; amountIn.disabled = off; durationIn.disabled = off; easeSel.disabled = off;
    previewBtn.disabled = !ends;
    endBtn.disabled = !ends;
  }

  kindSel.addEventListener("change", () => { setting = { ...setting, kind: kindSel.value as MoveKind }; sync(); paint(); });
  amountIn.addEventListener("input", () => {
    const n = Number(amountIn.value);
    if (amountIn.value === "" || !Number.isFinite(n)) return;
    const k = setting.kind;
    if (amountIsAngle(k)) memo.degrees = k === "pan" ? Math.max(-MAX_PAN_DEG, Math.min(MAX_PAN_DEG, n)) : n;
    else memo.metres = k === "track" ? n : Math.max(0, n);
    sync(); paint();
  });
  durationIn.addEventListener("input", () => {
    const n = Number(durationIn.value);
    if (durationIn.value === "" || !Number.isFinite(n)) return;
    setting = { ...setting, durationS: Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, n)) };
    paint();
  });
  easeSel.addEventListener("change", () => { setting = { ...setting, ease: easeSel.value as MoveSetting["ease"] }; paint(); });
  // the amounts are clamped in the setting; show the clamped value once the field is left
  for (const i of [amountIn, durationIn]) i.addEventListener("blur", paint);

  const unsubscribe = shot.subscribe(() => { if (!run && !holding) paint(); });
  paint();

  return {
    root,
    move,
    setFromShot(rec) {
      stop();
      const s = settingFromMove(rec.move, rec.pose, front());
      if (hasEndPose(s.kind)) { if (amountIsAngle(s.kind)) memo.degrees = s.amount; else memo.metres = s.amount; }
      setting = { ...s, amount: amountOf(s.kind) };
      paint();
    },
    reset() {
      stop();
      memo.metres = defaultAmount("push-in");
      memo.degrees = defaultAmount("pan");
      setting = { kind: "static", amount: 0, durationS: DEFAULT_DURATION_S, ease: DEFAULT_EASE };
      paint();
    },
    isPreviewing: () => run !== null || holding,
    stop,
    refresh: paint,
    dispose() { stop(); unsubscribe(); },
  };
}
