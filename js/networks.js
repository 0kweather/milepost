// Rail networks for coloring track: every railroad on the map, plus
// passenger railroads whose track we draw but don't (yet) track live.

import { AGENCIES } from "./sources.js?v=dev";

const UNTRACKED = {
  marc:       { name: "MARC",                 color: "#e86a10" },
  vre:        { name: "Virginia Railway Express", color: "#a6192e" },
  shoreline:  { name: "Shore Line East",      color: "#00838f" },
  southshore: { name: "South Shore Line",     color: "#8d1b3d" },
  sounder:    { name: "Sounder",              color: "#2a7f9e" },
  ace:        { name: "Altamont Corridor Express", color: "#7b3f98" },
  sunrail:    { name: "SunRail",              color: "#e6731c" },
  coaster:    { name: "Coaster",              color: "#6f3c96" },
  tre:        { name: "Trinity Railway Express", color: "#2a9d8f" },
  railrunner: { name: "Rail Runner",          color: "#c1121f" },
  wes:        { name: "WES Commuter Rail",    color: "#5b8c2a" },
  texrail:    { name: "TEXRail",              color: "#7d2248" },
  commuter:   { name: "Commuter rail",        color: "#8d95a3" },
};

export const NETWORKS = {
  ...Object.fromEntries(Object.entries(AGENCIES).map(([id, a]) => [id, { name: a.name, color: a.color }])),
  ...UNTRACKED,
};

// MapLibre expression: color for the network id stored in a feature property.
export function networkColor(prop) {
  const pairs = Object.entries(NETWORKS).flatMap(([id, n]) => [id, n.color]);
  return ["match", ["get", prop], ...pairs, UNTRACKED.commuter.color];
}
