// The interface in English or French. Strings are written in English in the
// code and looked up here: t("Next stop") is "Prochain arrêt" in French.
// Placeholders in braces are filled from vars: t("in {time}", { time }).
// Railroad, line and station names, and the railroads' own notices, stay as
// published.
//
// The language follows Settings ("tt-lang": "auto", "en" or "fr"); "auto"
// picks French for browsers set to French (Quebec's, say).
let pref = "auto";
try { pref = JSON.parse(localStorage.getItem("tt-lang")) || "auto"; } catch {}
export const langPref = pref;
export const lang = pref === "auto" ? (/^fr\b/i.test(navigator.language || "") ? "fr" : "en") : pref;
// The French strings (js/fr.js) are fetched only when they'll be used; the
// rest of the app waits for them (a module's top-level await holds up its
// importers), so nothing is ever drawn in English first.
const FR = lang === "fr" ? (await import("./fr.js?v=dev")).default : {};
// For dates and times: French as written in Canada.
export const locale = lang === "fr" ? "fr-CA" : undefined;
document.documentElement.lang = lang;

// Dates and times are set through Intl.DateTimeFormat, which costs some
// twenty times more to make than to use, and a page of forty stops has that
// many times on it, drawn again at every refresh. So each formatter (a
// locale, a style, a zone) is made once and kept. Given the options a
// toLocaleTimeString or toLocaleDateString call would get, it gives back
// the same string that call would.
const formatters = new Map();
export function dateFormat(options, loc = locale) {
  const key = `${loc}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(loc, options)));
  return f;
}

export function t(en, vars) {
  let s = lang === "fr" ? FR[en] ?? en : en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// "1 train" / "3 trains": the singular and plural forms, with {n}.
export const tn = (n, one, many, vars = {}) => t(n === 1 ? one : many, { n, ...vars });

// Static text in index.html: data-i18n (text), data-i18n-title,
// data-i18n-aria, data-i18n-placeholder hold the English to look up.
export function translatePage(root = document) {
  if (lang === "en") return;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n || el.textContent.trim());
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}
