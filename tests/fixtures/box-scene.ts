import * as THREE from "three";
import { HELPER_LAYER } from "../../src/viewer/scene";

/**
 * Synthetic lens-check scene, built in code. Black background and one flat white square,
 * 1.00 m wide and 1.00 m tall, centred on the camera axis at 10.00 m.
 * The square is a plane, so there is no depth to shift its apparent width.
 * With `helper` on, a magenta cube sits on the helper layer beside it (used by the overlay check).
 */
export const BOX_DISTANCE_M = 10;

export function buildBoxScene(opts: { helper?: boolean } = {}): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const box = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  box.position.set(0, 0, -BOX_DISTANCE_M);
  scene.add(box);
  if (opts.helper) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
    h.position.set(2.2, 0, -BOX_DISTANCE_M); // inside the frame at 35 mm and 50 mm
    h.layers.set(HELPER_LAYER);
    scene.add(h);
  }
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  camera.layers.enable(HELPER_LAYER);
  camera.position.set(0, 0, 0);
  return { scene, camera };
}
