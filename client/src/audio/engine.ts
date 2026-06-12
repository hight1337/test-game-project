import { TOP_SPEED } from "../game/physics";

// Browsers cap the number of AudioContexts per page (~6), so one shared
// context lives for the whole session; each race only creates/destroys its
// own oscillator graph.
let sharedCtx: AudioContext | null = null;
function getContext(): AudioContext | null {
  if (!sharedCtx) {
    try {
      sharedCtx = new AudioContext();
    } catch {
      return null; // no audio available; the game runs silent
    }
  }
  return sharedCtx;
}

/**
 * Procedural engine sound: two detuned oscillators through a lowpass filter,
 * pitch driven by speed with fake gear steps. Starts on first user gesture.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private gain!: GainNode;
  private filter!: BiquadFilterNode;
  muted = false;
  private running = false;
  private disposed = false;

  start() {
    if (this.disposed) return;
    if (this.running) {
      this.ctx?.resume();
      return;
    }
    const ctx = getContext();
    if (!ctx) return;
    ctx.resume();
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 420;
    this.filter.Q.value = 0.4;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc2 = ctx.createOscillator();
    this.osc2.type = "triangle"; // soft sub-octave for body, no harsh edge
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    this.osc1.connect(this.filter);
    this.osc2.connect(g2).connect(this.filter);
    this.filter.connect(this.gain).connect(ctx.destination);
    this.osc1.start();
    this.osc2.start();
    this.running = true;
  }

  update(speed: number, throttle: number) {
    if (!this.running || !this.ctx) return;
    const v = Math.abs(speed);
    // 8 fake gears; pitch rises within each gear then drops on the shift
    const gearLen = TOP_SPEED / 8;
    const frac = (v % gearLen) / gearLen;
    const gear = Math.min(7, Math.floor(v / gearLen));
    const freq = 52 + frac * 95 + gear * 6;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(freq, t, 0.06);
    this.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.06);
    const target = this.muted
      ? 0
      : 0.018 + throttle * 0.032 + (v / TOP_SPEED) * 0.008;
    this.gain.gain.setTargetAtTime(target, t, 0.1);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /** fade out and tear down this race's oscillator graph */
  dispose() {
    this.disposed = true;
    if (!this.running || !this.ctx) return;
    this.running = false;
    const { osc1, osc2, gain, filter, ctx } = this;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => {
      try {
        osc1.stop();
        osc2.stop();
        osc1.disconnect();
        osc2.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        /* already stopped */
      }
    }, 300);
  }
}
