// Locale, formatting and the string lookup. Thai dates use the Buddhist era, and both
// locales use Arabic digits everywhere — a reader comparing 512 with ๕๑๒ makes mistakes.

import { en, th } from './strings.js';

const CATALOGUES = { en, th };
const STORE = 'dm.locale';

let locale = 'en';

export function initLocale() {
  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch { /* storage may be blocked */ }
  if (saved === 'en' || saved === 'th') locale = saved;
  else locale = detected();
  apply();
  return locale;
}

export const detected = () =>
  (navigator.languages || [navigator.language || 'en']).some((l) => String(l).toLowerCase().startsWith('th'))
    ? 'th' : 'en';

export const getLocale = () => locale;

export function setLocale(next, remember = true) {
  locale = next === 'th' ? 'th' : 'en';
  if (remember) { try { localStorage.setItem(STORE, locale); } catch { /* ignore */ } }
  apply();
}

export function followDevice() {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  locale = detected();
  apply();
}

export function followingDevice() {
  try { return localStorage.getItem(STORE) === null; } catch { return true; }
}

function apply() {
  document.documentElement.lang = locale;
}

/** t('phrase.range', {from: 5, to: 8, total: 24}) — whole strings, named placeholders only. */
export function t(key, vars) {
  const s = (CATALOGUES[locale] && CATALOGUES[locale][key]) ?? en[key];
  if (s === undefined) return key;          // visible in dev, never a silent blank
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---------------------------------------------------------------- formatting

const dateFmt = () => new Intl.DateTimeFormat(
  locale === 'th' ? 'th-TH-u-ca-buddhist-nu-latn' : 'en-GB',
  { day: 'numeric', month: 'long', year: 'numeric' },
);

const timeFmt = () => new Intl.DateTimeFormat(
  locale === 'th' ? 'th-TH-u-nu-latn' : 'en-GB',
  { hour: '2-digit', minute: '2-digit', hour12: false },
);

/** Day granularity — what a locked vault is allowed to show. */
export const formatDate = (ms) => dateFmt().format(new Date(ms));

/** Exact timestamp — only ever shown inside an open vault. */
export function formatDateTime(ms) {
  const d = new Date(ms);
  const date = dateFmt().format(d);
  const time = timeFmt().format(d);
  return locale === 'th' ? `${date} เวลา ${time} น.` : `${date}, ${time}`;
}

export const formatSize = (bytes) =>
  bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

export const formatClock = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const daysSince = (ms) => Math.floor((Date.now() - ms) / 86400000);

/** Filenames are never localised, and always use the Gregorian year so they sort. */
export function backupFilename(fingerprint) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `dyingmessage-${fingerprint}-${stamp}.dmv`;
}
