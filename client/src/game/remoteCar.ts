import type { NetCarState, PlayerInfo } from "@f1web/shared";
import { buildCarVisual, CarVisual } from "./carMesh";
import { angleLerp, lerp } from "./utils";

interface Snap {
  t: number;
  x: number;
  z: number;
  h: number;
  v: number;
  st: number;
}

const WHEEL_R = 0.34;
const MAX_EXTRAPOLATE_MS = 250;

/**
 * A networked opponent car: buffers state snapshots and renders the pose at
 * `now - INTERP_DELAY_MS`, extrapolating briefly when the buffer runs dry.
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

  constructor(readonly info: PlayerInfo) {
    this.visual = buildCarVisual(info.color, info.name);
    this.visual.group.visible = false; // until the first snapshot arrives
  }

  push(t: number, s: NetCarState) {
    this.buf.push({ t, x: s.x, z: s.z, h: s.h, v: s.v, st: s.st });
    if (this.buf.length > 60) this.buf.splice(0, this.buf.length - 60);
    this.lap = s.lap;
    this.prog = s.prog;
    this.fin = s.fin;
  }

  update(renderT: number, dt: number) {
    if (this.buf.length === 0) return;
    this.visual.group.visible = true;

    let x: number, z: number, h: number, v: number, st: number;
    const newest = this.buf[this.buf.length - 1];

    if (renderT >= newest.t) {
      // extrapolate a little along the heading, then freeze
      const over = Math.min(renderT - newest.t, MAX_EXTRAPOLATE_MS) / 1000;
      x = newest.x + Math.sin(newest.h) * newest.v * over;
      z = newest.z + Math.cos(newest.h) * newest.v * over;
      h = newest.h;
      v = newest.v;
      st = newest.st;
    } else if (this.buf.length === 1 || renderT <= this.buf[0].t) {
      // not enough history yet — snap to the oldest snapshot
      const o = this.buf[0];
      x = o.x;
      z = o.z;
      h = o.h;
      v = o.v;
      st = o.st;
    } else {
      let i = this.buf.length - 2;
      while (i > 0 && this.buf[i].t > renderT) i--;
      const a = this.buf[i];
      const b = this.buf[i + 1];
      const span = Math.max(1, b.t - a.t);
      const f = Math.min(1, Math.max(0, (renderT - a.t) / span));
      x = lerp(a.x, b.x, f);
      z = lerp(a.z, b.z, f);
      h = angleLerp(a.h, b.h, f);
      v = lerp(a.v, b.v, f);
      st = lerp(a.st, b.st, f);
    }

    // drop snapshots that are too old to ever be needed again
    while (this.buf.length > 2 && this.buf[1].t < renderT - 1000) this.buf.shift();

    this.x = x;
    this.z = z;
    this.visual.group.position.set(x, 0, z);
    this.visual.group.rotation.y = h;
    for (const p of this.visual.frontPivots) p.rotation.y = st * 0.45;
    this.spin += (v / WHEEL_R) * dt;
    for (const w of this.visual.wheels) w.rotation.x = this.spin;
  }

  dispose() {
    this.visual.dispose();
  }
}
