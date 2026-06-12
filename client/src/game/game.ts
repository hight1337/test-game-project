import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  GO_HOLD_MAX_MS,
  GO_HOLD_MIN_MS,
  NET_SEND_HZ,
  TRACK_MAP,
  type NetCarState,
  type PlayerInfo,
} from "@f1web/shared";
import { EngineAudio } from "../audio/engine";
import { Hud, HudCar } from "../ui/hud";
import { buildCarVisual, CarVisual, CAR_VISUAL_SCALE } from "./carMesh";
import { TireSmoke } from "./effects";
import { ChaseCamera } from "./camera";
import { Input } from "./input";
import { CarSim } from "./physics";
import { RaceTracker } from "./raceTracker";
import { RacingLine } from "./racingLine";
import { RemoteCar } from "./remoteCar";
import { buildWorld, World } from "./scene";
import { Track } from "./track";
import { buildTrackVisual, TrackVisual } from "./trackMesh";

const STEP = 1 / 60;
const WHEEL_R = 0.34;

// one PMREM environment for the whole session — gives PBR materials
// (car paint, rims) something to reflect
let envTexture: THREE.Texture | null = null;
function getEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!envTexture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  return envTexture;
}
// car-vs-car contact envelope (ellipse in the car's frame): cars are long
// and narrow, so nose-to-tail contact happens much sooner than side-to-side —
// you can race genuinely side by side without phantom collisions
const CONTACT_HALF_LEN = 3.0;
const CONTACT_HALF_WID = 1.9;

export interface GameConfig {
  renderer: THREE.WebGLRenderer;
  hud: Hud;
  trackId: string;
  laps: number;
  self: PlayerInfo;
  gridIndex: number;
  /** fires once when the local car completes the final lap */
  onSelfFinished?: (totalMs: number, bestLapMs: number) => void;
  /**
   * online: called at an exact NET_SEND_HZ cadence from the fixed physics
   * step (a wall-clock interval would drift and alias against the server's
   * relay tick, which renders as stutter on other screens)
   */
  onSelfState?: (s: NetCarState) => void;
  /** Esc pressed */
  onExit: () => void;
}

/**
 * One running race session (practice or online). Owns the scene, the local
 * car simulation, remote cars, HUD updates and the render loop.
 */
export class Game {
  readonly track: Track;
  private world: World;
  private trackVis: TrackVisual;
  private selfVis: CarVisual;
  private sim: CarSim;
  private tracker: RaceTracker;
  private line: RacingLine;
  private smoke = new TireSmoke();
  private input = new Input();
  private cam = new ChaseCamera();
  private audio = new EngineAudio();
  private remotes = new Map<string, RemoteCar>();

  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private netAccum = 0;
  private started = false;
  private finishedNotified = false;
  /** remotes we're currently touching — full impulse only on contact entry */
  private contacts = new Set<string>();
  /** wall-clock deadline after the first finisher (online races) */
  private finishDeadline: number | null = null;
  private disposed = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private wheelSpin = 0;

  private onResize = () => {
    this.cfg.renderer.setSize(window.innerWidth, window.innerHeight);
    this.cam.resize();
  };
  private audioKickstart = () => this.audio.start();

  constructor(private cfg: GameConfig) {
    this.track = new Track(TRACK_MAP[cfg.trackId]);
    this.world = buildWorld(this.track);
    this.world.scene.environment = getEnvironment(cfg.renderer);
    this.world.scene.environmentIntensity = 0.45;
    this.trackVis = buildTrackVisual(this.track);
    this.world.scene.add(this.trackVis.group);

    this.selfVis = buildCarVisual(cfg.self.color);
    this.world.scene.add(this.selfVis.group);

    this.line = new RacingLine(this.track);
    this.world.scene.add(this.line.base, this.line.ahead);
    this.line.setVisible(localStorage.getItem("f1web.line") !== "0");
    this.world.scene.add(this.smoke.group);

    this.sim = new CarSim(this.track);
    const slot = this.track.gridSlot(cfg.gridIndex);
    this.sim.setPose(slot.x, slot.z, slot.heading);
    this.tracker = new RaceTracker(this.track, cfg.laps);

    this.input.attach();
    this.input.enabled = false;
    this.input.on("Escape", () => cfg.onExit());
    this.input.on("KeyR", () => this.resetCar());
    this.input.on("KeyM", () => this.audio.toggleMute());
    this.input.on("KeyL", () => {
      const v = !this.line.base.visible;
      this.line.setVisible(v);
      localStorage.setItem("f1web.line", v ? "1" : "0");
    });

    cfg.hud.setTrack(this.track);
    cfg.hud.setVisible(true);
    cfg.hud.centerText("");

    window.addEventListener("resize", this.onResize);
    // AudioContext needs a user gesture; the first keypress provides one
    window.addEventListener("keydown", this.audioKickstart, { once: true });
    this.onResize();

    this.cam.snapTo(this.sim.x, this.sim.z, this.sim.heading);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);

    // debug handle for devtools poking
    (window as unknown as Record<string, unknown>).__game = {
      sim: this.sim,
      track: this.track,
      tracker: this.tracker,
      remotes: this.remotes,
    };
  }

  // ---- remote cars ---------------------------------------------------------

  addRemote(info: PlayerInfo) {
    if (this.remotes.has(info.id) || info.id === this.cfg.self.id) return;
    const rc = new RemoteCar(info);
    this.remotes.set(info.id, rc);
    this.world.scene.add(rc.visual.group);
  }

  removeRemote(id: string) {
    this.contacts.delete(id);
    const rc = this.remotes.get(id);
    if (!rc) return;
    this.world.scene.remove(rc.visual.group);
    rc.dispose();
    this.remotes.delete(id);
  }

  pushRemoteState(id: string, t: number, s: NetCarState) {
    this.remotes.get(id)?.push(t, s);
  }

  // ---- race control --------------------------------------------------------

  private countdownT0: number | null = null;
  private prepMs = 0;
  private lightsMs = 0;
  /** practice schedules its own randomized lights-out; online waits for "go" */
  private localGoAt: number | null = null;

  /**
   * Start sequence: a prep window (big on-screen count so everyone settles
   * on the grid), then the 5 red lights, then — after a random hold nobody
   * can anticipate — lights out.
   */
  startCountdown(prepMs: number, lightsMs: number, localGo: boolean) {
    this.countdownT0 = performance.now();
    this.prepMs = prepMs;
    this.lightsMs = lightsMs;
    if (localGo) {
      const hold =
        GO_HOLD_MIN_MS + Math.random() * (GO_HOLD_MAX_MS - GO_HOLD_MIN_MS);
      this.localGoAt = this.countdownT0 + prepMs + lightsMs + hold;
    }
  }

  private updateCountdown(t: number) {
    if (this.countdownT0 === null || this.started) return;
    const elapsed = t - this.countdownT0;
    if (elapsed < this.prepMs) {
      const secs = Math.ceil((this.prepMs - elapsed) / 1000);
      this.cfg.hud.centerText(String(secs), secs <= 3 ? "#ff2a1c" : "#ffffff");
      this.trackVis.setStartLights(0, false);
    } else {
      this.cfg.hud.centerText("");
      const lit = Math.min(
        5,
        Math.ceil(((elapsed - this.prepMs) / this.lightsMs) * 5),
      );
      this.trackVis.setStartLights(lit, false);
    }
    if (this.localGoAt !== null && t >= this.localGoAt) this.go();
  }

  go() {
    if (this.started || this.disposed) return;
    this.countdownT0 = null;
    this.localGoAt = null;
    this.started = true;
    this.input.enabled = true;
    this.trackVis.setStartLights(5, true);
    this.tracker.go(performance.now(), this.sim.trackIdx, this.sim.progress);
    this.cfg.hud.centerText("GO!", "#21d448");
    this.audio.start();
    this.timers.push(setTimeout(() => this.cfg.hud.centerText(""), 900));
  }

  getNetState(): NetCarState {
    return {
      ts: Math.round(performance.now()),
      x: round2(this.sim.x),
      z: round2(this.sim.z),
      h: round3(this.sim.heading),
      v: round2(this.sim.vF),
      st: round2(this.sim.steerVis),
      lap: this.tracker.lap,
      prog: Math.round(this.tracker.raceDist),
      fin: this.tracker.finished,
    };
  }

  centerText(text: string, color?: string) {
    this.cfg.hud.centerText(text, color);
  }

  /** someone crossed the line first — show the time left for everyone else */
  startFinishCountdown(ms: number) {
    this.finishDeadline = performance.now() + ms;
  }

  private resetCar() {
    if (!this.started || this.tracker.finished) return;
    const pose = this.track.resetPose(this.sim.x, this.sim.z, this.sim.trackIdx);
    this.sim.setPose(pose.x, pose.z, pose.heading);
    this.tracker.reanchor(pose.idx);
  }

  // ---- main loop -----------------------------------------------------------

  private tick = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.fixedStep(performance.now());
      this.acc -= STEP;
    }
    this.render(dt, t);
  };

  private fixedStep(now: number) {
    const input = this.input.read(STEP);
    this.sim.step(STEP, input);

    // own-state uplink, locked to the simulation clock
    if (this.cfg.onSelfState) {
      this.netAccum += STEP;
      if (this.netAccum >= 1 / NET_SEND_HZ) {
        this.netAccum -= 1 / NET_SEND_HZ;
        this.cfg.onSelfState(this.getNetState());
      }
    }

    // car-to-car contact: elliptical envelope in our frame, with the
    // response split by WHERE the contact is — frontal hits stop the car,
    // side swipes deflect it laterally while keeping racing speed, rear
    // taps shove it forward. Finished cars are ghosts.
    if (!this.tracker.finished) {
      const fx = Math.sin(this.sim.heading);
      const fz = Math.cos(this.sim.heading);
      const lx = fz;
      const lz = -fx;
      for (const [rcId, rc] of this.remotes) {
        if (!rc.visual.group.visible || rc.fin) continue;
        const dx = this.sim.x - rc.x;
        const dz = this.sim.z - rc.z;
        // delta in our frame: along the nose vs across the body
        const dF = dx * fx + dz * fz;
        const dL = dx * lx + dz * lz;
        const q2 =
          (dF / CONTACT_HALF_LEN) ** 2 + (dL / CONTACT_HALF_WID) ** 2;
        if (q2 >= 1 || q2 < 1e-4) {
          this.contacts.delete(rcId);
          continue;
        }
        const q = Math.sqrt(q2);
        const isNewContact = !this.contacts.has(rcId);
        this.contacts.add(rcId);

        // contact normal = ellipse gradient, mapped back to world space
        let nF = dF / (CONTACT_HALF_LEN * CONTACT_HALF_LEN);
        let nL = dL / (CONTACT_HALF_WID * CONTACT_HALF_WID);
        const nLen = Math.hypot(nF, nL) || 1;
        nF /= nLen;
        nL /= nLen;
        const nx = fx * nF + lx * nL;
        const nz = fz * nF + lz * nL;

        // gentle positional separation
        const pen = (1 - q) * 1.1;
        this.sim.nudge(nx * pen * 0.45, nz * pen * 0.45);

        const vw = this.sim.velWorld();
        const closing = -(vw.x * nx + vw.z * nz);
        if (closing > 0) {
          // car-to-car is a MOMENTUM EXCHANGE, not a wall: on contact ENTRY
          // equal masses share the closing speed (we lose ~half on a square
          // hit; the other car's client shoves them forward with the rest).
          // While contact persists only a light hold applies — re-cancelling
          // every physics step would compound to a hard stop in ~100ms.
          const frontal = Math.abs(nF);
          // entry: momentum exchange. sustained: gentle hold — 0.03/step at
          // 60Hz halves residual closing speed roughly every 0.4s
          const k = isNewContact ? 0.35 + 0.3 * frontal : 0.03;
          this.sim.applyImpulse(nx * closing * k, nz * closing * k);
          // only a truly violent square impact crumples a little speed
          if (isNewContact && frontal > 0.7 && closing > 12) {
            this.sim.vF *= 0.93;
          }
        }
      }
    }

    const s = this.track.samples[this.sim.trackIdx];
    const vw = this.sim.velWorld();
    this.tracker.update(
      now,
      STEP,
      this.sim.trackIdx,
      vw.x * s.tx + vw.z * s.tz,
      this.sim.progress,
    );

    // tire smoke: wheelspin off the line, lockups, slides, wall grinds
    const speed = Math.abs(this.sim.vF);
    let intensity = 0;
    if (input.throttle > 0.6 && speed > 0.5 && speed < 18 && !this.sim.onRunoff) {
      intensity = Math.max(intensity, 0.9 * (1 - speed / 18)); // launch wheelspin
    }
    if (input.brake > 0.6 && speed > 22) {
      intensity = Math.max(intensity, 0.55); // braking lockup
    }
    intensity = Math.max(intensity, Math.min(1, Math.abs(this.sim.vL) * 0.28)); // slides
    if (this.sim.wallHit > 1) intensity = 1; // impacts
    if (intensity > 0.12) {
      // emit at both rear wheel contact patches
      const fx = Math.sin(this.sim.heading);
      const fz = Math.cos(this.sim.heading);
      const back = 1.45 * CAR_VISUAL_SCALE;
      const half = 0.8 * CAR_VISUAL_SCALE;
      for (const side of [-1, 1]) {
        this.smoke.emit(
          this.sim.x - fx * back + fz * side * half,
          this.sim.z - fz * back - fx * side * half,
          intensity * 0.5,
          STEP,
        );
      }
    }

    if (this.tracker.finished && !this.finishedNotified) {
      this.finishedNotified = true;
      this.input.enabled = false;
      this.cfg.hud.centerText("FINISH", "#ffffff");
      this.cfg.onSelfFinished?.(this.tracker.totalMs!, this.tracker.bestLapMs!);
    }
  }

  private render(dt: number, t: number) {
    this.updateCountdown(t);

    // local car visuals
    this.selfVis.group.position.set(this.sim.x, 0, this.sim.z);
    this.selfVis.group.rotation.y = this.sim.heading;
    for (const p of this.selfVis.frontPivots) p.rotation.y = this.sim.steerVis * 0.45;
    this.wheelSpin += (this.sim.vF / WHEEL_R) * dt;
    for (const w of this.selfVis.wheels) w.rotation.x = this.wheelSpin;

    this.line.update(this.sim.trackIdx, Math.abs(this.sim.vF));

    this.smoke.update(dt);

    // remote cars (each manages its own clock offset + jitter buffer)
    for (const rc of this.remotes.values()) rc.update(t, dt);

    this.cam.update(dt, this.sim.x, this.sim.z, this.sim.heading, Math.abs(this.sim.vF));
    this.audio.update(this.sim.vF, this.input.enabled ? this.input.read(0).throttle : 0);

    // live position among all cars (race distance from the start line)
    const myProg = this.tracker.raceDist;
    let pos = 1;
    for (const rc of this.remotes.values()) {
      if (rc.prog > myProg) pos++;
    }

    const now = performance.now();
    this.cfg.hud.setFinishCountdown(
      this.finishDeadline !== null
        ? Math.ceil((this.finishDeadline - now) / 1000)
        : null,
    );
    const hudCars: HudCar[] = [
      { x: this.sim.x, z: this.sim.z, color: this.cfg.self.color, self: true },
    ];
    for (const rc of this.remotes.values()) {
      if (rc.visual.group.visible)
        hudCars.push({ x: rc.x, z: rc.z, color: rc.info.color, self: false });
    }
    this.cfg.hud.update(
      {
        speedKmh: this.sim.vF * 3.6, // signed: the gauge shows "R" in reverse
        lap: this.tracker.lap,
        totalLaps: this.tracker.totalLaps,
        pos,
        posTotal: this.remotes.size + 1,
        curMs: this.tracker.currentLapMs(now),
        lastMs: this.tracker.lastLapMs,
        bestMs: this.tracker.bestLapMs,
        wrongWay: this.tracker.wrongWay,
      },
      hudCars,
    );

    this.cfg.renderer.render(this.world.scene, this.cam.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    this.input.detach();
    this.audio.dispose();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.audioKickstart);
    for (const rc of this.remotes.values()) rc.dispose();
    this.remotes.clear();
    this.smoke.dispose();
    this.line.dispose();
    this.selfVis.dispose();
    this.trackVis.dispose();
    this.world.dispose();
    this.cfg.hud.setVisible(false);
    this.cfg.hud.centerText("");
    this.cfg.hud.setFinishCountdown(null);
    // drop the devtools handle so the disposed scene can be collected
    const w = window as unknown as Record<string, unknown>;
    if ((w.__game as { sim?: unknown } | undefined)?.sim === this.sim) {
      delete w.__game;
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
