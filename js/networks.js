// Rail networks for coloring track: every railroad on the map, plus
// passenger railroads whose track we draw but don't (yet) track live.

import { AGENCIES } from "./sources.js?v=dev";

const UNTRACKED = {
  coaster:    { name: "Coaster",              color: "#6f3c96" },
  tre:        { name: "Trinity Railway Express", color: "#2a9d8f" },
  wes:        { name: "WES Commuter Rail",    color: "#5b8c2a" },
  texrail:    { name: "TEXRail",              color: "#7d2248" },
  alaska:     { name: "Alaska Railroad",      color: "#1b4f9c" },
  go:         { name: "GO Transit",           color: "#3d8b37" },
  wce:        { name: "West Coast Express",   color: "#7a1f5c" },
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
