/**
 * Parsing a TRMNL recipe's user settings out of the polling request.
 *
 * TRMNL stores each user's form values and interpolates them into the polling
 * URL via Liquid, so a request arrives carrying one user's whole board as
 * query parameters. There is no session and nothing persisted on our side —
 * the settings *are* the request.
 *
 * Card slots are encoded one parameter each, `c1`..`c6`, as
 * `type:stopIds:walkTime:title`. A flat string rather than JSON because it has
 * to survive being written into a URL by a Liquid template, where quoting JSON
 * is a reliable source of breakage.
 */

/** Transit types a slot may select, matching the dashboard's own union. */
export const TRANSIT_TYPES = [
  "subway",
  "railroad-lirr",
  "railroad-mtn",
  "bus",
  "ferry",
] as const;

export type TransitType = (typeof TRANSIT_TYPES)[number];

/** One configured card. */
export interface CardSettings {
  /** 1-based slot, which fixes the card's place in the 3x2 grid. */
  slot: number;
  transitType: TransitType;
  /** Every stop ID this card merges — a complex or a bus corner has several. */
  stopIds: string[];
  /** Minutes to reach the stop. Departures inside it are dropped. */
  walkTime: number;
  /** Overrides the station name as the card heading. */
  title?: string;
}

/** A whole board, as one poll describes it. */
export interface BoardSettings {
  cards: CardSettings[];
  use24HourTime: boolean;
  urgentThresholdMinutes: number;
  showLeaveIn: boolean;
  /** Departures to request per stop, for the feeds that take a limit. */
  fetchDepartures: number;
}

const MAX_SLOTS = 6;
const DEFAULT_WALK_TIME = 5;
const DEFAULT_URGENT_THRESHOLD = 10;
const DEFAULT_FETCH_DEPARTURES = 8;

/** Treat TRMNL's unset/off values as absent rather than as content. */
function isBlank(value: string | null): boolean {
  if (value === null) return true;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" || trimmed === "off" || trimmed === "none";
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (isBlank(value)) return fallback;
  const trimmed = value!.trim().toLowerCase();
  return trimmed === "true" || trimmed === "1" || trimmed === "yes";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseTransitType(value: string): TransitType | undefined {
  const normalised = value.trim().toLowerCase();
  // The form shows friendly names; map them to the internal union rather than
  // making users' stored settings depend on our type spelling.
  const aliases: Record<string, TransitType> = {
    subway: "subway",
    lirr: "railroad-lirr",
    "railroad-lirr": "railroad-lirr",
    "metro-north": "railroad-mtn",
    mtn: "railroad-mtn",
    "railroad-mtn": "railroad-mtn",
    bus: "bus",
    ferry: "ferry",
  };
  return aliases[normalised];
}

/**
 * Parse one `cN` parameter.
 *
 * @returns The card, or undefined when the slot is off or unparseable. A bad
 *   slot is skipped rather than failing the whole board — one misconfigured
 *   card should not blank the panel, which is the same rule the dashboard
 *   applies to a failing feed.
 */
function parseCard(slot: number, raw: string | null): CardSettings | undefined {
  if (isBlank(raw)) return undefined;

  // Split into at most 4 so a title containing ":" survives intact.
  const [type = "", ids = "", walk = "", ...titleParts] = raw!.split(":");
  const transitType = parseTransitType(type);
  if (!transitType) return undefined;

  // The picker may append "@<name>" to the ID list, carrying a display name
  // the server has no table for — bus stops, where `route_info.json` covers
  // only hand-added entries. An explicit title still wins over it.
  const [idList = "", pickedName = ""] = ids.split("@");

  // A card's IDs are "+"-joined: a subway complex or a bus corner is several.
  const stopIds = idList
    .split("+")
    .map((id) => id.trim())
    .filter(Boolean);
  if (stopIds.length === 0) return undefined;

  const title = titleParts.join(":").trim() || pickedName.trim();

  return {
    slot,
    transitType,
    stopIds,
    walkTime: parseNumber(walk, DEFAULT_WALK_TIME),
    title: title === "" ? undefined : title,
  };
}

/**
 * Read a board out of a polling request's query string.
 *
 * Never throws: an empty or malformed request yields a board with no cards,
 * which renders as an empty panel rather than an error. The recipe is
 * unattended, so refusing to render is worse than rendering nothing.
 */
export function parseBoardSettings(url: URL): BoardSettings {
  const params = url.searchParams;
  const cards: CardSettings[] = [];

  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const card = parseCard(slot, params.get(`c${slot}`));
    if (card) cards.push(card);
  }

  return {
    cards,
    use24HourTime: parseBoolean(params.get("h24"), true),
    urgentThresholdMinutes: parseNumber(
      params.get("urgent") ?? undefined,
      DEFAULT_URGENT_THRESHOLD
    ),
    showLeaveIn: parseBoolean(params.get("leavein"), false),
    fetchDepartures: parseNumber(
      params.get("fetch") ?? undefined,
      DEFAULT_FETCH_DEPARTURES
    ),
  };
}
