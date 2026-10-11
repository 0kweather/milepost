// Address of your deployed relay (see relay/README.md), e.g.
// "https://trainsheet-relay.yourname.workers.dev". Leave empty to show only
// the feeds browsers can read directly.
window.TRAINSHEET_RELAY = "https://traintracker-relay.alexanderbronzini.workers.dev";

// Per-feed addresses that override the relay, for feeds that block it.
// UTA refuses Cloudflare, so FrontRunner can come from the Vercel function in
// api/uta.js: { uta: "https://<project>.vercel.app/api/uta" }
window.TRAINSHEET_FEEDS = {};
