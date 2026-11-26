// Link shortener for campaign (UTM) links. Zero dependencies.
//   Public:  GET /s/<code>                      -> 302 to the stored destination (full URL, UTM tags included), counts the click
//   Admin:   GET    /api/admin/short-links[?path=/su-kien/x]   list (optionally only links to one page)
//            POST   /api/admin/short-links {url, label?}       create (same URL -> same code)
//            DELETE /api/admin/short-links/<code>
// The destination keeps its utm_* query string, so when a visitor lands on the page the normal tracking (tracking.js ->
// lead UTM fields) works exactly as with the long link. Only this site's own URLs can be shortened (no open redirect).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters
const CODE_LEN = 6;
const MAX_LINKS = 5000;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|zalo|embedly|headless/i;

module.exports = function init({ DATA_DIR, SITE_URL, send, readJson, rateLimited, isAdmin }) {
  const FILE = path.join(DATA_DIR, 'short-links.json');
  const SITE = String(SITE_URL).replace(/\/+$/, '');
  const hosts = new Set([new URL(SITE).host, ...String(process.env.SHORT_LINK_HOSTS || '').split(/[\s,]+/).filter(Boolean)]);
  const fail = (status, error) => Object.assign(new Error(error), { status });

  let links = [];
  try { links = JSON.parse(fs.readFileSync(FILE, 'utf8')).links || []; } catch { /* first run */ }
  const byCode = new Map(links.map((l) => [l.code, l]));
  let dirty = false; let saveTimer = null;
  function saveNow() {
    dirty = false; saveTimer = null;
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ links }, null, 1)); fs.renameSync(tmp, FILE); }
    catch (e) { console.error('short-links save failed:', e.message); dirty = true; }
  }
  function save(now) { dirty = true; if (now) return saveNow(); if (!saveTimer) { saveTimer = setTimeout(saveNow, 5000); saveTimer.unref && saveTimer.unref(); } }
  process.on('exit', () => { if (dirty) saveNow(); });

  const view = (l) => ({ code: l.code, path: '/s/' + l.code, shortUrl: SITE + '/s/' + l.code, url: l.url, label: l.label || '', clicks: l.clicks || 0, createdAt: l.createdAt, lastClickAt: l.lastClickAt || null });

  // Accepts a full URL on one of our hosts, or a path starting with "/". Returns the normalised absolute URL.
  function normalise(raw) {
    const s = String(raw || '').trim();
    if (!s || s.length > 2000) throw fail(400, 'Link không hợp lệ');
    let u;
    try { u = s.startsWith('/') && !s.startsWith('//') ? new URL(SITE + s) : new URL(s); } catch { throw fail(400, 'Link không hợp lệ'); }
    if (!/^https?:$/.test(u.protocol) || !hosts.has(u.host)) throw fail(400, 'Chỉ rút gọn được link thuộc website Erasight Academy');
    if (u.pathname.startsWith('/s/') || u.pathname.startsWith('/api/')) throw fail(400, 'Không thể rút gọn link này');
    u.hash = '';
    return u.toString();
  }
  // Custom endings: 3-30 letters, digits or dashes. Some words are used by the site itself.
  const CODE_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
  const RESERVED = new Set(['admin', 'api', 'mcp', 's', 'su-kien', 'blog', 'tai-lieu-ai', 'san-pham-hoc-vien', 'huy-dang-ky-email']);
  function cleanCode(v, selfCode) {
    const c = String(v || '').trim().toLowerCase();
    if (!CODE_RE.test(c)) throw fail(400, 'Đuôi link chỉ gồm chữ thường, số và dấu gạch ngang (3–30 ký tự)');
    if (RESERVED.has(c)) throw fail(400, 'Đuôi này đã được website dùng, hãy chọn đuôi khác');
    if (byCode.has(c) && c !== selfCode) throw fail(409, 'Đuôi này đã có link khác dùng');
    return c;
  }
  function renameTo(l, code) {
    if (code === l.code) return;
    byCode.delete(l.code); l.code = code; byCode.set(code, l); save(true);
  }
  const newCode = () => {
    for (let n = 0; n < 50; n++) {
      let c = ''; const b = crypto.randomBytes(CODE_LEN);
      for (let i = 0; i < CODE_LEN; i++) c += ALPHABET[b[i] % ALPHABET.length];
      if (!byCode.has(c)) return c;
    }
    throw fail(500, 'Không tạo được mã');
  };
  const autoLabel = (url) => {
    const q = new URL(url).searchParams;
    const parts = [q.get('utm_source'), q.get('utm_medium')].filter(Boolean).join('/');
    return [parts, q.get('utm_campaign'), q.get('utm_content')].filter(Boolean).join(' · ').slice(0, 120);
  };

  // ---- public redirect --------------------------------------------------------------
  function redirect(req, res, pathname) {
    const m = pathname.match(/^\/s\/([a-z0-9][a-z0-9-]{2,29})\/?$/i);
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    if (rateLimited(ip, 'short-redirect', 300, 60_000)) { res.writeHead(429); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const l = m && byCode.get(m[1].toLowerCase());
    if (!l) { res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' }); return res.end(); }
    if (req.method === 'GET' && !BOT_RE.test(String(req.headers['user-agent'] || ''))) { l.clicks = (l.clicks || 0) + 1; l.lastClickAt = new Date().toISOString(); save(false); }
    res.writeHead(302, { Location: l.url, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer-when-downgrade' });
    res.end();
  }

  // ---- admin ------------------------------------------------------------------------
  async function admin(req, res, pathname) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Login required' });
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'erasight-admin') return send(res, 403, { error: 'Bad request' });
    const m = pathname.match(/^\/api\/admin\/short-links(?:\/([a-z0-9][a-z0-9-]{2,29}))?$/i);
    if (!m) return send(res, 404, { error: 'Not found' });
    if (!m[1]) {
      if (req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams; const p = q.get('path');
        let list = [...links].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        if (p) list = list.filter((l) => new URL(l.url).pathname === p);
        return send(res, 200, { links: list.slice(0, 200).map(view), total: list.length });
      }
      if (req.method === 'POST') {
        const b = await readJson(req, 8 * 1024);
        const url = normalise(b.url);
        const wanted = b.code !== undefined && String(b.code).trim() !== '' ? cleanCode(b.code, null) : null;
        let l = links.find((x) => x.url === url);
        if (!l) {
          if (links.length >= MAX_LINKS) throw fail(409, 'Đã đạt giới hạn số link rút gọn');
          const code = wanted || newCode();
          if (wanted && byCode.has(wanted)) throw fail(409, 'Đuôi này đã có link khác dùng');
          l = { code, url, label: String(b.label || '').trim().slice(0, 120) || autoLabel(url), createdAt: new Date().toISOString(), clicks: 0 };
          links.push(l); byCode.set(l.code, l); save(true);
        } else {
          if (wanted) renameTo(l, cleanCode(wanted, l.code)); // same destination, new ending
          if (b.label && String(b.label).trim()) { l.label = String(b.label).trim().slice(0, 120); save(true); }
        }
        return send(res, 200, view(l));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    const l = byCode.get(m[1].toLowerCase());
    if (!l) return send(res, 404, { error: 'Not found' });
    if (req.method === 'DELETE') { links = links.filter((x) => x !== l); byCode.delete(l.code); save(true); return send(res, 200, { ok: true }); }
    if (req.method === 'GET') return send(res, 200, view(l));
    if (req.method === 'PATCH') { // change the ending of an existing link
      const b = await readJson(req, 2 * 1024);
      renameTo(l, cleanCode(b.code, l.code));
      return send(res, 200, view(l));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  return {
    async handle(req, res, pathname) {
      try {
        if (pathname.startsWith('/s/')) return redirect(req, res, pathname);
        return await admin(req, res, pathname);
      } catch (e) {
        if (!e.status) console.error('short-links error:', e);
        if (res.headersSent) return res.end();
        send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      }
    },
  };
};
