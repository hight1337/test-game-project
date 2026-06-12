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

export const COUNTDOWN_MS = 3200;
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
