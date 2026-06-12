import * as THREE from "three";

const POOL = 90;
const MAX_SPAWN_PER_SEC = 70;

/**
 * Pooled sprite tire smoke: puffs spawned at the rear wheels during
 * wheelspin, hard braking, slides and wall grinds; they rise, expand and
 * fade. One shared texture, per-sprite material for individual opacity.
 */
export class TireSmoke {
  readonly group = new THREE.Group();
  private pool: {
    sprite: THREE.Sprite;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    maxLife: number;
  }[] = [];
  private next = 0;
  private spawnBudget = 0;
  private disposables: { dispose(): void }[] = [];

  constructor() {
    const tex = makeSmokeTexture();
    this.disposables.push(tex);
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        color: 0xcfcfd2,
      });
      this.disposables.push(mat);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.pool.push({ sprite, vx: 0, vy: 0, vz: 0, life: 1, maxLife: 1 });
    }
  }

  /** request smoke at a world position; intensity 0..1 gates the rate */
  emit(x: number, z: number, intensity: number, dt: number) {
    this.spawnBudget += MAX_SPAWN_PER_SEC * Math.min(1, intensity) * dt;
    while (this.spawnBudget >= 1) {
      this.spawnBudget -= 1;
      const p = this.pool[this.next];
      this.next = (this.next + 1) % POOL;
      p.sprite.visible = true;
      p.sprite.position.set(
        x + (Math.random() - 0.5) * 0.5,
        0.25,
        z + (Math.random() - 0.5) * 0.5,
      );
      p.sprite.scale.setScalar(0.6 + Math.random() * 0.5);
      p.vx = (Math.random() - 0.5) * 1.6;
      p.vy = 1.2 + Math.random() * 1.2;
      p.vz = (Math.random() - 0.5) * 1.6;
      p.maxLife = 0.6 + Math.random() * 0.5;
      p.life = 0;
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.sprite.visible) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.sprite.visible = false;
        continue;
      }
      const t = p.life / p.maxLife;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(p.sprite.scale.x + dt * 2.6);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.38 * (1 - t);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

function makeSmokeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
