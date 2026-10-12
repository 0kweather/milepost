// Official service notices for a train, from each railroad's own alerts:
//   - Amtrak, VIA, Brightline: notices Amtraker attaches to the train
//   - LIRR, Metro-North: the MTA's alerts feed (GTFS-realtime, JSON)
//   - MBTA: the MBTA V3 alerts API
// Notices about the train itself come first, then ones about its line.
// Returns [{ header, description, url, scope: "train" | "line" }].

const CACHE_MS = 2 * 60 * 1000;
const MAX_NOTICES = 6;
const cache = new Map(); // url -> { at, data }

async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await (await fetch(url)).json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

const english = (ts) => {
  const list = ts?.translation || [];
  return (list.find((x) => x.language === "en") || list.find((x) => !x.language) || list[0])?.text || "";
};

const activeNow = (periods, now = Date.now() / 1000) =>
  !periods?.length || periods.some((p) => (!p.start || p.start <= now) && (!p.end || p.end >= now));

async function mtaNotices(t, feed) {
  const url = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2F${feed}-alerts.json`;
  const data = await getJson(url);
  const out = [];
  for (const e of data.entity || []) {
    const a = e.alert;
    if (!a || !activeNow(a.active_period)) continue;
    const ents = a.informed_entity || [];
    const forTrip = ents.some((x) => x.trip?.trip_id && x.trip.trip_id === t.tripId);
    const forLine = ents.some((x) => x.route_id && x.route_id === t.routeId);
    if (!forTrip && !forLine) continue;
    out.push({ header: english(a.header_text), description: english(a.description_text), scope: forTrip ? "train" : "line" });
  }
  return out;
}

async function mbtaNotices(t) {
  if (!t.routeId) return [];
  const url = `https://api-v3.mbta.com/alerts?filter%5Broute%5D=${encodeURIComponent(t.routeId)}&filter%5Bdatetime%5D=NOW`;
  const data = await getJson(url);
  const out = [];
  for (const { attributes: a } of data.data || []) {
    const ents = a.informed_entity || [];
    const forTrip = ents.some((x) => x.trip && x.trip === t.tripId);
    // Line-wide notices; ones about a single station's platform or elevator are left out.
    const forLine = ents.some((x) => x.route === t.routeId && !x.stop && !x.trip);
    if (!forTrip && !forLine) continue;
    out.push({ header: a.header, description: a.description || "", url: a.url || null, scope: forTrip ? "train" : "line" });
  }
  return out;
}

export async function trainNotices(t) {
  let list = [];
  if (t.alerts?.length) list = t.alerts.map((a) => ({ header: a, description: "", scope: "train" }));
  else if (t.agency === "lirr" || t.agency === "mnr") list = await mtaNotices(t, t.agency);
  else if (t.agency === "mbta") list = await mbtaNotices(t);
  // Same text listed twice (once per direction or stop) shows once.
  const seen = new Set();
  return list
    .filter((n) => n.header && !seen.has(n.header) && seen.add(n.header))
    .sort((a, b) => (a.scope === "train" ? 0 : 1) - (b.scope === "train" ? 0 : 1))
    .slice(0, MAX_NOTICES);
}

// Official notices about a station: track and platform changes, elevator and
// escalator outages, work affecting it. From the MBTA's alerts (commuter
// rail and the station's elevators and escalators; North Station's subway
// alerts left out) and the MTA's LIRR and Metro-North feeds.
// Returns [{ header, description, url }].
export async function stationNotices(st) {
  const lists = await Promise.all(st.members.map(async (m) => {
    if (m.agency === "mbta") {
      const url = `https://api-v3.mbta.com/alerts?filter%5Bstop%5D=${encodeURIComponent(m.id)}&filter%5Bdatetime%5D=NOW`;
      const data = await getJson(url);
      return (data.data || [])
        .map(({ attributes: a }) => a)
        .filter((a) => (a.informed_entity || []).some((x) => x.route_type === 2 || x.facility))
        .map((a) => ({ header: a.header, description: a.description || "", url: a.url || null }));
    }
    if (m.agency === "lirr" || m.agency === "mnr") {
      const url = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2F${m.agency}-alerts.json`;
      const data = await getJson(url);
      return (data.entity || [])
        .map((e) => e.alert)
        .filter((a) => a && activeNow(a.active_period) && (a.informed_entity || []).some((x) => x.stop_id === m.id))
        .map((a) => ({ header: english(a.header_text), description: english(a.description_text), url: null }));
    }
    return [];
  }).map((p) => p.catch(() => [])));
  const seen = new Set();
  return lists.flat().filter((n) => n.header && !seen.has(n.header) && seen.add(n.header)).slice(0, MAX_NOTICES);
}
