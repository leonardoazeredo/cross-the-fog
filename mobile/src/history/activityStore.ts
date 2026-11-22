import type { SqlDriver } from "../db/driver.js";
import { deflateGpx, inflateGpx } from "./gpxBlob.js";
import type { ActivityDetail, ActivityStore, ActivitySummary } from "./types.js";

interface Row {
  id: string;
  started_at: string;
  ended_at: string;
  route_id: string | null;
  /** A TEXT value is a GPX that migration 2 could not deflate and kept as it was. */
  gpx_deflated: Uint8Array | string;
  track_json: string;
  stats_json: string;
  received_at: string;
  encoder_version: string;
}

const SUMMARY_COLUMNS = "id, started_at, ended_at, route_id, stats_json";

function toSummary(
  r: Pick<Row, "id" | "started_at" | "ended_at" | "route_id" | "stats_json">,
): ActivitySummary {
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    ...(r.route_id === null ? {} : { routeId: r.route_id }),
    stats: JSON.parse(r.stats_json),
  };
}

export function createActivityStore(db: SqlDriver): ActivityStore {
  return {
    async add(a) {
      const { changes } = await db.run(
        `INSERT INTO activities
           (id, started_at, ended_at, route_id, gpx_deflated, track_json, stats_json, received_at, encoder_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          a.id,
          a.startedAt,
          a.endedAt,
          a.routeId ?? null,
          deflateGpx(a.gpx),
          JSON.stringify(a.track),
          JSON.stringify(a.stats),
          a.receivedAt,
          a.encoderVersion,
        ],
      );
      return { stored: changes > 0 };
    },

    async list() {
      // julianday, not the text: ISO strings with and without fractional seconds do not sort as text.
      const rows = await db.all<Row>(
        `SELECT ${SUMMARY_COLUMNS} FROM activities ORDER BY julianday(started_at) DESC, id DESC`,
      );
      return rows.map(toSummary);
    },

    async get(id) {
      const [r] = await db.all<Omit<Row, "gpx_deflated">>(
        `SELECT ${SUMMARY_COLUMNS}, track_json, received_at, encoder_version FROM activities WHERE id = ?`,
        [id],
      );
      if (!r) return null;
      const detail: ActivityDetail = {
        ...toSummary(r),
        track: JSON.parse(r.track_json),
        receivedAt: r.received_at,
        encoderVersion: r.encoder_version,
      };
      return detail;
    },

    async gpx(id) {
      const [r] = await db.all<Pick<Row, "gpx_deflated">>(
        "SELECT gpx_deflated FROM activities WHERE id = ?",
        [id],
      );
      if (!r) return null;
      return typeof r.gpx_deflated === "string" ? r.gpx_deflated : inflateGpx(r.gpx_deflated);
    },

    async delete(id) {
      const { changes } = await db.run("DELETE FROM activities WHERE id = ?", [id]);
      return changes > 0;
    },
  };
}
