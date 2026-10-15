// Railroads and the feeds that locate their trains.
//
// Every source turns its feed into a list of plain "train" objects:
//   { id, agency, number, route, routeColor, lat, lon, bearing, speedMph,
//     origin, destination, nextStop, delayMin, statusText, updated,
//     estimated, stops: [{ key, name, time, status, arr, dep, ... }] }
//
// "direct" sources send CORS headers, so the browser can read them from any
// site. "relay" sources don't (or need an API key), so they go through the
// small Cloudflare Worker in /relay when one is configured.

import { locale } from "./i18n.js?v=dev";
import { decodeFeed } from "./gtfsrt.js?v=dev";

export const AGENCIES = {
  amtrak:     { name: "Amtrak",              short: "Amtrak",   region: "United States",       color: "#1f5fad", kind: "intercity" },
  brightline: { name: "Brightline",          short: "Brightline", region: "Florida",           color: "#d9a400", kind: "intercity" },
  via:        { name: "VIA Rail",            short: "VIA",      region: "Canada",              color: "#c8102e", kind: "intercity" },
  mbta:       { name: "MBTA Commuter Rail",  short: "MBTA",     region: "Boston",              color: "#80276c", kind: "commuter" },
  lirr:       { name: "Long Island Rail Road", short: "LIRR",   region: "New York",            color: "#0b8a7e", kind: "commuter" },
  mnr:        { name: "Metro-North",         short: "Metro-North", region: "New York",         color: "#d7263d", kind: "commuter" },
  njt:        { name: "NJ Transit Rail",     short: "NJT",      region: "New Jersey",          color: "#f47b20", kind: "commuter" },
  exo:        { name: "exo",                 short: "exo",      region: "Montréal",            color: "#0098a6", kind: "commuter" },
  go:         { name: "GO Transit",          short: "GO",       region: "Toronto",             color: "#3f9c35", kind: "commuter" },
  ctrail:     { name: "CT Rail",             short: "CT Rail",  region: "Connecticut",         color: "#9e1b32", kind: "commuter" },
  marc:       { name: "MARC Train",          short: "MARC",     region: "Maryland",            color: "#f58025", kind: "commuter" },
  vre:        { name: "Virginia Railway Express", short: "VRE",  region: "Northern Virginia",   color: "#a6192e", kind: "commuter" },
  septa:      { name: "SEPTA Regional Rail", short: "SEPTA",    region: "Philadelphia",        color: "#5b6e7f", kind: "commuter" },
  metra:      { name: "Metra",               short: "Metra",    region: "Chicago",             color: "#0096d6", kind: "commuter" },
  southshore: { name: "South Shore Line",    short: "South Shore", region: "Chicago–South Bend", color: "#8d1b3d", kind: "commuter" },
  rtd:        { name: "RTD Commuter Rail",   short: "RTD",      region: "Denver",              color: "#2e9bd6", kind: "commuter" },
  frontrunner:{ name: "UTA FrontRunner",     short: "FrontRunner", region: "Salt Lake City",   color: "#8e44ad", kind: "commuter" },
  railrunner: { name: "Rail Runner Express", short: "Rail Runner", region: "New Mexico",        color: "#c1121f", kind: "commuter" },
  capmetro:   { name: "CapMetro Rail",       short: "CapMetro", region: "Austin",              color: "#e0218a", kind: "commuter" },
  trirail:    { name: "Tri-Rail",            short: "Tri-Rail", region: "South Florida",       color: "#2ba84a", kind: "commuter" },
  sunrail:    { name: "SunRail",             short: "SunRail",  region: "Orlando",             color: "#e6731c", kind: "commuter" },
  caltrain:   { name: "Caltrain",            short: "Caltrain", region: "San Francisco",       color: "#e31837", kind: "commuter" },
  ace:        { name: "Altamont Corridor Express", short: "ACE", region: "Stockton–San Jose",   color: "#7b3f98", kind: "commuter" },
  smart:      { name: "SMART",               short: "SMART",    region: "Sonoma–Marin",        color: "#3f9b3f", kind: "commuter" },
  metrolink:  { name: "Metrolink",           short: "Metrolink", region: "Los Angeles",        color: "#00a3ad", kind: "commuter" },
  sounder:    { name: "Sounder",             short: "Sounder",  region: "Seattle",             color: "#2a7f9e", kind: "commuter" },
};

const STALE_SECONDS = 20 * 60;
const nowSec = () => Date.now() / 1000;

// ---------- helpers ----------

const COMPASS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function delayText(min) {
  if (min == null || Number.isNaN(min)) return null;
  if (min <= 1) return "On time";
  if (min < 60) return `${Math.round(min)} min late`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h} h ${m} min late`;
}

const mps2mph = (v) => (v == null ? null : v * 2.23694);
const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);

function train(fields) {
  return { bearing: null, speedMph: null, origin: null, destination: null, nextStop: null,
           delayMin: null, statusText: null, estimated: false, stops: null, route: null,
           routeColor: null, updated: Date.now(), ...fields };
}

// ---------- Amtrak, VIA, Brightline (Amtraker) ----------

function departureDay(first) {
  const iso = first?.schDep || first?.dep;
  if (!iso) return null;
  try {
    const opts = { weekday: "short", month: "short", day: "numeric", timeZone: first.tz };
    const day = new Date(iso).toLocaleDateString(locale, opts);
    return day === new Date().toLocaleDateString(locale, opts) ? null : day; // only worth showing for multi-day trips
  } catch {
    return null;
  }
}

// When the train's GPS position was taken, if the feed says so reliably.
// Some Amtrak trains report local time under the wrong offset (hours in the
// future), and Brightline's time is just when the data was fetched.
function fixTime(agency, ts) {
  const t = Date.parse(ts);
  if (agency === "brightline" || !t || t > Date.now() + 60000) return null;
  return t;
}

const AMTRAKER_PROVIDERS = { Amtrak: "amtrak", Via: "via", Brightline: "brightline" };

function parseAmtraker(json) {
  const out = [];
  for (const list of Object.values(json)) {
    for (const t of list) {
      const agency = AMTRAKER_PROVIDERS[t.provider];
      if (!agency || t.trainState !== "Active" || !valid(t.lat, t.lon)) continue;
      const stations = t.stations || [];
      // The next stop is the first one still ahead that has a time. Amtrak's
      // feed sometimes lists stops already passed as "Station" with no times,
      // and keeps stale "Departed" entries from an earlier day near the end
      // (Maple Leaf, in Canada), so statuses alone can't be trusted.
      const ni = stations.findIndex((s) => (s.status === "Enroute" || s.status === "Station") && (s.arr || s.dep));
      const next = ni >= 0 ? stations[ni] : null;
      // Finished: no stop ahead and its last one left over half an hour ago.
      // Amtraker keeps some trains "Active" long after (VIA's especially),
      // placed wherever their equipment has since gone.
      if (!next) {
        const last = Math.max(0, ...stations.map((s) => Date.parse(s.dep || s.arr) || 0));
        if (last && Date.now() - last > 30 * 60 * 1000) continue;
      }
      const nextAt = next ? Date.parse(next.arr || next.dep) : null;
      const stale = (s, j) => j > ni && nextAt && Date.parse(s.dep || s.arr) < nextAt;
      let delayMin = null;
      if (next && next.arr && next.schArr) delayMin = (Date.parse(next.arr) - Date.parse(next.schArr)) / 60000;
      else if (next && next.dep && next.schDep) delayMin = (Date.parse(next.dep) - Date.parse(next.schDep)) / 60000;
      out.push(train({
        id: `${agency}:${t.trainID}`,
        agency,
        number: agency === "via" ? String(t.trainNum).replace(/^v/i, "") : t.trainNum, // Amtraker prefixes VIA numbers with "v"
        route: t.routeName,
        lat: t.lat, lon: t.lon,
        bearing: COMPASS[t.heading] ?? null,
        speedMph: t.velocity,
        origin: t.origName,
        destination: t.destName,
        nextStop: next ? next.name : null,
        delayMin,
        statusText: delayText(delayMin),
        updated: Math.min(Date.parse(t.lastValTS) || Date.now(), Date.now()),
        fixAt: fixTime(agency, t.lastValTS),
        alerts: (t.alerts || []).map((a) => a.message).filter(Boolean), // official notices for this train
        // Long-distance trains run for days, so the same number can be on the map twice.
        departedOn: departureDay(stations[0]),
        stops: stations.map((s, j) => {
          const old = stale(s, j); // a time from an earlier trip: don't show it
          return {
            key: `ic:${s.code}`,
            name: s.name,
            tz: s.tz,
            time: old ? null : s.status === "Departed" ? s.dep || s.arr : s.arr || s.dep,
            scheduled: s.schArr || s.schDep,
            arr: old ? null : s.arr || null, dep: old ? null : s.dep || null, schArr: s.schArr || null, schDep: s.schDep || null,
            status: ni < 0 ? (s.status === "Departed" ? "past" : "future") : j < ni ? "past" : j === ni ? "next" : "future",
            here: j === ni && s.status === "Station", // standing at this station right now
            track: s.platform || null,
          };
        }),
      }));
    }
  }
  return out;
}

// ---------- MBTA ----------

const MBTA_ROUTES = {
  "CR-NewBedford": "Fall River/New Bedford Line",
  "CR-Foxboro": "Foxboro Event Service",
  "CR-Worcester": "Framingham/Worcester Line",
  "CR-Needham": "Needham Line",
};

// Every commuter rail trip's upcoming stops with predicted and scheduled
// times, and (included) the trains running them with their positions: one
// request per refresh. Without an API key the MBTA allows 20 requests a
// minute per connection, shared by every open tab.
const MBTA_PREDICTIONS = "https://api-v3.mbta.com/predictions?filter%5Broute%5D=" +
  ["Fairmount", "Fitchburg", "Worcester", "Franklin", "Greenbush", "Haverhill", "Kingston", "Lowell", "Middleborough",
    "Needham", "Newburyport", "Providence", "Foxboro", "NewBedford"].map((r) => `CR-${r}`).join(",") +
  "&include=vehicle,trip,stop,schedule&fields%5Bprediction%5D=arrival_time,departure_time,stop_sequence,schedule_relationship" +
  "&fields%5Bstop%5D=name,parent_station&fields%5Bschedule%5D=arrival_time,departure_time&fields%5Btrip%5D=name,headsign";
// Each trip's upcoming stops, from that response.
function mbtaTrips(json) {
  const inc = new Map((json.included || []).map((x) => [`${x.type}:${x.id}`, x]));
  const trips = new Map();
  for (const p of json.data || []) {
    const a = p.attributes, tripId = p.relationships.trip?.data?.id;
    const stop = inc.get(`stop:${p.relationships.stop?.data?.id}`);
    const time = a.departure_time || a.arrival_time;
    if (!tripId || !stop || !time || a.schedule_relationship === "SKIPPED" || a.schedule_relationship === "CANCELLED") continue;
    const sch = inc.get(`schedule:${p.relationships.schedule?.data?.id}`)?.attributes;
    if (!trips.has(tripId)) trips.set(tripId, []);
    trips.get(tripId).push({
      seq: a.stop_sequence, name: stop.attributes.name, place: stop.relationships?.parent_station?.data?.id || stop.id,
      time, arr: a.arrival_time, dep: a.departure_time, scheduled: sch?.departure_time || sch?.arrival_time || null,
    });
  }
  for (const [id, list] of trips) {
    list.sort((x, y) => x.seq - y.seq);
    // The MBTA sometimes predicts a stop twice for the same trip: keep one.
    trips.set(id, list.filter((x, i) => i === 0 || (x.seq !== list[i - 1].seq && x.place !== list[i - 1].place)));
  }
  return trips;
}
const iso = (t) => (t ? new Date(t).toISOString() : null);

// Each running trip's full timetable, for the stops a train has already left
// (predictions cover only what's ahead). Timetables don't change, so each is
// read once, in one request for all the trips not yet seen.
const mbtaTimetables = new Map();
async function loadMbtaTimetables(tripIds) {
  const missing = tripIds.filter((id) => !mbtaTimetables.has(id));
  if (missing.length) {
    const url = `https://api-v3.mbta.com/schedules?filter%5Btrip%5D=${missing.map(encodeURIComponent).join(",")}` +
      "&include=stop&fields%5Bschedule%5D=arrival_time,departure_time,stop_sequence&fields%5Bstop%5D=name,parent_station";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`MBTA schedules HTTP ${res.status}`);
    const json = await res.json();
    const inc = new Map((json.included || []).map((x) => [`stop:${x.id}`, x]));
    for (const id of missing) mbtaTimetables.set(id, []);
    for (const sc of json.data || []) {
      const stop = inc.get(`stop:${sc.relationships.stop?.data?.id}`), a = sc.attributes;
      const list = mbtaTimetables.get(sc.relationships.trip?.data?.id);
      if (!stop || !list || !(a.departure_time || a.arrival_time)) continue;
      list.push({ seq: a.stop_sequence, name: stop.attributes.name, place: stop.relationships?.parent_station?.data?.id || stop.id, time: a.departure_time || a.arrival_time });
    }
    for (const id of missing) mbtaTimetables.get(id).sort((x, y) => x.seq - y.seq);
  }
  // Forget trips no longer running.
  for (const id of mbtaTimetables.keys()) if (!tripIds.includes(id)) mbtaTimetables.delete(id);
  return mbtaTimetables;
}

function parseMbta(json, trips = new Map(), timetables = new Map()) {
  const included = new Map((json.included || []).map((x) => [`${x.type}:${x.id}`, x]));
  const out = [];
  for (const v of json.data) {
    const a = v.attributes;
    if (!valid(a.latitude, a.longitude)) continue;
    const routeId = v.relationships.route?.data?.id || "";
    const trip = included.get(`trip:${v.relationships.trip?.data?.id}`);
    const stop = included.get(`stop:${v.relationships.stop?.data?.id}`);
    const stopName = stop?.attributes?.name || null;
    const tripId = v.relationships.trip?.data?.id || null;
    const stopped = a.current_status === "STOPPED_AT";
    // Its upcoming stops: the first is the one it's at or heading to.
    const ahead = trips.get(tripId) || [];
    const next = ahead[0];
    // Before it, the stops it has left, at their scheduled times.
    const upTo = next?.seq ?? a.current_stop_sequence ?? -1;
    const behind = (timetables.get(tripId) || []).filter((s) => s.seq < upTo);
    const delayMin = next?.scheduled ? (Date.parse(next.time) - Date.parse(next.scheduled)) / 60000 : null;
    out.push(train({
      id: `mbta:${v.id}`,
      agency: "mbta",
      routeId,
      tripId,
      number: trip?.attributes?.name || a.label,
      // Carriages when the MBTA lists them; otherwise the one car the label names.
      cars: a.carriages?.length
        ? { numbers: a.carriages.map((c) => c.label).filter(Boolean), complete: true }
        : a.label ? { numbers: [a.label], complete: false } : null,
      route: MBTA_ROUTES[routeId] || routeId.replace(/^CR-/, "").replace(/([a-z])([A-Z])/g, "$1 $2") + " Line",
      routeColor: "#80276c",
      lat: a.latitude, lon: a.longitude,
      bearing: a.bearing,
      speedMph: mps2mph(a.speed),
      origin: (timetables.get(tripId) || [])[0]?.name || null,
      destination: trip?.attributes?.headsign || null,
      nextStop: stopName || next?.name || null,
      delayMin,
      statusText: stopped && stopName ? `Stopped at ${stopName}` : delayText(delayMin),
      updated: Date.parse(a.updated_at) || Date.now(),
      stops: ahead.length || behind.length ? [
        ...behind.map((s) => ({ key: `mbta:${s.place}`, name: s.name, tz: "America/New_York", time: iso(s.time), status: "past" })),
        ...ahead.map((s, i) => ({
          key: `mbta:${s.place}`,
          name: s.name,
          tz: "America/New_York",
          time: iso(s.time), arr: iso(s.arr), dep: iso(s.dep), scheduled: iso(s.scheduled),
          status: i === 0 ? "next" : "future",
          here: i === 0 && stopped,
        })),
      ] : null,
    }));
  }
  return out;
}

// ---------- MTA (LIRR + Metro-North) ----------

let mtaStatic = null;
async function loadMtaStatic() {
  mtaStatic ??= fetch("data/mta.json?v=dev").then((r) => r.json());
  return mtaStatic;
}

const evTime = (s) => s.departure?.time || s.arrival?.time || 0;
const arrTime = (s) => s.arrival?.time || s.departure?.time || 0;

// Works out where a trip is from its (predicted) stop times: at a station, or
// part-way between the last stop it left and the next one it will reach.
function tripProgress(stops, now, lookup) {
  const list = stops.filter((s) => !s.skipped && lookup[s.stopId] && evTime(s));
  if (list.length < 2) return null;
  if (now < evTime(list[0]) - 60 || now > arrTime(list[list.length - 1]) + 60) return null;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const here = lookup[s.stopId];
    if (now >= arrTime(s) && now <= evTime(s)) {
      return { at: s, lat: here[1], lon: here[2], prev: s, next: list[i + 1] || s, list, dwelling: true };
    }
    const n = list[i + 1];
    if (n && now > evTime(s) && now < arrTime(n)) {
      const there = lookup[n.stopId];
      const f = (now - evTime(s)) / Math.max(1, arrTime(n) - evTime(s));
      return {
        lat: here[1] + (there[1] - here[1]) * f,
        lon: here[2] + (there[2] - here[2]) * f,
        bearing: bearingBetween([here[1], here[2]], [there[1], there[2]]),
        // The stations it's between, so the map can follow the track.
        leg: { from: [here[2], here[1]], to: [there[2], there[1]], f },
        prev: s, next: n, list,
      };
    }
  }
  // Before first departure or right at the end.
  const s = now < evTime(list[0]) ? list[0] : list[list.length - 1];
  const p = lookup[s.stopId];
  return { at: s, lat: p[1], lon: p[2], prev: s, next: s, list, dwelling: true };
}

function mtaStops(agency, list, lookup, now, nextStop, dwellingAt, tz = "America/New_York") {
  return list.map((s) => ({
    here: s === dwellingAt,
    key: `${agency}:${s.stopId}`,
    name: lookup[s.stopId][0],
    tz,
    time: new Date(evTime(s) * 1000).toISOString(),
    arr: s.arrival?.time ? new Date(s.arrival.time * 1000).toISOString() : null,
    dep: s.departure?.time ? new Date(s.departure.time * 1000).toISOString() : null,
    status: s === nextStop ? "next" : evTime(s) < now ? "past" : "future",
    track: s.track || null,
    scheduled: s.scheduled ? new Date(s.scheduled * 1000).toISOString() : null,
  }));
}

function parseMta(agency, buf, meta) {
  const feed = decodeFeed(buf);
  const now = nowSec();
  const { stops: lookup, routes } = meta;
  const vpByTrip = new Map();
  for (const v of feed.vehicles) if (v.trip?.tripId) vpByTrip.set(v.trip.tripId, v);

  const out = [];
  for (const tu of feed.tripUpdates) {
    const tripId = tu.trip?.tripId;
    // Yards and maintenance facilities trains pass through ("Hillside
    // Facility") aren't stops riders make.
    tu.stops = tu.stops.filter((st) => !/\b(Facility|Yard)\b/i.test(lookup[st.stopId]?.[0] || ""));
    const prog = tripProgress(tu.stops, now, lookup);
    if (!prog) continue;
    const vp = tu.entityVehicle || vpByTrip.get(tripId);
    const fresh = vp?.position && valid(vp.position.lat, vp.position.lon) && now - (vp.timestamp || 0) < STALE_SECONDS;
    // Metro-North lists bus substitutions as letter-prefixed trips ("EB1973",
    // "LB1973"); they're buses on roads, not trains.
    const label = vp?.vehicle?.label || tu.vehicle?.label || "";
    if (agency === "mnr" && /^[A-Z]+\d/.test(label)) continue;
    const route = routes[tu.trip.routeId];
    const last = prog.list[prog.list.length - 1];
    const nextStop = prog.dwelling ? prog.at : prog.next;
    const delaySec = nextStop.arrival?.delay ?? nextStop.departure?.delay;
    // LIRR trip ids carry the train number after the schedule prefix
    // ("GO202_26_6754", sometimes with a suffix like "_1" or "_2953_METS");
    // extra trains lead with it ("1572X_2026-10-12"). Metro-North puts it in
    // the vehicle label.
    const number = agency === "mnr"
      ? vp?.vehicle?.label || tu.vehicle?.label || tripId
      : (tripId || "").match(/^[A-Z]+\d*_\d+_(\d+)/)?.[1] || (tripId || "").match(/^(\d+)[A-Z]?_\d{4}-\d{2}-\d{2}$/)?.[1] ||
        (tripId || "").split("_").pop();
    out.push(train({
      id: `${agency}:${tripId}`,
      agency,
      routeId: tu.trip.routeId || null,
      tripId,
      number,
      route: route ? route[0] : null,
      routeColor: route ? route[1] : null,
      lat: fresh ? vp.position.lat : prog.lat,
      lon: fresh ? vp.position.lon : prog.lon,
      bearing: fresh && vp.position.bearing ? vp.position.bearing : prog.bearing ?? null,
      speedMph: fresh ? mps2mph(vp.position.speed) : null,
      origin: lookup[prog.list[0].stopId][0],
      destination: lookup[last.stopId][0],
      nextStop: lookup[nextStop.stopId][0],
      delayMin: delaySec != null ? delaySec / 60 : null,
      statusText: prog.dwelling ? `At ${lookup[prog.at.stopId][0]}` : delaySec != null ? delayText(delaySec / 60) : null,
      updated: fresh ? vp.timestamp * 1000 : (feed.timestamp || now) * 1000,
      fixAt: fresh ? vp.timestamp * 1000 : null,
      // LIRR's vehicle label is a car number (Metro-North's is the train number).
      cars: agency === "lirr" && label ? { numbers: [label], complete: false } : null,
      estimated: !fresh,
      leg: fresh ? null : prog.leg || null,
      stops: mtaStops(agency, prog.list, lookup, now, nextStop, prog.dwelling ? prog.at : null),
      // Kept so estimated positions can be advanced between refreshes.
      _progress: fresh ? null : { stops: tu.stops, lookup },
    }));
  }
  return out;
}

// Recomputes estimated (schedule-interpolated) positions so they keep moving
// between feed refreshes.
export function advanceEstimated(t) {
  if (!t._progress) return false;
  const p = tripProgress(t._progress.stops, nowSec(), t._progress.lookup);
  if (!p) return false;
  t.lat = p.lat;
  t.lon = p.lon;
  t.leg = p.leg || null;
  if (p.bearing != null) t.bearing = p.bearing;
  return true;
}

// ---------- NJ Transit (DepartureVision, through the relay) ----------

// The relay scrapes NJ Transit's DepartureVision: each running train's line,
// destination and stop list with predicted times and which stops it has left
// ({ at, trains: [{ id, line, abbr, color, dest, stops: [{ name, time,
// departed, status }] }], vehicles }). With NJ Transit's Rail Data API (an
// account on the relay), vehicles gives each moving train's GPS position,
// next stop and seconds late ([{ id, line, next, lat, lon, late, at }]);
// trains without one are placed between stations from their stop times.
const NJT_LINES = [[/Atl/i, "Atlantic City Rail Line"], [/Gladstone/i, "Gladstone Branch"], [/Morris|M&E|Morristown/i, "Morris & Essex Line"],
  [/Montclair|Boonton/i, "Montclair-Boonton Line"], [/Bergen|Main/i, "Main/Bergen County Line"], [/Northeast|NEC/i, "Northeast Corridor"],
  [/Coast/i, "North Jersey Coast Line"], [/Pascack/i, "Pascack Valley Line"], [/Princeton/i, "Princeton Shuttle"],
  [/Raritan/i, "Raritan Valley Line"], [/Port Jervis/i, "Port Jervis Line"], [/Meadowlands/i, "Meadowlands Rail Line"]];
// DepartureVision stop names that don't match the timetable's station names.
const NJT_ALIASES = { broadwayfairlawn: "25", radburnfairlawn: "126", montclairstateu: "38081", newarkairport: "37953",
  princetonjunction: "125", ramseymain: "128", secaucuslowerlvl: "38174", secaucusupperlvl: "38187", trenton: "148", wayneroute23: "39635" };
const nameKey = (s) => String(s || "").toLowerCase().replace(/\b(station|sta|st|street|ave|avenue)\b/g, "").replace(/[^a-z0-9]/g, "");
let njtLookup = null;
const loadNjtStations = () => (njtLookup ??= fetch("data/stations.json?v=dev").then((r) => r.json()).then((d) => {
  const byId = {}, byName = {};
  for (const [id, name, lat, lon] of d.njt || []) { byId[id] = [name, lat, lon]; byName[nameKey(name)] = id; }
  return { byId, idOf: (name) => NJT_ALIASES[nameKey(name)] || byName[nameKey(name)] || null };
}));

// Minutes past midnight in New York at epoch second `sec`.
const nyClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
function nyMinutes(sec) {
  const p = Object.fromEntries(nyClock.formatToParts(new Date(sec * 1000)).map((x) => [x.type, +x.value || 0]));
  return p.hour * 60 + p.minute + p.second / 60;
}
// "5:41 PM" in New York as epoch seconds: the occurrence within 12 hours of
// `ref`, and not before `after` (times run on past midnight).
function njtTime(text, ref, after = 0) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(text || "").trim());
  if (!m) return null;
  const mins = (+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2];
  let t = Math.round(ref + (mins - nyMinutes(ref)) * 60);
  if (t - ref > 43200) t -= 86400;
  else if (ref - t > 43200) t += 86400;
  while (after && t < after - 3600) t += 86400;
  return t;
}

async function parseNjt(json) {
  const { byId, idOf } = await loadNjtStations();
  const now = nowSec(), at = (json.at || Date.now()) / 1000;
  const out = [];
  // GPS positions from the Rail Data API, by train number (reported within
  // the last five minutes).
  const gps = new Map((json.vehicles || []).filter((v) => !v.at || Date.now() - v.at < 5 * 60 * 1000).map((v) => [String(v.id), v]));
  const stationName = (raw) => { const id = idOf(raw); return id && byId[id] ? byId[id][0] : raw; };
  for (const tr of json.trains || []) {
    const line = NJT_LINES.find(([re]) => re.test(`${tr.line} ${tr.abbr}`))?.[1];
    if (!line || !tr.stops?.length) continue;   // SEPTA and Amtrak trains on the boards
    // Predicted times as a trip's stop times, held to what the board says: a
    // stop it has left can't be in the future, and one it hasn't reached can't
    // be in the past (a late train is still on its way to it).
    let prev = 0, rawPrev = 0, reached = false;
    const stops = [];
    for (const s of tr.stops) {
      const id = idOf(s.name);
      const raw = njtTime(s.time, at, rawPrev);
      if (!id || !byId[id] || raw == null) continue;
      rawPrev = raw;
      let t = raw;
      if (s.departed) t = Math.min(t, at);
      else { t = Math.max(t, prev ? prev + 60 : 0, reached ? 0 : at + 30); reached = true; }
      prev = t;
      stops.push({ stopId: id, arrival: { time: t }, departure: { time: t }, raw });
    }
    // A stop it has left can't be later than the next one (DepartureVision
    // sometimes gives the origin a time from another run).
    for (let i = stops.length - 2; i >= 0; i--) {
      const a = stops[i], b = stops[i + 1];
      if (a.departure.time > b.arrival.time) a.arrival.time = a.departure.time = b.arrival.time - 120;
    }
    // Done: every stop but the last one left, and its arrival time passed.
    const end = stops[stops.length - 1];
    if (!end || (tr.stops.slice(0, -1).every((x) => x.departed) && end.raw < at - 120)) continue;
    const prog = tripProgress(stops, now, byId);
    if (!prog) continue;
    const first = prog.list[0], last = prog.list[prog.list.length - 1];
    const nextStop = prog.dwelling ? prog.at : prog.next;
    const name = (st) => byId[st.stopId][0];
    const v = gps.get(String(tr.id));
    gps.delete(String(tr.id));
    out.push(train({
      id: `njt:${tr.id}`,
      agency: "njt",
      number: tr.id,
      route: line,
      routeColor: tr.color || null,
      origin: name(first),
      destination: name(last),
      stops: mtaStops("njt", prog.list, byId, now, nextStop, prog.dwelling ? prog.at : null),
      ...(v ? {
        // Where its GPS puts it, and NJ Transit's own delay.
        lat: v.lat, lon: v.lon,
        nextStop: v.next ? stationName(v.next) : name(nextStop),
        delayMin: v.late != null ? v.late / 60 : null,
        statusText: v.late != null ? delayText(v.late / 60) : null,
        updated: v.at || at * 1000,
      } : {
        lat: prog.lat,
        lon: prog.lon,
        bearing: prog.bearing ?? null,
        nextStop: name(nextStop),
        statusText: prog.dwelling && prog.at === first ? `At ${name(first)}` : prog.dwelling ? `At ${name(prog.at)}` : null,
        updated: at * 1000,
        estimated: true,
        leg: prog.leg || null,
        // Kept so estimated positions can be advanced between refreshes.
        _progress: { stops, lookup: byId },
      }),
    }));
  }
  // Moving trains the boards haven't listed yet: their position and next stop.
  for (const v of gps.values()) {
    const line = NJT_LINES.find(([re]) => re.test(v.line || ""))?.[1];
    if (!line) continue;
    out.push(train({
      id: `njt:${v.id}`, agency: "njt", number: v.id, route: line,
      lat: v.lat, lon: v.lon, nextStop: v.next ? stationName(v.next) : null,
      delayMin: v.late != null ? v.late / 60 : null, statusText: v.late != null ? delayText(v.late / 60) : null,
      updated: v.at || at * 1000,
    }));
  }
  return out;
}

// ---------- GO Transit (GO Tracker, through the relay) ----------

// The relay scrapes GO Tracker: each train's GPS position, number, line,
// delay, first and last stations and times, the station it's stopped at, and
// an equipment number ({ at, trains: [{ trip, line, lineCode, lat, lon,
// delaySec, from, to, start, end, equipment, atStation, atStationId, moving,
// updated }] }). Its stops and their times come from GO's timetable
// (data/go.json, scripts/build_go.py), shifted by the live delay.
const GO_LINES = {
  LW: ["Lakeshore West line", "#98002e"], LE: ["Lakeshore East line", "#ee3124"], MI: ["Milton line", "#f58220"],
  KI: ["Kitchener line", "#00853f"], GT: ["Kitchener line", "#00853f"], BR: ["Barrie line", "#003767"],
  RH: ["Richmond Hill line", "#0099c7"], ST: ["Stouffville line", "#794500"],
};
let goTimetable = null;
const loadGo = () => (goTimetable ??= fetch("data/go.json?v=dev").then((r) => r.json()));
const goSeen = new Map(); // train id -> [lat, lon, bearing], for its heading between refreshes
const hhmm = (s) => (/^(\d{1,2}):(\d{2})$/.test(s || "") ? +s.slice(0, -3) * 60 + +s.slice(-2) : null);
// The day `sec` falls on in Toronto (same clock as New York), as days since 1970.
const torontoDay = (sec) => Math.floor((sec - nyMinutes(sec) * 60 + 43200) / 86400);

async function parseGo(json) {
  const tt = await loadGo();
  const now = nowSec(), at = (json.at || Date.now()) / 1000;
  const nowMin = nyMinutes(at);
  const midnight = Math.round(at - nowMin * 60); // Toronto midnight today
  const ttStart = Math.floor(Date.parse(`${tt.start}T12:00:00Z`) / 86400000);
  // Eastern time's offset from UTC now, in minutes (-240 or -300).
  const offset = Math.round(((nowMin - ((at / 60) % 1440)) + 2160) % 1440 - 720);
  const out = [];
  for (const g of json.trains || []) {
    if (!valid(g.lat, g.lon)) continue;
    const [route, routeColor] = GO_LINES[g.lineCode] || [g.line ? `${g.line} line` : null, null];
    // A trip that starts hours "later" than now began yesterday, before midnight.
    const start = hhmm(g.start), end = hhmm(g.end);
    const day = start != null && start - nowMin > 360 ? midnight - 86400 : midnight;
    const idx = torontoDay(day + 43200) - ttStart;
    const runs = (mask) => idx >= 0 && idx < 14 ? (mask >> idx) & 1 : (mask >> (7 + (((idx - 7) % 7) + 7) % 7)) & 1;
    const pats = tt.trips[g.trip] || [];
    const ends = ([, s]) => s[0][1] % 1440 === start && s[s.length - 1][1] % 1440 === end;
    const pat = (pats.find((p) => ends(p) && runs(p[0])) || pats.find(ends) || pats.find((p) => runs(p[0])) || [])[1] || [];
    const delay = g.delaySec || 0;
    // Its stops, with times shifted by the delay; the one it's at (or next
    // reaches) is "next".
    let next = g.atStationId ? pat.findIndex(([sid]) => sid === g.atStationId) : -1;
    if (next < 0) next = pat.findIndex(([, m]) => day + m * 60 + delay > now - 30);
    const stops = pat.filter(([sid]) => tt.stops[sid]).map(([sid, m], i) => ({
      key: `go:${sid}`, name: tt.stops[sid][0], tz: "America/Toronto",
      time: new Date((day + m * 60 + delay) * 1000).toISOString(),
      scheduled: new Date((day + m * 60) * 1000).toISOString(),
      status: next < 0 || i < next ? "past" : i === next ? "next" : "future",
      here: i === next && Boolean(g.atStationId),
    }));
    const nextStop = next >= 0 ? stops[next] : null;
    // Heading: from where it was at the last refresh; else toward its next
    // stop, or (at or right by it) from that stop toward the one after.
    const id = `go:${g.trip}`, prev = goSeen.get(id);
    const km = (a, b) => Math.hypot((b[0] - a[0]) * 111, (b[1] - a[1]) * 111 * Math.cos((a[0] * Math.PI) / 180));
    let bearing = prev?.[2] ?? null;
    if (prev && km(prev, [g.lat, g.lon]) > 0.04) bearing = bearingBetween([prev[0], prev[1]], [g.lat, g.lon]);
    else if (bearing == null && next >= 0) {
      const here = [g.lat, g.lon], at = tt.stops[pat[next][0]].slice(1), after = pat[next + 1] && tt.stops[pat[next + 1][0]]?.slice(1);
      bearing = km(here, at) < 0.5 && after ? bearingBetween(at, after) : bearingBetween(here, at);
    }
    goSeen.set(id, [g.lat, g.lon, bearing]);
    const delayMin = delay / 60;
    const updated = g.updated ? Date.parse(`${g.updated}Z`) - offset * 60000 : at * 1000;
    out.push(train({
      id, agency: "go", number: g.trip, route, routeColor,
      lat: g.lat, lon: g.lon, bearing,
      origin: stops[0]?.name || g.from || null,
      destination: stops[stops.length - 1]?.name || g.to || null,
      nextStop: nextStop?.name || null,
      delayMin,
      statusText: g.atStation ? `At ${g.atStation}` : delayText(delayMin),
      updated: Math.min(updated || at * 1000, Date.now()),
      cars: g.equipment ? { numbers: [g.equipment], complete: false } : null,
      stops: stops.length ? stops : null,
    }));
  }
  return out;
}

// ---------- CT Rail (timetable, with New Haven's live board) ----------

// CTDOT publishes no live positions for its Hartford Line and Shore Line East
// trains, so they're placed from the timetable (data/ctrail.json,
// scripts/build_ct.py). MTA TrainTime's New Haven board lists them with a
// predicted time there, a track, cancellations and bus substitutions: the
// delay at New Haven shifts the whole trip, and is kept for the rest of the
// trip once the train has left the board.
const CT_BOARD = "https://backend-unified.mylirr.org/arrivals/2NH?amtrak=true"; // amtrak=true adds CT Rail
let ctTimetable = null;
const loadCt = () => (ctTimetable ??= fetch("data/ctrail.json?v=dev").then((r) => r.json()));
const ctSeen = new Map(); // "service day:number" -> { delay, gone, held, track } from the board

async function fetchCtBoard() {
  try {
    const res = await fetch(CT_BOARD, { headers: { "Accept-Version": "3.0" }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("CT Rail board", err);
    return null; // the trains still show, on their timetable
  }
}

async function parseCtrail(board) {
  const tt = await loadCt();
  const now = nowSec();
  const midnight = Math.round(now - nyMinutes(now) * 60); // New York midnight today
  const ttStart = Math.floor(Date.parse(`${tt.start}T12:00:00Z`) / 86400000);
  const live = new Map((board?.arrivals || []).filter((a) => a.branch === "HL" || a.branch === "SLE").map((a) => [String(a.train_num), a]));
  const out = [];
  for (const [number, pats] of Object.entries(tt.trips)) {
    // Today's run, or yesterday's still going after midnight.
    for (const day of [midnight, midnight - 86400]) {
      const idx = torontoDay(day + 43200) - ttStart; // same clock as New York
      const runs = (mask) => idx >= 0 && idx < 14 ? (mask >> idx) & 1 : (mask >> (7 + (((idx - 7) % 7) + 7) % 7)) & 1;
      const [, line, pat] = pats.find((p) => runs(p[0])) || [];
      if (!pat || now < day + pat[0][2] * 60 - 3600 || now > day + pat[pat.length - 1][1] * 60 + 4 * 3600) continue;
      // The board's time at New Haven against the timetable's.
      const key = `${day}:${number}`, nh = pat.findIndex(([code]) => code === "NHV");
      const a = live.get(number);
      if (a && nh >= 0) {
        const sched = day + (nh === pat.length - 1 ? pat[nh][1] : pat[nh][2]) * 60;
        if (Math.abs(a.time - sched) < 3 * 3600) {
          ctSeen.set(key, { delay: Math.max(0, a.time - sched), gone: a.status?.canceled || a.stop_type === "BUS",
                            held: a.status?.held, track: a.track || null });
        }
      }
      const seen = ctSeen.get(key);
      if (seen?.gone) break; // cancelled, or a bus today
      const delay = seen?.delay || 0;
      const stops = pat.map(([code, arr, dep]) => ({
        stopId: code, arrival: { time: day + arr * 60 + delay }, departure: { time: day + dep * 60 + delay },
        track: code === "NHV" ? seen?.track : null,
      }));
      const prog = tripProgress(stops, now, tt.stops);
      if (!prog) break;
      const first = prog.list[0], last = prog.list[prog.list.length - 1];
      const nextStop = prog.dwelling ? prog.at : prog.next;
      const name = (st) => tt.stops[st.stopId][0];
      const delayMin = seen ? delay / 60 : null;
      out.push(train({
        id: `ctrail:${number}`, agency: "ctrail", number, route: line,
        lat: prog.lat, lon: prog.lon, bearing: prog.bearing ?? null,
        origin: name(first), destination: name(last), nextStop: name(nextStop),
        delayMin,
        statusText: seen?.held ? "Held at New Haven" : prog.dwelling ? `At ${name(prog.at)}` : delayMin != null ? delayText(delayMin) : null,
        updated: now * 1000,
        estimated: true,
        leg: prog.leg || null,
        stops: mtaStops("ctrail", prog.list, tt.stops, now, nextStop, prog.dwelling ? prog.at : null),
        _progress: { stops, lookup: tt.stops },
      }));
      break;
    }
  }
  return out;
}

// ---------- Timetables (data/schedules, scripts/build_schedules.py) ----------

// Railroads whose live data names a train but not its stops (South Shore,
// SunRail), or that have no live data (Rail Runner), use their timetable.
const schedules = {};
const loadSchedule = (agency) => (schedules[agency] ??= fetch(`data/schedules/${agency}.json?v=dev`).then((r) => r.json()));
const clocks = {};
// Minutes past midnight at epoch second `sec` in time zone `tz`.
function localMinutes(sec, tz) {
  clocks[tz] ??= new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
  const p = Object.fromEntries(clocks[tz].formatToParts(new Date(sec * 1000)).map((x) => [x.type, +x.value || 0]));
  return p.hour * 60 + p.minute + p.second / 60;
}
// "9:44AM" or "11:14 am" in `tz` as epoch seconds, the occurrence nearest `ref`.
function clockTime(text, ref, tz) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(String(text || "").trim());
  if (!m) return null;
  const mins = (+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2];
  const t = Math.round(ref + (mins - localMinutes(ref, tz)) * 60);
  return t - ref > 43200 ? t - 86400 : ref - t > 43200 ? t + 86400 : t;
}

// A train number's run going now: today's, or yesterday's still running past
// midnight ({ day: the service day's midnight, line, pat }), or null.
// `slack`: seconds before its first departure and after its last arrival
// that still count.
function runNow(tt, number, now, slack) {
  const midnight = Math.round(now - localMinutes(now, tt.tz) * 60);
  const start = Date.parse(`${tt.start}T00:00:00Z`) / 1000;
  for (const day of [midnight, midnight - 86400]) {
    const idx = Math.round((day - start) / 86400);
    // Past the timetable's two weeks: the same weekday in its second week.
    const bit = idx >= 0 && idx < 14 ? idx : 7 + ((((idx - 7) % 7) + 7) % 7);
    const p = (tt.trips[number] || []).find(([mask]) => (mask >> bit) & 1);
    if (p && now >= day + p[2][0][2] * 60 - slack && now <= day + p[2][p[2].length - 1][1] * 60 + slack) {
      return { day, line: p[1], pat: p[2] };
    }
  }
  return null;
}

// A run's stop times, shifted by `delay` seconds; `live` (stop id -> epoch
// second) holds the railroad's own predictions where it gives them.
function runStops(run, delay = 0, live = {}, tracks = {}) {
  return run.pat.map(([id, arr, dep]) => {
    const a = live[id] ?? run.day + arr * 60 + delay;
    return { stopId: id, arrival: { time: a }, departure: { time: Math.max(a, run.day + dep * 60 + delay) },
             scheduled: run.day + dep * 60, track: tracks[id] || null };
  });
}

// A train with a GPS position whose stops come from its run: the stop it's
// heading to (by id) is next, the ones before it are past.
function gpsRunTrain(agency, tt, number, run, fields, { delay = 0, live = {}, tracks = {}, nextId = null, now }) {
  const stops = run ? runStops(run, delay, live, tracks) : [];
  let next = stops.findIndex((s) => s.stopId === nextId);
  if (next < 0) next = stops.findIndex((s) => s.arrival.time >= now - 30);
  const nextStop = next >= 0 ? stops[next] : null;
  const name = (s) => tt.stops[s.stopId][0];
  const delayMin = run ? delay / 60 : null;
  return train({
    id: `${agency}:${number}`, agency, number, route: run?.line || null, bearing: null,
    origin: stops[0] ? name(stops[0]) : null, destination: stops.length ? name(stops[stops.length - 1]) : null,
    nextStop: nextStop ? name(nextStop) : null,
    delayMin, statusText: delayMin != null ? delayText(delayMin) : null,
    stops: stops.length
      ? mtaStops(agency, stops, tt.stops, now, nextStop, null, tt.tz).map((s, i) => ({ ...s, status: next < 0 || i < next ? "past" : i === next ? "next" : "future" }))
      : null,
    ...fields,
  });
}

// Rail Runner: no live data, so each train is placed from its timetable.
async function timetableTrains(agency) {
  const tt = await loadSchedule(agency);
  const now = nowSec(), out = [];
  for (const number of Object.keys(tt.trips)) {
    const run = runNow(tt, number, now, 120);
    if (!run) continue;
    const stops = runStops(run);
    const prog = tripProgress(stops, now, tt.stops);
    if (!prog) continue;
    const nextStop = prog.dwelling ? prog.at : prog.next;
    const name = (st) => tt.stops[st.stopId][0];
    out.push(train({
      id: `${agency}:${number}`, agency, number, route: run.line,
      lat: prog.lat, lon: prog.lon, bearing: prog.bearing ?? null,
      origin: name(prog.list[0]), destination: name(prog.list[prog.list.length - 1]), nextStop: name(nextStop),
      statusText: prog.dwelling ? `At ${name(prog.at)}` : "Scheduled",
      updated: now * 1000, estimated: true, leg: prog.leg || null,
      stops: mtaStops(agency, prog.list, tt.stops, now, nextStop, prog.dwelling ? prog.at : null, tt.tz),
      _progress: { stops, lookup: tt.stops },
    }));
  }
  return out;
}

// ---------- South Shore Line (its ETA SPOT tracker) ----------

// The tracker South Shore links from its site: each train's position, number,
// one car's number, minutes off schedule, and its next few stops with
// predicted times and tracks. The full stop list comes from the timetable.
const SOUTH_SHORE = "https://southshore.etaspot.net/service.php?service=get_vehicles&includeETAData=1&inService=1&orderedETAArray=1&token=TESTING";

async function parseSouthShore(json) {
  const tt = await loadSchedule("southshore");
  const now = nowSec();
  return (json.get_vehicles || []).filter((v) => v.inService && valid(v.lat, v.lng)).map((v) => {
    const number = String(v.tripID || v.scheduleNumber);
    const run = runNow(tt, number, now, 3 * 3600);
    const live = {}, tracks = {};
    for (const m of v.minutesToNextStops || []) {
      const t = clockTime(m.time, now, tt.tz);
      if (t) live[`s${m.stopID}`] = t;
      if (m.track) tracks[`s${m.stopID}`] = String(m.track);
    }
    // onSchedule: minutes ahead of schedule (negative when late).
    const delay = Number.isFinite(v.onSchedule) ? Math.max(0, -v.onSchedule) * 60 : 0;
    return gpsRunTrain("southshore", tt, number, run, {
      lat: v.lat, lon: v.lng,
      updated: Math.min(v.receiveTime || now * 1000, Date.now()),
      cars: v.equipmentID ? { numbers: [String(v.equipmentID)], complete: false } : null,
    }, { delay, live, tracks, nextId: v.nextStopExtID, now });
  });
}

// ---------- exo (its live map, through the relay) ----------

// The relay reads exo.quebec's live map: each train's position and trip, and
// its delay at the stops ahead ({ at, vehicles, tripUpdates }). Train
// numbers, stops and times come from exo's timetable (data/schedules/exo.json).
async function parseExo(json) {
  const tt = await loadSchedule("exo");
  const now = nowSec();
  const updates = new Map((json.tripUpdates || []).map((u) => [u.TripId, u]));
  const out = [];
  for (const v of json.vehicles || []) {
    const number = tt.ids?.[v.TripId];
    if (!number || !valid(v.Latitude, v.Longitude)) continue;
    const run = runNow(tt, number, now, 3 * 3600);
    // The stops ahead and the delay at the next of them.
    const ahead = (updates.get(v.TripId)?.StopTimeUpdates || []).slice().sort((a, b) => a.StopSequence - b.StopSequence);
    const next = ahead[0];
    const delay = Math.max(0, next?.ArrivalDelay ?? next?.DepartureDelay ?? 0);
    // Arrived (nothing ahead, its last stop five minutes past): done.
    if (!next && run && now > run.day + run.pat[run.pat.length - 1][1] * 60 + delay + 300) continue;
    out.push(gpsRunTrain("exo", tt, number, run, {
      lat: v.Latitude, lon: v.Longitude,
      routeColor: tt.colors?.[run?.line] || null,
      updated: Math.min((v.Timestamp || now) * 1000, Date.now()),
    }, { delay, nextId: next ? tt.codes?.[next.Stop?.Code] : null, now }));
  }
  return out;
}

// ---------- SunRail (its website's train status) ----------

// sunrail.com's train status: each train's position, number, speed, next
// station with its predicted time there, and one equipment number. It needs
// a token from the same API, good for 12 hours.
const SUNRAIL = "https://sunrail.com/wp-json/sunrail/v1/";
let sunrailToken = null; // { value, until }

async function fetchSunRail() {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!sunrailToken || Date.now() > sunrailToken.until) {
      const n = await (await fetch(`${SUNRAIL}nonce`, { cache: "no-store" })).json();
      sunrailToken = { value: n.nonce, until: Date.now() + (Math.min(n.expires_in || 3600, 43200) - 600) * 1000 };
    }
    const res = await fetch(`${SUNRAIL}train_feed`, { headers: { "X-WP-Nonce": sunrailToken.value }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) { sunrailToken = null; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("SunRail refused the token");
}

async function parseSunRail(list) {
  const tt = await loadSchedule("sunrail");
  const now = nowSec();
  return (Array.isArray(list) ? list : []).filter((t) => valid(+t.Lat, +t.Long) && t.TripId).map((t) => {
    const number = String(t.TripId);
    const run = runNow(tt, number, now, 3 * 3600);
    // Its delay: the predicted time at its next station against the timetable's.
    const at = clockTime(t.ArrivalTime, now, tt.tz);
    const sched = run?.pat.find(([id]) => id === String(t.NextStation));
    const late = at && sched ? at - (run.day + sched[1] * 60) : null;
    const delay = late != null && Math.abs(late) < 3 * 3600 ? Math.max(0, late) : 0;
    return gpsRunTrain("sunrail", tt, number, run, {
      lat: +t.Lat, lon: +t.Long,
      speedMph: Number.isFinite(t.Speed) ? t.Speed : null,
      updated: now * 1000,
      cars: t.Id ? { numbers: [String(t.Id)], complete: false } : null,
    }, { delay, live: at ? { [String(t.NextStation)]: at } : {}, nextId: String(t.NextStation), now });
  });
}

// ---------- Generic GTFS-realtime vehicle feeds ----------

// Stop and trip lookups from the timetables of railroads whose realtime feeds
// carry only IDs (scripts/build_trips.py).
const TIME_ZONES = { rtd: "America/Denver", capmetro: "America/Chicago", metra: "America/Chicago", marc: "America/New_York", frontrunner: "America/Denver",
                     vre: "America/New_York" };
let tripsStatic = null;
const loadTrips = () => (tripsStatic ??= fetch("data/trips.json?v=dev").then((r) => r.json()));

// Fills in a train's upcoming stops, next stop, destination and delay from its
// trip's predicted stop times (GTFS-realtime trip updates) and the railroad's
// timetable. Feeds drop stops a train has left, so only what's ahead shows.
function addTrip(t, agency, tripId, tu, west, now) {
  const info = west.trips[tripId];
  // Some feeds (UTA) name a stop only by its place in the trip.
  const bySeq = info?.[2];
  const stopsOf = (tu?.stops || []).map((s) => (s.stopId || !bySeq ? s : { ...s, stopId: bySeq[s.seq] }))
    // A departure before its arrival (Sound Transit's at last stops) is noise.
    .map((s) => (s.departure?.time && s.arrival?.time && s.departure.time < s.arrival.time ? { ...s, departure: null } : s));
  const list = stopsOf.filter((s) => !s.skipped && west.stops[s.stopId] && evTime(s));
  if (info?.[1]) t.destination = info[1];
  else if (list.length) t.destination = west.stops[list[list.length - 1].stopId][0];
  if (!list.length) return;
  const nextIdx = list.findIndex((s) => evTime(s) >= now - 20);
  const next = list[nextIdx];
  const dwelling = next && arrTime(next) <= now;
  const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
  t.stops = list.map((s, i) => ({
    key: `${agency}:${west.stops[s.stopId][3]}`,
    name: west.stops[s.stopId][0],
    tz: TIME_ZONES[agency] || "America/Los_Angeles",
    time: iso(evTime(s)),
    arr: iso(s.arrival?.time), dep: iso(s.departure?.time),
    status: i === nextIdx ? "next" : nextIdx < 0 || i < nextIdx ? "past" : "future",
    here: i === nextIdx && dwelling,
  }));
  if (next) {
    t.nextStop = west.stops[next.stopId][0];
    const delaySec = next.arrival?.delay ?? next.departure?.delay;
    if (delaySec != null) {
      t.delayMin = delaySec / 60;
      t.statusText = delayText(t.delayMin);
    }
    if (dwelling) t.statusText = `At ${t.nextStop}`;
  }
}

function gtfsVehicles(agency, buf, { keep = () => true, route, number, destination, west: lookup, zeroHeading = false, idOf } = {}) {
  const feed = decodeFeed(buf);
  const now = nowSec();
  const tripUpdates = new Map(feed.tripUpdates.filter((u) => u.trip?.tripId).map((u) => [u.trip.tripId, u]));
  const seen = new Set();
  const out = [];
  for (const v of feed.vehicles) {
    const p = v.position;
    if (!p || !valid(p.lat, p.lon) || !keep(v)) continue;
    if (v.timestamp && now - v.timestamp > STALE_SECONDS) continue;
    // Some feeds' vehicle ids change between refreshes (Sounder's): use the train's.
    const key = idOf?.(v) || v.vehicle?.id || v.trip?.tripId || `${p.lat},${p.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(train({
      id: `${agency}:${key}`,
      agency,
      number: number ? number(v) : v.vehicle?.label || v.vehicle?.id || null,
      route: route ? route(v) : v.trip?.routeId || null,
      lat: p.lat, lon: p.lon,
      // Most feeds send 0 when they don't know the heading; Tri-Rail's 0 is due north.
      bearing: p.bearing || (zeroHeading && p.bearing === 0 ? 0 : null),
      speedMph: mps2mph(p.speed),
      destination: destination ? destination(v) : null,
      updated: (v.timestamp || feed.timestamp || now) * 1000,
      fixAt: lookup && v.timestamp ? v.timestamp * 1000 : null,
    }));
    if (lookup && v.trip?.tripId) addTrip(out[out.length - 1], agency, v.trip.tripId, tripUpdates.get(v.trip.tripId), lookup, now);
    // Still reporting a quarter hour after its last stop: the trip is over.
    const st = out[out.length - 1].stops;
    if (st?.length && st.every((s) => s.status === "past") && Date.parse(st[st.length - 1].time) < now * 1000 - 15 * 60 * 1000) out.pop();
  }
  return out;
}

// ---------- SEPTA ----------

// TrainView gives each train's position, next stop and delay; its stops and
// their times come from SEPTA's timetable (data/schedules/septa.json, by train
// number), shifted by the delay.
async function parseSepta(json) {
  const tt = await loadSchedule("septa").catch(() => null);
  const now = nowSec();
  const idOf = tt ? new Map(Object.entries(tt.stops).map(([id, [name]]) => [nameKey(name), id])) : new Map();
  return json
    // TrainView keeps some parked trains listed as many hours "late"; skip them.
    .filter((t) => valid(+t.lat, +t.lon) && !(t.late > 600))
    .map((t) => {
      const number = String(t.trainno);
      const fields = {
        route: /line$/i.test(t.line) ? t.line : `${t.line} Line`,
        lat: +t.lat, lon: +t.lon,
        bearing: t.heading != null && t.heading !== "" ? +t.heading : null,
        destination: t.dest,
        nextStop: t.nextstop,
        currentStop: t.currentstop,
        delayMin: t.late,
        statusText: delayText(t.late),
        cars: t.consist ? { numbers: t.consist.split(",").map((c) => c.trim()).filter(Boolean), complete: true } : null,
      };
      const run = tt && runNow(tt, number, now, 3 * 3600);
      if (!run) return train({ id: `septa:${number}`, agency: "septa", number, origin: t.SOURCE, ...fields });
      return gpsRunTrain("septa", tt, number, run, fields, { delay: (+t.late || 0) * 60, nextId: idOf.get(nameKey(t.nextstop)) || null, now });
    });
}

// ---------- Source table ----------

const RTD_LINES = { A: "A Line", "113B": "B Line", "113G": "G Line", "117N": "N Line" };

export const SOURCES = [
  {
    id: "amtraker", agencies: ["amtrak", "via", "brightline"], format: "json", interval: 60,
    url: "https://api-v3.amtraker.com/v3/trains",
    credit: { label: "Amtraker", href: "https://amtraker.com" },
    parse: parseAmtraker,
  },
  {
    id: "mbta", agencies: ["mbta"], format: "json", interval: 30,
    url: MBTA_PREDICTIONS,
    credit: { label: "MBTA V3 API", href: "https://www.mbta.com/developers" },
    // Upcoming stops, with the trains running them included; then the
    // timetables of the stops behind them (if that fails, trains still show).
    parse: async (json) => {
      const vehicles = (json.included || []).filter((x) => x.type === "vehicle");
      const tripIds = [...new Set(vehicles.map((v) => v.relationships?.trip?.data?.id).filter(Boolean))];
      const timetables = await loadMbtaTimetables(tripIds).catch((err) => (console.warn("MBTA schedules", err), new Map()));
      return parseMbta({ data: vehicles, included: json.included }, mbtaTrips(json), timetables);
    },
  },
  {
    id: "lirr", agencies: ["lirr"], format: "pb", interval: 30,
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr",
    credit: { label: "MTA", href: "https://api.mta.info" },
    parse: async (buf) => parseMta("lirr", buf, (await loadMtaStatic()).lirr),
  },
  {
    id: "mnr", agencies: ["mnr"], format: "pb", interval: 30,
    url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr",
    credit: { label: "MTA", href: "https://api.mta.info" },
    parse: async (buf) => parseMta("mnr", buf, (await loadMtaStatic()).mnr),
  },
  // ----- through the relay (no CORS headers upstream) -----
  {
    id: "septa", agencies: ["septa"], format: "json", interval: 30, relay: true,
    credit: { label: "SEPTA", href: "https://www3.septa.org/developer/" },
    parse: parseSepta,
  },
  {
    id: "rtd", agencies: ["rtd"], format: "pb", interval: 30, relay: true,
    credit: { label: "RTD", href: "https://www.rtd-denver.com/open-records/open-spatial-information/real-time-feeds" },
    parse: async (buf) => gtfsVehicles("rtd", buf, {
      keep: (v) => v.trip?.routeId in RTD_LINES,
      route: (v) => RTD_LINES[v.trip.routeId],
      number: () => null, // the feed has no public train numbers
      west: (await loadTrips()).rtd,
    }),
  },
  {
    // UTA's GTFS-realtime feeds, which refuse the relay's servers; the relay
    // reads Transitland's copies instead (refreshed every few minutes, to stay
    // within its free quota). Route and departure data provided by
    // permission of UTA.
    id: "uta", agencies: ["frontrunner"], format: "pb", interval: 60, relay: true,
    credit: { label: "UTA (via Transitland)", href: "https://www.transit.land/feeds/f-9x0-uta~rt" },
    parse: async (buf) => gtfsVehicles("frontrunner", buf, {
      // FrontRunner consists report as L1, L2, ...; TRAX and buses use numeric ids.
      keep: (v) => /^L\d+$/.test(v.vehicle?.id || ""),
      route: () => "FrontRunner",
      number: () => null,
      // Stops and times from the trip updates and UTA's timetable.
      west: (await loadTrips()).frontrunner,
    }),
  },
  {
    id: "capmetro", agencies: ["capmetro"], format: "pb", interval: 30, relay: true,
    credit: { label: "CapMetro", href: "https://data.texas.gov" },
    parse: async (buf) => gtfsVehicles("capmetro", buf, {
      keep: (v) => v.trip?.routeId === "550",
      route: () => "Red Line",
      number: () => null,
      west: (await loadTrips()).capmetro,
    }),
  },
  {
    id: "trirail", agencies: ["trirail"], format: "pb", interval: 30, relay: true,
    credit: { label: "Tri-Rail", href: "https://www.tri-rail.com" },
    parse: (buf) => gtfsVehicles("trirail", buf, {
      route: () => "Tri-Rail",
      zeroHeading: true,
      number: (v) => (v.vehicle?.label || "").replace(/^P/, "") || null, // "P625" is train 625
    }),
  },
  // ----- through the relay, with an API key stored on the relay -----
  {
    id: "metra", agencies: ["metra"], format: "pb", interval: 30, relay: true, needsKey: "METRA_API_TOKEN",
    credit: { label: "Metra", href: "https://metra.com/developers" },
    parse: async (buf) => gtfsVehicles("metra", buf, {
      // The feed also lists equipment laid up in the yards, with no trip.
      keep: (v) => !!v.trip?.tripId,
      route: (v) => v.trip?.routeId,
      // Metra trip ids look like "UP-N_UN303_V3_A"; the train number is in the middle.
      number: (v) => (v.trip?.tripId || "").split("_")[1]?.replace(/^\D+/, "") || v.vehicle?.label,
      // Destination from the timetable; stops and times from the trip updates
      // the relay appends.
      west: (await loadTrips()).metra,
    }),
  },
  {
    // MDOT MTA's GTFS-realtime feeds: positions, plus predicted stop times
    // the relay appends. Trip ids carry the train number ("Train454").
    id: "marc", agencies: ["marc"], format: "pb", interval: 30, relay: true,
    credit: { label: "MDOT MTA", href: "https://www.mta.maryland.gov/developer-resources" },
    parse: async (buf) => gtfsVehicles("marc", buf, {
      route: (v) => ({ 11704: "Brunswick Line", 11705: "Penn Line", 11706: "Camden Line" })[v.trip?.routeId] || "MARC",
      number: (v) => (v.trip?.tripId || "").replace(/^Train\s*/i, "") || null,
      west: (await loadTrips()).marc,
    }),
  },
  {
    // Scraped from GO Tracker by the relay; no key needed.
    id: "go", agencies: ["go"], format: "json", interval: 20, relay: true,
    credit: { label: "GO Tracker", href: "https://www.gotracker.ca/gotracker/web/" },
    parse: parseGo,
  },
  {
    // Official GTFS-realtime (no CORS headers, so through the relay).
    id: "vre", agencies: ["vre"], format: "pb", interval: 60, relay: true,
    credit: { label: "VRE", href: "https://www.vre.org/" },
    parse: async (buf) => {
      const west = (await loadTrips()).vre;
      return gtfsVehicles("vre", buf, {
        route: (v) => ({ 2: "Fredericksburg Line", 4: "Manassas Line" })[v.trip?.routeId] || null,
        number: (v) => west.trips[v.trip?.tripId]?.[0] || null,
        west,
      });
    },
  },
  {
    // Sound Transit's GTFS-realtime (OneBusAway), through the relay.
    id: "sounder", agencies: ["sounder"], format: "pb", interval: 30, relay: true,
    credit: { label: "Sound Transit", href: "https://www.soundtransit.org/help-contacts/business-information/open-transit-data-otd" },
    parse: async (buf) => {
      const number = (v) => /_(\d+)$/.exec(v.trip?.tripId || "")?.[1] || null;
      return gtfsVehicles("sounder", buf, {
        keep: (v) => /^SNDR_/.test(v.trip?.routeId || ""),
        route: (v) => ({ SNDR_EV: "N Line", SNDR_TL: "S Line" })[v.trip?.routeId] || "Sounder",
        number, idOf: number,
        west: (await loadTrips()).sounder,
      });
    },
  },
  {
    // South Shore's own tracker, read directly (it allows browsers).
    id: "southshore", agencies: ["southshore"], format: "json", interval: 30, url: SOUTH_SHORE,
    credit: { label: "South Shore Line", href: "https://www.mysouthshoreline.com/" },
    parse: parseSouthShore,
  },
  {
    // Read from exo.quebec's live map by the relay; no key needed.
    id: "exo", agencies: ["exo"], format: "json", interval: 30, relay: true,
    credit: { label: "exo", href: "https://exo.quebec/" },
    parse: parseExo,
  },
  {
    // sunrail.com's train status, read directly.
    id: "sunrail", agencies: ["sunrail"], interval: 30,
    credit: { label: "SunRail", href: "https://sunrail.com/" },
    load: fetchSunRail, parse: parseSunRail,
  },
  {
    // No live data published: placed from the timetable.
    id: "railrunner", agencies: ["railrunner"], interval: 60,
    credit: { label: "Rail Runner timetable", href: "https://riometro.org/" },
    load: async () => null, parse: () => timetableTrains("railrunner"),
  },
  {
    // No live positions published: the timetable, adjusted by MTA TrainTime's
    // New Haven board (fetched directly; it allows browsers).
    id: "ctrail", agencies: ["ctrail"], interval: 60,
    credit: { label: "CTDOT timetable, MTA TrainTime", href: "https://www.hartfordline.com/" },
    load: fetchCtBoard, parse: parseCtrail,
  },
  {
    // Scraped from DepartureVision by the relay; no key needed.
    id: "njt", agencies: ["njt"], format: "json", interval: 30, relay: true,
    credit: { label: "NJ Transit DepartureVision", href: "https://www.njtransit.com/dv-to" },
    parse: parseNjt,
  },
  {
    id: "caltrain", agencies: ["caltrain"], format: "pb", interval: 30, relay: true, needsKey: "API_511_KEY",
    credit: { label: "511 SF Bay", href: "https://511.org/open-data" },
    parse: async (buf) => gtfsVehicles("caltrain", buf, { route: (v) => v.trip?.routeId || "Caltrain", west: (await loadTrips()).caltrain }),
  },
  {
    // ACE, through 511 (the relay fetches it once a minute).
    id: "ace", agencies: ["ace"], format: "pb", interval: 60, relay: true, needsKey: "API_511_KEY",
    credit: { label: "511 SF Bay", href: "https://511.org/open-data" },
    parse: async (buf) => gtfsVehicles("ace", buf, {
      route: () => "ACE",
      // Trip "ACE06" is train 6 ("ACE03H" its holiday run).
      number: (v) => (/^ACE0*(\d+)/.exec(v.trip?.tripId || "") || [])[1] || null,
      west: (await loadTrips()).ace,
    }),
  },
  {
    id: "smart", agencies: ["smart"], format: "pb", interval: 30, relay: true, needsKey: "API_511_KEY",
    credit: { label: "511 SF Bay", href: "https://511.org/open-data" },
    // The feed also lists parked and non-revenue cars; only ones on a trip are
    // running. Labels are car numbers, not train numbers, so none is shown.
    parse: async (buf) => gtfsVehicles("smart", buf, { keep: (v) => Boolean(v.trip?.tripId), route: () => "SMART", number: () => null, west: (await loadTrips()).smart }),
  },
  {
    id: "metrolink", agencies: ["metrolink"], format: "pb", interval: 30, relay: true, needsKey: "METROLINK_API_KEY",
    credit: { label: "Metrolink", href: "https://metrolinktrains.com/about/gtfs/" },
    parse: async (buf) => gtfsVehicles("metrolink", buf, { route: (v) => v.trip?.routeId, west: (await loadTrips()).metrolink }),
  },
];

export async function fetchSource(src, relayBase) {
  if (src.load) return src.parse(await src.load());
  // A per-feed address in config.js wins (for feeds that block the relay).
  const override = (window.TRAINSHEET_FEEDS || {})[src.id];
  const url = override || (src.relay ? `${relayBase.replace(/\/$/, "")}/feed/${src.id}` : src.url);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = src.format === "pb" ? await res.arrayBuffer() : await res.json();
  return src.parse(body);
}
