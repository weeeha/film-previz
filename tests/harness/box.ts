// Dev and test only page, served by the Vite dev server at /tests/harness/box.html.
// It is not an input of the production build (vite build reads only index.html).
import * as THREE from "three";
import { SENSORS } from "../../src/camera/sensors";
import { applyLens } from "../../src/camera/lens";
import { grabFrame } from "../../src/camera/frameGrab";
import { buildBoxScene } from "../fixtures/box-scene";

/** A pixel counts as white when its darkest channel is above this, so JPEG edge blur is split at mid grey. */
export const WHITE_THRESHOLD = 128;

export type BoxResult = {
  widthPx: number; heightPx: number; decodedW: number; decodedH: number;
  whitePx: number; whitePercent: number; magentaPx: number; bytes: number;
  canvasW: number; canvasH: number; canvasAfter: [number, number];
};

async function run(focalMm: number, aspect: number, opts: { helper?: boolean; widthPx?: number; sensorId?: string } = {}): Promise<BoxResult> {
  const sensor = SENSORS.find((s) => s.id === (opts.sensorId ?? "full-frame"))!;
  const { scene, camera } = buildBoxScene({ helper: opts.helper });
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(640, 360);
  renderer.setPixelRatio(2); // the grab must not depend on, or change, this
  document.body.appendChild(renderer.domElement);
  applyLens(camera, focalMm, sensor, aspect);
  const before: [number, number] = [renderer.domElement.width, renderer.domElement.height];

  const grab = await grabFrame(renderer, scene, camera, opts.widthPx ?? 1920, aspect);

  // Measure the decoded JPEG that grabFrame returned, never the live canvas.
  const bmp = await createImageBitmap(grab.blob);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const midY = Math.floor(bmp.height / 2);
  let whitePx = 0;
  for (let x = 0; x < bmp.width; x++) {
    const i = (midY * bmp.width + x) * 4;
    if (Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > WHITE_THRESHOLD) whitePx++;
  }
  let magentaPx = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 150 && data[i + 1]! < 100 && data[i + 2]! > 150) magentaPx++;
  }
  const after: [number, number] = [renderer.domElement.width, renderer.domElement.height];
  const res: BoxResult = {
    widthPx: grab.widthPx, heightPx: grab.heightPx, decodedW: bmp.width, decodedH: bmp.height,
    whitePx, whitePercent: (100 * whitePx) / bmp.width, magentaPx, bytes: grab.blob.size,
    canvasW: before[0], canvasH: before[1], canvasAfter: after,
  };
  renderer.dispose();
  renderer.domElement.remove();
  document.getElementById("out")!.textContent = `${focalMm} mm, aspect ${aspect}: ${res.whitePercent.toFixed(2)} percent white (threshold ${WHITE_THRESHOLD}), ${res.decodedW} x ${res.decodedH}`;
  return res;
}

/** Control for the overlay check: render the helper scene straight to a canvas with the helper layer on and count magenta pixels. */
function liveMagenta(): number {
  const { scene, camera } = buildBoxScene({ helper: true });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(320, 180);
  applyLens(camera, 50, SENSORS[0]!, 16 / 9);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  let seen = 0;
  for (let x = 0; x < 320; x++) {
    gl.readPixels(x, 90, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[0]! > 150 && px[1]! < 100 && px[2]! > 150) seen++;
  }
  renderer.dispose();
  return seen;
}

(window as unknown as { __box: { run: typeof run; liveMagenta: typeof liveMagenta } }).__box = { run, liveMagenta };

// By-hand button for Safari or any browser: prints the measured percent.
for (const [f, label] of [[50, "50 mm"], [35, "35 mm"]] as const) {
  const b = document.createElement("button");
  b.textContent = `Measure ${label}`;
  b.onclick = async () => { const r = await run(f, 16 / 9); document.getElementById("out")!.textContent += ` | ${label}: ${r.whitePercent.toFixed(2)}%`; };
  document.body.appendChild(b);
}
