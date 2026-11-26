// Campaign attribution + lead classification for CRM leads. The browser sends the visitor's UTM tags (only
// after they accepted measurement cookies). This keeps the four we track and builds the Lead fields:
//   leadType      what kind of form it was (set by the server from the endpoint, never by the browser)
//   source        marketing origin from utm_source as a short code (FB, IG, ZALO...), omitted when unknown
//   utmTagList    one Array field: a chip per tag, e.g. ["source: facebook", "campaign: workshop-t11"]
//   requestedItem the course / document / event the lead asked for
const KEYS = ['source', 'medium', 'campaign', 'content'];

const clean = (v) => String(v == null ? '' : v)
  .replace(/[\u0000-\u001f\u007f|=]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

// The channels we track. Anything else that arrives as utm_source is recorded as "other".
const CHANNELS = { facebook: 'social', instagram: 'social', zalo: 'social', thread: 'social', tiktok: 'social', email: 'email', website: 'web', referral: 'referral', other: 'other' };
const ALIASES = { fb: 'facebook', meta: 'facebook', ig: 'instagram', insta: 'instagram', threads: 'thread', mail: 'email', 'e-mail': 'email', newsletter: 'email', web: 'website', site: 'website' };
function canonicalSource(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const x = ALIASES[s] || s;
  return Object.prototype.hasOwnProperty.call(CHANNELS, x) ? x : 'other';
}

// -> {source, medium, campaign, content} with only non-empty, sanitised values (or null)
function parse(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const k of KEYS) { const v = clean(input[k]); if (v) out[k] = v; }
  if (out.source) out.source = canonicalSource(out.source);
  return Object.keys(out).length ? out : null;
}

// -> "source=… | medium=… | campaign=… | content=…" or '' when nothing was sent
const utmTags = (input) => {
  const p = parse(input);
  return p ? KEYS.filter((k) => p[k]).map((k) => `${k}=${p[k]}`).join(' | ') : '';
};

const TYPES = { course: 'COURSE_REGISTRATION', document: 'MATERIAL_DOWNLOAD', event: 'EVENT_REGISTRATION', other: 'OTHERS' };

// channel -> short code for the Lead's Source select. Thread, Website, Referral and Other have no code in Twenty yet:
// they stay in the UTM tags, and the Source field is left empty for them.
const SOURCE_CODE = { facebook: 'FB', instagram: 'IG', zalo: 'ZALO', tiktok: 'TIKTOK', email: 'EMAIL' };
function sourceCode(source) {
  const c = canonicalSource(source);
  return c ? (SOURCE_CODE[c] || null) : null;
}

// Fields to merge into the POST /leads body. `type` is one of TYPES' keys.
function leadFields({ type, requestedItem, utm }) {
  const p = parse(utm);
  const out = { leadType: TYPES[type] || TYPES.other };
  if (requestedItem) out.requestedItem = String(requestedItem).slice(0, 300);
  if (p) {
    const src = sourceCode(p.source);
    if (src) out.source = src;
    out.utmTagList = KEYS.filter((k) => p[k]).map((k) => `${k}: ${p[k].toLowerCase()}`);
  }
  return out;
}

module.exports = { parse, utmTags, leadFields, sourceCode, canonicalSource, CHANNELS, KEYS, TYPES };
