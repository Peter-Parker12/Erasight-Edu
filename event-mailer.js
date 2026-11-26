// Scheduled event emails: seeding sequence (+ last call), event notifications and the "last notification"
// that every registration after the last call receives. Recipients are read from Twenty CRM; the actual
// sending is done by a Twenty workflow that polls POST /api/workflow/due-emails every ~15 minutes.
// Zero dependencies. State lives in DATA_DIR (events.json holds the config, email-ledger.jsonl the history).
//
//   POST /api/workflow/due-emails            X-API-Key -> { items: [{to, name, subject, html, ...}], remaining }
//   POST /api/workflow/email-sent            X-API-Key { mailId, to } -> confirms delivery of one item (until then it is only "claimed"; unconfirmed claims are retried after MAIL_CLAIM_TTL_MIN, up to MAIL_MAX_ATTEMPTS times)
//   GET|POST /huy-dang-ky-email?e=&t=        public unsubscribe page (signed link)
//   Admin (cookie + X-Requested-With):
//     GET|PATCH /api/admin/events/:id/emails                 list + timeline | { seedingStartLocal }
//     POST /api/admin/events/:id/emails                      create
//     PATCH|DELETE /api/admin/events/:id/emails/:mid         edit | delete
//     GET  .../:mid/preview?name=  GET .../:mid/recipients   preview | counts + sample names
//     POST .../:mid/resend {email} | {all:true}              clear "already sent" so it goes out again
//     POST .../:mid/test {to}                                queued into the next poll
//     PUT  .../emails/images?ext=png|jpg|webp (raw body)     upload a picture -> {url}; public GET /api/email-images/:file
//     POST .../emails/sanitize {html}                        -> {html} (what the rich-text editor may keep)
//   A mail has format 'html' (rich-text editor, sanitized by email-html.js) or 'text' (older plain-text mails).
//     GET  .../emails/leads?q= | ?selected=1                 search CRM leads | status of the test-mode leads
//   Test mode (PATCH .../emails { testMode: {on, emails[]} }): the real scheduler runs for this event (even as a
//   draft) but only for the listed leads. Turning it off clears those leads' send history for this event.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const emailHtml = require('./email-html');
const mailSmtp = require('./mail-smtp');

const HOUR = 3600e3;
const STALE_MS = 6 * HOUR;          // a fixed-time email first seen this late is skipped, not sent back-dated
const CLAIM_TTL_MS = Math.max(16, Number(process.env.MAIL_CLAIM_TTL_MIN) || 30) * 60 * 1000; // handed to Twenty but never confirmed this long -> try again
// Off by default: the Twenty workflow must have the "Confirm sent" step first, otherwise every mail would be retried as unconfirmed.
const REQUIRE_CONFIRM = /^(1|true|yes)$/i.test(process.env.MAIL_REQUIRE_CONFIRM || '');
const MAX_ATTEMPTS = Math.max(1, Number(process.env.MAIL_MAX_ATTEMPTS) || 3);               // ... at most this many times, then "failed"
// Sending mode: 'twenty' (default: the Twenty workflow sends) or 'direct' (this server sends itself, see mail-smtp.js)
const MAIL_MODE = String(process.env.MAIL_MODE || 'twenty').toLowerCase();
const DIRECT = MAIL_MODE === 'direct';
const CLAIMS = REQUIRE_CONFIRM || DIRECT;  // claim before sending; the send result then decides sent / retry / failed
const RETRY_MIN = [5, 30];                 // minutes to wait after a temporary failure, by attempt
const TICK_MS = Math.max(5, Number(process.env.MAIL_TICK_SECONDS) || 60) * 1000;
const ENROLL_GRACE_MS = 1 * HOUR;   // a lead whose sequence start is further in the past than this starts "now"
const MAX_EMAILS = 20;
const MAX_OFFSET_H = 24 * 90;
const MAX_TESTERS = 20;
const MAX_IMAGES = 40;                // uploaded pictures per event
const BODY_LIMIT = 200 * 1024;       // request size for e-mail bodies written in the rich-text editor
const MAX_HTML = 100000;             // characters of sanitized html per e-mail
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

module.exports = function init(ctx) {
  const { DATA_DIR, SITE, twenty, twentyReady, send, readJson, rateLimited, isAdmin, getEvents, saveEvents, images, helpers: h } = ctx;
  const now = ctx.now || (() => Date.now());
  const LEDGER = path.join(DATA_DIR, 'email-ledger.jsonl');
  const OPTOUT = path.join(DATA_DIR, 'email-optout.json');
  const IMG_DIR = path.join(DATA_DIR, 'email-images');
  fs.mkdirSync(IMG_DIR, { recursive: true });
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
    if (s.sentAt && !s.cc) cnt(id).sent -= 1;
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
    else if (row.k === 'claim') { s.claimAt = at; s.retryAt = null; s.attempts = (s.attempts || 0) + 1; if (row.cc) s.cc = true; } // being sent, result not yet known
    else if (row.k === 'release') { s.claimAt = null; s.retryAt = at + (RETRY_MIN[Math.min((s.attempts || 1) - 1, RETRY_MIN.length - 1)]) * 60000; } // temporary failure: try again later
    else if (row.k === 'fail') { s.claimAt = null; s.permanent = true; s.failReason = String(row.reason || '').slice(0, 200); } // the server refused it for good
    else if (row.k === 'cc' && !s.sentAt) { s.sentAt = at; s.cc = true; } // internal copy: not counted as a lead send
    else if (row.k === 'sent' && !s.sentAt) { s.sentAt = at; if (!s.cc) cnt(row.e).sent += 1; }
    else if (row.k === 'cancel' && !s.cancelAt) { s.cancelAt = at; cnt(row.e).cancel += 1; }
    state.set(k, s);
  }
  const pendingNow = (s, t) => !s.sentAt && s.claimAt && t - s.claimAt < CLAIM_TTL_MS;
  const failedNow = (s, t) => !s.sentAt && (s.permanent || (!pendingNow(s, t) && (s.attempts || 0) >= MAX_ATTEMPTS));
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

  // ---- Internal copies: staff who receive one copy of every seeding / notification mail when it goes out ----
  const envCopy = () => String(process.env.INTERNAL_COPY_EMAILS || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => EMAIL_RE.test(x));
  const copyList = (ev) => (ev.internalCopy && Array.isArray(ev.internalCopy) ? ev.internalCopy : []);
  const copyAll = (ev) => [...new Set([...envCopy(), ...copyList(ev)])];

  // ---- Test mode: only the listed leads are considered ------------------------------
  const testOn = (ev) => !!(ev.testMode && ev.testMode.on);
  const testers = (ev) => (ev.testMode && Array.isArray(ev.testMode.emails) ? ev.testMode.emails : []);
  function audienceFor(ev, leads) {
    const people = peopleFor(ev, leads);
    if (!testOn(ev)) return people;
    const only = new Set(testers(ev));
    return people.filter((p) => only.has(p.email));
  }
  // Registration confirmation: an ordinary "on register" notification flagged as the confirmation (confirm: true).
  // Turning it on/off only toggles it (or creates it with a default body); its content is edited in the normal email editor.
  const CONFIRM_SINCE = '1970-01-01T00:00:00.000Z';
  const confirmMailOf = (ev) => mailsOf(ev).find((x) => x.confirm) || null;
  const confirmationOn = (ev) => { const m = confirmMailOf(ev); return !!(m && m.enabled); };
  const confirmationInfo = (ev) => { const m = confirmMailOf(ev); return { enabled: !!(m && m.enabled), mailId: m ? m.id : '', sent: m ? ((counts.get(m.id) || {}).sent || 0) : 0 }; };
  function defaultConfirmBody(ev) {
    let html = '<p>Xin chào {{first_name}},</p><p>Cảm ơn bạn đã đăng ký tham dự sự kiện. Đây là email xác nhận đăng ký của bạn.</p>'
      + '<p><strong>{{event_title}}</strong><br>Thời gian: {{event_date}} lúc {{event_time}}<br>Hình thức: {{event_mode}}<br>Địa điểm: {{event_location}}</p>';
    if (ev.joinLink) html += '<p>Link tham gia: <a href="{{join_link}}">{{join_link}}</a></p>';
    return html;
  }
  function setConfirmation(ev, on) {
    let m = confirmMailOf(ev);
    if (!m) {
      if (!on) return;
      m = { id: newId(), type: 'notification', name: 'Xác nhận đăng ký', subject: 'Xác nhận đăng ký: {{event_title}}', format: 'html',
        body: emailHtml.sanitize(defaultConfirmBody(ev)), enabled: false, audience: 'registered', timing: { mode: 'on_register', delayHours: 0 },
        confirm: true, createdAt: new Date(now()).toISOString(), activeSince: CONFIRM_SINCE };
      const next = [...mailsOf(ev), m];
      validateSet(next);
      ev.emails = next;
    }
    m.activeSince = CONFIRM_SINCE; // everyone already registered gets it too (the ledger stops repeats)
    m.enabled = !!on;
  }
  const schedMails = (ev) => mailsOf(ev);

  // An event takes part in sending when it is published, or when it is in test mode (drafts can be tested).
  const sendable = (ev) => ev.status === 'published' || testOn(ev);

  // Forget what was sent / cancelled / enrolled for these addresses on this event, so they start fresh.
  function resetFor(ev, emails) {
    const ids = ['seq:' + ev.id, ...mailsOf(ev).map((m) => m.id)];
    for (const em of emails) for (const id of ids) if (state.has(key(id, em))) ledger({ k: 'reset', e: id, r: em });
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
    const mails = only ? schedMails(ev).filter((m) => m.id === only.id) : schedMails(ev).filter((m) => m.enabled);
    const seedStart = seedStartOf(ev);
    const lc = lastCallAt(ev);
    const lastNoticeOn = mailsOf(ev).some((m) => m.type === 'last_notification' && m.enabled);
    const push = (m, p, planned, cancelIfLate) => {
      const s = state.get(key(m.id, p.email)) || {};
      let status;
      if (s.sentAt) status = 'sent';
      else if (pendingNow(s, t)) status = 'pending';
      else if (failedNow(s, t)) status = 'failed';
      else if (s.cancelAt) status = 'cancelled';
      else if (s.retryAt && t < s.retryAt) status = 'retry';
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
            if (!m.confirm && lastNoticeOn && lc != null && p.registeredAt >= lc) continue; // registered after the last call: gets the last notification instead
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
    const subject = h.fillTokens(m.subject, vars).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    if (m.format === 'html') { // rich-text body: values are escaped, then the whole thing is re-sanitized with inline styles
      const safe = {}; for (const k of Object.keys(vars)) safe[k] = emailHtml.esc(vars[k]);
      return { subject, html: h.wrapEmail(emailHtml.sanitize(h.fillTokens(m.body, safe), { render: true, site: SITE }), footer) };
    }
    return { subject, html: h.renderEmail(h.fillTokens(m.body, vars), footer) };
  }

  const PRIO = { last_notification: 0, notification: 1, seeding: 2 };
  let testQueue = [];
  let busy = Promise.resolve();

  // Claims everything that is due (ledger written first = at-most-once) and returns it for the Twenty workflow.
  function dueBatch(freshLeads, cap) {
    const run = async () => {
      const t = now();
      const evs = getEvents().filter((e) => sendable(e) && t < h.startMs(e) && schedMails(e).some((m) => m.enabled));
      const items = [];
      const tests = testQueue; testQueue = [];
      for (const q of tests) {
        if (items.length >= BATCH_MAX) { testQueue.push(q); continue; }
        const r = renderFor(q.ev, q.mail, { name: q.name, email: q.to, item: q.ev.title, preview: true });
        items.push({ to: q.to, name: q.name, subject: '[GỬI THỬ] ' + r.subject, html: r.html, eventId: q.ev.id, mailId: q.mail.id, test: true });
      }
      let due = [];
      if (evs.length) {
        const leads = await fetchLeads(!!freshLeads); // throws -> nothing is claimed
        for (const ev of evs) {
          const people = audienceFor(ev, leads);
          for (const en of evaluate(ev, people, t, true)) if (en.status === 'due') due.push(Object.assign(en, { ev }));
        }
      }
      due.sort((a, b) => (PRIO[a.mail.type] - PRIO[b.mail.type]) || (a.planned - b.planned));
      const room = Math.max(0, Math.min(BATCH_MAX, cap == null ? Infinity : cap) - items.length);
      const take = due.slice(0, room);
      for (const en of take) {
        ledger({ k: CLAIMS ? 'claim' : 'sent', e: en.mail.id, r: en.person.email }); // claimed = being sent; confirmed later (workflow) or by the send result (direct)
        const r = renderFor(en.ev, en.mail, en.person);
        items.push({ to: en.person.email, name: en.person.name || '', subject: r.subject, html: r.html, eventId: en.ev.id, mailId: en.mail.id, ...(testOn(en.ev) ? { testMode: true } : {}) });
        // Registration confirmation: the internal team gets one copy per registrant, each tracked separately
        if (en.mail.confirm) {
          for (const to of copyAll(en.ev)) {
            const ck = 'cc:' + to + '>' + en.person.email;
            const cs = state.get(key(en.mail.id, ck)) || {};
            if (cs.sentAt || pendingNow(cs, t) || failedNow(cs, t)) continue;
            ledger(CLAIMS ? { k: 'claim', e: en.mail.id, r: ck, cc: true } : { k: 'cc', e: en.mail.id, r: ck });
            items.push({ to, name: 'Erasight', subject: `[ĐĂNG KÝ MỚI] ${en.person.name || en.person.email} · ${r.subject}`, html: r.html, eventId: en.ev.id, mailId: en.mail.id, internalCopy: true, copyOf: en.person.email, ledgerKey: ck });
          }
        }
      }
      const mailsSent = new Map(); for (const en of take) if (!en.mail.confirm) mailsSent.set(en.mail.id, en);
      for (const en of mailsSent.values()) {
        for (const to of copyAll(en.ev)) {
          const cs = state.get(key(en.mail.id, 'cc:' + to)) || {};
          if (cs.sentAt || pendingNow(cs, t) || failedNow(cs, t)) continue;
          ledger(CLAIMS ? { k: 'claim', e: en.mail.id, r: 'cc:' + to, cc: true } : { k: 'cc', e: en.mail.id, r: 'cc:' + to });
          const r = renderFor(en.ev, en.mail, { name: 'Erasight', email: to, item: en.ev.title, preview: true });
          items.push({ to, name: 'Erasight', subject: '[BẢN SAO NỘI BỘ] ' + r.subject, html: r.html, eventId: en.ev.id, mailId: en.mail.id, internalCopy: true });
        }
      }
      return { ok: true, count: items.length, remaining: due.length - take.length, items };
    };
    const p = busy.then(run, run);
    busy = p.catch(() => {});
    return p;
  }

  // The Twenty workflow calls this after its "Send email" step succeeded for one item: only now is the mail "sent".
  async function workflowSent(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (rateLimited(h.clientIp(req), 'workflow-sent', 600, 60_000)) return send(res, 429, { error: 'Too many requests' });
    if (!h.workflowAuthorized(req)) return send(res, 401, { error: 'Invalid API key' });
    const b = await readJson(req, 4096);
    const mailId = String(b.mailId || ''); const to = String(b.to || '').trim().toLowerCase();
    if (!/^[a-f0-9]{12}$/.test(mailId) || !EMAIL_RE.test(to)) return send(res, 400, { error: 'mailId / to invalid' });
    let confirmed = false;
    const copyOf = String(b.copyOf || '').trim().toLowerCase();
    for (const r of (copyOf ? ['cc:' + to + '>' + copyOf] : [to, 'cc:' + to])) {
      const s = state.get(key(mailId, r));
      if (s && s.claimAt && !s.sentAt) { ledger({ k: 'sent', e: mailId, r }); confirmed = true; }
    }
    return send(res, 200, { ok: true, confirmed });
  }

  // ---- Sending by this server (MAIL_MODE=direct) ----------------------------------------------------------
  // Sending account, configured in .env like the outreach app's Settings:
  //   MAIL_PROVIDER=gmail | outlook  -> that provider's SMTP server, login = MAIL_SMTP_USER, password = app password
  //   MAIL_PROVIDER=custom           -> MAIL_SMTP_HOST / MAIL_SMTP_PORT / MAIL_SMTP_SECURE
  //   MAIL_PROVIDER empty            -> deliver straight to each recipient's mail server (needs DNS + port 25)
  const SEND = (() => {
    const provider = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
    const user = String(process.env.MAIL_SMTP_USER || '').trim();
    const pass = String(process.env.MAIL_SMTP_PASS || '');
    const preset = mailSmtp.PROVIDERS[provider];
    const from = String(process.env.MAIL_FROM || (preset ? user : '')).trim().toLowerCase();
    const domain = from.includes('@') ? from.slice(from.indexOf('@') + 1) : '';
    let dkim = null;
    if (process.env.DKIM_KEY_FILE && process.env.DKIM_SELECTOR) {
      try { dkim = { domain: process.env.DKIM_DOMAIN || domain, selector: process.env.DKIM_SELECTOR, key: fs.readFileSync(process.env.DKIM_KEY_FILE, 'utf8') }; }
      catch (e) { console.error('DKIM key file not readable:', e.message); }
    }
    let relay = null;
    if (preset) relay = { ...preset, user, pass };
    else if (provider === 'custom' && process.env.MAIL_SMTP_HOST) relay = { host: process.env.MAIL_SMTP_HOST.trim(), port: Number(process.env.MAIL_SMTP_PORT) || 587, secure: /^(1|true|yes)$/i.test(process.env.MAIL_SMTP_SECURE || ''), user, pass };
    const needsAccount = !!preset && (!user || !pass); // Gmail / Outlook always need the account; a custom server may not
    // a Gmail / Outlook account only accepts mail whose From is that account
    const fromOk = !(relay && user && from !== user.toLowerCase());
    return {
      provider, from, fromName: process.env.MAIL_FROM_NAME || 'Erasight Academy', domain, helo: process.env.MAIL_HELO || domain, dkim, relay,
      ready: !!(from && domain) && !needsAccount && fromOk,
      problem: !from ? 'MAIL_FROM chưa đặt' : needsAccount ? 'Thiếu MAIL_SMTP_USER / MAIL_SMTP_PASS' : !fromOk ? 'MAIL_FROM phải trùng MAIL_SMTP_USER' : '',
      dailyCap: Math.max(1, Number(process.env.MAIL_DAILY_CAP) || (preset ? 450 : 1000)), // Gmail allows about 500 a day
    };
  })();
  const SENDLOG = path.join(DATA_DIR, 'send-log.jsonl');   // one line per send attempt (accepted / rejected / retry)
  const setupInfo = () => ({ mode: MAIL_MODE, provider: SEND.provider || 'direct', ready: SEND.ready, problem: SEND.problem, from: SEND.from, dkim: !!SEND.dkim, relay: SEND.relay ? SEND.relay.host : '', dailyCap: SEND.dailyCap, tickSeconds: TICK_MS / 1000 });
  function logSend(it, status, info) {
    const row = { at: new Date(now()).toISOString(), status, kind: it.test ? 'test' : it.internalCopy ? 'copy' : 'lead',
      eventId: it.eventId, mailId: it.mailId, to: it.to, code: (info && info.code) || 0, msg: String((info && (info.text || info.message)) || '').slice(0, 240) };
    try { fs.appendFileSync(SENDLOG, JSON.stringify(row) + '\n'); } catch (e) { console.error('send log failed:', e.message); }
  }

  // One round: claims what is due (same rules as the workflow), sends each item, records the result.
  // accepted sends in the last 24 hours (the daily cap, like the outreach app's send cap)
  function sentLast24h() {
    const since = now() - 24 * HOUR; let n = 0;
    try {
      for (const line of fs.readFileSync(SENDLOG, 'utf8').split('\n')) {
        if (!line || line.indexOf('"accepted"') < 0 || line.indexOf('"kind":"test"') >= 0) continue;
        if ((Date.parse(JSON.parse(line).at) || 0) >= since) n += 1;
      }
    } catch { /* nothing yet */ }
    return n;
  }
  async function sendRound(freshLeads) {
    if (!SEND.ready) { console.error('direct mail not sent: ' + (SEND.problem || 'setup incomplete')); return 0; }
    const room = SEND.dailyCap - sentLast24h();
    if (room <= 0) return 0; // over the daily cap: the rest waits for tomorrow
    const batch = await dueBatch(freshLeads, room);
    for (const it of batch.items) {
      const kind = it.test ? 'test' : it.internalCopy ? 'copy' : 'lead';
      const key = it.ledgerKey || (it.internalCopy ? 'cc:' + it.to : it.to);
      const unsubscribe = kind === 'lead' && /huy-dang-ky-email/.test(it.html) ? unsubUrl(it.to) : '';
      const raw = mailSmtp.assemble(mailSmtp.buildMessage({ from: SEND.from, fromName: SEND.fromName, to: it.to, subject: it.subject, html: it.html,
        messageId: crypto.randomBytes(12).toString('hex'), domain: SEND.domain, unsubscribe, date: new Date(now()) }), SEND.dkim);
      try {
        const r = await mailSmtp.deliver(it.to, raw, SEND);
        if (kind !== 'test') ledger({ k: 'sent', e: it.mailId, r: key });
        logSend(it, 'accepted', r);
      } catch (e) {
        if (e.permanent) { if (kind !== 'test') ledger({ k: 'fail', e: it.mailId, r: key, reason: e.message }); logSend(it, 'rejected', e); }
        else { if (kind !== 'test') ledger({ k: 'release', e: it.mailId, r: key }); logSend(it, 'retry', e); }
      }
    }
    return batch.items.length;
  }
  let roundRunning = null; let roundAgain = false; let freshAgain = false;
  // Runs a round now (after a registration: with a fresh lead list, or on the timer). Rounds never overlap.
  function kick(fresh) {
    if (!DIRECT) return;
    if (roundRunning) { roundAgain = true; freshAgain = freshAgain || !!fresh; return; }
    roundRunning = sendRound(!!fresh).catch((e) => console.error('mail round failed:', e.message)).finally(() => {
      roundRunning = null;
      if (roundAgain) { const f = freshAgain; roundAgain = false; freshAgain = false; kick(f); }
    });
  }
  if (DIRECT) { const timer = setInterval(kick, TICK_MS); if (timer.unref) timer.unref(); }

  // Report for one event: totals and per-email counts from the ledger, daily numbers and failures from the send log.
  function reportFor(ev, days) {
    const t = now();
    const perMail = mailsOf(ev).map((m) => {
      const pre = m.id + '|';
      const row = { mailId: m.id, name: m.name, type: m.type, confirm: !!m.confirm, enabled: !!m.enabled, sent: 0, copies: 0, pending: 0, retry: 0, failed: 0, cancelled: 0 };
      for (const [k, s] of state) {
        if (!k.startsWith(pre)) continue;
        if (k.slice(pre.length).startsWith('cc:')) { if (s.sentAt) row.copies += 1; continue; }
        if (s.sentAt) row.sent += 1;
        else if (s.cancelAt) row.cancelled += 1;
        else if (pendingNow(s, t)) row.pending += 1;
        else if (failedNow(s, t)) row.failed += 1;
        else if (s.retryAt && t < s.retryAt) row.retry += 1;
      }
      return row;
    });
    const totals = perMail.reduce((a, r) => ({ sent: a.sent + r.sent, copies: a.copies + r.copies, pending: a.pending + r.pending, retry: a.retry + r.retry, failed: a.failed + r.failed, cancelled: a.cancelled + r.cancelled }),
      { sent: 0, copies: 0, pending: 0, retry: 0, failed: 0, cancelled: 0 });
    const since = t - days * 86400000;
    const byDay = new Map(); const failures = [];
    try {
      for (const line of fs.readFileSync(SENDLOG, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.eventId !== ev.id || r.kind === 'test') continue;
        const at = Date.parse(r.at) || 0; if (at < since) continue;
        const day = new Date(at + 7 * 3600e3).toISOString().slice(0, 10); // Vietnam time
        const d = byDay.get(day) || { day, accepted: 0, rejected: 0, retry: 0 }; byDay.set(day, d);
        if (r.status === 'accepted') d.accepted += 1;
        else if (r.status === 'rejected') { d.rejected += 1; failures.push(r); }
        else if (r.status === 'retry') { d.retry += 1; failures.push(r); }
      }
    } catch { /* nothing sent yet */ }
    // a retry that later went through is not a current problem
    const latestOk = new Map();
    try {
      for (const line of fs.readFileSync(SENDLOG, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.eventId === ev.id && r.status === 'accepted' && r.kind !== 'test') latestOk.set(r.mailId + '|' + r.to, String(r.at));
      }
    } catch { /* none */ }
    const open = failures.filter((f) => f.status === 'rejected' || !(latestOk.get(f.mailId + '|' + f.to) >= String(f.at)));
    open.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    failures.length = 0; failures.push(...open);
    return { days, setup: setupInfo(), totals, perMail, byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)), failures: failures.slice(0, 100) };
  }

  async function workflowDue(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (rateLimited(h.clientIp(req), 'workflow-due', 60, 60_000)) return send(res, 429, { error: 'Too many requests' });
    if (!h.workflowAuthorized(req)) return send(res, 401, { error: 'Invalid API key' });
    if (DIRECT) return send(res, 200, { ok: true, count: 0, remaining: 0, items: [], mode: 'direct', note: 'Email được gửi trực tiếp từ máy chủ; workflow này không cần gửi nữa.' });
    try { return send(res, 200, await dueBatch()); } catch (e) {
      if (e.status) throw e;
      console.error('due-emails failed:', e.message);
      return send(res, 502, { ok: false, error: 'Không đọc được danh sách lead từ Twenty', items: [], count: 0, remaining: 0 });
    }
  }

  // ---- Admin ----------------------------------------------------------------------
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const newId = () => crypto.randomBytes(6).toString('hex');

  function flight(mailId) { // claimed-but-unconfirmed / given-up counts for one mail (lead rows only)
    const t = now(); let pending = 0; let failed = 0; const pre = mailId + '|';
    for (const [k, s] of state) { if (!k.startsWith(pre) || s.cc || k.startsWith(pre + 'cc:')) continue; if (pendingNow(s, t)) pending += 1; else if (failedNow(s, t)) failed += 1; }
    return { pending, failed };
  }
  function adminMail(ev, m) {
    const seed = seedStartOf(ev);
    const start = h.startMs(ev);
    const c = counts.get(m.id) || { sent: 0, cancel: 0 };
    const o = {
      id: m.id, type: m.type, name: m.name, subject: m.subject, body: m.body, format: m.format === 'html' ? 'html' : 'text', enabled: !!m.enabled,
      audience: m.audience, sent: c.sent, cancelled: c.cancel, ...flight(m.id), confirm: !!m.confirm,
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
      testMode: { on: testOn(ev), emails: testers(ev), max: MAX_TESTERS }, hasJoinLink: !!ev.joinLink,
      internalCopy: { emails: copyList(ev), fromEnv: envCopy(), max: MAX_TESTERS },
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
      const fmt = b.format === 'html' ? 'html' : b.format === 'text' ? 'text' : (m.format === 'html' ? 'html' : 'text');
      if (fmt === 'html') {
        const clean = emailHtml.sanitize(String(b.body ?? '').slice(0, 150000));
        if (emailHtml.isEmpty(clean)) throw fail(400, 'Vui lòng nhập nội dung email');
        if (clean.length > MAX_HTML) throw fail(400, 'Nội dung email quá dài');
        m.body = clean; m.format = 'html';
      } else {
        const t = String(b.body ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 10000);
        if (!t) throw fail(400, 'Vui lòng nhập nội dung email'); m.body = t; m.format = 'text';
      }
    }
    if (b.enabled !== undefined || creating) {
      const en = b.enabled === undefined ? true : !!b.enabled;
      if (en && (!m.enabled || creating) && !m.confirm) m.activeSince = new Date(now()).toISOString();
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
    const m = pathname.match(/^\/api\/admin\/events\/([a-f0-9]{16})\/emails(?:\/(preview|leads|sanitize|images|report)|\/([a-f0-9]{12})(?:\/(preview|recipients|resend|test|sent))?)?$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const [, evId, colPreview, mailId, sub] = m;
    const ev = getEvents().find((x) => x.id === evId);
    if (!ev) return send(res, 404, { error: 'Not found' });
    if (!ev.emails) ev.emails = [];

    if (colPreview === 'report') { // sent / failed counts for the admin report tab
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const days = Math.min(90, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 14));
      return send(res, 200, reportFor(ev, days));
    }
    if (colPreview === 'sanitize') { // pasted / source-view html -> the sanitized html the editor may show
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, BODY_LIMIT);
      return send(res, 200, { html: emailHtml.sanitize(String(b.html || '').slice(0, 150000)) });
    }
    if (colPreview === 'images') { // picture upload from the editor -> public url under /api/email-images/
      if (req.method !== 'PUT') return send(res, 405, { error: 'Method not allowed' });
      let ext = String(new URL(req.url, 'http://x').searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
      if (ext === 'jpeg') ext = 'jpg';
      if (!images.TYPES[ext]) throw fail(400, 'Ảnh chỉ nhận PNG, JPG hoặc WebP');
      if (fs.readdirSync(IMG_DIR).filter((f) => f.startsWith(ev.id + '-')).length >= MAX_IMAGES) throw fail(409, `Mỗi sự kiện tối đa ${MAX_IMAGES} ảnh email`);
      const name = `${ev.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      await images.receive(req, path.join(IMG_DIR, name), ext, 'Ảnh');
      return send(res, 201, { url: '/api/email-images/' + name });
    }
    if (colPreview === 'leads') { // lead picker for test mode
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const q = new URL(req.url, 'http://x').searchParams;
      let people;
      try { people = peopleFor(ev, await fetchLeads(q.get('fresh') === '1')); } catch (e) { if (e.status) throw e; return send(res, 502, { error: 'Không đọc được danh sách lead từ Twenty' }); }
      const view = (p) => ({ email: p.email, name: p.name || '', registered: p.registeredAt != null, registeredAt: p.registeredAt ? new Date(p.registeredAt).toISOString() : null, optOut: !!p.optOut, inCrm: true });
      if (q.get('selected') === '1') {
        const byEmail = new Map(people.map((p) => [p.email, p]));
        return send(res, 200, { leads: testers(ev).map((em) => (byEmail.has(em) ? view(byEmail.get(em)) : { email: em, name: '', registered: false, optOut: optOut.has(em), inCrm: false })) });
      }
      const fold = (x) => h.norm(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); // "nguyen" finds "Nguyễn"
      const term = fold(q.get('q') || '');
      const hits = people.filter((p) => !term || fold(p.email).includes(term) || fold(p.name).includes(term))
        .sort((a, b) => (b.registeredAt != null) - (a.registeredAt != null) || b.created - a.created).slice(0, 12);
      return send(res, 200, { leads: hits.map(view) });
    }
    if (colPreview) { // live preview of text that is not saved yet
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, BODY_LIMIT);
      const html = b.format === 'html';
      const tmp = { id: 'preview', type: ['seeding', 'notification', 'last_notification'].includes(b.type) ? b.type : 'notification', subject: h.cleanText(b.subject, 200) || '(chưa có tiêu đề)', format: html ? 'html' : 'text', body: String(b.body || '').slice(0, html ? 150000 : 10000) || '(chưa có nội dung)', audience: b.audience === 'all' ? 'all' : 'registered' };
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
        if (b.testMode !== undefined) {
          const tm = b.testMode || {};
          const list = [...new Set((Array.isArray(tm.emails) ? tm.emails : testers(ev)).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))];
          const bad = list.find((x) => !EMAIL_RE.test(x));
          if (bad) throw fail(400, `Email không hợp lệ: ${bad}`);
          if (list.length > MAX_TESTERS) throw fail(400, `Tối đa ${MAX_TESTERS} lead thử nghiệm`);
          const on = tm.on === undefined ? testOn(ev) : !!tm.on;
          if (on && !list.length) throw fail(400, 'Hãy thêm ít nhất một lead thử nghiệm trước khi bật');
          const before = testers(ev);
          if (testOn(ev) && !on) resetFor(ev, before);                                   // leaving test mode: testers start fresh
          else if (on) resetFor(ev, before.filter((x) => !list.includes(x)));            // removed testers start fresh too
          ev.testMode = { on, emails: list };
        }
        if (b.internalCopy !== undefined) {
          const list = [...new Set((Array.isArray(b.internalCopy) ? b.internalCopy : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))];
          const bad = list.find((x) => !EMAIL_RE.test(x));
          if (bad) throw fail(400, `Email không hợp lệ: ${bad}`);
          if (list.length > MAX_TESTERS) throw fail(400, `Tối đa ${MAX_TESTERS} người nhận nội bộ`);
          ev.internalCopy = list;
        }
        saveEvents();
        return send(res, 200, overview(ev));
      }
      if (req.method === 'POST') {
        const b = await readJson(req, BODY_LIMIT);
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
      try { people = audienceFor(ev, await fetchLeads(true)); } catch (e) { if (e.status) throw e; return send(res, 502, { error: 'Không đọc được danh sách lead từ Twenty' }); }
      const ens = evaluate(ev, people, now(), false, real).filter((e) => e.mail.id === real.id);
      const by = (s) => ens.filter((e) => e.status === s);
      const sample = ens.filter((e) => e.status === 'due' || e.status === 'wait').slice(0, 8).map((e) => ({ name: e.person.name || '(không tên)', email: e.person.email }));
      return send(res, 200, { eligible: ens.length, sent: by('sent').length, cancelled: by('cancelled').length + by('cancel').length, due: by('due').length, pending: by('pending').length, failed: by('failed').length, waiting: by('wait').length, sample, enabled: !!real.enabled });
    }
    if (sub === 'sent') { // who the server has handed this mail to, oldest first (ledger order = the order the workflow loops over them)
      const t = now(); const pre = mailId + '|'; const rows = [];
      for (const [k, st] of state) {
        if (!k.startsWith(pre)) continue; const em = k.slice(pre.length);
        if (em.startsWith('cc:') || !(st.sentAt || st.claimAt)) continue;
        rows.push({ email: em, status: st.sentAt ? 'sent' : pendingNow(st, t) ? 'pending' : failedNow(st, t) ? 'failed' : 'unconfirmed', at: new Date(st.sentAt || st.claimAt).toISOString(), attempts: st.attempts || 0 });
      }
      return send(res, 200, { total: rows.length, recipients: rows });
    }
    if (sub === 'resend') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, 4096);
      if (Array.isArray(b.emails)) {
        const list = [...new Set(b.emails.map((x) => String(x || '').trim().toLowerCase()))];
        if (!list.length || list.length > 500 || list.some((x) => !EMAIL_RE.test(x))) throw fail(400, 'Danh sách email không hợp lệ (1–500 email)');
        for (const em of list) if (state.has(key(mailId, em))) ledger({ k: 'reset', e: mailId, r: em });
      } else if (b.all === true) ledger({ k: 'reset', e: mailId, r: '*' });
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
      const b = await readJson(req, BODY_LIMIT);
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

  // ---- Pictures used inside e-mails (public: mail clients fetch them by url) -----------------------
  function image(req, res, pathname) {
    const m = pathname.match(/^\/api\/email-images\/([a-f0-9]{16}-[a-f0-9]{12}\.(png|jpg|webp))$/);
    if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(m ? 405 : 404); return res.end(); }
    const file = path.join(IMG_DIR, m[1]);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': images.TYPES[m[2]].mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
  function removeImages(evId) {
    try { for (const f of fs.readdirSync(IMG_DIR)) if (f.startsWith(evId + '-')) fs.unlink(path.join(IMG_DIR, f), () => {}); } catch { /* nothing to remove */ }
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

  return { kick, sendRound, reportFor, setupInfo, confirmationOn, confirmationInfo, setConfirmation, workflowSent, workflowDue, admin, unsubscribe, image, removeImages, dueBatch, evaluate, peopleFor, audienceFor, _state: state, _counts: counts, _optOut: optOut };
};
