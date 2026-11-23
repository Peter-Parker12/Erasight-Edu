// Allow-list HTML sanitizer for e-mail bodies written in the admin's rich-text editor (zero dependencies).
// Used twice: when a body is SAVED (structure + placeholders such as {{join_link}} are kept) and when it is RENDERED
// for a recipient (placeholders are already filled in; inline styles are added so Gmail / Outlook show it properly).
// Anything not on the allow-list (scripts, event handlers, iframes, forms, data: URLs, classes ...) is removed,
// tags are re-balanced and every attribute value is re-escaped, so the output is safe to put inside the e-mail layout.
'use strict';

const TAGS = new Set(['p', 'br', 'hr', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'span']);
const MAP = { b: 'strong', i: 'em', strike: 's', del: 's', div: 'p', section: 'p', article: 'p', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3' };
const VOID = new Set(['br', 'hr', 'img']);
const BLOCK = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'hr']);
const INLINE = new Set(['span', 'strong', 'em', 'u', 's', 'a']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math|head|title|textarea|select|form|button|video|audio|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const MAX_DEPTH = 24;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', nbsp: ' ', lpar: '(', rpar: ')', sol: '/' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  const v = NAMED[e.toLowerCase()]; return v === undefined ? m : v;
});
const fixText = (s) => s.replace(/&(?![a-zA-Z]{2,8};|#\d{1,6};|#x[0-9a-f]{1,6};)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const squash = (v) => v.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');

// ---- inline style allow-list -------------------------------------------------------
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}(?:\s*,\s*[\d.]+)?\s*\)|[a-z]{3,20})$/i;
const STYLE_RULES = {
  color: (v) => COLOR.test(v),
  'background-color': (v) => COLOR.test(v),
  'text-align': (v) => /^(left|center|right|justify)$/i.test(v),
  'font-size': (v) => /^\d{1,2}(\.\d)?px$/.test(v) && parseFloat(v) >= 10 && parseFloat(v) <= 40,
  'font-weight': (v) => /^(bold|normal|[1-9]00)$/i.test(v),
  'font-style': (v) => /^(italic|normal)$/i.test(v),
  'text-decoration': (v) => /^(underline|line-through|none)$/i.test(v),
};
function cleanStyle(raw) {
  const out = {};
  for (const decl of decode(raw).split(';')) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase(); const v = decl.slice(i + 1).trim().replace(/\s*!important$/i, '');
    if (STYLE_RULES[k] && v.length <= 40 && STYLE_RULES[k](v)) out[k] = v.toLowerCase();
  }
  return out;
}
const styleStr = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

// ---- inline styles added when rendering (e-mail clients ignore <style> blocks) -------------
const BASE = {
  p: 'margin:0 0 14px;font-size:15px;line-height:1.7;color:#0C2A3A',
  h2: 'margin:22px 0 8px;font-size:18px;line-height:1.35;color:#0C2A3A',
  h3: 'margin:18px 0 6px;font-size:16px;line-height:1.4;color:#0C2A3A',
  ul: 'margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#0C2A3A',
  ol: 'margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#0C2A3A',
  li: 'margin:0 0 6px',
  blockquote: 'margin:0 0 14px;padding:4px 0 4px 14px;border-left:3px solid #0DA096;font-size:15px;line-height:1.7;color:#4A6572',
  hr: 'border:0;border-top:1px solid #DDE7E7;margin:20px 0',
  a: 'color:#07736C;text-decoration:underline',
};
const BUTTON = 'display:inline-block;background:#E85D04;color:#ffffff;padding:12px 22px;border-radius:10px;font-weight:700;font-size:15px;line-height:1.2;text-decoration:none';
const IMG = 'display:block;max-width:100%;height:auto;border:0;border-radius:8px';

// ---- attribute validation ----------------------------------------------------------------
function cleanHref(v, render) {
  const x = squash(decode(v));
  if (/^(https?:\/\/|mailto:|tel:)[^\s]*$/i.test(x) && x.length <= 2000) return decode(v).trim();
  if (!render && /^\{\{\s*[a-z_]+\s*\}\}[^\s"'<>]*$/i.test(x)) return decode(v).trim(); // {{join_link}} etc., filled in per recipient
  return null;
}
function cleanSrc(v, render, site) {
  let x = decode(v).trim(); const k = squash(x);
  if (/^\/api\/email-images\/[A-Za-z0-9._-]+$/.test(k)) { x = k; if (render) x = String(site || '') + x; }
  else if (!/^https?:\/\/[^\s]+$/i.test(k)) return null;
  return /^https?:\/\//i.test(squash(x)) || !render ? x : null;
}

function buildTag(name, rawAttrs, render, site) {
  const attrs = {}; let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(rawAttrs))) {
    const k = m[1].toLowerCase(); const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    if (!(k in attrs)) attrs[k] = v;
  }
  const out = {}; let style = {}; let btn = false; let center = false;
  if (attrs.style !== undefined) style = cleanStyle(attrs.style);
  if (name === 'a') {
    const href = attrs.href !== undefined ? cleanHref(attrs.href, render) : null;
    if (href) out.href = href;
    if (attrs['data-btn'] === '1' && href) btn = true;
  } else if (name === 'img') {
    const src = attrs.src !== undefined ? cleanSrc(attrs.src, render, site) : null;
    if (!src) return null;
    out.src = src;
    out.alt = decode(attrs.alt || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    const w = squash(attrs.width || '');
    if (/^\d{1,3}%$/.test(w) && +w.slice(0, -1) >= 5 && +w.slice(0, -1) <= 100) out.width = w;
    else if (/^\d{2,3}$/.test(w) && +w >= 20 && +w <= 600) out.width = w;
    if (attrs['data-align'] === 'center') { center = true; }
    if (!render) { if (center) out['data-align'] = 'center'; }
  } else if (name === 'br' || name === 'hr') { /* no attributes */ }
  let sOut = {};
  if (render) {
    const base = name === 'img' ? IMG + (center ? ';margin:0 auto 14px' : ';margin:0 0 14px') : btn ? BUTTON : (BASE[name] || '');
    for (const part of base.split(';')) { const i = part.indexOf(':'); if (i > 0) sOut[part.slice(0, i)] = part.slice(i + 1); }
  }
  if (name !== 'img') {
    if (render && btn) { if (style['text-align']) sOut['text-align'] = style['text-align']; } // a button keeps its own look
    else Object.assign(sOut, style);
  }
  const sStr = styleStr(sOut);
  if (name === 'a' && btn && !render) out['data-btn'] = '1';
  let s = '';
  for (const [k, v] of Object.entries(out)) s += ` ${k}="${esc(v)}"`;
  if (sStr) s += ` style="${esc(sStr)}"`;
  if (name === 'a' && render && out.href) s += ' target="_blank" rel="noopener"';
  return s;
}

// html -> sanitized html. opts: { render: bool, site: 'https://host' }
function sanitize(html, opts) {
  const render = !!(opts && opts.render); const site = (opts && opts.site || '').replace(/\/+$/, '');
  let src = String(html == null ? '' : html).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (let i = 0; i < 4 && DROP_WITH_CONTENT.test(src); i++) { DROP_WITH_CONTENT.lastIndex = 0; src = src.replace(DROP_WITH_CONTENT, ''); }
  DROP_WITH_CONTENT.lastIndex = 0;
  const out = []; const stack = [];
  const close = () => out.push(`</${stack.pop()}>`);
  let last = 0; let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    if (m.index > last) out.push(fixText(src.slice(last, m.index)));
    last = TAG_RE.lastIndex;
    let name = m[2].toLowerCase(); name = MAP[name] || name;
    if (!TAGS.has(name)) continue;
    if (m[1] === '/') {
      if (VOID.has(name)) continue;
      const i = stack.lastIndexOf(name); if (i < 0) continue;
      while (stack.length > i) close();
      continue;
    }
    const top = () => stack[stack.length - 1];
    const textual = () => stack.length > 0 && (INLINE.has(top()) || top() === 'p' || top() === 'h2' || top() === 'h3');
    if (BLOCK.has(name)) { while (textual()) close(); }
    if (name === 'li') {
      if (top() === 'li') close();
      else while (textual()) close();
      if (top() !== 'ul' && top() !== 'ol') continue;
    }
    if (stack.length >= MAX_DEPTH) continue;
    if (name === 'br') { out.push('<br>'); continue; }
    const attrs = buildTag(name, m[3] || '', render, site);
    if (attrs === null) continue; // e.g. an <img> without a usable source
    out.push(`<${name}${attrs}>`);
    if (!VOID.has(name)) stack.push(name);
  }
  if (last < src.length) out.push(fixText(src.slice(last)));
  while (stack.length) close();
  return out.join('');
}

// true when the (sanitized) html has neither visible text nor an image
function isEmpty(html) {
  if (/<img\b/i.test(html)) return false;
  return !decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/[\s\u00a0\u200b]+/g, '');
}

module.exports = { sanitize, isEmpty, esc };
