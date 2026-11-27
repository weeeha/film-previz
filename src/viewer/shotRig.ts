import * as THREE from "three";

/** The shot camera as the walk camera sees it: a frustum drawn to a short depth, and its number. Helper layer only. */
export class ShotRig {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly sprite: THREE.Sprite;
  private readonly lineMat = new THREE.LineBasicMaterial({ color: 0xeceef1, depthTest: false, transparent: true });
  private readonly spriteMat: THREE.SpriteMaterial;
  private texture: THREE.CanvasTexture | null = null;
  private key = "";
  private label = "";

  constructor(layer: number) {
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
    this.spriteMat = new THREE.SpriteMaterial({ depthTest: false, transparent: true });
    this.sprite = new THREE.Sprite(this.spriteMat);
    this.sprite.renderOrder = 21;
    this.group.add(this.lines, this.sprite);
    this.group.traverse((o) => o.layers.set(layer));
    this.group.layers.set(layer);
  }

  setLabel(text: string): void {
    if (text === this.label) return;
    this.label = text;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#14161999";
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = "#eceef1";
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 61, 61);
      ctx.fillStyle = "#eceef1";
      ctx.font = "600 38px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 32, 34, 56);
    }
    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.spriteMat.map = this.texture;
    this.spriteMat.needsUpdate = true;
  }

  /** Follow the camera. `depth` is the length of the drawn frustum in world units. */
  update(camera: THREE.PerspectiveCamera, depth: number): void {
    camera.updateMatrixWorld(true);
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    const key = `${camera.fov.toFixed(4)}|${camera.aspect.toFixed(4)}|${depth.toFixed(4)}`;
    if (key !== this.key) {
      this.key = key;
      const y = depth * Math.tan((camera.fov * Math.PI) / 360), x = y * camera.aspect, z = -depth;
      const a = [0, 0, 0], tl = [-x, y, z], tr = [x, y, z], br = [x, -y, z], bl = [-x, -y, z];
      const up = [[-x * 0.3, y * 1.05, z], [x * 0.3, y * 1.05, z], [0, y * 1.35, z]];
      const segs = [a, tl, a, tr, a, br, a, bl, tl, tr, tr, br, br, bl, bl, tl, up[0]!, up[1]!, up[1]!, up[2]!, up[2]!, up[0]!];
      this.lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(segs.flat(), 3));
    }
    // The number sits above the frustum's far edge, where the walk camera sees it clear of the lines.
    const s = depth * 0.3;
    this.sprite.scale.set(s, s, 1);
    this.sprite.position.set(0, depth * Math.tan((camera.fov * Math.PI) / 360) * 1.35 + s * 0.7, -depth);
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.lineMat.dispose();
    this.texture?.dispose();
    this.spriteMat.dispose();
  }
}
