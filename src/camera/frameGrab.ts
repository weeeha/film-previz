import * as THREE from "three";
import { HELPER_LAYER } from "../viewer/scene";

export type FrameGrab = { blob: Blob; widthPx: number; heightPx: number };

/**
 * Render the scene from `camera` at exactly widthPx by round(widthPx / aspect), as a JPEG.
 * Helpers and overlays (the helper layer) are hidden. The renderer, its canvas and the camera
 * are left as they were: the grab renders into its own target at pixel ratio 1.
 */
export async function grabFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  widthPx: number,
  aspect: number,
): Promise<FrameGrab> {
  const w = Math.round(widthPx);
  const h = Math.round(w / aspect);
  if (!(w > 0 && h > 0)) throw new Error(`bad grab size ${w} x ${h}`);

  const target = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
  target.texture.colorSpace = THREE.SRGBColorSpace; // same output encoding as the screen
  const saved = {
    target: renderer.getRenderTarget(),
    aspect: camera.aspect,
    projection: camera.projectionMatrix.clone(),
    projectionInverse: camera.projectionMatrixInverse.clone(),
    layers: camera.layers.mask,
  };
  const px = new Uint8Array(w * h * 4);
  try {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    camera.layers.disable(HELPER_LAYER);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    // Spark's async readbacks can leave a pixel pack buffer bound, which makes readPixels fail silently.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
  } finally {
    renderer.setRenderTarget(saved.target);
    camera.aspect = saved.aspect;
    camera.projectionMatrix.copy(saved.projection);
    camera.projectionMatrixInverse.copy(saved.projectionInverse);
    camera.layers.mask = saved.layers;
    target.dispose();
  }

  // GL rows run bottom to top: flip while copying into the canvas.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for the frame grab");
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  // toDataURL is synchronous. canvas.toBlob waits for an idle task, which never comes while the
  // viewer's animation loop keeps the main thread busy (seen in Chromium with the 500k splat set).
  const b64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  if (!b64) throw new Error("JPEG encoding failed");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  return { blob, widthPx: w, heightPx: h };
}
