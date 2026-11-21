import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh, SplatFileType } from "@sparkjsdev/spark";
import { WalkControls } from "./walk";
import { applyScale } from "../scale/scale";

/** Helpers and overlays (collider wireframe, markers) go on this layer. Hide it for frame grabs. */
export const HELPER_LAYER = 1;

const CLEAR = 0x111111;

function fileTypeFor(name: string): SplatFileType | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ply": return SplatFileType.PLY;
    case "spz": return SplatFileType.SPZ;
    case "splat": return SplatFileType.SPLAT;
    case "ksplat": return SplatFileType.KSPLAT;
    default: return undefined;
  }
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  readonly walk: WalkControls;
  /** Holds the splat and the collider. Both carry the 180 degree turn about x (OpenCV axes to three.js). */
  readonly content = new THREE.Group();
  private readonly spark: SparkRenderer;
  private splat: SplatMesh | null = null;
  private collider: THREE.Mesh | null = null;
  private readonly colliderMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  private readonly observer: ResizeObserver;
  private last = 0;
  splatCount = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(CLEAR, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.camera.layers.enable(HELPER_LAYER);
    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);
    this.scene.add(this.content);

    this.walk = new WalkControls(this.camera, this.renderer.domElement);
    // Phase 0 start pose: 2 m from the room centre toward the front wall, looking at the back wall (raw units).
    this.walk.setPose(new THREE.Vector3(0, 0.16, 0.8), new THREE.Vector3(0, 0.16, 0));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number): void {
    const dt = this.last ? Math.min((t - this.last) / 1000, 0.1) : 0;
    this.last = t;
    this.walk.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  async loadSplat(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
      const mesh = new SplatMesh({ url, fileType: fileTypeFor(file.name) });
      await mesh.initialized;
      if (this.splat) { this.content.remove(this.splat); this.splat.dispose(); }
      mesh.rotation.x = Math.PI;
      this.content.add(mesh);
      this.splat = mesh;
      this.splatCount = mesh.numSplats;
      return this.splatCount;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async loadCollider(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      if (!mesh) throw new Error("no mesh in collider file");
      const m: THREE.Mesh = mesh;
      m.material = this.colliderMat;
      m.visible = false; // raycasting ignores visibility, so the collider still picks
      m.layers.set(HELPER_LAYER);
      m.rotation.x = Math.PI;
      if (this.collider) { this.content.remove(this.collider); this.collider.geometry.dispose(); }
      this.content.add(m);
      this.collider = m;
      return (m.geometry.index?.count ?? m.geometry.attributes.position?.count ?? 0) / 3;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  get hasCollider(): boolean { return this.collider !== null; }

  /**
   * Raycast the collider through a point given in client (page) pixels.
   * Returns the hit in content-local coordinates (raw units, before scale and shift), or null on a miss or no collider.
   */
  pickCollider(clientX: number, clientY: number): THREE.Vector3 | null {
    if (!this.collider) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const ray = new THREE.Raycaster();
    ray.layers.enable(HELPER_LAYER); // the collider lives on the helper layer
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true); // the camera is not in the scene, and the loop may be paused
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.collider, false)[0];
    return hit ? this.content.worldToLocal(hit.point.clone()) : null;
  }

  /** Client (page) pixel position of a content-local point. Used by the tests to aim real clicks. */
  localToClient(p: [number, number, number]): { x: number; y: number } {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const v = this.content.localToWorld(new THREE.Vector3(...p)).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /**
   * Scale and shift the content (splat and collider) and move the walk camera with it,
   * so the view stays where it was. `metric` says whether the units are now metres.
   */
  setScale(factor: number, groundOffsetM: number, metric: boolean): void {
    const oldS = this.content.scale.x, oldP = this.content.position.clone();
    const cam = this.camera.position;
    const lx = (cam.x - oldP.x) / oldS, lz = (cam.z - oldP.z) / oldS;
    applyScale(this.content, factor, groundOffsetM);
    cam.x = lx * factor + this.content.position.x;
    cam.z = lz * factor + this.content.position.z;
    this.walk.speed = this.walk.speed / oldS * factor;
    this.walk.setEyeHeight(metric ? 1.6 : 0.16);
  }

  setColliderVisible(on: boolean): void {
    if (this.collider) this.collider.visible = on;
  }

  /** True when the canvas holds any pixel other than the clear colour. Renders one frame first. */
  hasContent(): boolean {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] !== 17 || px[1] !== 17 || px[2] !== 17) return true;
    }
    return false;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.walk.dispose();
    this.splat?.dispose();
    this.collider?.geometry.dispose();
    this.colliderMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
