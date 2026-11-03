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
 * **Escaping is `| json`, and the station arrives already split.**
 *
 * An earlier pass concluded the filter did not exist and fell back to
 * stripping quotes with `replace`. That was wrong: the probe wrote
 * `| json` into an HTML attribute, where the quotes were mangled, and the
 * empty result read as a missing filter. Tested properly it quotes,
 * escapes and handles empty strings — `say "hi" ok` renders as
 * `"say \"hi\" ok"` and survives the round trip intact.
 *
 * With real escaping available the template can do the splitting instead
 * of the Worker. A card's station arrives as
 * `{"type": "subway", "ids": ["127", "725"]}`, built in Liquid from the
 * readable value TRMNL stores, every part escaped. Verified against a
 * deliberately hostile value — `subway:1"}],"x":"y` — which escaped to a
 * string and left the rest of the document intact rather than injecting
 * into it.
 *
 * That is what ends the class of bug this project kept hitting: a card
 * called "Bus:6:", a heading reading ":5:", "· Subway" smuggled through
 * an @name, a route filter ignored for sitting past a tail, a badge
 * reading "ACE:5:", and a whole board falling back to the demo because
 * TRMNL stores `id::label` and the parser split on the first colon. Every
 * one was the Worker inferring a field from where a separator fell.
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
  type TransitType,
} from "./settings";
import { valueFromLabel } from "./pickers";

/** A station as the body describes it: already split into its parts. */
interface JsonStation {
  type?: unknown;
  ids?: unknown;
}

/** One card as the polling body describes it. Every field optional. */
interface JsonCard {
  /**
   * An object, or a string for a body written before the split moved into
   * the template.
   */
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
 * The transit type and stop IDs a card names.
 *
 * The body sends these already separated, because the template splits
 * them — `{% assign p = station | split: ":" %}` — and `| json` escapes
 * each part. That is the whole point of the object form: the Worker reads
 * two named fields instead of inferring them from where separators fall
 * in a string, which is what produced most of this project's defects.
 *
 * A string is still accepted, for a body rendered by a polling template
 * that has not been re-saved. It carries TRMNL's own `id::label` storage
 * (everything from "::" on is the dropdown's display text) and, for the
 * oldest values, no id at all — just the label, which `valueFromLabel`
 * resolves against the bundled tables.
 */
function readStation(value: unknown): {
  transitType: TransitType | undefined;
  stopIds: string[];
} {
  const none = { transitType: undefined, stopIds: [] };

  if (value && typeof value === "object") {
    const station = value as JsonStation;
    const transitType = parseTransitType(asText(station.type));
    const ids = Array.isArray(station.ids) ? station.ids : [];

    return {
      transitType,
      // Split on "+" and whitespace even here: a body written before the
      // template did the splitting sends one joined string in the array.
      stopIds: ids
        .flatMap((id) => asText(id).split(/[+\s]+/))
        .map((id) => id.trim())
        .filter(Boolean),
    };
  }

  const raw = asText(value);
  if (raw === "") return none;

  const stored = raw.split("::")[0]!.trim();
  const station = valueFromLabel(stored) ?? stored;

  const colon = station.indexOf(":");
  if (colon === -1) return none;

  const transitType = parseTransitType(station.slice(0, colon));
  if (!transitType) return none;

  return {
    transitType,
    stopIds: station
      .slice(colon + 1)
      .split(/[+\s]+/)
      .map((id) => id.trim())
      .filter(Boolean),
  };
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
  const { transitType, stopIds } = readStation(entry.station);
  if (!transitType || stopIds.length === 0) return undefined;

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
