# Email to team@trmnl.com

Fill the two bracketed spots — the video link, and the screenshot line if
you attach stills. Everything else is final.

---

**Subject:** Plugin submission — NYC Transit Board (524413)

Hi,

I'd like to submit **NYC Transit Board** for the plugin store.

- **Plugin id:** 524413
- **Owner:** spo2.spire.club@gmail.com
- **Installation video:** [LINK]
- **Setup guide:** https://brian.ma/nyc-transit-board/
- **Source:** https://github.com/AlephFive/nyc-transit-board

**What it does.** A live departure board for New York City transit, filtered
by how long it takes you to walk to the stop. You pick up to six stations
across subway, Long Island Rail Road, Metro-North, MTA bus and NYC Ferry,
and set a walk time for each. Departures you couldn't physically reach are
hidden, so every row on the panel is something you can still catch if you
leave now.

That filter is the reason the plugin exists. The MTA's own apps show you
everything, including the train pulling out of the station as you read
about it. A wall panel you glance at on the way out the door wants the
opposite: only the departures that are still real.

**Why it needs a server.** The plugin polls a Cloudflare Worker rather than
the MTA directly, for three reasons that don't have a template-side
workaround. The subway and railroad feeds are GTFS-realtime protobuf, which
Liquid can't decode. Merging up to six stations, filtering each by walk
time and capping rows per card is computation rather than templating. And
the bus SIRI feed requires an API key, which can't live in markup the user
can read.

The Worker is stateless — no database, no stored user settings. Each
request carries its board configuration in the POST body, is answered from
the MTA feeds, and is forgotten. **No credentials are needed to review it**:
the MTA key is mine and stays server-side, so installing the plugin and
picking stations is the whole setup.

**Notes for review.** Refresh is 15 minutes, which is also why the board
shows clock times instead of a countdown — "leaves in 6 min" is stale by up
to the refresh interval, while "16:42" stays true. Layouts are provided for
the full screen and for half and quarter mashup cells, each designed for
the space it gets rather than scaled down. A station whose feed fails shows
that in its own card while the rest of the board keeps working, and an
empty card means the feed had nothing rather than that something broke —
there's no fallback to a printed timetable.

Happy to make changes if anything doesn't fit the store's expectations.

Thanks,
Shao-en Ma

---

## If they ask for more

**Data sources.** MTA GTFS-realtime (subway, LIRR, Metro-North), MTA Bus
Time SIRI, NYC Ferry GTFS-realtime via Connexionz, and NY Open Data's bus
stop list for naming and for checking a stop is still in service. Static
station tables are bundled at build time.

**One thing that looks wrong and isn't.** The NYC Ferry feed is fetched over
HTTP, not HTTPS — Connexionz publishes no TLS endpoint for it. Only public
sailing times cross that connection, and nothing is sent to it. Every other
feed is HTTPS.

**Upstream load.** One request per panel per refresh. Feeds are fetched per
transit type and deduplicated, so a six-card board is a handful of upstream
requests rather than thirty.

**Attribution.** The listing states it isn't affiliated with the MTA. No
MTA branding or logos are used; the route bullets are drawn from the
station tables, and the panel is 1-bit so no line colours are reproduced.

**Tests.** 353 passing, run against captured feed fixtures rather than live
network calls (`npm test` in `trmnl-recipe/`).
