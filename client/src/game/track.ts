import type { TrackData } from "@f1web/shared";
import { wrapAngle } from "./utils";

/** distance between road edge and the wall, meters */
export const RUNOFF = 5;
/** kerb width outside the road edge, still decent grip */
export const KERB_W = 1.4;
/** resampled centerline spacing, meters */
const SPACING = 3;
const N_GATES = 10;
/**
 * Cars render at 1.45x real size (see carMesh CAR_VISUAL_SCALE), so widths
 * scale by the same factor — the track-to-car proportion then matches the
 * real world: ~3 cars abreast on normal sections, tight where the real
 * circuit is tight. Everything (mesh, physics, walls, grid) derives from
 * the scaled samples.
 */
const WIDTH_SCALE = 1.45;
/**
 * Real laps (5-7 km) take too long for casual racing — compress the
 * centerline to 70%. Corners tighten proportionally; widths stay at the
 * scaled real values above, so the track also feels a touch wider.
 */
const LENGTH_SCALE = 0.7;

export interface TrackSample {
  x: number;
  z: number;
  /** unit tangent (direction of travel) */
  tx: number;
  tz: number;
  /** unit normal = tangent rotated +90deg in data space */
  nx: number;
  nz: number;
  /** road half-widths along +n / -n */
  wn: number;
  wp: number;
  /** cumulative centerline distance from start line */
  dist: number;
  /** curvature, rad/m, signed */
  curv: number;
}

export interface NearestResult {
  idx: number;
  /** signed offset along the sample normal */
  lateral: number;
  /** distance along the centerline, meters */
  progress: number;
}

export interface GridSlot {
  x: number;
  z: number;
  heading: number;
  idx: number;
}

/**
 * Runtime track: smooth resampled centerline with tangents/normals,
 * nearest-point queries, checkpoint gates and grid slots.
 */
export class Track {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly gates: number[] = [];
  readonly data: TrackData;
  /**
   * Samples where a DISTANT part of the lap passes through the same spot
   * (figure-8 crossovers like Suzuka). Walls/kerbs are suppressed here so
   * the crossing renders as an open intersection instead of a barrier
   * cutting across the road.
   */
  readonly overlap: boolean[];

  constructor(data: TrackData) {
    this.data = data;
    const raw = data.points;
    const n = raw.length;

    // Catmull-Rom resample of the closed centerline. Data columns are
    // [x, y, wRight, wLeft]; data y maps to world z. With y->z the data's
    // "right of travel" side lies along +normal (n = tangent rotated +90 in
    // data space), so wn (width along +n) = wRight and wp = wLeft.
    const pts: { x: number; z: number; wn: number; wp: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = raw[(i - 1 + n) % n];
      const p1 = raw[i];
      const p2 = raw[(i + 1) % n];
      const p3 = raw[(i + 2) % n];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(1, Math.round(segLen / SPACING));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push({
          x: catmullRom(p0[0], p1[0], p2[0], p3[0], t) * LENGTH_SCALE,
          z: catmullRom(p0[1], p1[1], p2[1], p3[1], t) * LENGTH_SCALE,
          wn: (p1[2] + (p2[2] - p1[2]) * t) * WIDTH_SCALE,
          wp: (p1[3] + (p2[3] - p1[3]) * t) * WIDTH_SCALE,
        });
      }
    }

    const m = pts.length;
    let dist = 0;
    for (let i = 0; i < m; i++) {
      const prev = pts[(i - 1 + m) % m];
      const cur = pts[i];
      const next = pts[(i + 1) % m];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) dist += Math.hypot(cur.x - prev.x, cur.z - prev.z);
      this.samples.push({
        x: cur.x,
        z: cur.z,
        tx,
        tz,
        nx: -tz,
        nz: tx,
        wn: cur.wn,
        wp: cur.wp,
        dist,
        curv: 0,
      });
    }
    this.length =
      dist + Math.hypot(pts[0].x - pts[m - 1].x, pts[0].z - pts[m - 1].z);

    // curvature = heading change per meter, smoothed over a small window
    for (let i = 0; i < m; i++) {
      const a = this.samples[(i - 2 + m) % m];
      const b = this.samples[(i + 2) % m];
      const dh = wrapAngle(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz));
      this.samples[i].curv = dh / (SPACING * 4);
    }

    for (let g = 0; g < N_GATES; g++) {
      this.gates.push(Math.floor((g * m) / N_GATES));
    }

    // overlap detection: distant-in-lap sample pairs that nearly coincide
    this.overlap = new Array(m).fill(false);
    for (let i = 0; i < m; i += 2) {
      const si = this.samples[i];
      for (let j = i + 120; j < m; j += 2) {
        const wrapSep = Math.min(j - i, m - (j - i));
        if (wrapSep < 120) continue;
        const dx = si.x - this.samples[j].x;
        const dz = si.z - this.samples[j].z;
        if (dx * dx + dz * dz < 20 * 20) {
          for (let k = -10; k <= 10; k++) {
            this.overlap[(i + k + m) % m] = true;
            this.overlap[(j + k + m) % m] = true;
          }
        }
      }
    }
  }

  /**
   * Distance from a point to the nearest barrier, checked against EVERY
   * part of the lap (brute force; for one-time scenery placement). Positive
   * = outside all walls by that many meters.
   */
  minClearance(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.samples.length; i += 2) {
      const s = this.samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const lat = Math.abs(dx * s.nx + dz * s.nz);
      const along = Math.abs(dx * s.tx + dz * s.tz);
      if (along > 8) continue; // not abreast of this sample
      const wall = Math.max(s.wn, s.wp) + RUNOFF;
      best = Math.min(best, lat - wall);
    }
    return best;
  }

  headingAt(idx: number): number {
    const s = this.samples[idx];
    return Math.atan2(s.tx, s.tz);
  }

  /**
   * Nearest sample to a position. `hint` is the previous result's index;
   * searches a local window first and falls back to a full scan if the
   * window result looks wrong (teleport/reset).
   */
  nearest(x: number, z: number, hint = 0): NearestResult {
    const m = this.samples.length;
    let best = this.scan(x, z, hint - 40, hint + 40);
    const bs = this.samples[best];
    if ((x - bs.x) ** 2 + (z - bs.z) ** 2 > 60 * 60) {
      best = this.scan(x, z, 0, m - 1);
    }
    const s = this.samples[best];
    const dx = x - s.x;
    const dz = z - s.z;
    const along = dx * s.tx + dz * s.tz;
    return {
      idx: best,
      lateral: dx * s.nx + dz * s.nz,
      progress: (s.dist + along + this.length) % this.length,
    };
  }

  private scan(x: number, z: number, from: number, to: number): number {
    const m = this.samples.length;
    let bestD = Infinity;
    let best = 0;
    for (let i = from; i <= to; i++) {
      const s = this.samples[((i % m) + m) % m];
      const d = (x - s.x) ** 2 + (z - s.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = ((i % m) + m) % m;
      }
    }
    return best;
  }

  /** standing-start grid: two staggered columns behind the start line */
  gridSlot(slot: number): GridSlot {
    const m = this.samples.length;
    const back = 12 + slot * 8; // meters behind the line
    const idx = (m - Math.round(back / SPACING) + m) % m;
    const s = this.samples[idx];
    const side = (slot % 2 === 0 ? 1 : -1) * 2.2;
    return {
      x: s.x + s.nx * side,
      z: s.z + s.nz * side,
      heading: Math.atan2(s.tx, s.tz),
      idx,
    };
  }

  /** respawn pose at the nearest centerline point */
  resetPose(x: number, z: number, hint: number): GridSlot {
    const near = this.nearest(x, z, hint);
    const s = this.samples[near.idx];
    return { x: s.x, z: s.z, heading: this.headingAt(near.idx), idx: near.idx };
  }
}

function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}
