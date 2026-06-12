import { KERB_W, RUNOFF, Track } from "./track";
import { clamp } from "./utils";

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
}

// --- handling tune ---------------------------------------------------------
/** reference top speed for audio/camera scaling, m/s (~330 km/h) */
export const TOP_SPEED = 92;
// engine: acceleration is power-limited (a = P/(m*v)) like a real ~1000 hp /
// ~800 kg car, and traction-limited off the line
const POWER_ACCEL = 820; // usable power per mass, W/kg
const TRACTION_BASE = 11.5; // rear-tire launch limit, m/s^2 (~1.2g)
const TRACTION_DOWNFORCE = 0.45; // share of aero grip usable for traction
// braking is grip-limited: the tires' budget (mechanical + downforce) sets
// the stopping power (~4.5g from 320 km/h). Braking costs some cornering
// grip, but only a soft arcade share — keyboard brakes are all-or-nothing,
// so a strict friction circle would make every stop an understeer festival
const BRAKE_TURN_TRADEOFF = 0.3; // full brake keeps 70% of turning grip
const REVERSE_SPEED = 14;
const REVERSE_ACCEL = 9;
const WHEELBASE = 3.1;
const MAX_STEER = 0.45; // rad, low speed
const STEER_FALLOFF = 20; // m/s; higher = livelier steering at speed
// grip model: mechanical grip + aero downforce that grows with speed, like a
// real F1 car — slow corners demand braking, fast sweepers go nearly flat
// (exported for the racing-line assist, which predicts corner speeds)
export const GRIP_BASE = 17.5; // mechanical grip, m/s^2 (~1.8g)
export const DOWNFORCE = 0.0035; // aero grip gain per (m/s)^2
export const DOWNFORCE_MAX = 30; // aero grip cap, m/s^2
const SLIDE_DRAG = 0.4; // speed scrub per m/s of lateral sliding, 1/s
const GRIP = 8.0; // lateral slip damping on tarmac, 1/s
const GRIP_RUNOFF = 5.5; // paved runoff: dusty, a bit less grip
const DRAG = 0.00105; // quadratic aero drag — sets top speed ~324 km/h
const ROLL = 0.5; // rolling resistance, m/s^2
const RUNOFF_DRAG = 0.9; // extra decel on the runoff, m/s^2
const RUNOFF_POWER = 0.8; // throttle effectiveness on the runoff
const WALL_RESTITUTION = 0.05; // barriers absorb the hit — no pinball bounce
const WALL_GRIND = 6.5; // m/s^2 lost while scraping along the barrier
// half-extents of the upscaled car visuals (see carMesh CAR_VISUAL_SCALE);
// the wall clearance projects these onto the wall normal so neither the
// nose nor a flank ever clips through the barrier mesh
const CAR_HALF_W = 1.35;
const CAR_HALF_L = 3.3;

/**
 * Arcade car simulation on a flat track. Velocity is decomposed into a
 * forward and a lateral component relative to the heading; grip is modelled
 * as exponential damping of the lateral component.
 */
export class CarSim {
  x = 0;
  z = 0;
  heading = 0;
  /** forward velocity, m/s (negative = reversing) */
  vF = 0;
  /** lateral velocity, m/s, along the car's left axis */
  vL = 0;
  /** smoothed steering for visuals, -1..1 */
  steerVis = 0;

  trackIdx = 0;
  lateral = 0;
  progress = 0;
  onRunoff = false;
  onKerb = false;
  /** impact speed of a wall hit this step (0 = none), for audio/fx */
  wallHit = 0;

  constructor(private track: Track) {}

  setPose(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vF = 0;
    this.vL = 0;
    const near = this.track.nearest(x, z, this.trackIdx);
    this.trackIdx = near.idx;
    this.lateral = near.lateral;
    this.progress = near.progress;
  }

  get speedKmh(): number {
    return Math.abs(this.vF) * 3.6;
  }

  /** world-space velocity */
  velWorld(): { x: number; z: number } {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // left axis = forward rotated +90deg around Y
    const lx = fz;
    const lz = -fx;
    return { x: fx * this.vF + lx * this.vL, z: fz * this.vF + lz * this.vL };
  }

  /** positional separation only (car-to-car contact) */
  nudge(px: number, pz: number) {
    this.x += px;
    this.z += pz;
  }

  /** world-space velocity change, e.g. contact impulse */
  applyImpulse(ix: number, iz: number) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.vF += ix * fx + iz * fz;
    this.vL += ix * fz + iz * -fx;
  }

  step(dt: number, input: CarInput) {
    this.wallHit = 0;
    const surfThrottle = this.onRunoff ? RUNOFF_POWER : 1;
    const grip = this.onRunoff ? GRIP_RUNOFF : GRIP;

    // aero downforce term, shared by traction, braking and cornering grip
    const aero = Math.min(DOWNFORCE * this.vF * this.vF, DOWNFORCE_MAX);
    // total tire grip available this instant
    const gripBudget = GRIP_BASE + aero;
    let brakeFrac = 0;

    // longitudinal — throttle while reversing brakes hard first, so
    // reverse -> forward feels instant instead of waiting for the car to coast
    if (input.throttle > 0) {
      if (this.vF < -0.3) {
        this.vF = Math.min(0, this.vF + gripBudget * input.throttle * dt);
      } else {
        // traction-limited off the line, power-limited once rolling
        const traction = TRACTION_BASE + aero * TRACTION_DOWNFORCE;
        const a = Math.min(POWER_ACCEL / Math.max(this.vF, 8), traction);
        this.vF += a * surfThrottle * input.throttle * dt;
      }
    }
    if (input.brake > 0) {
      if (this.vF > 0.4) {
        brakeFrac = input.brake;
        this.vF = Math.max(0, this.vF - gripBudget * input.brake * dt);
      } else {
        // reverse gear
        this.vF = Math.max(-REVERSE_SPEED, this.vF - REVERSE_ACCEL * input.brake * dt);
      }
    }
    const drag = DRAG * this.vF * Math.abs(this.vF) + Math.sign(this.vF) * ROLL;
    this.vF -= drag * dt;
    if (this.onRunoff) {
      this.vF -= Math.sign(this.vF) * RUNOFF_DRAG * dt;
    }
    if (Math.abs(this.vF) < 0.05 && input.throttle === 0) this.vF = 0;

    // steering: kinematic bicycle, limited by the tires' grip budget
    const steerAngle =
      (input.steer * MAX_STEER) / (1 + Math.abs(this.vF) / STEER_FALLOFF);
    const wanted = (this.vF / WHEELBASE) * Math.tan(steerAngle);
    // braking trades away a soft share of cornering grip (arcade ABS feel)
    const aLatMax = gripBudget * (1 - BRAKE_TURN_TRADEOFF * brakeFrac);
    const yawCap = aLatMax / Math.max(Math.abs(this.vF), 6);
    const yawRate = clamp(wanted, -yawCap, yawCap);
    this.heading += yawRate * dt;

    // past the limit the front washes out: the car turns less than asked
    // (the cap above) AND slides outward — carry too much speed into a
    // corner and you go to the wall instead of magically slowing down
    const excess = Math.abs(wanted) - yawCap;
    const slideFactor = excess > 0 ? 1 + Math.min(excess / yawCap, 1.8) : 1;
    this.vL += -yawRate * Math.abs(this.vF) * 0.16 * slideFactor * dt;

    // sliding tires have less grip than rolling ones -> slides are progressive
    const gripEff = grip / (1 + Math.abs(this.vL) * 0.18);
    this.vL *= Math.exp(-gripEff * dt);

    // the only speed penalty is genuine tire scrub while actually sliding
    this.vF -= Math.sign(this.vF) * Math.abs(this.vL) * SLIDE_DRAG * dt;

    // integrate position
    const v = this.velWorld();
    this.x += v.x * dt;
    this.z += v.z * dt;

    // track interaction
    const near = this.track.nearest(this.x, this.z, this.trackIdx);
    this.trackIdx = near.idx;
    this.lateral = near.lateral;
    this.progress = near.progress;
    const s = this.track.samples[near.idx];
    const roadW = near.lateral > 0 ? s.wn : s.wp;
    const absLat = Math.abs(near.lateral);
    this.onKerb = absLat > roadW && absLat <= roadW + KERB_W;
    this.onRunoff = absLat > roadW + KERB_W;

    // wall clamp: clearance depends on how the car is angled to the wall —
    // a nose-first hit needs half a car LENGTH of room, a parallel slide
    // only half a car width
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    const alongNormal =
      Math.abs(hx * s.nx + hz * s.nz) * CAR_HALF_L +
      Math.abs(hz * s.nx - hx * s.nz) * CAR_HALF_W;
    const limit = roadW + RUNOFF - alongNormal;
    if (absLat > limit) {
      const side = Math.sign(near.lateral);
      const overshoot = absLat - limit;
      this.x -= s.nx * side * overshoot;
      this.z -= s.nz * side * overshoot;
      // remove outward velocity, keep some bounce, scrub speed
      const vw = this.velWorld();
      const vn = vw.x * s.nx * side + vw.z * s.nz * side;
      if (vn > 0) {
        this.wallHit = vn;
        const nx = s.nx * side;
        const nz = s.nz * side;
        // scrub speed in proportion to how square the impact was
        const scrub = 1 - clamp(vn * 0.022, 0.02, 0.5);
        const newVx = (vw.x - nx * vn * (1 + WALL_RESTITUTION)) * scrub;
        const newVz = (vw.z - nz * vn * (1 + WALL_RESTITUTION)) * scrub;
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        this.vF = newVx * fx + newVz * fz;
        this.vL = newVx * fz + newVz * -fx;
      }
      // grinding along the barrier bleeds speed every contact frame, so
      // wall-riding a corner is always slower than braking for it
      this.vF -= Math.sign(this.vF) * WALL_GRIND * dt;
      this.lateral = side * limit;
    }

    // visual steering smoothing
    this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 10);
  }
}
