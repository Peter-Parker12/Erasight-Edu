// AI document library: admin uploads, public gallery, download gated by a 7-day access cookie.
// Zero dependencies. Files + metadata live in DATA_DIR (a Docker volume in production).
//
// Public:  GET  /api/documents                  published documents (never exposes file paths)
//          GET  /api/documents/access           does the visitor hold a valid access cookie?
//          GET  /api/documents/:id/cover        cover image
//          POST /api/documents/:id/view         +1 view (deduped per IP+document)
//          POST /api/documents/:id/request      form {name, phone, email} -> Lead in CRM + access cookie
//          GET  /api/documents/:id/download     needs the access cookie
// Admin:   POST /api/admin/login | logout, GET /api/admin/session
//          GET|POST /api/admin/documents, PATCH|DELETE /api/admin/documents/:id
//          PUT  /api/admin/documents/:id/file | cover   (raw body upload, streamed to disk)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function init({ twenty, twentyReady, normalizePhone, send, readJson, rateLimited }) {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const FILES_DIR = path.join(DATA_DIR, 'files');
  const COVERS_DIR = path.join(DATA_DIR, 'covers');
  const DB_FILE = path.join(DATA_DIR, 'documents.json');
  const FAILED_LEADS = path.join(DATA_DIR, 'failed-leads.jsonl');
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
  // Cookies must stay valid across restarts, so set SESSION_SECRET in production.
  const SECRET = process.env.SESSION_SECRET
    || (ADMIN_PASSWORD ? crypto.createHash('sha256').update('erasight-session:' + ADMIN_PASSWORD).digest('hex')
      : crypto.randomBytes(32).toString('hex'));
  const ACCESS_DAYS = Number(process.env.ACCESS_DAYS) > 0 ? Number(process.env.ACCESS_DAYS) : 7;
  const MAX_DOC = (Number(process.env.MAX_DOC_MB) || 25) * 1024 * 1024;
  const MAX_COVER = (Number(process.env.MAX_COVER_MB) || 3) * 1024 * 1024;
  const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
  const ACCESS_TTL_MS = ACCESS_DAYS * 24 * 60 * 60 * 1000;
  const VIEW_DEDUPE_MS = 30 * 60 * 1000;

  const DOC_TYPES = {
    pdf: { mime: 'application/pdf', magic: [Buffer.from('%PDF-')] },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])] },
    doc: { mime: 'application/msword', magic: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])] },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])] },
    xls: { mime: 'application/vnd.ms-excel', magic: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])] },
    csv: { mime: 'text/csv; charset=utf-8', magic: [], extra: (b) => !b.slice(0, 16).includes(0x00) },
  };
  const COVER_TYPES = {
    png: { mime: 'image/png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
    jpg: { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
    webp: { mime: 'image/webp', magic: [Buffer.from('RIFF')], extra: (b) => b.slice(8, 12).toString() === 'WEBP' },
  };

  // ---- Storage ---------------------------------------------------------------
  let docs = [];
  try { docs = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { docs = []; }
  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(docs, null, 2));
    fs.renameSync(tmp, DB_FILE); // atomic replace
  }
  function saveSoon() { if (!saveTimer) { saveTimer = setTimeout(saveNow, 2000); saveTimer.unref?.(); } }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (saveTimer) saveNow(); process.exit(0); });

  const findDoc = (id) => docs.find((d) => d.id === id);
  const isPublished = (d) => d && d.status === 'published';
  const refreshStatus = (d) => {
    d.status = (d.file || d.link) && d.cover ? 'published' : 'pending';
    d.updatedAt = new Date().toISOString();
  };
  const publicDoc = (d) => ({
    id: d.id, title: d.title, description: d.description, views: d.views,
    type: d.type || (d.link ? 'link' : null), size: d.size || 0,
    link: d.link || null,
    coverUrl: `/api/documents/${d.id}/cover?v=${encodeURIComponent(d.updatedAt)}`, createdAt: d.createdAt,
  });
  const adminDoc = (d) => ({
    ...publicDoc(d), status: d.status, hasFile: !!d.file, hasCover: !!d.cover,
    link: d.link || '',
  });

  // ---- Signed cookies --------------------------------------------------------
  const mac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
  function sign(kind, ttlMs) {
    const exp = Date.now() + ttlMs;
    const body = Buffer.from(JSON.stringify({ k: kind, exp })).toString('base64url');
    return { value: `${body}.${mac(body)}`, exp };
  }
  function verify(token, kind) {
    if (typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const want = Buffer.from(mac(body)); const got = Buffer.from(sig);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString());
      return p.k === kind && p.exp > Date.now() ? p : null;
    } catch { return null; }
  }
  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  const isHttps = (req) => /https/i.test(req.headers['x-forwarded-proto'] || '') || /https/i.test(req.headers['cf-visitor'] || '');
  function setCookie(req, res, name, value, maxAgeMs, cookiePath) {
    res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${isHttps(req) ? '; Secure' : ''}`);
  }
  const isAdmin = (req) => !!verify(cookies(req).adm, 'admin');
  const hasAccess = (req) => verify(cookies(req).lib_access, 'access');

  // ---- Helpers ---------------------------------------------------------------
  const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'tai-lieu';
  const fail = (status, error) => Object.assign(new Error(error), { status });
  const startsWith = (buf, sig) => buf.length >= sig.length && buf.slice(0, sig.length).equals(sig);

  function cleanText(v, max) { return String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); }
  function readViews(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000) throw fail(400, 'Invalid views');
    return n;
  }

  // Stream a raw request body to destPath with a size cap, then verify the file signature.
  function receiveFile(req, destPath, max, types, ext) {
    return new Promise((resolve, reject) => {
      const type = types[ext];
      if (!type) return reject(fail(400, 'Unsupported file type'));
      const declared = Number(req.headers['content-length']);
      if (declared > max) return reject(fail(413, 'File too large'));
      const tmp = destPath + '.tmp';
      const out = fs.createWriteStream(tmp);
      let size = 0; let done = false;
      const abort = (err) => { if (done) return; done = true; out.destroy(); fs.unlink(tmp, () => {}); reject(err); };
      req.on('data', (c) => { size += c.length; if (size > max) abort(fail(413, 'File too large')); });
      req.on('error', abort);
      out.on('error', abort);
      out.on('finish', () => {
        if (done) return;
        done = true;
        try {
          const fd = fs.openSync(tmp, 'r'); const head = Buffer.alloc(16);
          fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
          const hasMagic = Array.isArray(type.magic) && type.magic.length > 0;
          const magicMatch = hasMagic ? type.magic.some((m) => startsWith(head, m)) : true;
          const ok = size > 0 && magicMatch && (!type.extra || type.extra(head));
          if (!ok) { fs.unlinkSync(tmp); return reject(fail(400, 'File content does not match its type')); }
          fs.renameSync(tmp, destPath);
          resolve(size);
        } catch (e) { reject(e); }
      });
      req.pipe(out);
    });
  }

  function removeFile(dir, name) { if (name) fs.unlink(path.join(dir, name), () => {}); }

  // ---- Admin routes ----------------------------------------------------------
  async function admin(req, res, pathname) {
    if (!ADMIN_PASSWORD) return send(res, 503, { error: 'ADMIN_PASSWORD not configured' });
    const ip = clientIp(req);

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (rateLimited(ip, 'admin-login', 5, 60_000)) return send(res, 429, { error: 'Too many attempts' });
      const b = await readJson(req);
      const a = crypto.createHash('sha256').update(String(b.password || '')).digest();
      const c = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
      if (!crypto.timingSafeEqual(a, c)) return send(res, 401, { error: 'Wrong password' });
      setCookie(req, res, 'adm', sign('admin', ADMIN_TTL_MS).value, ADMIN_TTL_MS, '/api/admin');
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/session' && req.method === 'GET') return send(res, 200, { admin: isAdmin(req) });
    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      setCookie(req, res, 'adm', '', 0, '/api/admin');
      return send(res, 200, { ok: true });
    }

    if (!isAdmin(req)) return send(res, 401, { error: 'Login required' });
    // Mutations must carry a custom header (cannot be sent by a cross-site form); cookies are SameSite=Lax too.
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'erasight-admin') return send(res, 403, { error: 'Bad request' });

    const m = pathname.match(/^\/api\/admin\/documents(?:\/([a-f0-9]{16})(?:\/(file|cover))?)?$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const [, id, sub] = m;

    if (!id) {
      if (req.method === 'GET') return send(res, 200, { documents: [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(adminDoc) });
      if (req.method === 'POST') {
        const b = await readJson(req);
        const title = cleanText(b.title, 150);
        if (!title) throw fail(400, 'Title is required');
        const link = cleanText(b.link, 500) || null;
        const now = new Date().toISOString();
        const doc = {
          id: crypto.randomBytes(8).toString('hex'), title, description: cleanText(b.description, 400),
          views: b.views === undefined || b.views === '' ? crypto.randomInt(2000, 3001) : readViews(b.views),
          type: link ? 'link' : null, size: 0, file: null, cover: null, link, status: 'pending', createdAt: now, updatedAt: now,
        };
        refreshStatus(doc);
        docs.push(doc); saveNow();
        return send(res, 201, { document: adminDoc(doc) });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }

    const doc = findDoc(id);
    if (!doc) return send(res, 404, { error: 'Document not found' });

    if (sub && req.method === 'PUT') {
      const url = new URL(req.url, 'http://x');
      let ext = String(url.searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
      if (ext === 'jpeg') ext = 'jpg';
      const isFile = sub === 'file';
      const dir = isFile ? FILES_DIR : COVERS_DIR;
      const size = await receiveFile(req, path.join(dir, `${doc.id}.${ext}`), isFile ? MAX_DOC : MAX_COVER, isFile ? DOC_TYPES : COVER_TYPES, ext);
      const old = isFile ? doc.file : doc.cover;
      if (old && old !== `${doc.id}.${ext}`) removeFile(dir, old);
      if (isFile) { doc.file = `${doc.id}.${ext}`; doc.type = ext; doc.size = size; } else { doc.cover = `${doc.id}.${ext}`; }
      refreshStatus(doc); saveNow();
      return send(res, 200, { document: adminDoc(doc) });
    }
    if (sub) return send(res, 405, { error: 'Method not allowed' });

    if (req.method === 'PATCH') {
      const b = await readJson(req);
      if (b.title !== undefined) { const t = cleanText(b.title, 150); if (!t) throw fail(400, 'Title is required'); doc.title = t; }
      if (b.description !== undefined) doc.description = cleanText(b.description, 400);
      if (b.views !== undefined) doc.views = readViews(b.views);
      if (b.link !== undefined) {
        doc.link = cleanText(b.link, 500) || null;
        if (!doc.file && doc.link) doc.type = 'link';
      }
      refreshStatus(doc);
      doc.updatedAt = new Date().toISOString(); saveNow();
      return send(res, 200, { document: adminDoc(doc) });
    }
    if (req.method === 'DELETE') {
      removeFile(FILES_DIR, doc.file); removeFile(COVERS_DIR, doc.cover);
      docs = docs.filter((d) => d !== doc); saveNow();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // ---- Public routes ---------------------------------------------------------
  const seenViews = new Map(); // "ip|docId" -> timestamp
  setInterval(() => { const now = Date.now(); for (const [k, t] of seenViews) if (now - t > VIEW_DEDUPE_MS) seenViews.delete(k); }, 10 * 60_000).unref();

  async function requestAccess(req, res, doc) {
    const ip = clientIp(req);
    if (rateLimited(ip, 'doc-request', 5, 60_000)) return send(res, 429, { ok: false, error: 'Too many requests' });
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true }); // honeypot: pretend success to bots, no access granted
    const name = cleanText(b.name, 120);
    const phone = cleanText(b.phone, 30);
    const email = cleanText(b.email, 200);
    if (!name || !/^\+?[\d\s().-]{8,18}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Invalid input');

    try {
      if (!twentyReady()) throw new Error('TWENTY_URL / TWENTY_API_KEY not configured');
      await twenty('POST', '/leads', {
        name, emails: { primaryEmail: email }, phones: normalizePhone(phone),
        channel: 'WEBSITE', status: 'NEW', requestedDocument: doc.title,
      });
    } catch (e) {
      // Never block the visitor on a CRM outage; keep the lead so it can be recovered.
      console.error('document lead failed (access still granted):', e.message);
      fs.appendFile(FAILED_LEADS, JSON.stringify({ at: new Date().toISOString(), name, phone, email, document: doc.title }) + '\n', () => {});
    }
    const t = sign('access', ACCESS_TTL_MS);
    setCookie(req, res, 'lib_access', t.value, ACCESS_TTL_MS, '/api/documents');
    return send(res, 200, { ok: true, downloadUrl: `/api/documents/${doc.id}/download`, expiresAt: new Date(t.exp).toISOString() });
  }

  function download(req, res, doc) {
    if (!hasAccess(req)) return send(res, 403, { error: 'Access required' });
    if (doc.file) {
      const file = path.join(FILES_DIR, doc.file || '');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'File missing' });
      const type = DOC_TYPES[doc.type] || { mime: 'application/octet-stream' };
      const ascii = `${slug(doc.title)}.${doc.type}`;
      const utf8 = encodeURIComponent(`${doc.title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120)}.${doc.type}`);
      res.writeHead(200, {
        'Content-Type': type.mime, 'Content-Length': fs.statSync(file).size,
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      });
      return fs.createReadStream(file).pipe(res);
    }
    if (doc.link) {
      res.writeHead(302, { Location: doc.link });
      return res.end();
    }
    return send(res, 404, { error: 'No file or link available' });
  }

  function cover(req, res, doc) {
    const file = path.join(COVERS_DIR, doc.cover || '');
    if (!doc.cover || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': COVER_TYPES[path.extname(file).slice(1)].mime,
      'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  }

  async function pub(req, res, pathname) {
    if (pathname === '/api/documents' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, { documents: docs.filter(isPublished).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicDoc) });
    }
    if (pathname === '/api/documents/access' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const a = hasAccess(req);
      return send(res, 200, a ? { valid: true, expiresAt: new Date(a.exp).toISOString() } : { valid: false });
    }
    const m = pathname.match(/^\/api\/documents\/([a-f0-9]{16})\/(cover|view|request|download)$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const doc = findDoc(m[1]);
    if (!isPublished(doc)) return send(res, 404, { error: 'Document not found' });

    if (m[2] === 'cover' && req.method === 'GET') return cover(req, res, doc);
    if (m[2] === 'download' && req.method === 'GET') return download(req, res, doc);
    if (m[2] === 'view' && req.method === 'POST') {
      const key = `${clientIp(req)}|${doc.id}`;
      if (!seenViews.has(key)) { seenViews.set(key, Date.now()); doc.views += 1; saveSoon(); }
      return send(res, 200, { views: doc.views });
    }
    if (m[2] === 'request' && req.method === 'POST') return requestAccess(req, res, doc);
    return send(res, 405, { error: 'Method not allowed' });
  }

  // ---- Entry point -----------------------------------------------------------
  return {
    async handle(req, res, pathname) {
      try {
        if (pathname.startsWith('/api/admin')) return await admin(req, res, pathname);
        return await pub(req, res, pathname);
      } catch (e) {
        if (!e.status) console.error('documents error:', e);
        if (res.headersSent) return res.end();
        const body = { ok: false, error: e.status ? e.message : 'Server error' };
        res.setHeader('Connection', 'close');
        send(res, e.status || 500, body);
        if (e.status === 413) res.on('finish', () => req.destroy());
      }
    },
  };
};
