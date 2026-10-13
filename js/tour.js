// The guided tour: a short walk through the app that drives the real thing.
// It spotlights one part at a time with a card beside it, opening a live
// train and one of its stations along the way. Started from Settings or the
// list's footer; Escape or × ends it, the arrow keys step through.

let tour = null; // { steps, i, demo, frame, el: { shade, ring, card } }

// app: { state, map, select, selectStation, closeDetail, setSheet, isPhone, targetOf, visible, padding }
export function startTour(app) {
  if (tour) endTour();
  const demo = pickTrain(app);
  const stopStation = demo && nextStation(app, demo);
  const steps = [
    {
      title: "Welcome to Trainsheet",
      text: "Passenger trains across the US and Canada, live on one map. This tour takes about a minute; you can leave it any time.",
      enter: () => app.closeDetail(),
    },
    demo && {
      title: "Trains on the map",
      text: "Each arrow is a train, pointing the way it's heading, in its railroad's color. Trains placed from their timetable rather than GPS are marked estimated. Tap one to open it.",
      enter: () => {
        app.closeDetail();
        const p = app.targetOf(demo);
        app.map.jumpTo({ center: [p.lon, p.lat], zoom: Math.max(app.map.getZoom(), 9), padding: app.padding() });
        if (app.isPhone) app.setSheet("collapsed");
      },
      target: () => {
        const p = app.targetOf(demo), pt = app.map.project([p.lon, p.lat]), r = app.map.getContainer().getBoundingClientRect();
        return { left: r.left + pt.x - 22, top: r.top + pt.y - 22, width: 44, height: 44, round: true };
      },
    },
    {
      title: "Search",
      text: "Find a train by its number, or a station, a line or a city.",
      enter: () => { app.closeDetail(); if (app.isPhone) app.setSheet(""); },
      target: "#search",
    },
    {
      title: "Railroads",
      text: "Every railroad on the map, with how many of its trains are running. Tap one to hide or show its trains, or its circled i for its page: what's running, its lines, its fleet and its stations.",
      enter: () => { app.closeDetail(); if (app.isPhone) app.setSheet("expanded"); },
      target: "#agencies",
    },
    {
      title: "Settings",
      text: "Dark mode, units, train labels, your time zone, and which trains show on the map. You can restart this tour from here too.",
      enter: () => { app.closeDetail(); if (app.isPhone) app.setSheet(""); },
      target: "#settings-btn",
    },
    demo && {
      title: "A train's page",
      text: "Where it's going, whether it's on time, and its cars, drawn as they run on this train (or as they usually do on this line).",
      enter: () => { if (app.state.selected !== demo.id) app.select(demo.id); if (app.isPhone) app.setSheet("expanded"); },
      target: "#train-detail .hero",
    },
    demo && {
      title: "The cars",
      text: "Tap a car or locomotive to read about that model: who built it, how fast it goes, and its history.",
      enter: () => { if (app.state.selected !== demo.id) app.select(demo.id); if (app.isPhone) app.setSheet("expanded"); },
      target: "#train-detail .consist-strip",
      optional: true,
    },
    demo && {
      title: "Stops and tracking",
      text: "Every stop with its live time. Tap a station's name to open it. Tap a stop's circle to track the train until there: it stays pinned at the top, and you're told when it arrives.",
      enter: () => { if (app.state.selected !== demo.id) app.select(demo.id); if (app.isPhone) app.setSheet("expanded"); },
      target: "#train-detail .stops-scroll",
      optional: true,
    },
    demo && {
      title: "Follow the train",
      text: "Keeps the train in the middle of the map as it moves.",
      enter: () => { if (app.state.selected !== demo.id) app.select(demo.id); if (app.isPhone) app.setSheet(""); },
      target: "#follow-btn",
    },
    stopStation && {
      title: "Stations",
      text: "A station's page lists the next departures and arrivals from every railroad that stops there, with tracks, service notices and step-free access where the railroads publish them.",
      enter: () => { if (app.state.station !== stopStation) app.selectStation(stopStation); if (app.isPhone) app.setSheet("expanded"); },
      target: "#train-detail",
    },
    {
      title: "That's the tour",
      text: "Enjoy the trains. You can take the tour again from Settings.",
      enter: () => { app.closeDetail(); if (app.isPhone) app.setSheet(""); },
      last: true,
    },
  ].filter(Boolean);

  const shade = document.createElement("div");
  shade.className = "tour-shade";
  const ring = document.createElement("div");
  ring.className = "tour-ring";
  const card = document.createElement("div");
  card.className = "tour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("aria-label", "Tour");
  document.body.append(shade, ring, card);
  tour = { steps, i: 0, el: { shade, ring, card } };
  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-tour-next]")) go(tour.i + 1);
    else if (e.target.closest("[data-tour-back]")) go(tour.i - 1);
    else if (e.target.closest("[data-tour-close]")) endTour();
  });
  shade.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", onKey, true);
  go(0);
  const tick = () => {
    if (!tour) return;
    place();
    tour.frame = requestAnimationFrame(tick);
  };
  tour.frame = requestAnimationFrame(tick);
}

export function endTour() {
  if (!tour) return;
  cancelAnimationFrame(tour.frame);
  Object.values(tour.el).forEach((e) => e.remove());
  document.removeEventListener("keydown", onKey, true);
  tour = null;
}

function onKey(e) {
  if (!tour) return;
  if (e.key === "Escape") { e.stopPropagation(); endTour(); }
  else if (e.key === "ArrowRight") go(tour.i + 1);
  else if (e.key === "ArrowLeft") go(tour.i - 1);
}

function go(i) {
  if (!tour) return;
  if (i >= tour.steps.length) return endTour();
  i = Math.max(0, i);
  const back = i < tour.i;
  tour.i = i;
  const step = tour.steps[i];
  step.enter?.();
  // A step whose part isn't on this page (a train with no cars drawn or no
  // stop list) is skipped.
  if (step.optional && !findTarget(step)) return go(back ? i - 1 : i + 1);
  const n = tour.steps.length;
  tour.el.card.innerHTML = `
    <div class="tour-head"><span class="tour-count">${i + 1} of ${n}</span>
      <button type="button" class="tour-x" data-tour-close aria-label="End the tour">×</button></div>
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    <div class="tour-actions">
      ${i > 0 ? '<button type="button" class="btn small" data-tour-back>Back</button>' : ""}
      <button type="button" class="btn small primary" data-tour-next>${step.last ? "Done" : i === 0 ? "Start" : "Next"}</button>
    </div>`;
  const el = typeof step.target === "string" && document.querySelector(step.target);
  el?.scrollIntoView?.({ block: "nearest" });
  tour.el.card.querySelector("[data-tour-next]").focus({ preventScroll: true });
  place();
}

function findTarget(step) {
  if (!step.target) return null;
  if (typeof step.target === "function") return step.target();
  const el = document.querySelector(step.target);
  if (!el || !el.offsetParent) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? r : null;
}

// Spotlight the step's part and put the card beside it, kept on screen.
function place() {
  const { shade, ring, card } = tour.el;
  const r = findTarget(tour.steps[tour.i]);
  const pad = 6, vw = innerWidth, vh = innerHeight;
  if (!r) {
    shade.classList.add("on");
    ring.hidden = true;
    card.style.left = `${Math.max(12, (vw - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(12, (vh - card.offsetHeight) / 2)}px`;
    return;
  }
  shade.classList.remove("on");
  ring.hidden = false;
  // Clipped to the window (a long stop list runs off the bottom).
  const left = Math.max(4, r.left - pad), top = Math.max(4, r.top - pad);
  const right = Math.min(vw - 4, r.left + r.width + pad), bottom = Math.min(vh - 4, r.top + r.height + pad);
  Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
  ring.classList.toggle("round", Boolean(r.round));
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 12;
  let x, y;
  if (vw > 720 && right + gap + cw < vw - 12) { x = right + gap; y = top; }            // beside it (wide screens)
  else if (bottom + gap + ch < vh - 12) { x = left; y = bottom + gap; }                // below
  else if (top - gap - ch > 12) { x = left; y = top - gap - ch; }                       // above
  else { x = (vw - cw) / 2; y = 12; }                                                  // over the top of the map
  card.style.left = `${Math.max(12, Math.min(x, vw - cw - 12))}px`;
  card.style.top = `${Math.max(12, Math.min(y, vh - ch - 12))}px`;
}

// A good train to show: on the map, with stops still ahead and cars drawn;
// GPS-located and intercity preferred.
function pickTrain(app) {
  const all = [...app.state.trains.values()].filter((t) => Number.isFinite(t.lat) && app.visible(t));
  const score = (t) => (t.stops?.some((s) => s.status === "future") ? 4 : 0) + (t.estimated ? 0 : 2) + (t.agency === "amtrak" ? 1 : 0);
  return all.sort((a, b) => score(b) - score(a))[0] || null;
}

function nextStation(app, t) {
  const s = t.stops?.find((x) => x.status !== "past" && x.key && app.state.stationOfKey?.has(x.key));
  return s ? app.state.stationOfKey.get(s.key) : null;
}
