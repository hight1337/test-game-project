export const DEFAULT_PORT = 8090;

/**
 * How often each client sends its own car state to the server. Matches the
 * broadcast rate — a slower send rate makes the server re-broadcast stale
 * positions, which renders as stutter on other screens.
 */
export const NET_SEND_HZ = 20;
/** How often the server broadcasts all car states to a room. */
export const NET_BROADCAST_HZ = 20;
/** Render delay for remote cars (interpolation buffer). */
export const INTERP_DELAY_MS = 120;

/** grid-prep window before the start lights begin */
export const PREP_MS = 10_000;
/** the 5 red lights come on across this window */
export const LIGHTS_MS = 4000;
/** random hold after all 5 lights are lit, before lights-out (F1-style) */
export const GO_HOLD_MIN_MS = 600;
export const GO_HOLD_MAX_MS = 3000;
export const DEFAULT_LAPS = 3;
export const MIN_LAPS = 1;
export const MAX_LAPS = 10;
export const MAX_PLAYERS = 12;
/** Race ends for everyone this long after the first player finishes. */
export const FINISH_TIMEOUT_MS = 60_000;

export const CAR_COLORS = [
  "#e10600", // Ferrari red
  "#00d2be", // Mercedes teal
  "#ff8700", // McLaren orange
  "#3671c6", // Red Bull blue
  "#229971", // Aston green
  "#ff87bc", // Alpine pink
  "#fff200", // yellow
  "#b0b0b0", // silver
  "#7b2ff2", // violet
  "#00a3e0", // light blue
  "#9acd32", // lime
  "#ff5e00", // deep orange
];
