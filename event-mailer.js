// Scheduled event emails: seeding sequence (+ last call), event notifications and the "last notification"
// that every registration after the last call receives. Recipients are read from Twenty CRM; the actual
// sending is done by a Twenty workflow that polls POST /api/workflow/due-emails every ~15 minutes.
// Zero dependencies. State lives in DATA_DIR (events.json holds the config, email-ledger.jsonl the history).
//
//   POST /api/workflow/due-emails            X-API-Key -> { items: [{to, name, subject, html, ...}], remaining }
//   GET|POST /huy-dang-ky-email?e=&t=        public unsubscribe page (signed link)
//   Admin (cookie + X-Requested-With):
//     GET|PATCH /api/admin/events/:id/emails                 list + timeline | { seedingStartLocal }
//     POST /api/admin/events/:id/emails                      create
//     PATCH|DELETE /api/admin/events/:id/emails/:mid         edit | delete
//     GET  .../:mid/preview?name=  GET .../:mid/recipients   preview | counts + sample names
//     POST .../:mid/resend {email} | {all:true}              clear "already sent" so it goes out again
//     POST .../:mid/test {to}                                queued into the next poll
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOUR = 3600e3;
const STALE_MS = 6 * HOUR;          // a fixed-time email first seen this late is skipped, not sent back-dated
const ENROLL_GRACE_MS = 1 * HOUR;   // a lead whose sequence start is further in the past than this starts "now"
const MAX_EMAILS = 20;
const MAX_OFFSET_H = 24 * 90;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

module.exports = function init(ctx) {
  const { DATA_DIR, SITE, twenty, twentyReady, send, readJson, rateLimited, isAdmin, getEvents, saveEvents, helpers: h } = ctx;
  const now = ctx.now || (() => Date.now());
  const LEDGER = path.join(DATA_DIR, 'email-ledger.jsonl');
  const OPTOUT = path.join(DATA_DIR, 'email-optout.json');
  const BATCH_MAX = Math.max(1, Number(process.env.MAIL_BATCH_MAX) || 50);
  const fail = h.fail;

  // ---- Ledger: who already got / was cancelled for which email -----------------
  const state = new Map();   // "mailId|email" (mailId may be "seq:<eventId>" for the enrolment time) -> {enrolledAt, sentAt, cancelAt}
  const counts = new Map();  // mailId -> {sent, cancel}
  const key = (id, email) => `${id}|${email}`;
  const cnt = (id) => { if (!counts.has(id)) counts.set(id, { sent: 0, cancel: 0 }); return counts.get(id); };

  function drop(k) {
    const s = state.get(k); if (!s) return;
    const id = k.slice(0, k.indexOf('|'));
    if (s.sentAt) cnt(id).sent -= 1;
    if (s.cancelAt) cnt(id).cancel -= 1;
    state.delete(k);
  }
  function apply(row) {
    const at = Date.parse(row.at) || 0;
    if (row.k === 'reset') {
      if (row.r === '*') { for (const k of [...state.keys()]) if (k.startsWith(row.e + '|')) drop(k); } else drop(key(row.e, row.r));
      return;
    }
    const k = key(row.e, row.r);
    const s = state.get(k) || {};
    if (row.k === 'enroll') s.enrolledAt = at;
    else if (row.k === 'sent' && !s.sentAt) { s.sentAt = at; cnt(row.e).sent += 1; }
    else if (row.k === 'cancel' && !s.cancelAt) { s.cancelAt = at; cnt(row.e).cancel += 1; }
    state.set(k, s);
  }
  function ledger(row) {
    row.at = row.at || new Date(now()).toISOString();
    apply(row);
    fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n'); // synchronous: the claim must be on disk before we answer
  }
  try {
    for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) { if (line.trim()) { try { apply(JSON.parse(line)); } catch { /* skip bad line */ } } }
  } catch { /* first run */ }

  // ---- Opt-outs ------------------------------------------------------------------
  let optOut = new Set();
  try { optOut = new Set(Object.keys(JSON.parse(fs.readFileSync(OPTOUT, 'utf8')).emails || {})); } catch { /* none yet */ }
  function saveOptOut() {
    const emails = {}; for (const e of optOut) emails[e] = true;
    const tmp = OPTOUT + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ emails }, null, 2)); fs.renameSync(tmp, OPTOUT);
  }
  const secret = () => process.env.SESSION_SECRET || process.env.WORKFLOW_API_KEY || process.env.ADMIN_PASSWORD || 'erasight-unsubscribe';
  const sign = (email) => crypto.createHmac('sha256', secret()).update('unsub:' + email).digest('hex').slice(0, 32);
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
  const unb64 = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch { return ''; } };
  const unsubUrl = (email) => `${SITE}/huy-dang-ky-email?e=${b64(email)}&t=${sign(email)}`;

  // ---- Leads from Twenty ----------------------------------------------------------
  const firstArray = (o) => (Array.isArray(o) ? o : o && typeof o === 'object' ? Object.values(o).map(firstArray).find(Boolean) : undefined);
  let leadCache = { at: 0, leads: null };
  async function fetchLeads(force) {
    if (!twentyReady()) throw fail(503, 'TWENTY_URL / TWENTY_API_KEY chưa được cấu hình');
    if (!force && leadCache.leads && now() - leadCache.at < 120_000) return leadCache.leads;
    const rows = []; let cursor = null;
    for (let page = 0; page < 100; page++) {
      const data = await twenty('GET', `/leads?limit=60${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`);
      rows.push(...(firstArray(data) || []));
      const pi = data.pageInfo || (data.data && data.data.pageInfo);
      if (!pi || !pi.hasNextPage || !pi.endCursor) break;
      cursor = pi.endCursor;
    }
    const leads = [];
    for (const l of rows) {
      const email = String(l.emails && l.emails.primaryEmail || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) continue;
      leads.push({
        id: l.id, email, name: String(l.name || '').trim().slice(0, 120), created: Date.parse(l.createdAt) || 0,
        type: l.leadType || '', item: String(l.requestedItem || ''), optOut: l.emailOptOut === true,
      });
    }
    leadCache = { at: now(), leads };
    return leads;
  }

  // One person per email address (several leads with the same email collapse into one).
  function peopleFor(ev, leads) {
    const titles = new Set([h.norm(ev.title), ...(ev.previousTitles || []).map(h.norm)]);
    const byEmail = new Map();
    for (const l of leads) {
      let p = byEmail.get(l.email);
      if (!p) { p = { email: l.email, name: l.name, nameAt: l.created, item: l.item, created: l.created, registeredAt: null, optOut: false, regName: '', regItem: '' }; byEmail.set(l.email, p); }
      if (l.created < p.created) p.created = l.created;
      if (l.created >= p.nameAt && l.name) { p.name = l.name; p.nameAt = l.created; }
      if (l.optOut) p.optOut = true;
      if (l.type === 'EVENT_REGISTRATION' && titles.has(h.norm(l.item)) && (p.registeredAt == null || l.created < p.registeredAt)) {
        p.registeredAt = l.created; p.regName = l.name; p.regItem = l.item;
      }
    }
    return [...byEmail.values()].map((p) => Object.assign(p, {
      name: p.regName || p.name, item: p.regItem || p.item, optOut: p.optOut || optOut.has(p.email),
    }));
  }

  // ---- Scheduling ------------------------------------------------------------------
  const seedStartOf = (ev) => (ev.seedingStartAt ? Date.parse(ev.seedingStartAt) : null);
  const mailsOf = (ev) => (ev.emails || []);

  // The moment the last-call email goes out (global cut-over). null when there is none or it falls after the event starts.
  function lastCallAt(ev) {
    const lc = mailsOf(ev).find((m) => m.type === 'seeding' && m.isLastCall && m.enabled);
    const s = seedStartOf(ev);
    if (!lc || s == null) return null;
    const at = s + lc.offsetHours * HOUR;
    return at < h.startMs(ev) ? at : null;
  }

  function enrollment(evId, email, base, t, record) {
    const s = state.get(key('seq:' + evId, email));
    if (s && s.enrolledAt) return s.enrolledAt;
    const at = t - base > ENROLL_GRACE_MS ? t : base;
    if (record) ledger({ k: 'enroll', e: 'seq:' + evId, r: email, at: new Date(at).toISOString() });
    return at;
  }

  // -> [{mail, person, planned, status}] where status is sent | cancelled | cancel | due | wait
  function evaluate(ev, people, t, record, only) {
    const out = [];
    const start = h.startMs(ev);
    if (t >= start) return out;
    const mails = only ? mailsOf(ev).filter((m) => m.id === only.id) : mailsOf(ev).filter((m) => m.enabled);
    const seedStart = seedStartOf(ev);
    const lc = lastCallAt(ev);
    const lastNoticeOn = mailsOf(ev).some((m) => m.type === 'last_notification' && m.enabled);
    const push = (m, p, planned, cancelIfLate) => {
      const s = state.get(key(m.id, p.email)) || {};
      let status;
      if (s.sentAt) status = 'sent';
      else if (s.cancelAt) status = 'cancelled';
      else if (cancelIfLate && planned >= start) status = 'cancel';
      else status = planned <= t ? 'due' : 'wait';
      if (status === 'cancel' && record) ledger({ k: 'cancel', e: m.id, r: p.email });
      out.push({ mail: m, person: p, planned, status });
    };

    for (const m of mails) {
      const since = Date.parse(m.activeSince || m.createdAt) || 0;
      if (m.type === 'seeding') {
        if (seedStart == null || t < seedStart) continue;
        for (const p of people) {
          if (p.optOut) continue;
          if (m.audience === 'registered') { if (p.registeredAt == null) continue; } else if (m.skipRegistered !== false && p.registeredAt != null) continue;
          const base = Math.max(seedStart, m.audience === 'registered' ? p.registeredAt : p.created);
          push(m, p, enrollment(ev.id, p.email, base, t, record) + m.offsetHours * HOUR, true);
        }
      } else if (m.type === 'notification') {
        const tm = m.timing || { mode: 'on_register', delayHours: 0 };
        if (tm.mode === 'on_register') {
          for (const p of people) {
            if (p.registeredAt == null || p.registeredAt < since) continue; // no back-filling people who registered before this email existed
            if (lastNoticeOn && lc != null && p.registeredAt >= lc) continue; // registered after the last call: gets the last notification instead
            push(m, p, p.registeredAt + (tm.delayHours || 0) * HOUR, false);
          }
        } else {
          const planned = tm.mode === 'before' ? start - tm.hours * HOUR : Date.parse(tm.at);
          if (!Number.isFinite(planned)) continue;
          if (t - planned > STALE_MS && !(counts.get(m.id) && counts.get(m.id).sent)) continue; // too stale and never started: skip
          for (const p of people) {
            if (m.audience === 'all' ? p.optOut : p.registeredAt == null) continue;
            const ref = m.audience === 'all' ? p.created : p.registeredAt;
            if (ref > planned) continue; // joined after the send time: no back-dated mails
            push(m, p, planned, false);
          }
        }
      } else if (m.type === 'last_notification') {
        if (lc == null) continue;
        for (const p of people) {
          if (p.registeredAt == null || p.registeredAt < lc || p.registeredAt < since) continue;
          push(m, p, p.registeredAt, false);
        }
      }
    }
    return out;
  }

  const firstName = (n) => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return w.length ? w[w.length - 1] : ''; };

  function renderFor(ev, m, p) {
    const vars = Object.assign({}, h.eventVars(ev), {
      name: p.name || 'bạn', first_name: firstName(p.name) || 'bạn', email: p.email, requested_item: p.item || ev.title,
    });
    const marketing = m.type === 'seeding' || m.audience === 'all';
    const footer = marketing
      ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#8aa0a8">Bạn nhận email này vì đã để lại thông tin tại Erasight Academy. <a href="${p.preview ? '#' : unsubUrl(p.email)}" style="color:#8aa0a8">Hủy nhận email</a></p>`
      : '';
    return {
      subject: h.fillTokens(m.subject, vars).replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
      html: h.renderEmail(h.fillTokens(m.body, vars), footer),
    };
  }

  const PRIO = { last_notification: 0, notification: 1, seeding: 2 };
  let testQueue = [];
  let busy = Promise.resolve();

  // Claims everything that is due (ledger written first = at-most-once) and returns it for the Twenty workflow.
  function dueBatch() {
    const run = async () => {
      const t = now();
      const evs = getEvents().filter((e) => e.status === 'published' && t < h.startMs(e) && mailsOf(e).some((m) => m.enabled));
      const items = [];
      const tests = testQueue; testQueue = [];
      for (const q of tests) {
        if (items.length >= BATCH_MAX) { testQueue.push(q); continue; }
        const r = renderFor(q.ev, q.mail, { name: q.name, email: q.to, item: q.ev.title, preview: true });
        items.push({ to: q.to, name: q.name, subject: '[GỬI THỬ] ' + r.subject, html: r.html, eventId: q.ev.id, mailId: q.mail.id, test: true });
      }
      let due = [];
      if (evs.length) {
        const leads = await fetchLeads(); // throws -> nothing is claimed
        for (const ev of evs) {
          const people = peopleFor(ev, leads);
          for (const en of evaluate(ev, people, t, true)) if (en.status === 'due') due.push(Object.assign(en, { ev }));
        }
      }
      due.sort((a, b) => (PRIO[a.mail.type] - PRIO[b.mail.type]) || (a.planned - b.planned));
      const room = Math.max(0, BATCH_MAX - items.length);
      const take = due.slice(0, room);
      for (const en of take) {
        ledger({ k: 'sent', e: en.mail.id, r: en.person.email });
        const r = renderFor(en.ev, en.mail, en.person);
        items.push({ to: en.person.email, name: en.person.name || '', subject: r.subject, html: r.html, eventId: en.ev.id, mailId: en.mail.id });
      }
      return { ok: true, count: items.length, remaining: due.length - take.length, items };
    };
    const p = busy.then(run, run);
    busy = p.catch(() => {});
    return p;
  }

  async function workflowDue(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (rateLimited(h.clientIp(req), 'workflow-due', 60, 60_000)) return send(res, 429, { error: 'Too many requests' });
    if (!h.workflowAuthorized(req)) return send(res, 401, { error: 'Invalid API key' });
    try { return send(res, 200, await dueBatch()); } catch (e) {
      if (e.status) throw e;
      console.error('due-emails failed:', e.message);
      return send(res, 502, { ok: false, error: 'Không đọc được danh sách lead từ Twenty', items: [], count: 0, remaining: 0 });
    }
  }

  // ---- Admin ----------------------------------------------------------------------
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const newId = () => crypto.randomBytes(6).toString('hex');

  function adminMail(ev, m) {
    const seed = seedStartOf(ev);
    const start = h.startMs(ev);
    const c = counts.get(m.id) || { sent: 0, cancel: 0 };
    const o = {
      id: m.id, type: m.type, name: m.name, subject: m.subject, body: m.body, enabled: !!m.enabled,
      audience: m.audience, sent: c.sent, cancelled: c.cancel,
    };
    if (m.type === 'seeding') {
      Object.assign(o, { offsetHours: m.offsetHours, isLastCall: !!m.isLastCall, skipRegistered: m.skipRegistered !== false });
      if (seed != null) { const at = seed + m.offsetHours * HOUR; o.plannedLocal = h.toLocal(new Date(at).toISOString()); o.afterEvent = at >= start; }
    } else if (m.type === 'notification') {
      const tm = m.timing || { mode: 'on_register', delayHours: 0 };
      o.timing = { mode: tm.mode, delayHours: tm.delayHours || 0, hours: tm.hours || 0, atLocal: tm.at ? h.toLocal(tm.at) : '' };
      const at = tm.mode === 'before' ? start - tm.hours * HOUR : tm.mode === 'at' ? Date.parse(tm.at) : null;
      if (at != null) { o.plannedLocal = h.toLocal(new Date(at).toISOString()); o.afterEvent = at >= start; }
    }
    return o;
  }

  function timeline(ev) {
    const start = h.startMs(ev); const seed = seedStartOf(ev); const lc = lastCallAt(ev);
    const nodes = [];
    let n = 0;
    for (const m of mailsOf(ev).filter((x) => x.type === 'seeding').sort((a, b) => a.offsetHours - b.offsetHours)) {
      n += 1;
      if (seed == null) continue;
      const at = seed + m.offsetHours * HOUR;
      nodes.push({ kind: m.isLastCall ? 'lastcall' : 'seeding', label: m.isLastCall ? `LAST CALL (#${n})` : `#${n}`, at: new Date(at).toISOString(), local: h.toLocal(new Date(at).toISOString()), cancelled: at >= start, enabled: !!m.enabled });
    }
    for (const m of mailsOf(ev).filter((x) => x.type === 'notification')) {
      const tm = m.timing || {};
      if (tm.mode === 'at' || tm.mode === 'before') {
        const at = tm.mode === 'before' ? start - tm.hours * HOUR : Date.parse(tm.at);
        if (Number.isFinite(at)) nodes.push({ kind: 'notification', label: m.name, at: new Date(at).toISOString(), local: h.toLocal(new Date(at).toISOString()), cancelled: at >= start, enabled: !!m.enabled });
      }
    }
    nodes.push({ kind: 'event', label: 'SỰ KIỆN', at: ev.startAt, local: h.toLocal(ev.startAt), cancelled: false, enabled: true });
    nodes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { nodes, lastCallLocal: lc != null ? h.toLocal(new Date(lc).toISOString()) : '' };
  }

  function overview(ev) {
    return {
      eventId: ev.id, eventTitle: ev.title, eventStartLocal: h.toLocal(ev.startAt), published: ev.status === 'published',
      seedingStartLocal: ev.seedingStartAt ? h.toLocal(ev.seedingStartAt) : '',
      emails: mailsOf(ev).map((m) => adminMail(ev, m)), timeline: timeline(ev), batchMax: BATCH_MAX,
    };
  }

  function validateSet(list) {
    if (list.length > MAX_EMAILS) throw fail(400, `Tối đa ${MAX_EMAILS} email cho mỗi sự kiện`);
    const seeding = list.filter((m) => m.type === 'seeding');
    if (seeding.length && Math.min(...seeding.map((m) => m.offsetHours)) !== 0) throw fail(400, 'Email đầu tiên của sequence phải có offset 0 giờ');
    const flagged = seeding.filter((m) => m.isLastCall);
    if (flagged.length > 1) throw fail(400, 'Chỉ được đánh dấu một email là Last call');
    if (flagged.length && seeding.some((m) => m !== flagged[0] && m.offsetHours >= flagged[0].offsetHours)) {
      throw fail(400, 'Last call phải là email cuối cùng của sequence (các email khác phải gửi sớm hơn)');
    }
    if (list.filter((m) => m.type === 'last_notification').length > 1) throw fail(400, 'Chỉ có một email thông báo cuối');
  }

  function intIn(v, lo, hi, msg) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw fail(400, msg);
    return n;
  }

  function fillMail(m, b, creating) {
    if (b.name !== undefined || creating) m.name = h.cleanText(b.name, 100) || (m.type === 'last_notification' ? 'Email thông báo cuối' : 'Email');
    if (b.subject !== undefined || creating) { const s = h.cleanText(b.subject, 200); if (!s) throw fail(400, 'Vui lòng nhập tiêu đề email'); m.subject = s; }
    if (b.body !== undefined || creating) {
      const t = String(b.body ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 10000);
      if (!t) throw fail(400, 'Vui lòng nhập nội dung email'); m.body = t;
    }
    if (b.enabled !== undefined || creating) {
      const en = b.enabled === undefined ? true : !!b.enabled;
      if (en && (!m.enabled || creating)) m.activeSince = new Date(now()).toISOString();
      m.enabled = en;
    }
    if (m.type === 'seeding') {
      if (b.audience !== undefined || creating) m.audience = b.audience === 'registered' ? 'registered' : 'all';
      if (b.skipRegistered !== undefined || creating) m.skipRegistered = b.skipRegistered === undefined ? true : !!b.skipRegistered;
    } else if (m.type === 'notification') {
      if (b.audience !== undefined || creating) m.audience = b.audience === 'all' ? 'all' : 'registered';
      if (b.timing !== undefined || creating) {
        const t = b.timing || { mode: 'on_register', delayHours: 0 };
        if (t.mode === 'on_register') { m.timing = { mode: 'on_register', delayHours: intIn(t.delayHours ?? 0, 0, 720, 'Độ trễ phải từ 0 đến 720 giờ') }; m.audience = 'registered'; }
        else if (t.mode === 'before') m.timing = { mode: 'before', hours: intIn(t.hours, 1, 720, 'Số giờ trước sự kiện phải từ 1 đến 720') };
        else if (t.mode === 'at') { const at = h.parseLocal(t.atLocal); if (!at) throw fail(400, 'Thời gian gửi chưa hợp lệ'); m.timing = { mode: 'at', at }; }
        else throw fail(400, 'Kiểu thời gian không hợp lệ');
      }
    } else {
      m.audience = 'registered';
    }
  }

  async function admin(req, res, pathname) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Login required' });
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'erasight-admin') return send(res, 403, { error: 'Bad request' });
    const m = pathname.match(/^\/api\/admin\/events\/([a-f0-9]{16})\/emails(?:\/(preview)|\/([a-f0-9]{12})(?:\/(preview|recipients|resend|test))?)?$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const [, evId, colPreview, mailId, sub] = m;
    const ev = getEvents().find((x) => x.id === evId);
    if (!ev) return send(res, 404, { error: 'Not found' });
    if (!ev.emails) ev.emails = [];

    if (colPreview) { // live preview of text that is not saved yet
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, 64 * 1024);
      const tmp = { id: 'preview', type: ['seeding', 'notification', 'last_notification'].includes(b.type) ? b.type : 'notification', subject: h.cleanText(b.subject, 200) || '(chưa có tiêu đề)', body: String(b.body || '').slice(0, 10000) || '(chưa có nội dung)', audience: b.audience === 'all' ? 'all' : 'registered' };
      return send(res, 200, renderFor(ev, tmp, { name: h.cleanText(b.name, 120) || 'Nguyễn Văn An', email: 'an@example.com', item: ev.title, preview: true }));
    }
    if (!mailId) {
      if (req.method === 'GET') return send(res, 200, overview(ev));
      if (req.method === 'PATCH') {
        const b = await readJson(req, 16 * 1024);
        if (b.seedingStartLocal !== undefined) {
          if (b.seedingStartLocal === '') ev.seedingStartAt = null;
          else { const at = h.parseLocal(b.seedingStartLocal); if (!at) throw fail(400, 'Thời gian bắt đầu sequence chưa hợp lệ'); ev.seedingStartAt = at; }
        }
        saveEvents();
        return send(res, 200, overview(ev));
      }
      if (req.method === 'POST') {
        const b = await readJson(req, 64 * 1024);
        const type = ['seeding', 'notification', 'last_notification'].includes(b.type) ? b.type : null;
        if (!type) throw fail(400, 'Loại email không hợp lệ');
        const cand = clone(ev.emails);
        if (type === 'last_notification' && cand.some((x) => x.type === 'last_notification')) throw fail(409, 'Sự kiện đã có email thông báo cuối');
        const mail = { id: newId(), type, createdAt: new Date(now()).toISOString() };
        fillMail(mail, b, true);
        if (type === 'seeding') {
          mail.offsetHours = cand.some((x) => x.type === 'seeding') ? intIn(b.offsetHours, 1, MAX_OFFSET_H, 'Số giờ sau email đầu phải từ 1 đến ' + MAX_OFFSET_H) : 0;
          mail.isLastCall = false;
        }
        cand.push(mail);
        if (type === 'seeding' && b.isLastCall) { mail.isLastCall = true; }
        validateSet(cand);
        ev.emails = cand; saveEvents();
        return send(res, 201, overview(ev));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }

    const cand = clone(ev.emails);
    const mail = cand.find((x) => x.id === mailId);
    if (!mail) return send(res, 404, { error: 'Not found' });
    const real = ev.emails.find((x) => x.id === mailId);

    if (sub === 'preview') {
      const q = new URL(req.url, 'http://x').searchParams;
      return send(res, 200, renderFor(ev, real, { name: h.cleanText(q.get('name'), 120) || 'Nguyễn Văn An', email: 'an@example.com', item: ev.title, preview: true }));
    }
    if (sub === 'recipients') {
      let people;
      try { people = peopleFor(ev, await fetchLeads(true)); } catch (e) { if (e.status) throw e; return send(res, 502, { error: 'Không đọc được danh sách lead từ Twenty' }); }
      const ens = evaluate(ev, people, now(), false, real).filter((e) => e.mail.id === real.id);
      const by = (s) => ens.filter((e) => e.status === s);
      const sample = ens.filter((e) => e.status === 'due' || e.status === 'wait').slice(0, 8).map((e) => ({ name: e.person.name || '(không tên)', email: e.person.email }));
      return send(res, 200, { eligible: ens.length, sent: by('sent').length, cancelled: by('cancelled').length + by('cancel').length, due: by('due').length, waiting: by('wait').length, sample, enabled: !!real.enabled });
    }
    if (sub === 'resend') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, 4096);
      if (b.all === true) ledger({ k: 'reset', e: mailId, r: '*' });
      else { const em = String(b.email || '').trim().toLowerCase(); if (!EMAIL_RE.test(em)) throw fail(400, 'Email không hợp lệ'); ledger({ k: 'reset', e: mailId, r: em }); }
      return send(res, 200, overview(ev));
    }
    if (sub === 'test') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, 4096);
      const to = String(b.to || '').trim().toLowerCase();
      if (!EMAIL_RE.test(to)) throw fail(400, 'Email nhận thử không hợp lệ');
      if (testQueue.length >= 20) throw fail(429, 'Đang có quá nhiều email thử chờ gửi');
      testQueue.push({ ev, mail: real, to, name: h.cleanText(b.name, 120) || 'Bạn' });
      return send(res, 200, { ok: true, note: 'Email thử sẽ được gửi ở lần chạy kế tiếp của workflow trong Twenty (tối đa 15 phút).' });
    }

    if (req.method === 'PATCH') {
      const b = await readJson(req, 64 * 1024);
      fillMail(mail, b, false);
      if (mail.type === 'seeding') {
        if (b.offsetHours !== undefined && mail.offsetHours !== 0) mail.offsetHours = intIn(b.offsetHours, 1, MAX_OFFSET_H, 'Số giờ sau email đầu phải từ 1 đến ' + MAX_OFFSET_H);
        if (b.isLastCall !== undefined) { for (const x of cand) if (x.type === 'seeding') x.isLastCall = false; mail.isLastCall = !!b.isLastCall; }
      }
      validateSet(cand);
      ev.emails = cand; saveEvents();
      return send(res, 200, overview(ev));
    }
    if (req.method === 'DELETE') {
      const rest = cand.filter((x) => x.id !== mailId);
      if (mail.type === 'seeding' && mail.offsetHours === 0) {
        const seeds = rest.filter((x) => x.type === 'seeding');
        if (seeds.length) { const min = Math.min(...seeds.map((x) => x.offsetHours)); for (const x of seeds) x.offsetHours -= min; } // next email becomes the anchor
      }
      validateSet(rest);
      ev.emails = rest; saveEvents();
      return send(res, 200, overview(ev));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // ---- Public unsubscribe page ---------------------------------------------------
  const page = (res, status, title, body) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' });
    res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>`
      + `<body style="margin:0;background:#F6FAFA;font-family:Arial,Helvetica,sans-serif;color:#0C2A3A"><div style="max-width:460px;margin:12vh auto;padding:0 18px"><div style="background:#fff;border:1px solid #DDE7E7;border-radius:16px;padding:28px">${body}</div></div></body></html>`);
  };

  async function unsubscribe(req, res) {
    const q = new URL(req.url, 'http://x').searchParams;
    const email = unb64(q.get('e')).trim().toLowerCase();
    const tk = String(q.get('t') || '');
    const ok = EMAIL_RE.test(email) && tk.length === 32 && crypto.timingSafeEqual(Buffer.from(tk), Buffer.from(sign(email)));
    if (!ok) return page(res, 400, 'Liên kết không hợp lệ', '<h1 style="font-size:20px;margin:0 0 8px">Liên kết không hợp lệ</h1><p style="margin:0;color:#4A6572">Liên kết hủy nhận email đã hết hạn hoặc không đúng.</p>');
    const safe = email.replace(/[<>&"]/g, '');
    if (req.method === 'POST') {
      req.resume();
      if (rateLimited(h.clientIp(req), 'unsub', 10, 60_000)) return page(res, 429, 'Thử lại sau', '<p>Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút.</p>');
      optOut.add(email); saveOptOut();
      (async () => { // mirror the flag on the CRM lead(s) so the team can see it; best effort
        try {
          const leads = await fetchLeads(true);
          for (const l of leads.filter((x) => x.email === email)) await twenty('PATCH', `/leads/${l.id}`, { emailOptOut: true });
          leadCache.at = 0;
        } catch (e) { console.error('opt-out mirror failed:', e.message); }
      })();
      return page(res, 200, 'Đã hủy nhận email', `<h1 style="font-size:20px;margin:0 0 8px">Đã hủy nhận email ✓</h1><p style="margin:0;color:#4A6572">Địa chỉ <b>${safe}</b> sẽ không nhận email giới thiệu từ Erasight Academy nữa. Email xác nhận cho sự kiện bạn đã đăng ký vẫn được gửi.</p>`);
    }
    return page(res, 200, 'Hủy nhận email', `<h1 style="font-size:20px;margin:0 0 8px">Hủy nhận email giới thiệu?</h1><p style="margin:0 0 18px;color:#4A6572">Bạn sẽ không nhận thêm email giới thiệu sự kiện tại <b>${safe}</b>.</p>`
      + `<form method="post" action="${req.url.replace(/"/g, '&quot;')}"><button type="submit" style="background:#E85D04;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-weight:700;font-size:15px;cursor:pointer">Xác nhận hủy nhận email</button></form>`);
  }

  return { workflowDue, admin, unsubscribe, dueBatch, evaluate, peopleFor, _state: state, _counts: counts, _optOut: optOut };
};
