/**
 * Parsing a TRMNL recipe's user settings out of the polling request.
 *
 * TRMNL stores each user's form values and interpolates them into the polling
 * URL via Liquid, so a request arrives carrying one user's whole board as
 * query parameters. There is no session and nothing persisted on our side —
 * the settings *are* the request.
 *
 * Each card field gets **its own query parameter**: `c1` the station value,
 * `w1` the walk time, `n1` the title, `v1` the visibility toggle. Not JSON —
 * quoting that from a Liquid template is a reliable source of breakage — but
 * not packed into one parameter either.
 *
 * It was packed once, as `station:walkTime:title`, and that was the mistake.
 * The title is free text and sits last, so a colon in it is indistinguishable
 * from a separator; worse, a title that already contained a packed slot got
 * another tail appended on every round trip, and typing a new title appended
 * to the junk instead of replacing it. Four successive fixes each guessed at
 * where the real boundaries were. Separate parameters make the question not
 * arise: the URL encoder handles the escaping, and a title is whatever `n1`
 * says it is.
 *
 * `c1` still carries `type:stopIds` with an optional `!routes`, because those
 * are structured identifiers the picker writes, not free text.
 *
 * The station picker stores its value with the type already on the front
 * (`subway:127+725`), so a polling URL that also writes `{{ cardN_type }}`
 * produces a doubled prefix. Both forms parse — see `parseCard`.
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
  /**
   * Show only these routes, as the rider names them — "7", "S", "A".
   *
   * Empty means every route the stop carries, which is the default and what
   * most cards want. It earns its place at a complex: Times Square is five
   * platform groups and twelve routes on one card, and someone who only
   * rides the 1/2/3 does not want nine other lines competing for the rows.
   */
  routes?: string[];
}

/** A whole board, as one poll describes it. */
export interface BoardSettings {
  cards: CardSettings[];
  /** True when nothing was configured and the demo board stood in. */
  isDemo: boolean;
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

/**
 * Whether a card's visibility toggle says to show it.
 *
 * Separate from `parseBoolean` because the two disagree about "off".
 * `isBlank` counts "off" as unset — that is the station picker's own Off
 * option — so `parseBoolean("off", true)` returns the fallback, `true`.
 * Correct for `h24`; backwards for a flag where "off" is the plainest way
 * to say hidden.
 *
 * Unset really does mean visible, though: an older polling URL sends no
 * `vN` at all, and an empty value is what TRMNL writes for a field a user
 * has never touched. Neither should blank a board that was working.
 */
function parseVisible(value: string | null): boolean {
  if (value === null || value.trim() === "") return true;
  const trimmed = value.trim().toLowerCase();
  return trimmed !== "false" && trimmed !== "0" && trimmed !== "no" && trimmed !== "off";
}

/**
 * A card's custom heading, or "" to fall back to the station's own name.
 *
 * Now that the title has its own query parameter, this is only a guard
 * against values stored while it did not. Those came through packed as
 * `station:walk:title`, so a title could inherit an entire old slot string
 * and arrive as "Vernon Blvd-Jackson Av (7) · Subway:5:test" — the user's
 * "test" with a stale label in front of it.
 *
 * An embedded `:<digits>:` is the old packing's own separator appearing
 * where only a heading belongs, and no MTA station name contains one: they
 * carry slashes, parentheses, periods and middots freely, but never a
 * colon-wrapped number. Everything after the last of them is what was
 * actually typed.
 */
function cardTitle(raw: string): string {
  // Last, not first: a value that round-tripped more than once carries
  // several tails, and only the text after the final one was ever typed.
  const tail = /.*:\d+:/s;
  const typed = tail.test(raw) ? raw.replace(tail, "").trim() : raw.trim();

  // A heading with no letter at all is leftover punctuation, never a name.
  return /\p{L}/u.test(typed) ? typed : "";
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
interface SlotParams {
  /** The picker's stored value: `type:stopIds` with an optional `!routes`. */
  station: string | null;
  walk: string | undefined;
  title: string | undefined;
}

function parseCard(slot: number, params: SlotParams): CardSettings | undefined {
  if (isBlank(params.station)) return undefined;

  // The route filter is split off the *whole* value before anything else.
  //
  // It used to be taken from the segment between the first and second
  // colon, which is where the picker puts the IDs — correct for a current
  // value, and silently wrong for one still carrying a packed
  // ":<walk>:<title>" tail, because the "!routes" then sits in a later
  // segment that nothing looks at. The filter was simply ignored, with no
  // error and a full card to look at. `!` is our own separator and means
  // one thing wherever it appears, so taking it first is both simpler and
  // immune to what follows.
  // In a packed legacy value the filter sits *before* the walk and title
  // ("subway:127!A,C,E:5:Home"), so the list is cut at the first colon and
  // the rest handed back to the positional parse below. In a current value
  // there is nothing after it and the cut is a no-op.
  const bang = params.station!.indexOf("!");
  let stationPart = params.station!;
  let routes: string[] = [];

  if (bang !== -1) {
    const after = params.station!.slice(bang + 1);
    const colon = after.indexOf(":");
    const routeList = colon === -1 ? after : after.slice(0, colon);
    const trailing = colon === -1 ? "" : after.slice(colon);
    stationPart = params.station!.slice(0, bang) + trailing;
    routes = routeList
      .split(",")
      .map((route) => route.trim().toUpperCase())
      .filter(Boolean);
  }

  const parts = stationPart.split(":");

  // The picker's stored value already begins with the transit type, so a
  // polling URL that writes `{{ cardN_type }}:{{ cardN_station }}` yields
  // "subway:subway:127+725". Dropping the duplicate keeps both that and a
  // hand-written form working.
  if (parts.length > 1 && parseTransitType(parts[0]) && parseTransitType(parts[1])) {
    parts.shift();
  }

  // A legacy packed value carries ":<walk>:<title>" here. Those fields have
  // their own parameters now, so anything past the IDs is ignored — see the
  // module comment for why the packed form existed and what it cost.
  const [type = "", ids = "", packedWalk = "", ...packedTitle] = parts;
  const transitType = parseTransitType(type);
  if (!transitType) return undefined;

  // A legacy "@<name>" may still be in a value stored before the picker
  // dropped it. Split it off and discard it: the board builder names bus
  // stops from the dataset now, and every other network from its own tables.
  const [idList = ""] = ids.split("@");

  // A card's IDs are "+"-joined: a subway complex or a bus corner is several.
  //
  // Split on whitespace too. A query string decodes a literal "+" as a space,
  // and whether TRMNL percent-encodes the stored value when it interpolates
  // it into the polling URL is not under our control — so "127+725" may
  // arrive as "127 725". Accepting both means a multi-ID station cannot
  // silently collapse into one unusable id.
  const stopIds = idList
    .split(/[+\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (stopIds.length === 0) return undefined;

  // Both read from their own parameters. The packed value is consulted only
  // when the parameter is absent, which means an old polling URL — a user
  // who has not re-saved the plugin since the URL changed shape.
  const title = cardTitle(params.title ?? packedTitle.join(":"));
  const walk = parseNumber(params.walk ?? packedWalk, DEFAULT_WALK_TIME);

  return {
    slot,
    transitType,
    stopIds,
    walkTime: walk,
    title: title === "" ? undefined : title,
    routes: routes.length > 0 ? routes : undefined,
  };
}

/**
 * The board a plugin shows before anyone has configured it.
 *
 * Two problems, one answer. A new installer would otherwise see a blank panel
 * and have to guess that the fault is their own empty form. And the public
 * recipe page renders a preview from whatever the author's own instance holds,
 * which would publish the author's home stations to everyone browsing the
 * directory.
 *
 * So an unconfigured board shows a demonstration instead: three well-known
 * Manhattan stations nobody lives at, exercising all three transit types, with
 * walk times that make the filtering visible. It is real live data — the
 * stations exist and the feeds are current — so the preview shows what the
 * plugin genuinely does rather than a mock-up of it.
 */
export const DEMO_CARDS: CardSettings[] = [
  {
    slot: 1,
    transitType: "subway",
    // Times Square, all five platform groups, as the picker would supply them.
    stopIds: ["127", "725", "902", "A27", "R16"],
    walkTime: 5,
    title: "Times Sq-42 St",
  },
  {
    slot: 2,
    transitType: "subway",
    // The same complex narrowed to one platform group, which is how a rider
    // splits a station carrying twelve routes into something readable. Shown
    // beneath the full card so the preview demonstrates the difference.
    stopIds: ["R16"],
    walkTime: 5,
    routes: ["N", "Q", "R", "W"],
    title: "Times Sq N/Q/R/W",
  },
  {
    slot: 3,
    transitType: "railroad-lirr",
    // Jamaica, not Penn Station. At a terminal most trains run to their
    // branch's namesake, so badge and destination repeat on three rows in
    // four — "Ronkonkoma | Ronkonkoma" — and the card reads as a column of
    // the same word twice. Jamaica is the LIRR's hub, where nearly every
    // train passes through: 10 branches, 13 destinations, and trains in
    // both directions, which is what the Metro-North card beside it shows.
    stopIds: ["102"],
    walkTime: 10,
    title: "Jamaica",
  },
  {
    slot: 4,
    transitType: "bus",
    // Both sides of the street. A bus stop ID is one direction, so a corner
    // takes two — the single thing about bus cards a new installer most
    // needs to see, and the preview can show it for free.
    stopIds: ["403257", "403465"],
    walkTime: 5,
    title: "W 42 St/5 Av",
  },
  {
    slot: 5,
    transitType: "railroad-mtn",
    stopIds: ["1"], // Grand Central
    walkTime: 10,
    title: "Grand Central",
  },
  {
    slot: 6,
    transitType: "ferry",
    stopIds: ["87"], // Wall St/Pier 11, the busiest landing
    walkTime: 5,
    title: "Wall St/Pier 11",
  },
];

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
    // The visibility toggle is decided here rather than in the Liquid guard
    // that writes `c<slot>`. Liquid's truthiness made that unreliable: only
    // `nil` and `false` are falsy there, so a checkbox arriving as the
    // *string* "false" is truthy and `{% if cardN_visible %}` hides nothing.
    // Which of those TRMNL stores for an unticked box is not documented and
    // not testable from here, so the template passes the raw value through
    // and `parseVisible` — which accepts every spelling and is under test —
    // decides.
    if (!parseVisible(params.get(`v${slot}`))) continue;

    const card = parseCard(slot, {
      station: params.get(`c${slot}`),
      walk: params.get(`w${slot}`) ?? undefined,
      title: params.get(`n${slot}`) ?? undefined,
    });
    if (card) cards.push(card);
  }

  return {
    // An unconfigured board demonstrates itself rather than rendering blank.
    cards: cards.length > 0 ? cards : DEMO_CARDS,
    isDemo: cards.length === 0,
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
