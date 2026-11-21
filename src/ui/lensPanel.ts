import type { ShotState } from "../camera/shotState";
import { SENSORS, ASPECTS, LENSES_MM } from "../camera/sensors";
import { el, labelled, isFocused } from "./dom";

const num = (x: number) => String(+x.toFixed(2));

/** The Lens section of the Stage inspector, from the approved draft. */
export function createLensPanel(shot: ShotState): { root: HTMLElement } {
  // focal length chips: real radio inputs drawn as buttons, then the free field
  const chips = el("div", { className: "chips c5", id: "focal" });
  chips.setAttribute("role", "radiogroup");
  chips.setAttribute("aria-labelledby", "lbl-focal");
  const radios = new Map<number, HTMLInputElement>();
  for (const mm of LENSES_MM) {
    const r = el("input", { type: "radio", name: "fl", id: `f${mm}`, value: String(mm) });
    radios.set(mm, r);
    chips.append(r, el("label", { htmlFor: r.id }, String(mm)));
  }
  const free = el("input", { type: "number", id: "f-free", min: "1", step: "0.5", placeholder: "Other" });
  free.setAttribute("aria-label", "Other focal length, mm");
  chips.append(free);

  const sensor = el("select", { id: "sensor" });
  for (const s of SENSORS) {
    sensor.append(el("option", { value: s.id }, s.id === "custom" ? "Custom" : `${s.label} ${num(s.widthMm)} x ${num(s.heightMm)} mm`));
  }
  const aspect = el("select", { id: "aspect" });
  for (const a of ASPECTS) aspect.append(el("option", { value: a.id }, a.label));

  const cw = el("input", { type: "number", id: "cw", step: "0.01", min: "1", value: "36" });
  const ch = el("input", { type: "number", id: "ch", step: "0.01", min: "1", value: "24" });
  const custom = el("div", { className: "fields two", id: "custom-sensor", hidden: true }, labelled("Sensor width, mm", cw), labelled("Sensor height, mm", ch));

  const readout = el("p", { className: "readout", id: "readout" });
  readout.setAttribute("aria-live", "polite");
  const frameSize = el("p", { className: "sub-readout", id: "frame-size" });

  const focalGroup = el("div", {}, el("span", { className: "group-label", id: "lbl-focal" }, "Focal length, mm"), chips);
  const root = el("section", { className: "insp", id: "lens" },
    el("h2", { id: "h-lens" }, "Lens"),
    focalGroup,
    el("div", { className: "fields sens" }, labelled("Sensor", sensor), labelled("Aspect", aspect)),
    custom,
    el("div", {}, readout, frameSize),
  );
  root.setAttribute("aria-labelledby", "h-lens");

  function paint(): void {
    const { focalMm, sensor: s, aspectId } = shot.lens;
    const chipHit = free.value === "" && radios.has(focalMm);
    radios.forEach((r, mm) => { r.checked = chipHit && mm === focalMm; });
    if (!radios.has(focalMm) && !isFocused(free)) free.value = String(focalMm);
    sensor.value = s.id;
    aspect.value = aspectId;
    custom.hidden = s.id !== "custom";
    if (s.id === "custom") {
      if (!isFocused(cw)) cw.value = String(s.widthMm);
      if (!isFocused(ch)) ch.value = String(s.heightMm);
    }
    const { hfovDeg, vfovDeg } = shot.fov();
    readout.textContent = `${num(focalMm)} mm on ${num(s.widthMm)} mm: ${hfovDeg.toFixed(2)} degrees horizontal, ${vfovDeg.toFixed(2)} vertical`;
    frameSize.textContent = `Frame on the sensor: ${num(s.widthMm)} x ${num(s.widthMm / shot.lens.aspect)} mm`;
    readout.dataset.hfov = hfovDeg.toFixed(2);
    readout.dataset.vfov = vfovDeg.toFixed(2);
  }

  radios.forEach((r, mm) => r.addEventListener("change", () => { free.value = ""; shot.setLens({ focalMm: mm }); }));
  free.addEventListener("input", () => {
    radios.forEach((r) => { r.checked = false; });
    if (free.value !== "") shot.setLens({ focalMm: Number(free.value) });
  });
  const readSensor = () => {
    if (sensor.value === "custom") return { id: "custom", label: "Custom", widthMm: Number(cw.value), heightMm: Number(ch.value) };
    return { ...SENSORS.find((s) => s.id === sensor.value)! };
  };
  sensor.addEventListener("change", () => {
    if (sensor.value === "custom") { cw.value = String(shot.lens.sensor.widthMm); ch.value = String(shot.lens.sensor.heightMm); }
    shot.setLens({ sensor: readSensor() });
  });
  for (const i of [cw, ch]) i.addEventListener("input", () => shot.setLens({ sensor: readSensor() }));
  aspect.addEventListener("change", () => shot.setLens({ aspectId: aspect.value }));

  shot.subscribe(paint);
  paint();
  return { root };
}
