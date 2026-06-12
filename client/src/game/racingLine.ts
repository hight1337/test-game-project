import * as THREE from "three";
import { DOWNFORCE, DOWNFORCE_MAX, GRIP_BASE } from "./physics";
import { Track } from "./track";

/** samples of colored guidance ahead of the car (~390m at 3m spacing) */
const AHEAD = 130;
/** the ribbon starts this many samples ahead of the car center (~nose) */
const NOSE_OFFSET = 2;
const LINE_W = 0.95;
const BASE_W = 0.55;
const Y_BASE = 0.035;
const Y_AHEAD = 0.045;
/** dash pattern: samples on / samples off */
const DASH_ON = 4;
const DASH_PERIOD = 6;

const GREEN = new THREE.Color(0x2ecc40);
const YELLOW = new THREE.Color(0xffd23c);
const RED = new THREE.Color(0xff3b30);

/**
 * Driving assist: an approximate racing line (centerline pulled toward
 * corner apexes) plus a speed-aware colored ribbon ahead of the car.
 * Green = the next corner works at your current speed, yellow = marginal,
 * red = brake now or you won't make it. Corner speeds come from the same
 * grip model the physics uses, so the advice matches the car.
 */
export class RacingLine {
  readonly base: THREE.Mesh;
  readonly ahead: THREE.Mesh;
  private linePts: { x: number; z: number }[] = [];
  private vMax: number[] = [];
  private aheadGeo: THREE.BufferGeometry;
  private disposables: { dispose(): void }[] = [];

  constructor(private track: Track) {
    const s = track.samples;
    const m = s.length;

    // pull the line toward the inside of corners; smooth so it swings
    // gradually through entry-apex-exit
    let offsets = s.map((p) => {
      const maxOff = Math.max(0, Math.min(p.wn, p.wp) - 2.2);
      return clamp(-p.curv * 260, -maxOff, maxOff);
    });
    offsets = smoothLoop(smoothLoop(offsets, 14), 8);
    for (let i = 0; i < m; i++) {
      const p = s[i];
      const maxOff = Math.max(0, Math.min(p.wn, p.wp) - 2.2);
      const o = clamp(offsets[i], -maxOff, maxOff);
      this.linePts.push({ x: p.x + p.nx * o, z: p.z + p.nz * o });
    }

    // max cornering speed per sample from the grip model:
    // v^2 * |curv| = GRIP_BASE + min(DOWNFORCE * v^2, DOWNFORCE_MAX)
    for (let i = 0; i < m; i++) {
      const c = Math.abs(s[i].curv);
      if (c <= DOWNFORCE * 1.05) {
        this.vMax.push(999); // downforce outgrows the demand: flat out
      } else {
        let v2 = GRIP_BASE / (c - DOWNFORCE);
        if (DOWNFORCE * v2 > DOWNFORCE_MAX) v2 = (GRIP_BASE + DOWNFORCE_MAX) / c;
        this.vMax.push(Math.sqrt(v2));
      }
    }

    this.base = this.buildBase();
    const { mesh, geo } = this.buildAhead();
    this.ahead = mesh;
    this.aheadGeo = geo;
  }

  private buildBase(): THREE.Mesh {
    const s = this.track.samples;
    const m = s.length;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= m; i++) {
      const p = s[i % m];
      const l = this.linePts[i % m];
      pos.push(
        l.x + p.nx * BASE_W * 0.5, Y_BASE, l.z + p.nz * BASE_W * 0.5,
        l.x - p.nx * BASE_W * 0.5, Y_BASE, l.z - p.nz * BASE_W * 0.5,
      );
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disposables.push(geo, mat);
    return new THREE.Mesh(geo, mat);
  }

  private buildAhead() {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.Float32BufferAttribute(
      new Float32Array((AHEAD + 1) * 2 * 3),
      3,
    );
    // RGBA vertex colors: alpha drives the dash pattern and distance fade
    const col = new THREE.Float32BufferAttribute(
      new Float32Array((AHEAD + 1) * 2 * 4),
      4,
    );
    pos.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pos);
    geo.setAttribute("color", col);
    const idx: number[] = [];
    for (let i = 0; i < AHEAD; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; // positions move every frame
    return { mesh, geo };
  }

  /** recolor + reposition the guidance ribbon for the car's current state */
  update(carIdx: number, speedMs: number) {
    if (!this.ahead.visible) return;
    const s = this.track.samples;
    const m = s.length;
    const len = this.track.length;
    const pos = this.aheadGeo.getAttribute("position") as THREE.BufferAttribute;
    const col = this.aheadGeo.getAttribute("color") as THREE.BufferAttribute;

    // braking power available around the current speed, with safety margin
    const aero = Math.min(DOWNFORCE * speedMs * speedMs, DOWNFORCE_MAX);
    const brakeA = 0.85 * (GRIP_BASE + aero);
    const startDist = s[carIdx].dist;

    // distance of each ahead sample from the car; the ribbon itself begins
    // at the car's nose rather than under the chassis
    const dist = new Float32Array(AHEAD + 1);
    for (let k = 0; k <= AHEAD; k++) {
      const i = (carIdx + NOSE_OFFSET + k) % m;
      const p = s[i];
      dist[k] = (p.dist - startDist + len) % len;
      const l = this.linePts[i];
      pos.setXYZ(k * 2, l.x + p.nx * LINE_W * 0.5, Y_AHEAD, l.z + p.nz * LINE_W * 0.5);
      pos.setXYZ(k * 2 + 1, l.x - p.nx * LINE_W * 0.5, Y_AHEAD, l.z - p.nz * LINE_W * 0.5);
    }

    // mark braking zones: for every corner ahead that is too fast for the
    // CURRENT speed, the red zone runs from its braking point (where you
    // must be on the brakes already) up to the corner itself; a yellow band
    // sits just before each braking point as a heads-up
    const status = new Uint8Array(AHEAD + 1); // 0 green, 1 yellow, 2 red
    const yellowLead = Math.max(30, speedMs * 0.8);
    for (let k = 0; k <= AHEAD; k++) {
      const vm = this.vMax[(carIdx + NOSE_OFFSET + k) % m];
      if (speedMs <= vm) continue;
      const dBrake = (speedMs * speedMs - vm * vm) / (2 * brakeA);
      const zoneStart = dist[k] - dBrake;
      for (let j = 0; j <= k; j++) {
        if (dist[j] >= zoneStart) {
          if (status[j] < 2) status[j] = 2;
        } else if (dist[j] >= zoneStart - yellowLead && status[j] < 1) {
          status[j] = 1;
        }
      }
    }

    for (let k = 0; k <= AHEAD; k++) {
      const c = status[k] === 2 ? RED : status[k] === 1 ? YELLOW : GREEN;
      // dash pattern + soft fade-in at the nose and fade-out far ahead
      let a = k < 2 ? 0.35 + k * 0.3 : 0.95;
      a *= 1 - (k / AHEAD) ** 1.8;
      if (k % DASH_PERIOD >= DASH_ON) a = 0;
      col.setXYZW(k * 2, c.r, c.g, c.b, a);
      col.setXYZW(k * 2 + 1, c.r, c.g, c.b, a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  setVisible(v: boolean) {
    this.base.visible = v;
    this.ahead.visible = v;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** moving average over a closed loop */
function smoothLoop(values: number[], radius: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      sum += values[(i + k + n) % n];
    }
    out[i] = sum / (radius * 2 + 1);
  }
  return out;
}
