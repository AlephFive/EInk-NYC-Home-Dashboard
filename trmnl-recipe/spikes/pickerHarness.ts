/** Phase 1, step 4 — exercise the picker endpoints off-Worker. */
import { searchStations } from "../src/pickers";

const show = (label: string, opts: Record<string, string>[]) => {
  console.log(`\n--- ${label} (${opts.length}) ---`);
  for (const o of opts.slice(0, 8)) {
    const [k, v] = Object.entries(o)[0];
    console.log(`  ${k.padEnd(48)} -> ${v}`);
  }
  if (opts.length > 8) console.log(`  ...and ${opts.length - 8} more`);
};

show('subway "times sq" (complex must collapse to ONE option)', await searchStations("subway", "times sq"));
show('subway "port authority" (must find the Times Sq complex)', await searchStations("subway", "port authority"));
show('subway "vernon"', await searchStations("subway", "vernon"));
show('subway "coney" (one ID, four lines)', await searchStations("subway", "coney"));
show('lirr "grand central"', await searchStations("lirr", "grand central"));
show('mtn "grand central" (different ID from LIRR)', await searchStations("mtn", "grand central"));
show('bus "borden" (live, valid_to filtered)', await searchStations("bus", "borden"));
show('bus "b" (too short, must be empty)', await searchStations("bus", "b"));
