// client/i18n.js - text lookup, en and no from day one.
//
// The catalogues live in data/i18n/ and are deliberately NOT part of the
// ruleset the engine hashes: they contain non-ASCII text, and the canonical
// state walk rejects that on purpose. Language is a presentation choice and
// cannot move a state hash - a Norwegian player and an English one are playing
// the same war down to the byte.
//
// A missing key falls back to English and then to the key itself, so a gap in
// a translation degrades to readable rather than blank. The test enforces that
// the two catalogues have identical key sets, which is what actually keeps
// them honest.

const DEFAULT_LANG = 'en';
const LANGS = ['en', 'no'];

function pickLang(requested, navigatorLanguage) {
  if (LANGS.includes(requested)) return requested;
  const browser = String(navigatorLanguage ?? '').slice(0, 2).toLowerCase();
  // Norwegian shows up as nb, nn, or no depending on the browser.
  if (browser === 'nb' || browser === 'nn' || browser === 'no') return 'no';
  return LANGS.includes(browser) ? browser : DEFAULT_LANG;
}

async function fetchCatalog(lang, base = '/data/i18n') {
  const response = await fetch(`${base}/${lang}.json`);
  if (!response.ok) throw new Error(`cannot load catalogue ${lang}: ${response.status}`);
  return response.json();
}

function fill(template, vars) {
  if (vars === undefined) return template;
  let out = template;
  for (const name of Object.keys(vars)) {
    out = out.split(`{${name}}`).join(String(vars[name]));
  }
  return out;
}

function createTranslator(catalog, fallback) {
  return function translate(key, vars) {
    const template = catalog[key] ?? (fallback === undefined ? undefined : fallback[key]) ?? key;
    return fill(template, vars);
  };
}

export { DEFAULT_LANG, LANGS, pickLang, fetchCatalog, createTranslator, fill };
