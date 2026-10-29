import { FeedMessage } from "../EInk-NYC-Home-Dashboard/src/protocol/proto/generated/gtfs-realtime.ts";
const urls = {
  tripupdate: "http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate",
  vehicleposition: "http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition",
};
for (const [name, url] of Object.entries(urls)) {
  const r = await fetch(url);
  const buf = new Uint8Array(await r.arrayBuffer());
  try {
    const f = FeedMessage.decode(buf);
    const ts = f.header?.timestamp ? new Date(Number(f.header.timestamp)*1000).toISOString() : "none";
    console.log(`${name.padEnd(16)} ${buf.length}b  entities=${f.entity.length}  header.ts=${ts}  version=${f.header?.gtfsRealtimeVersion}`);
  } catch (e) {
    console.log(`${name.padEnd(16)} ${buf.length}b  DECODE FAILED: ${(e as Error).message}`);
  }
}
console.log("\nlocal time now:", new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));
