import type { CarInput } from "./physics";

const STICK_DEADZONE = 0.12;

/**
 * Driving input: keyboard with smoothed steering, merged with the first
 * connected gamepad (left stick = steer, RT/LT = throttle/brake, Y/△ = reset).
 */
export class Input {
  private keys = new Set<string>();
  private steer = 0;
  private handlers = new Map<string, () => void>();
  private padResetHeld = false;
  enabled = true;

  private onDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    const h = this.handlers.get(e.code);
    if (h) h();
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)
    ) {
      e.preventDefault();
    }
  };
  private onUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  attach() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
    this.keys.clear();
    this.handlers.clear();
  }

  /** one-shot key handler (R = reset, M = mute, ...) */
  on(code: string, fn: () => void) {
    this.handlers.set(code, fn);
  }

  read(dt: number): CarInput {
    const down = (c: string) => this.keys.has(c);
    const left = down("KeyA") || down("ArrowLeft");
    const right = down("KeyD") || down("ArrowRight");
    const target = this.enabled ? (left ? 1 : 0) - (right ? 1 : 0) : 0;

    // ramp toward the target, snap back to center faster
    const rate = target !== 0 ? 5.0 : 7.5;
    const d = target - this.steer;
    const maxStep = rate * dt;
    this.steer += Math.abs(d) <= maxStep ? d : Math.sign(d) * maxStep;

    let throttle = this.enabled && (down("KeyW") || down("ArrowUp")) ? 1 : 0;
    let brake = this.enabled && (down("KeyS") || down("ArrowDown")) ? 1 : 0;
    let steer = this.steer;

    const pad = this.gamepad();
    if (pad) {
      const stick = pad.axes[0] ?? 0;
      // triggers can rest slightly above zero (worn springs, drift) — without
      // a deadzone that reads as permanent throttle
      const trigger = (b: GamepadButton | undefined) => {
        const v = b?.value ?? 0;
        return v > 0.06 ? v : 0;
      };
      if (this.enabled) {
        // stick left is -1; our steer convention is +1 = left
        if (Math.abs(stick) > STICK_DEADZONE) steer = -stick;
        throttle = Math.max(throttle, trigger(pad.buttons[7]));
        brake = Math.max(brake, trigger(pad.buttons[6]));
      }
      // Y / triangle = reset, edge-triggered
      const resetDown = pad.buttons[3]?.pressed ?? false;
      if (resetDown && !this.padResetHeld) this.handlers.get("KeyR")?.();
      this.padResetHeld = resetDown;
    }

    return { throttle, brake, steer };
  }

  private gamepad(): Gamepad | null {
    if (typeof navigator.getGamepads !== "function") return null;
    for (const p of navigator.getGamepads()) {
      // only trust the standard mapping — on exotic mappings button 7 can be
      // anything, which reads as stuck throttle
      if (p && p.connected && p.mapping === "standard") return p;
    }
    return null;
  }
}
