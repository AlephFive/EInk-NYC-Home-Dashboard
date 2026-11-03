/**
 * Parsing a board from a JSON polling body.
 *
 * TRMNL can POST a Liquid-rendered body instead of interpolating a query
 * string, and this reads that body. It exists because the query-string
 * format has been the single largest source of defects in this project:
 *
 * - `Bus:6:` parsed as a bus stop called "6" and rendered a dead card
 * - a packed `:<walk>:<title>` tail reached the panel as a heading of ":5:"
 * - a display name smuggled beside the ID arrived as "… · Subway"
 * - a route filter was silently ignored when it sat past a tail
 * - a tail hiding behind the filter rendered a badge reading "ACE:5:"
 *
 * Every one is a positional-grammar ambiguity: the parser had to infer
 * which field it was looking at from where a separator fell, and a station
 * name can contain every separator. A JSON object has no positions. A
 * field is whatever its key says it is, and a value containing a colon,
 * an "@" or a middot is just a string.
 *
 * **The plugin does not use this yet, and the reason is TRMNL's Liquid.**
 * A JSON body has to escape its values, and the filters are not there:
 *
 *   `| json`     does not exist — it renders *nothing*, silently
 *   `| jsonify`  exists but does not escape: `a"b\c` comes back unchanged
 *   `| escape`   HTML-escapes, so a quote becomes `&quot;` in the JSON
 *
 * Probed against the real engine through `trmnlp build`, not assumed. So a
 * station or title containing a double quote breaks the document, and the
 * board falls back to the demo — a worse failure than any the flat format
 * has, because it takes out every card at once.
 *
 * The endpoint accepts POST regardless, so this is reachable today by a
 * hand-made request and is where the plugin should go the moment a usable
 * escape exists. Two routes out: ask TRMNL to add a real `json` filter, or
 * build the escaping out of `replace` in the template, which is the same
 * class of hand-rolled rule this was meant to escape and wants measuring
 * before it is trusted.
 */

import {
  DEFAULT_DESTINATION_SCALE,
  DEFAULT_FETCH_DEPARTURES,
  DEFAULT_URGENT_THRESHOLD,
  DEFAULT_WALK_TIME,
  DEMO_CARDS,
  MAX_SLOTS,
  clampDestinationScale,
  parseTransitType,
  type BoardSettings,
  type CardSettings,
} from "./settings";
import { valueFromLabel } from "./pickers";

/** One card as the polling body describes it. Every field optional. */
interface JsonCard {
  station?: unknown;
  routes?: unknown;
  walk?: unknown;
  title?: unknown;
  visible?: unknown;
}

interface JsonBoard {
  cards?: unknown;
  use24Hour?: unknown;
  urgent?: unknown;
  destinationScale?: unknown;
  showLeaveIn?: unknown;
  fetchDepartures?: unknown;
}

/** A value TRMNL may render as a real boolean, a string, or nothing. */
function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const text = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

/**
 * Liquid writes numbers unquoted, but a form field can arrive as a string.
 *
 * Absent and empty are checked before converting. `Number("")` is 0, not
 * NaN — so a missing walk time came back as 0 rather than the default,
 * and a missing scale clamped to 0.7. The test for "an absent field takes
 * the default" is what caught it.
 */
function asNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;

  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One card, or undefined when the entry names no stop.
 *
 * `station` is still `type:ids` — a single opaque token the picker writes
 * and nothing else parses out of position. Splitting it is the one piece
 * of string handling left, and it cannot be ambiguous: the type is a
 * closed set and everything after the first colon is the ID list.
 */
function parseCard(slot: number, entry: JsonCard): CardSettings | undefined {
  const raw = asText(entry.station);
  if (raw === "") return undefined;

  // TRMNL stores an xhrSelectSearch value as `id::label`, so what arrives
  // is "subway:117::116 St-Columbia University (1) · Subway". Everything
  // from "::" on is the display text the dropdown showed, and keeping it
  // put the whole label inside the stop ID list — the card then resolved
  // to nothing and the board fell back to the demo.
  //
  // Cut there rather than at the last colon: a label can contain colons,
  // and an id never contains "::".
  const stored = raw.split("::")[0]!.trim();

  // Older values are the bare label with no id in front — the form reads
  // correctly while the Worker gets prose — so that is recovered too.
  const station = valueFromLabel(stored) ?? stored;

  const colon = station.indexOf(":");
  if (colon === -1) return undefined;

  const transitType = parseTransitType(station.slice(0, colon));
  if (!transitType) return undefined;

  const stopIds = station
    .slice(colon + 1)
    .split(/[+\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (stopIds.length === 0) return undefined;

  // Routes are their own field now, so a filter cannot be lost by sitting
  // in the wrong place — the failure that made "!A,C,E" a no-op whenever a
  // legacy tail followed it.
  const routes = asText(entry.routes)
    .split(",")
    .map((route) => route.trim().toUpperCase())
    .filter(Boolean);

  const title = asText(entry.title);

  return {
    slot,
    transitType,
    stopIds,
    walkTime: asNumber(entry.walk, DEFAULT_WALK_TIME),
    title: title === "" ? undefined : title,
    routes: routes.length > 0 ? routes : undefined,
  };
}

/**
 * Read a board from a parsed JSON body.
 *
 * Never throws. A malformed body yields the demo board, the same as an
 * empty one — an unattended panel must render something.
 */
export function boardFromJson(body: unknown): BoardSettings {
  const board = (body ?? {}) as JsonBoard;
  const entries = Array.isArray(board.cards) ? board.cards : [];

  const cards: CardSettings[] = [];
  /** Parsed but hidden, kept in case every card was — see below. */
  const hidden: CardSettings[] = [];

  entries.slice(0, MAX_SLOTS).forEach((entry, index) => {
    const card = parseCard(index + 1, (entry ?? {}) as JsonCard);
    if (!card) return;
    if (asBoolean((entry as JsonCard).visible, true)) cards.push(card);
    else hidden.push(card);
  });

  // Every configured card hidden is not a board anyone built on purpose:
  // TRMNL sends an explicit false for a checkbox never touched, whatever
  // the field's declared default. Hiding some cards is honoured; hiding
  // all of them cannot be told apart from the untouched state.
  if (cards.length === 0 && hidden.length > 0) cards.push(...hidden);

  return {
    cards: cards.length > 0 ? cards : DEMO_CARDS,
    isDemo: cards.length === 0,
    use24HourTime: asBoolean(board.use24Hour, true),
    urgentThresholdMinutes: asNumber(board.urgent, DEFAULT_URGENT_THRESHOLD),
    destinationScale: clampDestinationScale(
      asNumber(board.destinationScale, DEFAULT_DESTINATION_SCALE)
    ),
    showLeaveIn: asBoolean(board.showLeaveIn, false),
    fetchDepartures: asNumber(board.fetchDepartures, DEFAULT_FETCH_DEPARTURES),
  };
}
