/**
 * A small, real stand-in for the three.js objects `dice-scene` uses.
 *
 * The module under test is written against structural shapes rather than an
 * import of three, so this fixture supplies those shapes. The vector and
 * quaternion maths is implemented properly (rotation, composition, slerp) rather
 * than stubbed: the point of these tests is that a value parented to a die
 * follows that die through the scene graph, which is only observable if the
 * transforms are real.
 *
 * It is deliberately built like the renderer's own meshes: one geometry per die,
 * one group per face triangle, explicit per-vertex normals, a per-face material
 * array, and a canvas-backed texture.
 */

export class FakeVector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: FakeVector3): this {
    return this.set(v.x, v.y, v.z);
  }

  clone(): FakeVector3 {
    return new FakeVector3(this.x, this.y, this.z);
  }

  add(v: FakeVector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: FakeVector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  addScaledVector(v: FakeVector3, scale: number): this {
    this.x += v.x * scale;
    this.y += v.y * scale;
    this.z += v.z * scale;
    return this;
  }

  multiplyScalar(scale: number): this {
    this.x *= scale;
    this.y *= scale;
    this.z *= scale;
    return this;
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize(): this {
    const length = this.length() || 1;
    return this.multiplyScalar(1 / length);
  }

  dot(v: FakeVector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: FakeVector3): this {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }

  distanceTo(v: FakeVector3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  lerpVectors(a: FakeVector3, b: FakeVector3, t: number): this {
    return this.set(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  }

  applyQuaternion(q: FakeQuaternion): this {
    const { x, y, z } = this;
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    return this.set(
      x + q.w * tx + (q.y * tz - q.z * ty),
      y + q.w * ty + (q.z * tx - q.x * tz),
      z + q.w * tz + (q.x * ty - q.y * tx),
    );
  }

  toArray(): number[] {
    return [this.x, this.y, this.z];
  }
}

export class FakeQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(q: FakeQuaternion): this {
    return this.set(q.x, q.y, q.z, q.w);
  }

  clone(): FakeQuaternion {
    return new FakeQuaternion(this.x, this.y, this.z, this.w);
  }

  invert(): this {
    this.x *= -1;
    this.y *= -1;
    this.z *= -1;
    return this;
  }

  /** `this = this * q`, matching three's composition order. */
  multiply(q: FakeQuaternion): this {
    const { x, y, z, w } = this;
    return this.set(
      w * q.x + x * q.w + y * q.z - z * q.y,
      w * q.y - x * q.z + y * q.w + z * q.x,
      w * q.z + x * q.y - y * q.x + z * q.w,
      w * q.w - x * q.x - y * q.y - z * q.z,
    );
  }

  /** The rotation taking `from` to `to`, as three implements it. */
  setFromUnitVectors(from: FakeVector3, to: FakeVector3): this {
    const r = from.dot(to) + 1;
    if (r < 1e-8) {
      // Antiparallel: any perpendicular axis will do.
      if (Math.abs(from.x) > Math.abs(from.z))
        return this.set(-from.y, from.x, 0, 0).normalize();
      return this.set(0, -from.z, from.y, 0).normalize();
    }
    return this.set(
      from.y * to.z - from.z * to.y,
      from.z * to.x - from.x * to.z,
      from.x * to.y - from.y * to.x,
      r,
    ).normalize();
  }

  slerp(qb: FakeQuaternion, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);
    let cos = this.x * qb.x + this.y * qb.y + this.z * qb.z + this.w * qb.w;
    let target = qb;
    if (cos < 0) {
      cos = -cos;
      target = new FakeQuaternion(-qb.x, -qb.y, -qb.z, -qb.w);
    }
    const theta = Math.acos(Math.min(1, Math.max(-1, cos)));
    const sin = Math.sin(theta);
    if (sin < 1e-6) return this.copy(target);
    const a = Math.sin((1 - t) * theta) / sin;
    const b = Math.sin(t * theta) / sin;
    return this.set(
      this.x * a + target.x * b,
      this.y * a + target.y * b,
      this.z * a + target.z * b,
      this.w * a + target.w * b,
    ).normalize();
  }

  normalize(): this {
    const length = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= length;
    this.y /= length;
    this.z /= length;
    this.w /= length;
    return this;
  }
}

export class FakeColor {
  r: number;
  g: number;
  b: number;

  constructor(r = 1, g = 1, b = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  clone(): FakeColor {
    return new FakeColor(this.r, this.g, this.b);
  }

  setRGB(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
}

export class FakeFloat32Attribute {
  array: ArrayLike<number>;
  itemSize: number;
  count: number;

  constructor(array: Float32Array, itemSize: number) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
}

export class FakeBufferGeometry {
  groups: { start: number; count: number; materialIndex: number }[] = [];
  attributes: Record<string, FakeFloat32Attribute | undefined> = {};
  boundingSphere: { radius: number } | null = null;
  disposed = 0;

  setAttribute(name: string, attribute: unknown): this {
    this.attributes[name] = attribute as FakeFloat32Attribute;
    return this;
  }

  setIndex(index: readonly number[]): this {
    this.attributes.index = new FakeFloat32Attribute(
      Float32Array.from(index),
      1,
    );
    return this;
  }

  dispose(): void {
    this.disposed += 1;
  }
}

export class FakeCanvasTexture {
  canvas: unknown;
  needsUpdate = true;
  disposed = 0;

  constructor(canvas: unknown) {
    this.canvas = canvas;
  }

  dispose(): void {
    this.disposed += 1;
  }
}

export class FakeMaterial {
  map: unknown = null;
  bumpMap: unknown = null;
  normalMap: unknown = null;
  color = new FakeColor();
  emissive = new FakeColor(0, 0, 0);
  emissiveIntensity = 0;
  transparent = false;
  opacity = 1;
  depthTest = true;
  depthWrite = true;
  blending = 1;
  side = 0;
  needsUpdate = false;
  disposed = 0;
  /** How many clones of this material are outstanding. */
  clones = 0;

  clone(): FakeMaterial {
    const copy = new FakeMaterial();
    copy.map = this.map;
    copy.bumpMap = this.bumpMap;
    copy.normalMap = this.normalMap;
    copy.color = this.color.clone();
    copy.emissive = this.emissive.clone();
    copy.emissiveIntensity = this.emissiveIntensity;
    copy.transparent = this.transparent;
    copy.opacity = this.opacity;
    copy.depthTest = this.depthTest;
    copy.depthWrite = this.depthWrite;
    copy.blending = this.blending;
    copy.side = this.side;
    this.clones += 1;
    return copy;
  }

  dispose(): void {
    this.disposed += 1;
  }
}

export class FakeObject3D {
  position = new FakeVector3();
  quaternion = new FakeQuaternion();
  scale = new FakeVector3(1, 1, 1);
  renderOrder = 0;
  visible = true;
  children: FakeObject3D[] = [];
  parent: FakeObject3D | null = null;

  add(...objects: FakeObject3D[]): this {
    for (const object of objects) {
      object.parent = this;
      this.children.push(object);
    }
    return this;
  }

  remove(...objects: FakeObject3D[]): this {
    for (const object of objects) {
      const at = this.children.indexOf(object);
      if (at >= 0) this.children.splice(at, 1);
      object.parent = null;
    }
    return this;
  }
}

export class FakeMesh extends FakeObject3D {
  geometry: FakeBufferGeometry;
  material: FakeMaterial | FakeMaterial[];
  shape?: string;

  constructor(
    geometry: FakeBufferGeometry = new FakeBufferGeometry(),
    material: FakeMaterial | FakeMaterial[] = new FakeMaterial(),
  ) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

/** The world position of an object, walked root-first like three does. */
export function worldPositionOf(object: FakeObject3D): FakeVector3 {
  const chain: FakeObject3D[] = [];
  for (let node: FakeObject3D | null = object; node; node = node.parent)
    chain.push(node);
  const position = new FakeVector3();
  const rotation = new FakeQuaternion();
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index]!;
    position.add(node.position.clone().applyQuaternion(rotation));
    rotation.multiply(node.quaternion);
  }
  return position;
}

/** The world rotation of an object. */
export function worldQuaternionOf(object: FakeObject3D): FakeQuaternion {
  const chain: FakeObject3D[] = [];
  for (let node: FakeObject3D | null = object; node; node = node.parent)
    chain.push(node);
  const rotation = new FakeQuaternion();
  for (let index = chain.length - 1; index >= 0; index -= 1)
    rotation.multiply(chain[index]!.quaternion);
  return rotation;
}

/* ------------------------------------------------------------------ *
 * Recording canvases.
 * ------------------------------------------------------------------ */

/** A 2D context that records what a presentation drew on it. */
export interface FakeCanvas2D {
  texts: { text: string; x: number; y: number; fillStyle: unknown }[];
  stops: [number, string][];
  rects: number;
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalCompositeOperation: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(): { addColorStop(offset: number, color: string): void };
}

export interface FakeCanvas {
  width: number;
  height: number;
  context: FakeCanvas2D;
  getContext(): FakeCanvas2D;
}

export function fakeCanvas(): FakeCanvas {
  const context = {
    texts: [],
    stops: [],
    rects: 0,
    globalAlpha: 1,
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalCompositeOperation: "source-over",
    clearRect() {},
    fillRect() {
      context.rects += 1;
    },
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    fill() {},
    stroke() {},
    fillText(text: string, x: number, y: number) {
      context.texts.push({ text, x, y, fillStyle: context.fillStyle });
    },
    createRadialGradient() {
      return {
        addColorStop(offset: number, color: string) {
          context.stops.push([offset, color]);
        },
      };
    },
  } as unknown as FakeCanvas2D;
  return {
    width: 0,
    height: 0,
    context,
    getContext: () => context,
  };
}

export function asCanvas(canvas: FakeCanvas): HTMLCanvasElement {
  return canvas as unknown as HTMLCanvasElement;
}

/* ------------------------------------------------------------------ *
 * Dice and scenes.
 * ------------------------------------------------------------------ */

export interface FaceSpec {
  normal: [number, number, number];
  /** Face centre in the die's local space. */
  centre: [number, number, number];
}

/** A cube's six faces, in the order a d6 geometry would carry them. */
export function cubeFaces(radius = 50): FaceSpec[] {
  return [
    { normal: [0, 0, 1], centre: [0, 0, radius] },
    { normal: [0, 0, -1], centre: [0, 0, -radius] },
    { normal: [1, 0, 0], centre: [radius, 0, 0] },
    { normal: [-1, 0, 0], centre: [-radius, 0, 0] },
    { normal: [0, 1, 0], centre: [0, radius, 0] },
    { normal: [0, -1, 0], centre: [0, -radius, 0] },
  ];
}

/**
 * A die geometry with one group per face, each triangle placed so its centroid
 * is the face's centre — the same shape the renderer's own `make_geom` produces.
 */
export function fakeDieGeometry(
  faces: FaceSpec[] = cubeFaces(),
  radius = 50,
): FakeBufferGeometry {
  const geometry = new FakeBufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  faces.forEach((face, index) => {
    const [nx, ny, nz] = face.normal;
    // Two in-plane axes, so three points around the centre share it.
    const helper: [number, number, number] =
      Math.abs(nz) > 0.5 ? [1, 0, 0] : [0, 0, 1];
    const u = new FakeVector3(...helper).cross(new FakeVector3(nx, ny, nz)).normalize();
    const v = new FakeVector3(nx, ny, nz).cross(u).normalize();
    const c = new FakeVector3(...face.centre);
    const points = [
      c.clone().addScaledVector(u, radius / 2),
      c.clone().addScaledVector(v, radius / 2),
      c.clone().addScaledVector(u.clone().add(v).multiplyScalar(-1), radius / 2),
    ];
    for (const point of points) positions.push(point.x, point.y, point.z);
    for (let vertex = 0; vertex < 3; vertex += 1) normals.push(nx, ny, nz);
    geometry.groups.push({
      start: index * 3,
      count: 3,
      materialIndex: index + 1,
    });
  });
  geometry.setAttribute(
    "position",
    new FakeFloat32Attribute(Float32Array.from(positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new FakeFloat32Attribute(Float32Array.from(normals), 3),
  );
  geometry.boundingSphere = { radius };
  return geometry;
}

export interface FakeDieOptions {
  faces?: FaceSpec[];
  radius?: number;
  /** The die's own material array, one per face. */
  materials?: FakeMaterial[];
  shape?: string;
  quaternion?: FakeQuaternion;
  position?: FakeVector3;
}

export function fakeDie(options: FakeDieOptions = {}): FakeMesh {
  const { faces = cubeFaces(), radius = 50 } = options;
  const geometry = fakeDieGeometry(faces, radius);
  const materials =
    options.materials ??
    faces.map(() => {
      const material = new FakeMaterial();
      // The renderer's dice always carry a canvas map; the presentation reads
      // the texture class off it.
      material.map = new FakeCanvasTexture(fakeCanvas());
      material.transparent = true;
      material.depthTest = false;
      return material;
    });
  const die = new FakeMesh(geometry, materials);
  if (options.shape) die.shape = options.shape;
  if (options.quaternion) die.quaternion.copy(options.quaternion);
  if (options.position) die.position.copy(options.position);
  return die;
}

/** A camera placed the way the renderer's own is: on +Z, looking at the table. */
export function fakeCamera(z = 800): FakeObject3D {
  const camera = new FakeObject3D();
  camera.position.set(0, 0, z);
  return camera;
}

export interface FakeRenderer {
  renders: number;
  render(scene: unknown, camera: unknown): void;
}

export function fakeRenderer(): FakeRenderer {
  return {
    renders: 0,
    render() {
      this.renders += 1;
    },
  };
}

/**
 * A frame scheduler the test drives by hand, so "three still frames" is a real
 * condition rather than a wait on wall-clock time.
 */
export function fakeFrameLoop() {
  let next = 0;
  const queued = new Map<number, () => void>();
  return {
    now: 0,
    /** Runs the pending frame callbacks once. */
    step(): void {
      const pending = [...queued.entries()];
      queued.clear();
      for (const [, callback] of pending) callback();
    },
    get pending(): number {
      return queued.size;
    },
    requestFrame(callback: () => void): number {
      next += 1;
      queued.set(next, callback);
      return next;
    },
    cancelFrame(handle: number): void {
      queued.delete(handle);
    },
  };
}
