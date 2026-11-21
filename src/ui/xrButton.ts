import type { Viewer } from "../viewer/scene";
import { xrSupport, startXr, type XrSessionHandle } from "../xr/xr";
import { el } from "./dom";

export const XR_NEEDS_SCALE = "Confirm the scale before entering VR. The set is shown at real size.";

/**
 * The Enter VR control for the Stage bar. It holds nothing until the browser reports immersive-vr support,
 * so on a desktop without a headset the bar is unchanged. With support and no confirmed scale it is disabled.
 */
export function createXrButton(
  viewer: Viewer,
  scaleConfirmed: () => boolean,
  onSession: (h: XrSessionHandle) => void,
): { root: HTMLElement; refresh(): Promise<void> } {
  const root = el("span", { className: "xr-slot", hidden: true });
  const btn = el("button", { className: "btn", type: "button", id: "enter-vr" }, "Enter VR");
  const note = el("span", { className: "meta", id: "xr-note" });
  note.setAttribute("aria-live", "polite");
  let supported = false, checked = false, inSession = false, starting = false, failure = "";

  function paint(): void {
    root.hidden = !supported;
    if (!supported) return;
    const ok = scaleConfirmed();
    btn.disabled = !ok || inSession || starting;
    btn.textContent = inSession ? "In VR" : "Enter VR";
    note.textContent = !ok ? XR_NEEDS_SCALE : failure;
  }

  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    failure = ""; starting = true; paint();
    try {
      const h = await startXr(viewer);
      inSession = true;
      h.onEnd(() => { inSession = false; paint(); });
      onSession(h);
    } catch (err) {
      failure = "Could not start VR: " + (err instanceof Error ? err.message : String(err));
    } finally {
      starting = false; paint();
    }
  });

  return {
    root,
    async refresh() {
      if (!checked) {
        checked = true;
        supported = (await xrSupport()) === "supported";
        if (supported) root.append(btn, note);
      }
      paint();
    },
  };
}
