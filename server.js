// Static file server + enrollment endpoint (no dependencies).
// POST /api/enroll creates a Lead in Twenty CRM and links it to the chosen course(s).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4232);
const ROOT = __dirname;
const TWENTY_URL = (process.env.TWENTY_URL || '').replace(/\/+$/, '');
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || '';
// WordPress REST API base URL (e.g. https://blog.erasight.vn/wp-json/wp/v2)
const WP_API_URL = (process.env.WP_API_URL || '').replace(/\/+$/, '');
// Only posts carrying this WordPress tag are shown on the blog pages. Accepts the tag's slug or its
// name ("Erasight Education" -> erasight-education); WordPress slugs are lowercase with hyphens.
const WP_POST_TAG = (process.env.WP_POST_TAG || 'erasight-education')
  .trim().toLowerCase().replace(/[\s_]+/g, '-');

const STATIC_ALLOW = /^\/([a-zA-Z0-9_.-]+\.html|assets\/|components\/|2\.\s*Official\s*Logos[^/]*\/|favicon\.ico)/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// ---- Twenty CRM -----------------------------------------------------------
async function twenty(method, endpoint, body) {
  const res = await fetch(`${TWENTY_URL}/rest${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${TWENTY_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Twenty ${method} ${endpoint} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Response shapes differ slightly between Twenty versions; find the first array / id defensively.
const firstArray = (o) => (Array.isArray(o) ? o : o && typeof o === 'object'
  ? Object.values(o).map(firstArray).find(Boolean) : undefined);
const findId = (o) => (o && typeof o === 'object'
  ? (typeof o.id === 'string' ? o.id : Object.values(o).map(findId).find(Boolean)) : undefined);

// Moodle course id (Twenty course.courseId) -> Twenty course record, cached for 5 minutes.
let courseCache = { at: 0, map: new Map() };
async function courseMap() {
  if (Date.now() - courseCache.at < 5 * 60 * 1000 && courseCache.map.size) return courseCache.map;
  const data = await twenty('GET', '/courses?limit=60');
  const map = new Map();
  for (const c of firstArray(data) || []) {
    if (c.courseId != null) map.set(Number(c.courseId), { id: c.id, name: c.name });
  }
  courseCache = { at: Date.now(), map };
  return map;
}

function normalizePhone(raw) {
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+84')) d = d.slice(3);
  else if (d.startsWith('84') && d.length >= 11) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return { primaryPhoneNumber: d, primaryPhoneCountryCode: 'VN', primaryPhoneCallingCode: '+84' };
}

async function enroll({ name, phone, email, courses }) {
  const map = await courseMap();
  const picked = [...new Set(courses.map(Number))].map((id) => map.get(id));
  if (!picked.length || picked.some((c) => !c)) {
    const err = new Error('Unknown course'); err.status = 400; throw err;
  }
  const lead = await twenty('POST', '/leads', {
    name,
    emails: { primaryEmail: email },
    phones: normalizePhone(phone),
    channel: 'WEBSITE',
    status: 'NEW',
  });
  const leadId = findId(lead);
  if (!leadId) throw new Error('Lead created but id missing in response');
  for (const c of picked) {
    try {
      await twenty('POST', '/leadCourses', { name: `${name} - ${c.name}`, leadId, courseId: c.id });
    } catch (e) {
      console.error('leadCourse link failed (lead kept):', leadId, e.message);
    }
  }
  return leadId;
}

// ---- HTTP -----------------------------------------------------------------
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

async function handleEnroll(req, res) {
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'Too many requests' });
  try {
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true }); // honeypot: pretend success to bots
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    const email = String(b.email || '').trim();
    const courses = Array.isArray(b.courses) ? b.courses : [];
    if (!name || name.length > 120 || !/^\+?[\d\s().-]{8,18}$/.test(phone)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200 || !courses.length || courses.length > 5) {
      return send(res, 400, { ok: false, error: 'Invalid input' });
    }
    if (!TWENTY_URL || !TWENTY_API_KEY) throw new Error('TWENTY_URL / TWENTY_API_KEY not configured');
    await enroll({ name, phone, email, courses });
    send(res, 200, { ok: true });
  } catch (e) {
    console.error('enroll failed:', e.message);
    send(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Server error' });
  }
}

// Cache-busting: rewrite local CSS/JS URLs in served HTML to ?v=<content hash>, so an edited file
// always gets a new URL and a stale copy in Cloudflare/the browser can never be reused.
const crypto = require('crypto');
const hashCache = new Map(); // file -> { mtimeMs, hash }
function assetHash(rel) {
  const file = path.join(ROOT, rel);
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = hashCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.hash;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
    hashCache.set(file, { mtimeMs, hash });
    return hash;
  } catch { return null; }
}
function stampAssets(html) {
  return html.replace(/(["'])(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[^"']*)?\1/g, (m, q, rel) => {
    const h = assetHash(rel);
    return h ? `${q}${rel}?v=${h}${q}` : m;
  });
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  else if (!path.extname(p) && fs.existsSync(path.join(ROOT, p + '.html'))) p = p + '.html';
  const file = path.join(ROOT, p);
  if (!STATIC_ALLOW.test(p) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    if (p.endsWith('.html')) buf = stampAssets(buf.toString('utf8'));
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // Code/markup must never be served stale by Cloudflare or browsers; only media is cached long-term.
      'Cache-Control': /\.(js|css|html|json)$/i.test(p) ? 'no-cache, no-store, must-revalidate'
        : p.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(buf);
  });
}

// ---- WordPress API Proxy --------------------------------------------------
async function handleWpProxy(req, res) {
  if (!WP_API_URL) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'WP_API_URL not configured' }));
  }
  try {
    // Strip /api/wp prefix and forward the rest to WordPress REST API
    const wpPath = req.url.replace(/^\/api\/wp/, '');
    const upstream = `${WP_API_URL}${wpPath}`;
    const wpRes = await fetch(upstream, {
      method: req.method,
      headers: { 'Accept': 'application/json', 'User-Agent': 'ErasightProxy/1.0' },
    });
    const body = await wpRes.text();
    res.writeHead(wpRes.status, {
      'Content-Type': wpRes.headers.get('content-type') || 'application/json',
      'Cache-Control': 'public, max-age=120', // cache 2 min
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (e) {
    console.error('WP proxy error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'WordPress upstream error' }));
  }
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/enroll' && req.method === 'POST') return handleEnroll(req, res);
  if (pathname === '/api/blog-config' && req.method === 'GET') return send(res, 200, { tag: WP_POST_TAG });
  if (pathname.startsWith('/api/wp') && (req.method === 'GET' || req.method === 'HEAD')) return handleWpProxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
}).listen(PORT, () => console.log(`Listening on :${PORT}`));
