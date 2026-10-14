// Static file server + enrollment endpoint (no dependencies).
// POST /api/enroll creates a Lead in Twenty CRM and links it to the chosen course(s).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4232);
const ROOT = __dirname;
const TWENTY_URL = (process.env.TWENTY_URL || '').replace(/\/+$/, '');
const TWENTY_API_KEY = process.env.TWENTY_API_KEY || '';

const STATIC_ALLOW = /^\/(index\.html|demo-page\.html|assets\/|components\/)/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
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

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!STATIC_ALLOW.test(p) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/enroll' && req.method === 'POST') return handleEnroll(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
}).listen(PORT, () => console.log(`Listening on :${PORT}`));
