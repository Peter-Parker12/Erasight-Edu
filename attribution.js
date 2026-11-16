// Campaign attribution for CRM leads. The browser sends the visitor's UTM tags (only after they accepted
// measurement cookies); this keeps the four we track and folds them into ONE short string for the Lead's
// `utmTags` field, e.g. "source=facebook | medium=social | campaign=workshop-t11 | content=banner-a".
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

module.exports = { parse, utmTags, KEYS };
