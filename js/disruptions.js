// Disruptions: stretches of line where a railroad says no trains are running
// right now (service suspended, or buses replacing trains), for drawing on
// the map. From the MTA's LIRR and Metro-North alerts (by their alert type:
// "Suspended", "Part Suspended", "Substitute Buses", planned or not) and the
// MBTA's commuter rail alerts (effect SUSPENSION or SHUTTLE). Each names the
// stations it covers, or the two it's between in its heading, or, for a
// whole MBTA line suspended, just the line.
//
// Returns [{ id, agency, header, description, url, buses, stops: [stop ids],
//            between: [name, name] | null, line: "Needham" | null,
//            routes: [line names it's about, as stations list their lines] }].

import { loadMtaStatic } from "./sources.js?v=dev";

const CACHE_MS = 2 * 60 * 1000;
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

// "Buses replace trains between Southeast and Wassaic" -> ["Southeast", "Wassaic"].
// The second name stops at punctuation or at words that start a new clause.
const BETWEEN = /\bbetween\s+(.+?)\s+and\s+(.+?)(?=[,.;:()]|\s+(?:on|from|until|through|with|due|for|while|all|to|in|stations?|starting|beginning|after|before)\b|$)/i;
export function betweenNames(text) {
  const m = BETWEEN.exec(String(text || "").replace(/\s+/g, " "));
  return m ? [m[1].trim(), m[2].trim()] : null;
}

const MTA_TYPES = /suspended|substitute bus/i;

let mtaRoutes = null; // "lirr:6" -> "Long Beach Branch" (data/mta.json, read once with sources.js)
async function mtaRouteName(agency, id) {
  mtaRoutes ??= loadMtaStatic().catch(() => ({}));
  return (await mtaRoutes)?.[agency]?.routes?.[id]?.[0] || null;
}

async function mtaDisruptions(agency) {
  const data = await getJson(`https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2F${agency}-alerts.json`);
  const out = [];
  for (const e of data.entity || []) {
    const a = e.alert;
    const type = a?.["transit_realtime.mercury_alert"]?.alert_type || "";
    if (!a || !MTA_TYPES.test(type) || !activeNow(a.active_period)) continue;
    const header = english(a.header_text), description = english(a.description_text);
    const routeIds = [...new Set((a.informed_entity || []).map((x) => x.route_id).filter(Boolean))];
    const routes = (await Promise.all(routeIds.map((r) => mtaRouteName(agency, r)))).filter(Boolean);
    out.push({
      id: `${agency}:${e.id}`, agency, header, description, url: null,
      buses: /bus/i.test(type),
      stops: [...new Set((a.informed_entity || []).map((x) => x.stop_id).filter(Boolean))],
      between: betweenNames(header) || betweenNames(description),
      line: null,
      routes,
    });
  }
  return out;
}

async function mbtaDisruptions() {
  const data = await getJson("https://api-v3.mbta.com/alerts?filter%5Broute_type%5D=2&filter%5Bdatetime%5D=NOW");
  const out = [];
  for (const { id, attributes: a } of data.data || []) {
    if (a.effect !== "SUSPENSION" && a.effect !== "SHUTTLE") continue;
    const ents = a.informed_entity || [];
    const stops = [...new Set(ents.map((x) => x.stop).filter((s) => s?.startsWith("place-")))];
    const routes = [...new Set(ents.map((x) => x.route).filter((r) => r?.startsWith("CR-")))];
    out.push({
      id: `mbta:${id}`, agency: "mbta", header: a.header, description: a.description || "", url: a.url || null,
      buses: a.effect === "SHUTTLE",
      stops,
      between: betweenNames(a.header),
      // A line suspended end to end names no stations: "CR-Needham" -> "Needham".
      line: !stops.length && routes.length === 1 ? routes[0].slice(3) : null,
      routes: routes.map((r) => r.slice(3)), // "CR-NewBedford" -> "NewBedford"
    });
  }
  return out;
}

// Whether a station's line (as stations.json names it: "Framingham /
// Worcester Line", "Waterbury") is one a disruption is about ("Worcester").
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(line|branch)$/, "");
export const aboutLine = (d, line) => d.routes.some((r) => squash(line).includes(squash(r)) || squash(r).includes(squash(line)));

export async function loadDisruptions() {
  const lists = await Promise.all([mtaDisruptions("lirr"), mtaDisruptions("mnr"), mbtaDisruptions()].map((p) => p.catch((err) => {
    console.warn("disruptions", err);
    return [];
  })));
  // The same notice listed twice (once per direction) draws once.
  const seen = new Set();
  return lists.flat().filter((d) => d.header && !seen.has(`${d.agency}|${d.header}`) && seen.add(`${d.agency}|${d.header}`));
}
