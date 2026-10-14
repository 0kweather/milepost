// Sharing a train: a picture of it (its plate, its cars, where it is and
// whether it's on time) with a link back to it. Phones hand the picture to
// the share sheet; elsewhere a preview offers to save it or copy the link.

const W = 1200, H = 630, RATIO = 2;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';

// info: { title, number, color, railroad, route, where, status, statusColor,
//         cars: [svg strings, drawn standalone], url }
export async function shareTrain(info, toast) {
  let blob;
  try {
    blob = await drawCard(info);
  } catch (err) {
    console.warn("share card", err);
  }
  const file = blob && new File([blob], `trainsheet-${(info.number || "train").toString().replace(/\W+/g, "")}.png`, { type: "image/png" });
  const text = `${info.number ? `${info.railroad} ${info.number}` : info.railroad} ${info.title}${info.where ? ` · ${info.where}` : ""}`;
  if (file && navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ files: [file], title: info.title, text, url: info.url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  preview(blob, file, info, toast);
}

// A sheet over the page: the picture, Save image and Copy link.
function preview(blob, file, info, toast) {
  document.querySelector(".share-sheet")?.remove();
  const url = blob ? URL.createObjectURL(blob) : "";
  const el = document.createElement("div");
  el.className = "share-sheet";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Share this train");
  el.innerHTML = `<div class="share-card">
      ${url ? `<img src="${url}" alt="">` : ""}
      <div class="share-actions">
        ${url ? `<a class="btn small" href="${url}" download="${file.name}">Save image</a>` : ""}
        <button type="button" class="btn small primary" data-share-copy>Copy link</button>
        <button type="button" class="btn small" data-share-close>Done</button>
      </div>
    </div>`;
  const close = () => {
    el.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  el.addEventListener("click", async (e) => {
    if (e.target === el || e.target.closest("[data-share-close]")) return close();
    if (e.target.closest("[data-share-copy]")) {
      try {
        await navigator.clipboard.writeText(info.url);
        toast("Link copied.");
      } catch {
        toast(info.url);
      }
    }
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(el);
  el.querySelector("[data-share-copy]").focus();
}

async function drawCard(info) {
  const c = document.createElement("canvas");
  c.width = W * RATIO;
  c.height = H * RATIO;
  const g = c.getContext("2d");
  g.scale(RATIO, RATIO);
  g.fillStyle = "#f2f2f7";
  g.fillRect(0, 0, W, H);

  // The cars, large across a band tinted with the line's color, running off
  // the right edge.
  const band = 300;
  g.fillStyle = mix(info.color, "#ffffff", 0.84);
  g.fillRect(0, 0, W, band);
  const images = await Promise.all(info.cars.map(svgImage));
  const carH = 150, railY = band - 40;
  let x = 64;
  for (const img of images) {
    if (!img || x > W) continue;
    const w = (img.naturalWidth / img.naturalHeight) * carH;
    g.drawImage(img, x, railY - carH, w, carH);
    x += w - 2;
  }
  g.fillStyle = "#5a5f66";
  g.fillRect(0, railY - 6, W, 5);

  // Plate, name, route, where it is.
  let y = band + 56;
  let tx = 64;
  if (info.number) {
    g.font = `800 52px ${FONT}`;
    const tw = g.measureText(info.number).width;
    const pw = Math.max(86, tw + 36), ph = 80;
    plate(g, 64, y - 8, pw, ph, info.color);
    g.fillStyle = "#121417";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(info.number, 64 + pw / 2, y - 8 + 12 + (ph - 12) / 2 + 2);
    tx = 64 + pw + 24;
  }
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#000";
  g.font = `800 60px ${FONT}`;
  g.fillText(fit(g, info.title, W - tx - 64), tx, y + 54);
  y += 120;
  g.font = `600 30px ${FONT}`;
  g.fillStyle = info.color;
  g.fillText(fit(g, [info.railroad, info.route].filter(Boolean).join(" · "), W - 128), 64, y);
  y += 48;
  g.font = `400 32px ${FONT}`;
  g.fillStyle = "#1c1c1e";
  const where = info.where || "";
  g.fillText(fit(g, where, W - 128), 64, y);
  if (info.status) {
    const wx = 64 + g.measureText(where).width;
    g.font = `700 32px ${FONT}`;
    g.fillStyle = info.statusColor || "#248a3d";
    g.fillText(`${where ? " · " : ""}${info.status}`, wx, y);
  }
  g.font = `700 24px ${FONT}`;
  g.fillStyle = "rgba(60,60,67,0.6)";
  g.textAlign = "right";
  g.fillText("trainsheet.com", W - 56, H - 40);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

function plate(g, x, y, w, h, color) {
  const r = 14;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = "#fff";
  g.fill();
  g.clip();
  g.fillStyle = color;
  g.fillRect(x, y, w, 12);
  g.restore();
  g.beginPath();
  g.roundRect(x + 2, y + 2, w - 4, h - 4, r - 2);
  g.lineWidth = 4;
  g.strokeStyle = "#121417";
  g.stroke();
}

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// #rrggbb blended toward another color by k (0 = a, 1 = b).
function mix(a, b, k) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a)) return "#e9ecf2";
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
}

// A car's SVG as an image, its logos inlined (an SVG drawn to a canvas
// can't fetch them itself).
const logoCache = new Map();
async function svgImage(svg) {
  try {
    const hrefs = [...new Set([...svg.matchAll(/href="(img\/logos\/[^"]+)"/g)].map((m) => m[1]))];
    for (const h of hrefs) {
      if (!logoCache.has(h)) {
        const text = await (await fetch(h)).text();
        logoCache.set(h, `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`);
      }
      svg = svg.split(`href="${h}"`).join(`href="${logoCache.get(h)}"`);
    }
    if (!svg.includes("xmlns=")) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}
