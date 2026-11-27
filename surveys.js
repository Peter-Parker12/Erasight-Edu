// Feedback surveys for events. Zero dependencies.
//   - the survey (questions, texts, open/closed) is stored on the event itself (events.json, field "survey")
//   - each participant gets a personal link (signed, no login); one answer per person, the latest answer counts
//   - answers are appended to DATA_DIR/survey-responses.jsonl and indexed in memory at start
//   - the post-event email that carries the link is sent by the mailer (event-mailer.js), not from here
//   Public:  GET /khao-sat/<eventId>/<token>             the answer page (noindex)
//            GET|POST /api/survey/<eventId>/<token>       questions / submit
//   Admin:   GET|PATCH /api/admin/events/<id>/survey     the survey
//            GET /api/admin/events/<id>/survey/results   analytics, responders, CSV source
//            GET /api/admin/surveys/summary              all events side by side
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['rating', 'nps', 'choice', 'multi', 'text'];
// Version tag for the answer page's CSS/JS: the server caches static files for a day, so a changed file needs a new URL.
const ASSET_VER = (() => {
  const root = path.join(__dirname, 'assets');
  return ['css/khao-sat.css', 'js/khao-sat.js'].map((f) => { try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex').slice(0, 10); } catch { return '0'; } }).join('-');
})();
const MAX_Q = 20;
const STOP = new Set(['và', 'của', 'là', 'có', 'các', 'những', 'cho', 'được', 'một', 'này', 'với', 'trong', 'khi', 'để', 'không', 'thì', 'mà', 'đã', 'sẽ', 'rất', 'cũng', 'cần', 'bạn', 'tôi', 'chúng', 'the', 'and', 'for', 'that', 'with', 'you', 'are', 'was', 'have', 'this', 'not', 'but', 'from']);

module.exports = function init({ DATA_DIR, SITE_URL, send, readJson, rateLimited, isAdmin, getEvents, saveEvents, secret }) {
  const RESP_FILE = path.join(DATA_DIR, 'survey-responses.jsonl');
  const SITE = String(SITE_URL || '').replace(/\/+$/, '');
  const fail = (status, error) => Object.assign(new Error(error), { status });
  const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const cleanLong = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

  // hooks filled in by events.js once the mailer exists: invitedFor(ev) -> Set(email), participantsFor(ev) -> Promise<[email]>
  const hooks = { invitedFor: () => new Set(), participantsFor: async () => [] };
  const attach = (h) => Object.assign(hooks, h);

  // ---- personal link -------------------------------------------------------------------------------
  const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
  const sig = (evId, email) => crypto.createHmac('sha256', secret()).update('survey:' + evId + ':' + email).digest('hex').slice(0, 32);
  function tokenFor(evId, email) { const e = String(email).trim().toLowerCase(); return b64(e) + '.' + sig(evId, e); }
  function emailFromToken(evId, token) {
    const [a, g] = String(token || '').split('.');
    if (!a || !g) return null;
    const email = Buffer.from(a, 'base64url').toString('utf8').trim().toLowerCase();
    if (!email || email.length > 200) return null;
    const want = sig(evId, email);
    if (g.length !== want.length) return null;
    return crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want)) ? email : null;
  }
  const linkFor = (evId, email) => `${SITE}/khao-sat/${evId}/${tokenFor(evId, email)}`;

  // ---- survey definition -----------------------------------------------------------------------------
  function defaultSurvey() {
    return {
      open: true, title: 'Đánh giá sự kiện', intro: 'Cảm ơn bạn đã tham dự. Chỉ mất vài phút để chia sẻ cảm nhận của bạn.',
      thanks: 'Cảm ơn bạn! Phản hồi của bạn giúp chúng tôi làm tốt hơn.',
      questions: [
        { id: 'q1', type: 'rating', text: 'Bạn đánh giá chung về buổi học như thế nào?', required: true },
        { id: 'q2', type: 'nps', text: 'Bạn có sẵn sàng giới thiệu sự kiện này cho bạn bè không?', required: true },
        { id: 'q3', type: 'multi', text: 'Phần nào bạn thích nhất?', required: false, options: ['Nội dung', 'Diễn giả', 'Thực hành', 'Thời lượng'] },
        { id: 'q4', type: 'text', text: 'Bạn muốn chúng tôi cải thiện điều gì?', required: false },
      ],
    };
  }
  const surveyOf = (ev) => (ev.survey && Array.isArray(ev.survey.questions) ? ev.survey : defaultSurvey());

  function cleanSurvey(b, prev) {
    const src = b || {}; const old = prev || defaultSurvey();
    const qs = src.questions !== undefined ? src.questions : old.questions;
    if (!Array.isArray(qs)) throw fail(400, 'Danh sách câu hỏi không hợp lệ');
    if (qs.length > MAX_Q) throw fail(400, `Tối đa ${MAX_Q} câu hỏi`);
    const seen = new Set();
    const questions = qs.map((q, i) => {
      const type = String(q && q.type || '');
      if (!TYPES.includes(type)) throw fail(400, `Câu ${i + 1}: loại câu hỏi không hợp lệ`);
      const text = cleanText(q.text, 300);
      if (!text) throw fail(400, `Câu ${i + 1}: vui lòng nhập nội dung câu hỏi`);
      let id = /^q[a-z0-9]{2,12}$/.test(String(q.id || '')) ? String(q.id) : 'q' + crypto.randomBytes(3).toString('hex');
      while (seen.has(id)) id = 'q' + crypto.randomBytes(3).toString('hex');
      seen.add(id);
      const out = { id, type, text, required: !!q.required };
      if (type === 'choice' || type === 'multi') {
        const opts = [...new Set((Array.isArray(q.options) ? q.options : []).map((x) => cleanText(x, 80)).filter(Boolean))];
        if (opts.length < 2 || opts.length > 12) throw fail(400, `Câu ${i + 1}: cần từ 2 đến 12 lựa chọn`);
        out.options = opts;
      }
      return out;
    });
    return {
      open: src.open !== undefined ? !!src.open : !!old.open,
      title: cleanText(src.title !== undefined ? src.title : old.title, 120) || 'Đánh giá sự kiện',
      intro: cleanLong(src.intro !== undefined ? src.intro : old.intro, 1000),
      thanks: cleanLong(src.thanks !== undefined ? src.thanks : old.thanks, 500),
      questions,
    };
  }

  // ---- answers -----------------------------------------------------------------------------------------
  const resp = new Map(); // "eventId|email" -> latest row
  function index(row) {
    const k = row.eventId + '|' + row.email;
    resp.set(k, row);
  }
  try {
    for (const line of fs.readFileSync(RESP_FILE, 'utf8').split('\n')) { if (line.trim()) { try { index(JSON.parse(line)); } catch { /* skip */ } } }
  } catch { /* no answers yet */ }
  const latestRows = (evId) => [...resp.values()].filter((r) => r.eventId === evId);
  const hasResponded = (evId, email) => resp.has(evId + '|' + String(email).toLowerCase());

  function checkAnswers(survey, answers) {
    const out = {}; const errs = [];
    const a = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
    for (const q of survey.questions) {
      const v = a[q.id];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) { if (q.required) errs.push(q.text); continue; }
      if (q.type === 'rating' || q.type === 'nps') {
        const n = Number(v);
        const max = q.type === 'rating' ? 5 : 10; const min = q.type === 'rating' ? 1 : 0;
        if (!Number.isInteger(n) || n < min || n > max) { errs.push(q.text); continue; }
        out[q.id] = n;
      } else if (q.type === 'choice') {
        if (typeof v !== 'string' || !q.options.includes(v)) { errs.push(q.text); continue; }
        out[q.id] = v;
      } else if (q.type === 'multi') {
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && q.options.includes(x))) { errs.push(q.text); continue; }
        out[q.id] = [...new Set(v)];
      } else {
        out[q.id] = cleanLong(v, 1000);
      }
    }
    return { out, errs };
  }

  // ---- analytics -----------------------------------------------------------------------------------------
  const r1 = (n) => Math.round(n * 10) / 10;
  function words(texts) {
    const count = new Map();
    for (const t of texts) for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length < 3 || STOP.has(w)) continue;
      count.set(w, (count.get(w) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, n]) => ({ word, n }));
  }
  function analyse(ev, rows) {
    const survey = surveyOf(ev);
    const questions = survey.questions.map((q) => {
      const vals = rows.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
      const base = { id: q.id, type: q.type, text: q.text, required: q.required, answered: vals.length };
      if (q.type === 'rating') {
        const nums = vals.map(Number).filter(Number.isInteger);
        return { ...base, avg: nums.length ? r1(nums.reduce((s, n) => s + n, 0) / nums.length) : null, dist: [1, 2, 3, 4, 5].map((n) => nums.filter((x) => x === n).length) };
      }
      if (q.type === 'nps') {
        const nums = vals.map(Number).filter(Number.isInteger);
        const p = nums.filter((x) => x >= 9).length; const d = nums.filter((x) => x <= 6).length; const pas = nums.length - p - d;
        return { ...base, score: nums.length ? Math.round((p - d) / nums.length * 100) : null, promoters: p, passives: pas, detractors: d };
      }
      if (q.type === 'choice') return { ...base, options: q.options.map((o) => ({ option: o, n: vals.filter((v) => v === o).length })) };
      if (q.type === 'multi') return { ...base, options: q.options.map((o) => ({ option: o, n: vals.filter((v) => Array.isArray(v) && v.includes(o)).length })) };
      const texts = rows.filter((r) => r.answers[q.id]).map((r) => ({ email: r.email, text: r.answers[q.id], at: r.at })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return { ...base, texts: texts.slice(0, 300), topWords: words(texts.map((t) => t.text)) };
    });
    const daily = new Map();
    for (const r of rows) { const day = new Date(Date.parse(r.at) + 7 * 3600e3).toISOString().slice(0, 10); daily.set(day, (daily.get(day) || 0) + 1); }
    return { questions, daily: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, n]) => ({ day, n })) };
  }

  async function results(ev) {
    const testers = new Set((ev.survey && ev.survey.testers) || []);
    const rows = latestRows(ev.id).filter((r) => !testers.has(r.email));
    const testAnswers = latestRows(ev.id).filter((r) => testers.has(r.email)).length;
    const invited = hooks.invitedFor(ev);
    let participants = [];
    try { participants = await hooks.participantsFor(ev); } catch { /* Twenty unreachable: no responder list */ }
    const answered = new Set(rows.map((r) => r.email));
    const responders = rows.map((r) => ({ email: r.email, at: r.at }));
    const nonResponders = participants.filter((e) => !answered.has(e));
    const a = analyse(ev, rows);
    return {
      eventId: ev.id, eventTitle: ev.title, open: !!surveyOf(ev).open,
      invited: invited.size, responses: rows.length, testAnswers, participants: participants.length,
      rate: invited.size ? Math.round(rows.length / invited.size * 100) : null,
      lastAt: rows.length ? rows.map((r) => r.at).sort().pop() : null,
      ...a, responders, nonResponders,
      rows: rows.map((r) => ({ email: r.email, at: r.at, answers: r.answers })).sort((x, y) => String(y.at).localeCompare(String(x.at))),
      questionsMeta: surveyOf(ev).questions.map((q) => ({ id: q.id, text: q.text, type: q.type })),
    };
  }

  // ---- public answer page --------------------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function page(ev, token, preview) {
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(surveyOf(ev).title)} · ${esc(ev.title)}</title>
<meta name="theme-color" content="#0B0E14">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/khao-sat.css?v=${ASSET_VER}">
</head><body>
<header class="ks-top"><a href="${esc(SITE)}" aria-label="Erasight Academy"><img src="/assets/logos/erasight-logo-ngang-mau-1600w.png" alt="Erasight Academy" width="180" height="30"></a><span class="ks-mono">Khảo sát sau sự kiện</span></header>
<main class="ks-wrap" data-event="${esc(ev.id)}" data-token="${esc(token || '')}"${preview ? ' data-preview="1"' : ''}><div id="ksApp"><p class="ks-muted">Đang tải…</p></div></main>
<footer class="ks-foot"><span class="ks-mono">Erasight Academy · Learn · Work · Grow · Global</span><a href="${esc(SITE)}">${esc(SITE.replace(/^https?:\/\//, ''))}</a></footer>
<script src="/assets/js/khao-sat.js?v=${ASSET_VER}" defer></script></body></html>`;
  }
  const notFound = (res) => { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); res.end('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Không tìm thấy</title><p style="font-family:sans-serif;padding:40px">Liên kết khảo sát không hợp lệ hoặc đã hết hạn.</p>'); };

  function publicLookup(evId, token) {
    const ev = getEvents().find((x) => x.id === evId);
    if (!ev || ev.status !== 'published') return null;
    const email = emailFromToken(evId, token);
    if (!email) return null;
    return { ev, email };
  }

  async function publicApi(req, res, evId, token) {
    const found = publicLookup(evId, token);
    if (!found) return send(res, 404, { error: 'Liên kết không hợp lệ' });
    const { ev, email } = found;
    const survey = surveyOf(ev);
    const row = resp.get(evId + '|' + email);
    if (req.method === 'GET') {
      return send(res, 200, {
        eventTitle: ev.title, title: survey.title, intro: survey.intro, thanks: survey.thanks, open: !!survey.open,
        questions: survey.questions, answered: !!row, answers: row ? row.answers : null,
      });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    if (rateLimited(ip, 'survey-submit', 20, 60_000)) return send(res, 429, { error: 'Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút.' });
    const b = await readJson(req, 16 * 1024);
    if (b.website) return send(res, 200, { ok: true }); // honeypot
    if (!survey.open) throw fail(409, 'Khảo sát này đã đóng.');
    const { out, errs } = checkAnswers(survey, b.answers);
    if (errs.length) throw fail(400, 'Vui lòng trả lời: ' + errs.slice(0, 3).join(' · '));
    const rec = { at: new Date().toISOString(), eventId: evId, email, answers: out };
    fs.appendFileSync(RESP_FILE, JSON.stringify(rec) + '\n');
    index(rec);
    return send(res, 200, { ok: true, thanks: survey.thanks, updated: !!row });
  }

  // ---- admin -----------------------------------------------------------------------------------------------
  function adminSurvey(ev) {
    const s = surveyOf(ev);
    const testers = (ev.survey && Array.isArray(ev.survey.testers) ? ev.survey.testers : []).map((email) => ({ email, link: linkFor(ev.id, email) }));
    return { ...s, testers, configured: !!(ev.survey && Array.isArray(ev.survey.questions)), eventTitle: ev.title };
  }

  async function admin(req, res, pathname) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Login required' });
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'erasight-admin') return send(res, 403, { error: 'Bad request' });
    if (pathname === '/api/admin/surveys/summary') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const rows = getEvents().map((ev) => {
        const testers = new Set((ev.survey && ev.survey.testers) || []);
        const r = latestRows(ev.id).filter((x) => !testers.has(x.email)); const inv = hooks.invitedFor(ev).size;
        const ratings = surveyOf(ev).questions.filter((q) => q.type === 'rating').map((q) => r.map((x) => Number(x.answers[q.id])).filter(Number.isInteger));
        const flat = ratings.flat(); const avg = flat.length ? r1(flat.reduce((s, n) => s + n, 0) / flat.length) : null;
        const nps = surveyOf(ev).questions.filter((q) => q.type === 'nps').map((q) => r.map((x) => Number(x.answers[q.id])).filter(Number.isInteger)).flat();
        const score = nps.length ? Math.round((nps.filter((x) => x >= 9).length - nps.filter((x) => x <= 6).length) / nps.length * 100) : null;
        return { eventId: ev.id, title: ev.title, invited: inv, responses: r.length, rate: inv ? Math.round(r.length / inv * 100) : null, avgRating: avg, nps: score };
      });
      return send(res, 200, { events: rows });
    }
    const m = pathname.match(/^\/api\/admin\/events\/([a-f0-9]{16})\/survey(?:\/(results|test-links))?$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const ev = getEvents().find((x) => x.id === m[1]);
    if (!ev) return send(res, 404, { error: 'Event not found' });
    if (m[2] === 'test-links') { // personal links for team members to try the survey (their answers are kept out of the results)
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = await readJson(req, 16 * 1024);
      const raw = Array.isArray(b.emails) ? b.emails.join(',') : String(b.emails || '');
      const list = [...new Set(raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
      if (!list.length) throw fail(400, 'Nhập ít nhất một email');
      if (list.some((x) => !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x))) throw fail(400, 'Có email chưa đúng định dạng');
      const cur = ev.survey || {};
      const testers = [...new Set([...(cur.testers || []), ...list])].slice(0, 30);
      ev.survey = { ...(ev.survey && ev.survey.questions ? ev.survey : defaultSurvey()), testers };
      ev.updatedAt = new Date().toISOString(); saveEvents();
      return send(res, 200, { survey: adminSurvey(ev) });
    }
    if (m[2] === 'results') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      return send(res, 200, await results(ev));
    }
    if (req.method === 'GET') return send(res, 200, { survey: adminSurvey(ev) });
    if (req.method === 'PATCH') {
      const b = await readJson(req, 64 * 1024);
      const body = b.survey && typeof b.survey === 'object' ? b.survey : b;
      ev.survey = { ...cleanSurvey(body, ev.survey && ev.survey.questions ? ev.survey : null), testers: (ev.survey && ev.survey.testers) || [] };
      ev.updatedAt = new Date().toISOString(); saveEvents();
      return send(res, 200, { survey: adminSurvey(ev) });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  return {
    attach,
    tokenFor, linkFor, hasResponded, surveyOf,
    async handle(req, res, pathname) {
      try {
        let m = pathname.match(/^\/api\/admin\/events\/([a-f0-9]{16})\/survey\/preview\/?$/); // under /api/admin: the admin cookie is only sent there
        if (m) { // admin preview of the answer page (nothing is saved)
          if (!isAdmin(req)) { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">Đăng nhập quản trị để xem thử.</p>'); }
          const ev = getEvents().find((x) => x.id === m[1]);
          if (!ev) return notFound(res);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
          return res.end(page(ev, '', true));
        }
        m = pathname.match(/^\/khao-sat\/([a-f0-9]{16})\/([A-Za-z0-9_\-.]+)\/?$/);
        if (m) {
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
          const found = publicLookup(m[1], m[2]);
          if (!found) return notFound(res);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
          return res.end(page(found.ev, m[2]));
        }
        m = pathname.match(/^\/api\/survey\/([a-f0-9]{16})\/([A-Za-z0-9_\-.]+)\/?$/);
        if (m) return await publicApi(req, res, m[1], m[2]);
        return await admin(req, res, pathname);
      } catch (e) {
        if (!e.status) console.error('survey error:', e);
        if (res.headersSent) return res.end();
        send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      }
    },
  };
};
