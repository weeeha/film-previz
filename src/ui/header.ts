import type { ScaleStore } from "../scale/store";
import type { SceneScale } from "../scale/scale";

/** The scene name and the scale chip in the app header, on every route. */
export function createHeader(store: ScaleStore): { setSceneName(name: string | null): void } {
  const name = document.getElementById("scene-name") as HTMLElement;
  const chip = document.getElementById("scale-chip") as HTMLElement;

  function paint(s: SceneScale): void {
    const confirmed = s.source !== "none" && s.confirmedAt !== null;
    chip.className = "badge " + (confirmed ? "ok" : "warn");
    if (!confirmed) chip.textContent = "Scale not confirmed";
    else if (s.reference) chip.textContent = `Scale confirmed, ${s.reference.label} ${s.reference.knownLengthM.toFixed(2)} m`;
    else chip.textContent = "Scale confirmed, Marble";
  }
  store.subscribe(paint);
  paint(store.get());

  return {
    setSceneName(n) {
      name.textContent = n ?? "No scene loaded";
      name.title = n ?? "";
    },
  };
}
