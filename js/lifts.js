// A station's elevators and escalators, and which are out of service, from
// the railroads that publish them:
//   - MBTA: every elevator and escalator at the station (its facilities),
//     and its outage alerts, which name the one that's out
//   - LIRR: the elevators and escalators to the LIRR at the five stations it
//     shares with the subway, from the MTA's elevator and escalator feeds
//     (the rest of the LIRR and Metro-North aren't in them)
//   - SEPTA: outages only (its feed lists what's out, not what's working),
//     through the relay
// Returns { lifts: [{ kind, name, out, since, until, note }], outagesOnly,
// source } or null when none of the station's railroads publishes them.

const CACHE_MS = 2 * 60 * 1000;
const cache = new Map(); // url -> { at, data }
async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

const norm = (s) => String(s || "").toLowerCase().replace(/\b(station|sta|st|street)\b/g, "").replace(/[^a-z0-9]/g, "");

async function mbtaLifts(placeId) {
  const [fac, alerts] = await Promise.all([
    getJson(`https://api-v3.mbta.com/facilities?filter%5Bstop%5D=${encodeURIComponent(placeId)}&filter%5Btype%5D=ELEVATOR,ESCALATOR`),
    // Outage alerts only come with these activities (the default leaves them out).
    getJson(`https://api-v3.mbta.com/alerts?filter%5Bstop%5D=${encodeURIComponent(placeId)}&filter%5Bactivity%5D=USING_WHEELCHAIR,USING_ESCALATOR&filter%5Bdatetime%5D=NOW`),
  ]);
  const out = new Map(); // facility id -> { since, until }
  for (const { attributes: a } of alerts.data || []) {
    if (a.effect !== "ELEVATOR_CLOSURE" && a.effect !== "ESCALATOR_CLOSURE") continue;
    const p = (a.active_period || [])[0] || {};
    for (const e of a.informed_entity || []) {
      if (e.facility) out.set(String(e.facility), { since: Date.parse(p.start) || null, until: Date.parse(p.end) || null });
    }
  }
  return (fac.data || []).map((f) => {
    const a = f.attributes, o = out.get(String(f.id));
    return { kind: a.type === "ESCALATOR" ? "escalator" : "elevator", name: a.short_name || a.long_name || "", out: Boolean(o), since: o?.since ?? null, until: o?.until ?? null, note: "" };
  });
}

// LIRR station id -> the MTA's name for the station complex it shares.
const MTA_COMPLEX = {
  237: "34 St-Penn Station",
  214: "61 St-Woodside",
  102: "Sutphin Blvd-Archer Av-JFK Airport",
  241: "Atlantic Av-Barclays Ctr",
  349: "Grand Central-42 St",
};
const LIRR_SIDE = /\bLIRR\b|Long Island|Madison Concourse/i;
const MTA_ENE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fnyct_ene";

// "10/14/2026 02:10:00 PM", New York time -> ms.
function nyTime(s) {
  const m = String(s || "").match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+)(?::\d+)? ?(AM|PM)/i);
  if (!m) return null;
  const h = (Number(m[4]) % 12) + (/PM/i.test(m[6]) ? 12 : 0);
  const guess = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]));
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(guess).map((x) => [x.type, x.value]));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - guess;
  return guess - offset;
}

async function mtaLifts(lirrId) {
  const complex = MTA_COMPLEX[lirrId];
  if (!complex) return null;
  const [equipment, outages] = await Promise.all([getJson(`${MTA_ENE}_equipments.json`), getJson(`${MTA_ENE}.json`)]);
  const down = new Map((outages || []).filter((o) => o.isupcomingoutage !== "Y").map((o) => [o.equipment, o]));
  return (equipment || [])
    .filter((e) => e.station === complex && e.isactive !== "N" && LIRR_SIDE.test(`${e.serving} ${e.shortdescription}`))
    .map((e) => {
      const o = down.get(e.equipmentno);
      return { kind: e.equipmenttype === "ES" ? "escalator" : "elevator", name: e.shortdescription || e.serving, out: Boolean(o),
               since: o ? nyTime(o.outagedate) : null, until: o ? nyTime(o.estimatedreturntoservice) : null, note: "" };
    });
}

async function septaOutages(st, relay) {
  const data = await getJson(`${relay.replace(/\/$/, "")}/septa-elevators`);
  const names = new Set(st.members.filter((m) => m.agency === "septa").map((m) => norm(m.name)));
  return (data.results || [])
    .filter((r) => names.has(norm(r.station)))
    .map((r) => ({ kind: "elevator", name: String(r.elevator || "").trim() || r.station, out: true, since: null, until: null,
                   note: [r.message, r.line].filter(Boolean).join(" · ") }));
}

export async function stationLifts(st, relay) {
  const mbta = st.members.find((m) => m.agency === "mbta");
  const lirr = st.members.find((m) => m.agency === "lirr" && MTA_COMPLEX[m.id]);
  const septa = relay && st.members.some((m) => m.agency === "septa");
  if (!mbta && !lirr && !septa) return null;
  const [a, b, c] = await Promise.all([
    mbta ? mbtaLifts(mbta.id).catch(() => null) : null,
    lirr ? mtaLifts(lirr.id).catch(() => null) : null,
    septa ? septaOutages(st, relay).catch(() => null) : null,
  ]);
  const lifts = [...(a || []), ...(b || []), ...(c || [])];
  if (!lifts.length) return null;
  return {
    lifts,
    outagesOnly: !a?.length && !b?.length,
    source: [a?.length && "the MBTA", b?.length && "the MTA", c?.length && "SEPTA"].filter(Boolean),
  };
}
