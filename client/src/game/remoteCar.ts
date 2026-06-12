import type { NetCarState, PlayerInfo } from "@f1web/shared";
import { buildCarVisual, CarVisual } from "./carMesh";
import { damp, lerp, wrapAngle } from "./utils";

/** one snapshot, in the SENDER's time domain */
interface Snap {
  ts: number;
  x: number;
  z: number;
  h: number;
  v: number;
  st: number;
}

const WHEEL_R = 0.34;
const MAX_EXTRAPOLATE_MS = 250;
/** adaptive playback delay = BASE + jitter * JITTER_K, clamped */
const DELAY_BASE_MS = 70;
const DELAY_JITTER_K = 3.5;
const DELAY_MIN_MS = 90;
const DELAY_MAX_MS = 240;
/** how fast the applied delay may slew (ms of delay per second) */
const DELAY_SLEW = 40;
/** clock-offset upward drift, ms per received packet (NTP-style min tracking) */
const OFFSET_DRIFT = 0.3;
/** output low-pass; snap beyond this distance (teleports/resets) */
const SMOOTH_RATE = 20;
const SNAP_DIST = 6;

/**
 * A networked opponent. Snapshots carry the sender's timestamp; we estimate
 * the clock offset from least-delayed packets and play the car back in the
 * sender's time domain at an adaptive delay — network jitter then shifts
 * WHEN we sample, never the spacing between samples. Position is Hermite-
 * interpolated using snapshot velocities, so 20 Hz corners render as curves.
 */
export class RemoteCar {
  readonly visual: CarVisual;
  lap = 0;
  prog = 0;
  fin = false;
  x = 0;
  z = 0;

  private buf: Snap[] = [];
  private spin = 0;
  /** min observed (arrival - senderTs); drifts up slowly to track clocks */
  private offset = Infinity;
  private jitterEma = 0;
  private appliedDelay = DELAY_MIN_MS;
  private smoothX = 0;
  private smoothZ = 0;
  private smoothH = 0;
  private smoothInit = false;

  constructor(readonly info: PlayerInfo) {
    this.visual = buildCarVisual(info.color, info.name);
    this.visual.group.visible = false; // until the first snapshot arrives
  }

  push(arrivalT: number, s: NetCarState) {
    this.lap = s.lap;
    this.prog = s.prog;
    this.fin = s.fin;

    // tolerate peers without timestamps (mixed versions): use arrival time
    const ts = Number.isFinite(s.ts) ? s.ts : arrivalT;
    const last = this.buf[this.buf.length - 1];
    if (last && ts <= last.ts) return; // duplicate or out-of-order

    const raw = arrivalT - ts;
    if (raw < this.offset) {
      this.offset = raw; // a less-delayed packet: better offset estimate
    } else {
      this.offset += OFFSET_DRIFT; // slow upward drift tracks clock skew
      this.jitterEma += (Math.abs(raw - this.offset) - this.jitterEma) * 0.1;
    }

    this.buf.push({ ts, x: s.x, z: s.z, h: s.h, v: s.v, st: s.st });
    if (this.buf.length > 60) this.buf.splice(0, this.buf.length - 60);
  }

  update(nowMs: number, dt: number) {
    if (this.buf.length === 0 || !Number.isFinite(this.offset)) return;
    this.visual.group.visible = true;

    // adaptive jitter buffer, slewed so playback time never jumps
    const target = Math.min(
      DELAY_MAX_MS,
      Math.max(DELAY_MIN_MS, DELAY_BASE_MS + this.jitterEma * DELAY_JITTER_K),
    );
    const maxStep = DELAY_SLEW * dt;
    this.appliedDelay +=
      Math.abs(target - this.appliedDelay) <= maxStep
        ? target - this.appliedDelay
        : Math.sign(target - this.appliedDelay) * maxStep;

    const renderTs = nowMs - this.offset - this.appliedDelay;
    const newest = this.buf[this.buf.length - 1];

    let x: number, z: number, h: number, v: number, st: number;
    if (renderTs >= newest.ts) {
      // buffer ran dry: extrapolate briefly with decaying velocity
      const over = Math.min(renderTs - newest.ts, MAX_EXTRAPOLATE_MS) / 1000;
      const decay = Math.exp(-over * 2.5);
      const dist = newest.v * over * decay;
      x = newest.x + Math.sin(newest.h) * dist;
      z = newest.z + Math.cos(newest.h) * dist;
      h = newest.h;
      v = newest.v * decay;
      st = newest.st;
    } else if (this.buf.length === 1 || renderTs <= this.buf[0].ts) {
      const o = this.buf[0];
      ({ x, z, h, v, st } = o);
    } else {
      let i = this.buf.length - 2;
      while (i > 0 && this.buf[i].ts > renderTs) i--;
      const a = this.buf[i];
      const b = this.buf[i + 1];
      const span = Math.max(1, b.ts - a.ts) / 1000; // seconds
      const f = Math.min(1, Math.max(0, (renderTs - a.ts) / (span * 1000)));

      // cubic Hermite through both poses using their velocity vectors —
      // linear lerp turns 20 Hz cornering into a polygon
      const f2 = f * f;
      const f3 = f2 * f;
      const h00 = 2 * f3 - 3 * f2 + 1;
      const h10 = f3 - 2 * f2 + f;
      const h01 = -2 * f3 + 3 * f2;
      const h11 = f3 - f2;
      const tax = Math.sin(a.h) * a.v * span;
      const taz = Math.cos(a.h) * a.v * span;
      const tbx = Math.sin(b.h) * b.v * span;
      const tbz = Math.cos(b.h) * b.v * span;
      x = h00 * a.x + h10 * tax + h01 * b.x + h11 * tbx;
      z = h00 * a.z + h10 * taz + h01 * b.z + h11 * tbz;
      h = a.h + wrapAngle(b.h - a.h) * f;
      v = lerp(a.v, b.v, f);
      st = lerp(a.st, b.st, f);
    }

    // drop snapshots that are too old to ever be needed again
    while (this.buf.length > 2 && this.buf[1].ts < renderTs - 1000) {
      this.buf.shift();
    }

    // light output filter: insurance against residual steps, snap on teleport
    if (
      !this.smoothInit ||
      Math.hypot(x - this.smoothX, z - this.smoothZ) > SNAP_DIST
    ) {
      this.smoothX = x;
      this.smoothZ = z;
      this.smoothH = h;
      this.smoothInit = true;
    } else {
      const a = damp(SMOOTH_RATE, dt);
      this.smoothX = lerp(this.smoothX, x, a);
      this.smoothZ = lerp(this.smoothZ, z, a);
      this.smoothH += wrapAngle(h - this.smoothH) * a;
    }

    this.x = this.smoothX;
    this.z = this.smoothZ;
    this.visual.group.position.set(this.smoothX, 0, this.smoothZ);
    this.visual.group.rotation.y = this.smoothH;
    for (const p of this.visual.frontPivots) p.rotation.y = st * 0.45;
    this.spin += (v / WHEEL_R) * dt;
    for (const w of this.visual.wheels) w.rotation.x = this.spin;
  }

  dispose() {
    this.visual.dispose();
  }
}
