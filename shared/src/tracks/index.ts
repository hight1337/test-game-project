import monza from "./monza.json";
import spa from "./spa.json";
import silverstone from "./silverstone.json";
import suzuka from "./suzuka.json";
import interlagos from "./interlagos.json";

export interface TrackData {
  id: string;
  name: string;
  country: string;
  /** [x, y, widthRight, widthLeft] in meters along the centerline, closed loop */
  points: [number, number, number, number][];
}

export const TRACKS: TrackData[] = [
  monza,
  spa,
  silverstone,
  suzuka,
  interlagos,
] as TrackData[];

export const TRACK_MAP: Record<string, TrackData> = Object.fromEntries(
  TRACKS.map((t) => [t.id, t]),
);

export const DEFAULT_TRACK_ID = "monza";
