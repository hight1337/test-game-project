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
 * Visual-only upscale: real F1 proportions read tiny against the track,
 * so cars render somewhat larger than their physics footprint.
 */
export const CAR_VISUAL_SCALE = 1.32;

/**
 * Modern F1 car modeled on team reference renders (RB20 / AMR24 silhouette):
 * low, long lofted hull with an engine-cover spine, massive tires with dark
 * rims, a dominant black diffuser at the rear, and a high wing on thin
 * vertical endplates.
 */
export function buildCarVisual(colorHex: string, name?: string): CarVisual {
  const group = new THREE.Group();
  group.scale.setScalar(CAR_VISUAL_SCALE);
  const disposables: { dispose(): void }[] = [];
  const color = new THREE.Color(colorHex);

  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.25,
    roughness: 0.3,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x131318,
    metalness: 0.1,
    roughness: 0.55,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x17171a,
    roughness: 0.95,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x55585f,
    metalness: 0.8,
    roughness: 0.35,
  });
  disposables.push(bodyMat, carbonMat, tireMat, rimMat);

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // ---- hull: LOW and long, station = [z, halfWidth, halfHeight, centerY] --
  const stations: [number, number, number, number][] = [
    [2.55, 0.05, 0.04, 0.24],
    [2.1, 0.13, 0.09, 0.26],
    [1.45, 0.22, 0.13, 0.3],
    [0.8, 0.34, 0.2, 0.34],
    [0.25, 0.46, 0.28, 0.36],
    [-0.35, 0.48, 0.3, 0.36],
    [-1.0, 0.4, 0.24, 0.32],
    [-1.45, 0.28, 0.18, 0.3],
    [-1.85, 0.14, 0.11, 0.28], // tail tucked behind the diffuser
  ];
  group.add(loftBody(stations, bodyMat, disposables));

  // engine-cover spine: flattened capsule ridge over the rear deck
  const spineGeo = new THREE.CapsuleGeometry(0.17, 1.5, 4, 10);
  disposables.push(spineGeo);
  const spine = new THREE.Mesh(spineGeo, bodyMat);
  spine.rotation.x = Math.PI / 2;
  spine.scale.set(0.85, 1, 1);
  spine.position.set(0, 0.58, -0.75);
  group.add(spine);

  // wide flat floor
  add(new THREE.BoxGeometry(1.85, 0.05, 3.3), carbonMat, 0, 0.09, -0.15);

  // sidepods: low blended volumes
  const podGeo = new THREE.CapsuleGeometry(0.3, 1.1, 4, 12);
  disposables.push(podGeo);
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(podGeo, bodyMat);
    pod.rotation.x = Math.PI / 2;
    pod.rotation.y = side * 0.06;
    pod.scale.set(1.15, 0.52, 1);
    pod.position.set(side * 0.62, 0.27, -0.5);
    group.add(pod);
  }

  // cockpit, helmet, halo
  add(new THREE.BoxGeometry(0.44, 0.07, 0.66), carbonMat, 0, 0.62, 0.4);
  add(new THREE.SphereGeometry(0.15, 14, 10), carbonMat, 0, 0.68, 0.38);
  const haloGeo = new THREE.TorusGeometry(0.32, 0.045, 8, 20, Math.PI);
  disposables.push(haloGeo);
  const halo = new THREE.Mesh(haloGeo, carbonMat);
  halo.position.set(0, 0.58, 0.42);
  group.add(halo);
  const pillarGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.36);
  disposables.push(pillarGeo);
  const pillar = new THREE.Mesh(pillarGeo, carbonMat);
  pillar.position.set(0, 0.7, 0.68);
  pillar.rotation.x = 0.7;
  group.add(pillar);

  // mirrors
  add(new THREE.BoxGeometry(0.15, 0.07, 0.05), carbonMat, -0.5, 0.6, 0.66);
  add(new THREE.BoxGeometry(0.15, 0.07, 0.05), carbonMat, 0.5, 0.6, 0.66);

  // ---- front wing -----------------------------------------------------------
  const fwMain = add(new THREE.BoxGeometry(1.9, 0.045, 0.6), bodyMat, 0, 0.12, 2.42);
  fwMain.rotation.x = -0.05;
  const fwFlap = add(new THREE.BoxGeometry(1.76, 0.035, 0.34), carbonMat, 0, 0.2, 2.3);
  fwFlap.rotation.x = -0.3;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.035, 0.24, 0.64), carbonMat, side * 0.96, 0.2, 2.42);
  }

  // ---- rear end, following the reference renders ---------------------------
  // dominant black diffuser: wide lower block + angled expansion ramp
  add(new THREE.BoxGeometry(1.3, 0.22, 0.55), carbonMat, 0, 0.2, -1.95);
  const ramp = add(new THREE.BoxGeometry(1.26, 0.05, 0.5), carbonMat, 0, 0.36, -2.0);
  ramp.rotation.x = 0.5;
  // beam wing tucked just above the diffuser
  const beam = add(new THREE.BoxGeometry(0.9, 0.04, 0.24), carbonMat, 0, 0.5, -2.02);
  beam.rotation.x = 0.35;
  // high main wing + flap spanning thin vertical endplates
  const rwMain = add(new THREE.BoxGeometry(1.3, 0.05, 0.42), bodyMat, 0, 0.92, -1.98);
  rwMain.rotation.x = 0.2;
  const rwFlap = add(new THREE.BoxGeometry(1.3, 0.04, 0.3), carbonMat, 0, 1.06, -2.08);
  rwFlap.rotation.x = 0.42;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.03, 0.52, 0.66), carbonMat, side * 0.66, 0.86, -2.0);
  }
  // single central pylon up to the wing
  const pylon = add(new THREE.BoxGeometry(0.06, 0.42, 0.09), carbonMat, 0, 0.66, -1.9);
  pylon.rotation.x = -0.15;
  // rain light strip on the diffuser centreline
  const rainMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  disposables.push(rainMat);
  add(new THREE.BoxGeometry(0.08, 0.14, 0.04), rainMat, 0, 0.34, -2.2);

  // ---- wheels: big, wide, dark rims ----------------------------------------
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Object3D[] = [];

  const wheelAt = (x: number, z: number, r: number, w: number, steerable: boolean) => {
    const tireGeo = new THREE.CylinderGeometry(r, r, w, 26);
    const rimGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.012, 14);
    const hubGeo = new THREE.CylinderGeometry(r * 0.14, r * 0.14, w + 0.03, 8);
    disposables.push(tireGeo, rimGeo, hubGeo);
    const wheel = new THREE.Mesh(tireGeo, tireMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.add(new THREE.Mesh(rimGeo, rimMat));
    wheel.add(new THREE.Mesh(hubGeo, carbonMat));
    wheels.push(wheel);
    if (steerable) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, r, z);
      pivot.add(wheel);
      group.add(pivot);
      frontPivots.push(pivot);
    } else {
      wheel.position.set(x, r, z);
      group.add(wheel);
    }
  };
  wheelAt(-0.78, 1.55, 0.37, 0.4, true);
  wheelAt(0.78, 1.55, 0.37, 0.4, true);
  wheelAt(-0.8, -1.45, 0.42, 0.52, false);
  wheelAt(0.8, -1.45, 0.42, 0.52, false);

  // slim suspension wishbones
  const armGeo = new THREE.BoxGeometry(0.48, 0.025, 0.07);
  disposables.push(armGeo);
  for (const [x, z] of [[-0.48, 1.55], [0.48, 1.55], [-0.48, -1.45], [0.48, -1.45]] as const) {
    const arm = new THREE.Mesh(armGeo, carbonMat);
    arm.position.set(x, 0.34, z);
    arm.rotation.z = x > 0 ? -0.08 : 0.08;
    group.add(arm);
  }

  // soft blob shadow
  const shadowGeo = new THREE.CircleGeometry(1.6, 24);
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
  shadow.scale.set(0.85, 1.45, 1);
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

/**
 * Sweep smooth superellipse cross-sections along Z into a fuselage with
 * averaged normals — reads as sculpted bodywork, not boxes.
 */
function loftBody(
  stations: [number, number, number, number][],
  mat: THREE.Material,
  disposables: { dispose(): void }[],
): THREE.Mesh {
  const RADIAL = 16;
  const pos: number[] = [];
  const idx: number[] = [];

  for (const [z, w, h, cy] of stations) {
    for (let r = 0; r < RADIAL; r++) {
      const t = (r / RADIAL) * Math.PI * 2;
      // superellipse: slightly squared sides, flatter bottom
      const cx = Math.cos(t);
      const sy = Math.sin(t);
      const px = w * Math.sign(cx) * Math.pow(Math.abs(cx), 0.7);
      const py = cy + h * Math.sign(sy) * Math.pow(Math.abs(sy), sy > 0 ? 0.85 : 0.55);
      pos.push(px, py, z);
    }
  }
  const rings = stations.length;
  for (let s = 0; s < rings - 1; s++) {
    for (let r = 0; r < RADIAL; r++) {
      const a = s * RADIAL + r;
      const b = s * RADIAL + ((r + 1) % RADIAL);
      const c = (s + 1) * RADIAL + r;
      const d = (s + 1) * RADIAL + ((r + 1) % RADIAL);
      idx.push(a, c, b, b, c, d);
    }
  }
  // cap both ends with fans
  const noseCenter = pos.length / 3;
  pos.push(0, stations[0][3], stations[0][0] + 0.02);
  for (let r = 0; r < RADIAL; r++) {
    idx.push(noseCenter, r, (r + 1) % RADIAL);
  }
  const tailCenter = pos.length / 3;
  const last = stations.length - 1;
  pos.push(0, stations[last][3], stations[last][0] - 0.02);
  for (let r = 0; r < RADIAL; r++) {
    const base = last * RADIAL;
    idx.push(tailCenter, base + ((r + 1) % RADIAL), base + r);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  disposables.push(geo);
  return new THREE.Mesh(geo, mat);
}
