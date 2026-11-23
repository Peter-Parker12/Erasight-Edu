// Campaign attribution + lead classification for CRM leads. The browser sends the visitor's UTM tags (only
// after they accepted measurement cookies). This keeps the four we track and builds the Lead fields:
//   leadType      what kind of form it was (set by the server from the endpoint, never by the browser)
//   source        marketing origin from utm_source as a short code (FB, IG, ZALO...), omitted when unknown
//   utmTagList    one Array field: a chip per tag, e.g. ["source: facebook", "campaign: workshop-t11"]
//   requestedItem the course / document / event the lead asked for
const KEYS = ['source', 'medium', 'campaign', 'content'];

const clean = (v) => String(v == null ? '' : v)
  .replace(/[\u0000-\u001f\u007f|=]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

// -> {source, medium, campaign, content} with only non-empty, sanitised values (or null)
function parse(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const k of KEYS) { const v = clean(input[k]); if (v) out[k] = v; }
  return Object.keys(out).length ? out : null;
}

// -> "source=… | medium=… | campaign=… | content=…" or '' when nothing was sent
const utmTags = (input) => {
  const p = parse(input);
  return p ? KEYS.filter((k) => p[k]).map((k) => `${k}=${p[k]}`).join(' | ') : '';
};

const TYPES = { course: 'COURSE_REGISTRATION', document: 'MATERIAL_DOWNLOAD', event: 'EVENT_REGISTRATION', other: 'OTHERS' };

// utm_source -> short code for the Lead's Source select. Unknown or missing source -> null (field left empty).
const SOURCE_RULES = [
  [/facebook|^fb$|^meta$/, 'FB'], [/instagram|^ig$/, 'IG'], [/zalo/, 'ZALO'], [/tiktok/, 'TIKTOK'],
  [/youtube|^yt$/, 'YT'], [/google/, 'GOOGLE'], [/^e-?mail$|newsletter/, 'EMAIL'],
];
function sourceCode(source) {
  const s = String(source || '').toLowerCase();
  const hit = s && SOURCE_RULES.find(([re]) => re.test(s));
  return hit ? hit[1] : null;
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

module.exports = { parse, utmTags, leadFields, sourceCode, KEYS, TYPES };
