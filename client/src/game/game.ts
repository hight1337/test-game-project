import * as THREE from "three";
import {
  INTERP_DELAY_MS,
  TRACK_MAP,
  type NetCarState,
  type PlayerInfo,
} from "@f1web/shared";
import { EngineAudio } from "../audio/engine";
import { Hud, HudCar } from "../ui/hud";
import { buildCarVisual, CarVisual } from "./carMesh";
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
// car-vs-car soft collision radius, matches the upscaled visuals
const CAR_CONTACT_DIST = 3.4;

export interface GameConfig {
  renderer: THREE.WebGLRenderer;
  hud: Hud;
  trackId: string;
  laps: number;
  self: PlayerInfo;
  gridIndex: number;
  /** fires once when the local car completes the final lap */
  onSelfFinished?: (totalMs: number, bestLapMs: number) => void;
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
  private input = new Input();
  private cam = new ChaseCamera();
  private audio = new EngineAudio();
  private remotes = new Map<string, RemoteCar>();

  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private started = false;
  private finishedNotified = false;
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
    this.trackVis = buildTrackVisual(this.track);
    this.world.scene.add(this.trackVis.group);

    this.selfVis = buildCarVisual(cfg.self.color);
    this.world.scene.add(this.selfVis.group);

    this.line = new RacingLine(this.track);
    this.world.scene.add(this.line.base, this.line.ahead);
    this.line.setVisible(localStorage.getItem("f1web.line") !== "0");

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

  /** practice mode: run the light sequence locally, then GO */
  startPracticeCountdown() {
    for (let i = 1; i <= 5; i++) {
      this.timers.push(
        setTimeout(() => this.trackVis.setStartLights(i, false), i * 580),
      );
    }
    this.timers.push(setTimeout(() => this.go(), 5 * 580 + 650));
  }

  /** online mode: the server drives the lights via countdown progress 0..1 */
  setCountdownProgress(fraction: number) {
    this.trackVis.setStartLights(Math.min(5, Math.ceil(fraction * 5)), false);
  }

  go() {
    if (this.started || this.disposed) return;
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

    // soft "ghost" collisions: separate positions gently and cancel only the
    // closing velocity (a flat per-step push would slingshot the car during
    // sustained contact). Finished cars are ghosts — they can't block anyone.
    if (!this.tracker.finished) {
      for (const rc of this.remotes.values()) {
        if (!rc.visual.group.visible || rc.fin) continue;
        const dx = this.sim.x - rc.x;
        const dz = this.sim.z - rc.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.01 && d2 < CAR_CONTACT_DIST * CAR_CONTACT_DIST) {
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const nz = dz / d;
          this.sim.nudge(nx * (CAR_CONTACT_DIST - d) * 0.3, nz * (CAR_CONTACT_DIST - d) * 0.3);
          const vw = this.sim.velWorld();
          const closing = -(vw.x * nx + vw.z * nz);
          if (closing > 0) {
            // remove the closing component plus a small bounce
            this.sim.applyImpulse(nx * closing * 1.25, nz * closing * 1.25);
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

    if (this.tracker.finished && !this.finishedNotified) {
      this.finishedNotified = true;
      this.input.enabled = false;
      this.cfg.hud.centerText("FINISH", "#ffffff");
      this.cfg.onSelfFinished?.(this.tracker.totalMs!, this.tracker.bestLapMs!);
    }
  }

  private render(dt: number, t: number) {
    // local car visuals
    this.selfVis.group.position.set(this.sim.x, 0, this.sim.z);
    this.selfVis.group.rotation.y = this.sim.heading;
    for (const p of this.selfVis.frontPivots) p.rotation.y = this.sim.steerVis * 0.45;
    this.wheelSpin += (this.sim.vF / WHEEL_R) * dt;
    for (const w of this.selfVis.wheels) w.rotation.x = this.wheelSpin;

    this.line.update(this.sim.trackIdx, Math.abs(this.sim.vF));

    // remote cars
    const renderT = t - INTERP_DELAY_MS;
    for (const rc of this.remotes.values()) rc.update(renderT, dt);

    this.cam.update(dt, this.sim.x, this.sim.z, this.sim.heading, Math.abs(this.sim.vF));
    this.audio.update(this.sim.vF, this.input.enabled ? this.input.read(0).throttle : 0);

    // live position among all cars (race distance from the start line)
    const myProg = this.tracker.raceDist;
    let pos = 1;
    for (const rc of this.remotes.values()) {
      if (rc.prog > myProg) pos++;
    }

    const now = performance.now();
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
    this.line.dispose();
    this.selfVis.dispose();
    this.trackVis.dispose();
    this.world.dispose();
    this.cfg.hud.setVisible(false);
    this.cfg.hud.centerText("");
    // drop the devtools handle so the disposed scene can be collected
    const w = window as unknown as Record<string, unknown>;
    if ((w.__game as { sim?: unknown } | undefined)?.sim === this.sim) {
      delete w.__game;
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
