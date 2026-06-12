import { RUNOFF, Track } from "./track";

/**
 * Lap/checkpoint logic for one car. Checkpoint gates (sample indices spread
 * around the track) must all be collected before a start-line crossing counts
 * as a completed lap — cutting the track or reversing over the line gains
 * nothing.
 */
export class RaceTracker {
  lap = 0; // 0 before GO, then 1-based
  lastLapMs: number | null = null;
  bestLapMs: number | null = null;
  totalMs: number | null = null;
  finished = false;
  /**
   * Signed race distance from the start line, meters. Starts slightly
   * negative on the grid and grows continuously across laps — this is what
   * live position ordering compares, so a car still on the grid never reads
   * as "almost a lap ahead".
   */
  raceDist = 0;

  private gateHit: boolean[];
  private prevIdx = 0;
  private prevProgress = 0;
  private lapStart = 0;
  private raceStart = 0;
  private wrongWayFor = 0;

  constructor(
    private track: Track,
    readonly totalLaps: number,
  ) {
    this.gateHit = new Array(track.gates.length).fill(false);
  }

  /** call at lights-out; lap 1 timing starts here (standing start) */
  go(now: number, startIdx: number, startProgress: number) {
    this.lap = 1;
    this.raceStart = now;
    this.lapStart = now;
    this.prevIdx = startIdx;
    this.prevProgress = startProgress;
    // the grid sits just behind the line, i.e. near the end of the loop
    this.raceDist = startProgress - this.track.length;
  }

  currentLapMs(now: number): number {
    return this.lap > 0 && !this.finished ? now - this.lapStart : 0;
  }

  raceMs(now: number): number {
    return this.lap > 0 ? (this.totalMs ?? now - this.raceStart) : 0;
  }

  wrongWay = false;

  update(
    now: number,
    dt: number,
    idx: number,
    velAlongTrack: number,
    progress: number,
  ) {
    if (this.lap === 0 || this.finished) return;

    // accumulate signed distance along the track (wrap-aware)
    const len = this.track.length;
    let d = progress - this.prevProgress;
    if (d > len / 2) d -= len;
    else if (d < -len / 2) d += len;
    this.raceDist += d;
    this.prevProgress = progress;

    const m = this.track.samples.length;
    const dIdx = (idx - this.prevIdx + m) % m;

    // only advance gates while moving forward through the samples
    if (dIdx > 0 && dIdx < m / 2) {
      for (let k = 1; k <= dIdx; k++) {
        const at = (this.prevIdx + k) % m;
        const g = this.track.gates.indexOf(at);
        if (g > 0) this.gateHit[g] = true;
        if (at === 0) this.onLineCrossed(now);
      }
      this.prevIdx = idx;
    } else if (dIdx >= m / 2) {
      // moving backwards: just track the index, gates stay as they were
      this.prevIdx = idx;
    }

    this.wrongWayFor = velAlongTrack < -3 ? this.wrongWayFor + dt : 0;
    this.wrongWay = this.wrongWayFor > 1.2;
  }

  /** after a reset teleport, re-anchor without granting gates */
  reanchor(idx: number) {
    this.prevIdx = idx;
  }

  private onLineCrossed(now: number) {
    const need = this.gateHit.length - 1; // gate 0 is the line itself
    const got = this.gateHit.filter(Boolean).length;
    if (got < need) return; // cut lap / partial lap: doesn't count

    const lapMs = now - this.lapStart;
    this.lastLapMs = lapMs;
    if (this.bestLapMs === null || lapMs < this.bestLapMs) this.bestLapMs = lapMs;
    this.gateHit.fill(false);

    if (this.lap >= this.totalLaps) {
      this.finished = true;
      this.totalMs = now - this.raceStart;
    } else {
      this.lap++;
      this.lapStart = now;
    }
  }
}
