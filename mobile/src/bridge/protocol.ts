import { z } from "zod";

import {
  type activitySummary,
  exportId,
  NATIVE_TO_WEB_MESSAGES,
  type routeRecord,
  type trackPoint,
  uuid,
  WEB_TO_NATIVE_MESSAGES,
} from "./messages.js";

export { EXPORT_CHUNK_BYTES, EXPORT_MAX_FILES, TRACK_CHUNK_POINTS } from "./messages.js";

const webToNativeSchema = z.union(Object.values(WEB_TO_NATIVE_MESSAGES).flat());
const nativeToWebSchema = z.union(Object.values(NATIVE_TO_WEB_MESSAGES).flat());

export const ORIGIN = "https://crossfog.madera.codes/";

export type WebToNative = z.infer<typeof webToNativeSchema>;
export type NativeToWeb = z.infer<typeof nativeToWebSchema>;
export type ChunkMessage = Extract<NativeToWeb, { type: "chunk" }>;
export type RouteRecord = z.infer<typeof routeRecord>;
export type ActivitySummary = z.infer<typeof activitySummary>;
export type TrackPoint = z.infer<typeof trackPoint>;
export type ExportChunk = Omit<Extract<WebToNative, { type: "exportBinary" }>, "v" | "type">;
export type ExportState = Extract<NativeToWeb, { type: "exportStatus" }>["state"];

export function encode(msg: WebToNative | NativeToWeb): string {
  return JSON.stringify(msg);
}

export type TrackUnavailableReason = Extract<NativeToWeb, { type: "trackUnavailable" }>["reason"];

/** Why a message with no known type was dropped. A tag only, never a value from the message. */
type DropReason = "json" | "not-object" | "unknown-type";

// `paths` is where the message broke the schema, as dotted keys; never a value.
interface DropPaths {
  readonly paths: readonly string[];
}

// The page-to-app types a dropped message is answered for, because the page waits on them. One list: the
// DroppedMessage variants below, describeDrop's cases and reportDropped's cases are each checked against it.
export const ANSWERABLE_TYPES = [
  "sendRoute",
  "exportBinary",
  "needTrack",
  "deleteActivity",
] as const;
export type AnswerableType = (typeof ANSWERABLE_TYPES)[number];

// Each id is set only when that id is itself valid, so the page is never answered about an id nobody checked.
export type DroppedMessage =
  // An unknown type is any text the page wrote, so it is not repeated: `reason` says what was unreadable.
  | { readonly type: null; readonly reason: DropReason; readonly paths: readonly [] }
  | (DropPaths & { readonly type: "sendRoute"; readonly routeId: string | null })
  | (DropPaths & { readonly type: "exportBinary"; readonly exportId: string | null })
  | (DropPaths & { readonly type: "needTrack"; readonly activityId: string | null })
  | (DropPaths & { readonly type: "deleteActivity"; readonly activityId: string | null })
  | (DropPaths & {
      readonly type: Exclude<WebToNative["type"], AnswerableType>;
    });

export type WebToNativeParse = { ok: true; msg: WebToNative } | { ok: false; drop: DroppedMessage };

const MAX_DROP_PATHS = 10;

function unnamed(reason: DropReason): DroppedMessage {
  return { type: null, reason, paths: [] };
}

function issuePaths(issues: readonly z.core.$ZodIssue[]): string[] {
  const paths = issues.map((i) => (i.path.length > 0 ? i.path.map(String).join(".") : "(message)"));
  return [...new Set(paths)].slice(0, MAX_DROP_PATHS);
}

const typeMismatched = (issues: readonly z.core.$ZodIssue[]) =>
  issues.some((i) => i.path[0] === "type");

// Zod hands back the issues of the one branch that got past its literals, or else an invalid_union
// with an issue list per branch: then a branch whose `type` matched is the message's own, and the one
// with the fewest issues is the closest it came, as one type can have several branches.
function describeDrop(data: unknown, error: z.ZodError): DroppedMessage {
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return unnamed("not-object");
  let own: readonly z.core.$ZodIssue[] | null = null;
  const [first] = error.issues;
  if (error.issues.length === 1 && first?.code === "invalid_union" && first.path.length === 0) {
    for (const branch of first.errors) {
      if (typeMismatched(branch)) continue;
      if (own === null || branch.length < own.length) own = branch;
    }
  } else if (!typeMismatched(error.issues)) {
    own = error.issues;
  }
  if (own === null) return unnamed("unknown-type");
  const obj = data as {
    type: WebToNative["type"];
    route?: unknown;
    exportId?: unknown;
    activityId?: unknown;
  };
  const paths = issuePaths(own);
  switch (obj.type) {
    case "sendRoute": {
      const route = obj.route;
      const id =
        typeof route === "object" && route !== null
          ? uuid.safeParse((route as { id?: unknown }).id)
          : null;
      return { type: "sendRoute", paths, routeId: id?.success ? id.data : null };
    }
    case "exportBinary": {
      const id = exportId.safeParse(obj.exportId);
      return { type: "exportBinary", paths, exportId: id.success ? id.data : null };
    }
    case "needTrack":
    case "deleteActivity": {
      const id = uuid.safeParse(obj.activityId);
      return { type: obj.type, paths, activityId: id.success ? id.data : null };
    }
    default: {
      // Fails to compile when ANSWERABLE_TYPES names a type with no case above.
      const unanswered: Exclude<WebToNative["type"], AnswerableType> = obj.type;
      return { type: unanswered, paths };
    }
  }
}

export function inspectWebToNative(raw: string): WebToNativeParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, drop: unnamed("json") };
  }
  const result = webToNativeSchema.safeParse(data);
  return result.success
    ? { ok: true, msg: result.data }
    : { ok: false, drop: describeDrop(data, result.error) };
}

export function parseNativeToWeb(raw: string): NativeToWeb | null {
  try {
    const result = nativeToWebSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// Android WebView reports the baseUrl without its trailing slash in onMessage events.
export function isTrustedSource(url: string): boolean {
  return (
    url === ORIGIN ||
    url === ORIGIN.slice(0, -1) ||
    (url.startsWith(ORIGIN) && (url[ORIGIN.length] === "#" || url[ORIGIN.length] === "?"))
  );
}
