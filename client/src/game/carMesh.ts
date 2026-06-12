import * as THREE from "three";

export interface CarVisual {
  group: THREE.Group;
  /** front wheel pivots, for steering */
  frontPivots: THREE.Object3D[];
  /** all wheel meshes, for rolling */
  wheels: THREE.Mesh[];
  nameSprite: THREE.Sprite | null;
  dispose: () => void;
}

/**
 * Stylized open-wheel F1 car built from primitives (length ~4.4m).
 * Faces +Z so `rotation.y = heading` matches the physics convention.
 */
/**
 * Visual-only upscale: real F1 proportions read tiny against a 12m-wide
 * track, so cars render larger than their physics footprint.
 */
export const CAR_VISUAL_SCALE = 1.45;

export function buildCarVisual(colorHex: string, name?: string): CarVisual {
  const group = new THREE.Group();
  group.scale.setScalar(CAR_VISUAL_SCALE);
  const disposables: { dispose(): void }[] = [];
  const color = new THREE.Color(colorHex);

  // slight specular highlight makes the livery read as painted bodywork
  const bodyMat = new THREE.MeshPhongMaterial({
    color,
    shininess: 55,
    specular: 0x555555,
  });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x16161c });
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x121214 });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x9a9aa2 });
  disposables.push(bodyMat, darkMat, tireMat, hubMat);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    group.add(mesh);
    return mesh;
  };

  // main tub + tapered nose cone + sidepods
  add(new THREE.BoxGeometry(0.85, 0.42, 2.6), bodyMat, 0, 0.42, -0.1);
  add(new THREE.BoxGeometry(0.46, 0.28, 0.9), bodyMat, 0, 0.42, 1.3);
  const noseCone = add(new THREE.ConeGeometry(0.22, 1.0, 10), bodyMat, 0, 0.36, 2.1);
  noseCone.rotation.x = Math.PI / 2;
  noseCone.scale.set(1, 1, 0.75);
  add(new THREE.BoxGeometry(1.5, 0.3, 1.3), bodyMat, 0, 0.34, -0.35);
  // cockpit, driver helmet, halo, airbox
  add(new THREE.BoxGeometry(0.55, 0.3, 0.7), darkMat, 0, 0.66, 0.25);
  add(new THREE.SphereGeometry(0.17, 10, 8), darkMat, 0, 0.78, 0.25);
  const halo = add(
    new THREE.TorusGeometry(0.34, 0.045, 6, 12, Math.PI),
    darkMat,
    0,
    0.78,
    0.32,
  );
  halo.rotation.y = Math.PI / 2; // arch over the cockpit, opening down
  halo.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(0.3, 0.34, 0.65), bodyMat, 0, 0.84, -0.35);
  // mirrors
  add(new THREE.BoxGeometry(0.16, 0.1, 0.07), darkMat, -0.5, 0.72, 0.55);
  add(new THREE.BoxGeometry(0.16, 0.1, 0.07), darkMat, 0.5, 0.72, 0.55);
  // front wing
  add(new THREE.BoxGeometry(1.85, 0.07, 0.5), bodyMat, 0, 0.16, 2.15);
  add(new THREE.BoxGeometry(0.09, 0.2, 0.5), darkMat, -0.88, 0.27, 2.15);
  add(new THREE.BoxGeometry(0.09, 0.2, 0.5), darkMat, 0.88, 0.27, 2.15);
  // rear wing + supports + diffuser block
  add(new THREE.BoxGeometry(1.05, 0.09, 0.45), bodyMat, 0, 0.95, -1.85);
  add(new THREE.BoxGeometry(0.07, 0.45, 0.4), darkMat, 0, 0.7, -1.85);
  add(new THREE.BoxGeometry(0.95, 0.28, 0.5), darkMat, 0, 0.3, -1.6);

  // wheels: front ones sit under steering pivots; light hub on each face
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.38, 14);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.4, 10);
  disposables.push(wheelGeo, hubGeo);
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Object3D[] = [];

  const wheelAt = (x: number, z: number, steerable: boolean) => {
    const wheel = new THREE.Mesh(wheelGeo, tireMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.add(new THREE.Mesh(hubGeo, hubMat)); // spins with the tire
    wheels.push(wheel);
    if (steerable) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.34, z);
      pivot.add(wheel);
      group.add(pivot);
      frontPivots.push(pivot);
    } else {
      wheel.position.set(x, 0.34, z);
      group.add(wheel);
    }
  };
  wheelAt(-0.78, 1.45, true);
  wheelAt(0.78, 1.45, true);
  wheelAt(-0.82, -1.35, false);
  wheelAt(0.82, -1.35, false);

  // soft blob shadow
  const shadowGeo = new THREE.CircleGeometry(1.6, 20);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  disposables.push(shadowGeo, shadowMat);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.045;
  shadow.scale.set(0.8, 1.3, 1);
  group.add(shadow);

  // floating name label for remote cars
  let nameSprite: THREE.Sprite | null = null;
  if (name) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(10,10,16,0.65)";
    const tw = Math.min(240, ctx.measureText(name).width + 28);
    ctx.beginPath();
    ctx.roundRect(128 - tw / 2, 8, tw, 48, 10);
    ctx.fill();
    ctx.fillStyle = colorHex;
    ctx.fillText(name, 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    disposables.push(tex, mat);
    nameSprite = new THREE.Sprite(mat);
    nameSprite.scale.set(4.4, 1.1, 1);
    nameSprite.position.set(0, 2.2, 0);
    group.add(nameSprite);
  }

  return {
    group,
    frontPivots,
    wheels,
    nameSprite,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
