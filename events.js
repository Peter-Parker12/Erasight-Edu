// Events: admin-managed listing (upcoming + past), one server-rendered page per event, and an on-site
// registration form that creates a Lead in Twenty CRM. Zero dependencies; data lives in DATA_DIR.
//
//   /su-kien                   list                          <- su-kien.html (template)
//   /su-kien-<slug>            detail                        <- su-kien-chi-tiet.html (template)
// Public:  GET  /api/events/:id/banner
//          POST /api/events/:id/register   {name, phone, email, website, utm} -> Lead (type, requestedItem, source, utmTagList)
// Emails:   scheduled seeding / notification / last-call emails live in event-mailer.js (config under each event's `emails`).
// Admin:   GET|POST /api/admin/events, GET|PATCH|DELETE /api/admin/events/:id
//          PUT  /api/admin/events/:id/banner?ext=png|jpg|webp   (raw body)
//          /api/admin/events/:id/emails...   (see event-mailer.js)
// Pages are rendered on the server (like the blog) so crawlers and AI bots read them without JavaScript.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const attribution = require('./attribution');

module.exports = function init({ ROOT, SITE_URL, finalize, respond, twenty, twentyReady, normalizePhone, send, readJson, rateLimited, isAdmin }) {
  const SITE = (SITE_URL || 'https://academy.erasight.net').replace(/\/+$/, '');
  const ORG = 'Erasight Academy';
  const LOGO = `${SITE}/assets/logos/erasight-bieutuong-mau-1024w.png`;
  const TZ = 'Asia/Ho_Chi_Minh';
  const VN_OFFSET_MS = 7 * 3600 * 1000; // Vietnam has no daylight saving
  const PAST_PAGE = 6;

  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  const BANNERS_DIR = path.join(DATA_DIR, 'events');
  const DB_FILE = path.join(DATA_DIR, 'events.json');
  const REG_FILE = path.join(DATA_DIR, 'event-registrations.jsonl');
  const FAILED_LEADS = path.join(DATA_DIR, 'failed-leads.jsonl');
  fs.mkdirSync(BANNERS_DIR, { recursive: true });
  const MAX_BANNER = (Number(process.env.MAX_COVER_MB) || 3) * 1024 * 1024;

  const BANNER_TYPES = {
    png: { mime: 'image/png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
    jpg: { mime: 'image/jpeg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
    webp: { mime: 'image/webp', magic: [Buffer.from('RIFF')], extra: (b) => b.slice(8, 12).toString() === 'WEBP' },
  };

  // ---- Helpers ---------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fail = (status, error) => Object.assign(new Error(error), { status });
  const clientIp = (req) => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'su-kien';
  const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
  const startsWith = (buf, sig) => buf.length >= sig.length && buf.slice(0, sig.length).equals(sig);

  // Admin enters Vietnam local time ("2026-11-22T19:30"); we store ISO UTC.
  function parseLocal(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(v || ''));
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - VN_OFFSET_MS;
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const toLocal = (iso) => new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
  const fmt = (iso, opts) => new Intl.DateTimeFormat('vi-VN', Object.assign({ timeZone: TZ }, opts)).format(new Date(iso));
  const fmtDate = (iso) => fmt(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtTime = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtWeekday = (iso) => fmt(iso, { weekday: 'long' });
  const dayKey = (iso) => fmtDate(iso);

  // ---- Storage ---------------------------------------------------------------
  let events = [];
  try { events = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { events = []; }
  function save() {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(events, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }

  // Registration index (rebuilt from the append-only log): per event -> {count, keys, bySource}
  const regs = new Map();
  const regEntry = (id) => { if (!regs.has(id)) regs.set(id, { count: 0, keys: new Set(), bySource: {} }); return regs.get(id); };
  const keysOf = (r) => [r.email ? 'e:' + String(r.email).toLowerCase() : '', r.phone ? 'p:' + String(r.phone).replace(/\D/g, '') : ''].filter(Boolean);
  function indexReg(r) {
    const e = regEntry(r.eventId);
    e.count += 1; keysOf(r).forEach((k) => e.keys.add(k));
    const src = (r.utm && r.utm.source) || 'direct';
    e.bySource[src] = (e.bySource[src] || 0) + 1;
  }
  try {
    for (const line of fs.readFileSync(REG_FILE, 'utf8').split('\n')) { if (line.trim()) { try { indexReg(JSON.parse(line)); } catch { /* skip bad line */ } } }
  } catch { /* no registrations yet */ }

  // ---- Event state -----------------------------------------------------------
  const startMs = (e) => new Date(e.startAt).getTime();
  const endMs = (e) => new Date(e.endAt).getTime();
  const phase = (e, now = Date.now()) => (now >= endMs(e) ? 'past' : now >= startMs(e) ? 'live' : 'upcoming');
  const seatsLeft = (e) => (e.capacity ? Math.max(0, e.capacity - (regs.get(e.id)?.count || 0)) : null);
  const published = () => events.filter((e) => e.status === 'published' && e.banner);
  const bannerUrl = (e) => `/api/events/${e.id}/banner?v=${encodeURIComponent(e.updatedAt)}`;
  const eventUrl = (e) => `/su-kien-${e.slug}`;

  // twCount: registrations counted from Twenty (undefined -> fall back to this server's own count)
  function adminEvent(e, twCount) {
    const r = regs.get(e.id);
    return {
      id: e.id, slug: e.slug, title: e.title, summary: e.summary, body: e.body, mode: e.mode, location: e.location,
      startLocal: toLocal(e.startAt), endLocal: toLocal(e.endAt), capacity: e.capacity || null, registrationOpen: !!e.registrationOpen,
      status: e.status, hasBanner: !!e.banner, url: eventUrl(e), phase: phase(e),
      // served from the admin route: the admin cookie is scoped to /api/admin, so drafts' banners show here too
      bannerUrl: e.banner ? `/api/admin/events/${e.id}/banner?v=${encodeURIComponent(e.updatedAt)}` : null,
      registrations: twCount != null ? twCount : (r ? r.count : 0), registrationSource: twCount != null ? 'twenty' : 'server', bySource: r ? r.bySource : {}, createdAt: e.createdAt, updatedAt: e.updatedAt,
      joinLink: e.joinLink || '', previousTitles: e.previousTitles || [],
      confirmation: mailer.confirmationInfo(e), zalo: e.zalo || null, recording: e.recording || null,
    };
  }

  // Registration extras: confirmation email (+ QR picture) and the Zalo group popup shown after registering.
  const imgRe = (evId) => new RegExp(`^/api/email-images/${evId}-[a-f0-9]{12}\\.(png|jpg|webp)$`);
  function cleanImage(v, evId) {
    const s = String(v || '').trim(); if (!s) return '';
    if (!imgRe(evId).test(s)) throw fail(400, 'Ảnh QR phải được tải lên từ phần cài đặt của sự kiện này');
    return s;
  }
  function cleanLink(v, label) {
    const s = cleanText(v, 500); if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw fail(400, `${label} phải bắt đầu bằng http:// hoặc https://`);
    return s;
  }
  const cleanLong = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
  function applyExtras(e, b) {
    if (b.recording !== undefined) { // recording shown on the event page once the event is past
      const r = b.recording || {}; const url = cleanText(r.url, 500);
      if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw fail(400, 'Link bản ghi phải bắt đầu bằng https://');
      e.recording = url ? { url, title: cleanText(r.title, 120) } : null;
    }
    if (b.confirmation !== undefined) mailer.setConfirmation(e, !!(b.confirmation || {}).enabled); // content: the email editor
    if (b.zalo !== undefined) {
      const z = b.zalo || {}; const prev = e.zalo || {};
      const f = (k) => (z[k] !== undefined ? z[k] : prev[k]);
      e.zalo = {
        enabled: z.enabled !== undefined ? !!z.enabled : !!prev.enabled, title: cleanText(f('title') ?? '', 120), text: cleanLong(f('text') ?? '', 500),
        image: cleanImage(f('image') ?? '', e.id), linkUrl: cleanLink(f('linkUrl') ?? '', 'Link nhóm Zalo'),
      };
      if (e.zalo.enabled && !e.zalo.image && !e.zalo.linkUrl) throw fail(400, 'Popup Zalo cần ít nhất ảnh QR hoặc link nhóm');
    }
  }

  function applyFields(e, b, creating) {
    if (b.title !== undefined || creating) { const t = cleanText(b.title, 150); if (!t) throw fail(400, 'Vui lòng nhập tiêu đề sự kiện');
      // Leads store the event title they registered under: remember old titles so the email lookup still finds the event after a rename.
      if (e.title && e.title !== t) e.previousTitles = [...new Set([...(e.previousTitles || []), e.title])].filter((x) => x !== t).slice(-20);
      e.title = t; }
    if (b.summary !== undefined || creating) e.summary = cleanText(b.summary, 220);
    if (b.body !== undefined || creating) e.body = String(b.body ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 20000);
    if (b.mode !== undefined || creating) e.mode = b.mode === 'offline' ? 'offline' : 'online';
    if (b.location !== undefined || creating) e.location = cleanText(b.location, 200);
    if (b.startLocal !== undefined || creating) { const s = parseLocal(b.startLocal); if (!s) throw fail(400, 'Thời gian bắt đầu chưa hợp lệ'); e.startAt = s; }
    if (b.endLocal !== undefined || creating) {
      let en = b.endLocal ? parseLocal(b.endLocal) : null;
      if (b.endLocal && !en) throw fail(400, 'Thời gian kết thúc chưa hợp lệ');
      if (!en) en = new Date(new Date(e.startAt).getTime() + 2 * 3600 * 1000).toISOString();
      e.endAt = en;
    }
    if (new Date(e.endAt) <= new Date(e.startAt)) throw fail(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
    if (b.capacity !== undefined || creating) {
      if (b.capacity === '' || b.capacity == null) e.capacity = null;
      else { const n = Number(b.capacity); if (!Number.isInteger(n) || n < 1 || n > 100000) throw fail(400, 'Số chỗ tối đa chưa hợp lệ'); e.capacity = n; }
    }
    if (b.registrationOpen !== undefined || creating) e.registrationOpen = b.registrationOpen === undefined ? true : !!b.registrationOpen;
    if (b.joinLink !== undefined || creating) {
      const l = cleanText(b.joinLink, 500);
      if (l && !/^https?:\/\/[^\s]+$/i.test(l)) throw fail(400, 'Link tham gia phải bắt đầu bằng http:// hoặc https://');
      e.joinLink = l;
    }
    if (b.status !== undefined || creating) {
      const st = b.status === 'published' ? 'published' : 'draft';
      if (st === 'published' && !e.banner) throw fail(400, 'Cần tải banner trước khi xuất bản');
      e.status = st;
    }
  }

  function uniqueSlug(title, selfId) {
    const base = slugify(title); let s = base; let i = 2;
    while (events.some((x) => x.slug === s && x.id !== selfId)) s = `${base}-${i++}`;
    return s;
  }

  function receiveBanner(req, dest, ext, label = 'Banner') {
    return new Promise((resolve, reject) => {
      const type = BANNER_TYPES[ext];
      if (!type) return reject(fail(400, label + ' chỉ nhận PNG, JPG hoặc WebP'));
      if (Number(req.headers['content-length']) > MAX_BANNER) return reject(fail(413, label + ' quá dung lượng cho phép'));
      const tmp = dest + '.tmp';
      const out = fs.createWriteStream(tmp);
      let size = 0; let done = false;
      const abort = (err) => { if (done) return; done = true; out.destroy(); fs.unlink(tmp, () => {}); reject(err); };
      req.on('data', (c) => { size += c.length; if (size > MAX_BANNER) abort(fail(413, label + ' quá dung lượng cho phép')); });
      req.on('error', abort); out.on('error', abort);
      out.on('finish', () => {
        if (done) return; done = true;
        try {
          const fd = fs.openSync(tmp, 'r'); const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
          if (!(size > 0 && type.magic.some((m) => startsWith(head, m)) && (!type.extra || type.extra(head)))) {
            fs.unlinkSync(tmp); return reject(fail(400, 'Nội dung tệp không khớp với định dạng ' + ext));
          }
          fs.renameSync(tmp, dest); resolve(size);
        } catch (e) { reject(e); }
      });
      req.pipe(out);
    });
  }
  const removeBanner = (name) => { if (name) fs.unlink(path.join(BANNERS_DIR, path.basename(name)), () => {}); };

  // ---- Rendering -------------------------------------------------------------
  const tpl = new Map();
  function template(name) {
    const file = path.join(ROOT, name);
    const { mtimeMs } = fs.statSync(file);
    const hit = tpl.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.html;
    const html = fs.readFileSync(file, 'utf8');
    tpl.set(file, { mtimeMs, html });
    return html;
  }
  const fill = (html, head, main) => html.replace('<!--SSR:HEAD-->', () => head).replace('<!--SSR:MAIN-->', () => main);

  function headTags({ title, description, canonical, image, type = 'website', robots = 'index,follow,max-image-preview:large', ld = [] }) {
    return [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}" />`,
      `<meta name="robots" content="${robots}" />`,
      `<link rel="canonical" href="${esc(canonical)}" />`,
      `<meta property="og:site_name" content="${ORG}" />`, `<meta property="og:locale" content="vi_VN" />`,
      `<meta property="og:type" content="${type}" />`, `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`, `<meta property="og:url" content="${esc(canonical)}" />`,
      `<meta property="og:image" content="${esc(image || LOGO)}" />`,
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
      `<meta name="twitter:title" content="${esc(title)}" />`, `<meta name="twitter:description" content="${esc(description)}" />`,
      `<meta name="twitter:image" content="${esc(image || LOGO)}" />`,
      ...ld.map(jsonLd),
    ].join('\n  ');
  }
  const crumbs = (items) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })),
  });

  const ICON = {
    cal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    web: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  };
  const modeLabel = (e) => (e.mode === 'online' ? 'Online' : 'Trực tiếp');

  function badge(e) {
    const p = phase(e);
    if (p === 'past') return '<span class="ev-badge ev-badge--end">Đã kết thúc</span>';
    if (p === 'live') return '<span class="ev-badge ev-badge--live">● Đang diễn ra</span>';
    const days = Math.ceil((startMs(e) - Date.now()) / 864e5);
    if (days <= 7) return `<span class="ev-badge ev-badge--soon">${days <= 1 ? 'Diễn ra trong 24 giờ tới' : `Còn ${days} ngày`}</span>`;
    return '<span class="ev-badge">Sắp diễn ra</span>';
  }

  function card(e) {
    const past = phase(e) === 'past';
    const full = seatsLeft(e) === 0;
    return `
        <a class="ev-card${past ? ' is-past' : ''}" href="${eventUrl(e)}">
          <div class="ev-card__banner"><img src="${bannerUrl(e)}" alt="${esc(e.title)}" loading="lazy" width="960" height="540" />${badge(e)}</div>
          <div class="ev-card__body">
            <div class="ev-meta"><span>${ICON.cal} ${fmtDate(e.startAt)} · ${fmtTime(e.startAt)}</span><span>${e.mode === 'online' ? ICON.web : ICON.pin} ${modeLabel(e)}</span></div>
            <h3>${esc(e.title)}</h3>
            ${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
            <span class="ev-more">${past ? `${e.recording && e.recording.url ? 'Có bản ghi · ' : ''}Xem lại thông tin →` : full ? 'Đã đủ chỗ · Xem chi tiết →' : 'Xem chi tiết →'}</span>
          </div>
        </a>`;
  }

  function renderList(pg) {
    const all = published();
    const upcoming = all.filter((e) => phase(e) !== 'past').sort((a, b) => startMs(a) - startMs(b));
    const past = all.filter((e) => phase(e) === 'past').sort((a, b) => startMs(b) - startMs(a));
    const shownPast = past.slice(0, PAST_PAGE * pg);
    const grid = (list, empty) => (list.length ? `<div class="ev-grid">${list.map(card).join('')}</div>` : `<div class="ev-empty">${empty}</div>`);
    const main = `
    <section class="blk ev-section" id="sap-dien-ra">
      <div class="wrap">
        <div class="ev-head"><h2>Sắp diễn ra</h2><span class="ev-count">${upcoming.length} sự kiện</span></div>
        <p class="ev-sub">Đăng ký sớm để giữ chỗ — một số sự kiện có số lượng giới hạn.</p>
        ${grid(upcoming, 'Hiện chưa có sự kiện sắp tới. Hãy quay lại sớm hoặc theo dõi Erasight trên Facebook và TikTok.')}
      </div>
    </section>
    <section class="blk ev-section ev-section--past" id="da-dien-ra">
      <div class="wrap">
        <div class="ev-head"><h2>Đã diễn ra</h2><span class="ev-count ev-count--muted">${past.length} sự kiện</span></div>
        <p class="ev-sub">Nhìn lại các sự kiện trước — mới nhất ở trên.</p>
        ${grid(shownPast, 'Chưa có sự kiện nào đã diễn ra.')}
        ${past.length > shownPast.length ? `<div class="ev-more-wrap"><a class="btn btn-ghost" href="/su-kien?past=${pg + 1}#da-dien-ra">Xem thêm sự kiện đã qua</a></div>` : ''}
      </div>
    </section>`;
    const description = 'Workshop, webinar và buổi chia sẻ thực chiến về AI Marketing và tiếng Anh đi làm tại Erasight Academy — xem sự kiện sắp diễn ra và các sự kiện đã qua.';
    const canonical = SITE + '/su-kien';
    const head = headTags({
      title: `Sự kiện — Workshop & Webinar | ${ORG}`, description, canonical, image: all[0] ? SITE + bannerUrl(all[0]) : undefined,
      ld: [
        { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Sự kiện ${ORG}`, description, url: canonical, inLanguage: 'vi', isPartOf: { '@type': 'WebSite', name: ORG, url: SITE },
          mainEntity: { '@type': 'ItemList', itemListElement: upcoming.concat(shownPast).map((e, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + eventUrl(e), name: e.title })) } },
        crumbs([[ORG, SITE + '/Homepage'], ['Sự kiện', canonical]]),
      ],
    });
    return { head, main };
  }

  // Event body: blank line = new paragraph, "## " = heading, "- " = bullet. Everything is escaped.
  function renderBody(text) {
    const out = []; let list = [];
    const flush = () => { if (list.length) { out.push(`<ul>${list.map((x) => `<li>${x}</li>`).join('')}</ul>`); list = []; } };
    for (const block of String(text || '').split(/\n{2,}/)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      let para = [];
      const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
      for (const l of lines) {
        if (/^##\s+/.test(l)) { flushPara(); flush(); out.push(`<h2>${esc(l.replace(/^##\s+/, ''))}</h2>`); }
        else if (/^[-•*]\s+/.test(l)) { flushPara(); list.push(esc(l.replace(/^[-•*]\s+/, ''))); }
        else { flush(); para.push(esc(l)); }
      }
      flushPara(); flush();
    }
    return out.join('\n');
  }

  // Recording link -> embed for YouTube / Vimeo / Google Drive, otherwise a plain link. Only https links are used.
  function recordingEmbed(raw) {
    let u; try { u = new URL(String(raw)); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^(www|m)\./, '');
    let id = null; let m;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com') id = u.searchParams.get('v') || ((m = u.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]+)/)) ? m[1] : null);
    if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}`, open: `https://www.youtube.com/watch?v=${id}` };
    if (host === 'vimeo.com' && (m = u.pathname.match(/^\/(\d{6,12})/))) return { kind: 'embed', src: `https://player.vimeo.com/video/${m[1]}`, open: `https://vimeo.com/${m[1]}` };
    if (host === 'drive.google.com' && (m = u.pathname.match(/\/file\/d\/([\w-]{10,80})/))) return { kind: 'embed', src: `https://drive.google.com/file/d/${m[1]}/preview`, open: u.toString() };
    return { kind: 'link', open: u.toString() };
  }

  function recordingSection(e) {
    const rec = e.recording && e.recording.url && phase(e) === 'past' ? recordingEmbed(e.recording.url) : null;
    if (!rec) return '';
    const title = e.recording.title || `Bản ghi: ${e.title}`;
    const frame = rec.kind === 'embed'
      ? `<div class="ev-rec-frame"><iframe src="${esc(rec.src)}" title="${esc(title)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"></iframe></div>` : '';
    return `<section class="ev-rec" id="ghi-hinh" aria-label="Xem lại sự kiện"><h2>Xem lại sự kiện</h2>${frame}<p><a class="ev-rec-btn" href="${esc(rec.open)}" target="_blank" rel="noopener">${rec.kind === 'embed' ? 'Mở trên trang gốc' : 'Xem bản ghi'} →</a></p></section>`;
  }

  function renderDetail(e) {
    const p = phase(e);
    const left = seatsLeft(e);
    const full = left === 0;
    const canRegister = p !== 'past' && e.registrationOpen && !full;
    const when = `${esc(fmtWeekday(e.startAt))}, ${fmtDate(e.startAt)}`;
    const time = dayKey(e.startAt) === dayKey(e.endAt) ? `${fmtTime(e.startAt)} – ${fmtTime(e.endAt)}` : `${fmtTime(e.startAt)} → ${fmtDate(e.endAt)} ${fmtTime(e.endAt)}`;
    const cta = canRegister
      ? `<button type="button" class="btn btn-primary ev-cta" id="evRegBtn" data-event-id="${esc(e.id)}" data-event-title="${esc(e.title)}" data-event-when="${esc(`${fmtDate(e.startAt)} · ${fmtTime(e.startAt)} · ${modeLabel(e)}`)}"${left ? ` data-seats="${left}"` : ''}>Đăng ký tham dự →</button>`
      : `<div class="ev-cta ev-cta--off">${p === 'past' ? 'Sự kiện đã kết thúc' : full ? 'Đã đủ chỗ' : 'Hiện chưa mở đăng ký'}</div>`;
    const others = published().filter((x) => x.id !== e.id && phase(x) !== 'past').sort((a, b) => startMs(a) - startMs(b)).slice(0, 2);
    const moreEvents = (others.length ? others : published().filter((x) => x.id !== e.id).sort((a, b) => startMs(b) - startMs(a)).slice(0, 2));
    const main = `
    <div class="wrap ev-detail">
      <nav class="res-breadcrumb ev-crumb" aria-label="Breadcrumb"><a href="/Homepage">Trang chủ</a><span>›</span><a href="/su-kien">Sự kiện</a><span>›</span><span aria-current="page">${esc(cut(e.title, 60))}</span></nav>
      <div class="ev-hero"><img src="${bannerUrl(e)}" alt="${esc(e.title)}" width="1280" height="720" />${badge(e)}</div>
      <div class="ev-layout">
        <article class="ev-content">
          <div class="ev-kicker">${modeLabel(e).toUpperCase()}${p === 'past' ? ' · ĐÃ DIỄN RA' : ''}</div>
          <h1>${esc(e.title)}</h1>
          ${e.summary ? `<p class="ev-lead">${esc(e.summary)}</p>` : ''}
          <div class="ev-body">${renderBody(e.body)}</div>
          ${recordingSection(e)}
        </article>
        <aside class="ev-side" aria-label="Thông tin sự kiện">
          <div class="ev-row"><span class="ev-ic">${ICON.cal}</span><div><em>Thời gian</em><b>${when}</b><span>${time} (GMT+7)</span></div></div>
          <div class="ev-row"><span class="ev-ic">${e.mode === 'online' ? ICON.web : ICON.pin}</span><div><em>Hình thức</em><b>${modeLabel(e)}</b>${e.location ? `<span>${esc(e.location)}</span>` : ''}</div></div>
          ${e.capacity ? `<div class="ev-row"><span class="ev-ic">${ICON.users}</span><div><em>Số chỗ</em><b>${p === 'past' ? `Tối đa ${e.capacity} người` : full ? 'Đã đủ chỗ' : `Còn ${left} / ${e.capacity} chỗ`}</b></div></div>` : ''}
          ${cta}
        </aside>
      </div>
      ${moreEvents.length ? `<section class="ev-others"><h2>${others.length ? 'Sự kiện sắp tới khác' : 'Sự kiện khác'}</h2><div class="ev-grid ev-grid--2">${moreEvents.map(card).join('')}</div></section>` : ''}
    </div>`;
    const description = e.summary || cut(String(e.body || '').replace(/[#\-•*]/g, ' ').replace(/\s+/g, ' ').trim(), 160) || e.title;
    const canonical = SITE + eventUrl(e);
    const ld = {
      '@context': 'https://schema.org', '@type': 'Event', name: e.title, description, url: canonical, inLanguage: 'vi',
      startDate: e.startAt, endDate: e.endAt, image: [SITE + bannerUrl(e)],
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: e.mode === 'online' ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
      location: e.mode === 'online' ? { '@type': 'VirtualLocation', url: canonical } : { '@type': 'Place', name: e.location || ORG, address: e.location || 'TP. Hồ Chí Minh' },
      organizer: { '@type': 'Organization', name: ORG, url: SITE },
    };
    const head = headTags({
      title: `${e.title} | Sự kiện ${ORG}`, description, canonical, image: SITE + bannerUrl(e), type: 'article',
      ld: [ld, crumbs([[ORG, SITE + '/Homepage'], ['Sự kiện', SITE + '/su-kien'], [e.title, canonical]])],
    });
    return { head, main };
  }

  const notFoundMain = `
    <div class="wrap ev-detail" style="text-align:center;padding:90px 0;">
      <div style="font-size:3.6rem;">🔍</div>
      <h1 style="font-family:var(--font-display);font-size:1.8rem;margin:12px 0 6px;">Không tìm thấy sự kiện</h1>
      <p style="color:var(--slate);">Sự kiện có thể đã được gỡ hoặc đường dẫn không đúng.</p>
      <p style="margin-top:18px;"><a class="btn btn-primary" href="/su-kien">Xem tất cả sự kiện</a></p>
    </div>`;

  function page(req, res, status, tplName, { head, main }) {
    const html = finalize(fill(template(tplName), head, main));
    respond(req, res, { status, buf: Buffer.from(html), contentType: 'text/html; charset=utf-8', cacheControl: status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store', isText: true });
  }

  // ---- Email helpers (shared with event-mailer.js) ----------------------------
  const norm = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const linkify = (html) => html.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#07736C">${u}</a>`);
  const fillTokens = (text, vars) => String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));

  // Placeholders that describe the event itself ({{name}}, {{first_name}} ... are added per recipient)
  const eventVars = (ev) => ({
    event_title: ev.title, event_date: `${fmtWeekday(ev.startAt)}, ${fmtDate(ev.startAt)}`, event_time: `${fmtTime(ev.startAt)} – ${fmtTime(ev.endAt)}`,
    event_mode: modeLabel(ev), event_location: ev.location || '', join_link: ev.joinLink || '', event_url: SITE + eventUrl(ev),
  });

  // text (already placeholder-filled) -> full HTML email; footerHtml is appended inside the card (e.g. unsubscribe link)
  function renderEmail(text, footerHtml) {
    const styled = linkify(renderBody(text))
      .replace(/<p>/g, '<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#0C2A3A">')
      .replace(/<h2>/g, '<h2 style="margin:22px 0 8px;font-size:18px;color:#0C2A3A">')
      .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.7;color:#0C2A3A">');
    return wrapEmail(styled, footerHtml);
  }

  // already-styled body html -> full HTML email (card + signature + footerHtml)
  function wrapEmail(styled, footerHtml) {
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
      + `<body style="margin:0;background:#F6FAFA;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;padding:24px 16px">`
      + `<div style="background:#fff;border:1px solid #DDE7E7;border-radius:14px;padding:26px">${styled}`
      + `<p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #eef3f3;font-size:13px;color:#6b8590">Trân trọng,<br>Erasight Academy · <a href="${SITE}" style="color:#6b8590">${SITE.replace(/^https?:\/\//, '')}</a></p>`
      + `${footerHtml || ''}</div></div></body></html>`;
  }

  function workflowAuthorized(req) {
    const key = process.env.WORKFLOW_API_KEY || '';
    if (!key) throw fail(503, 'WORKFLOW_API_KEY is not configured');
    const got = String(req.headers['x-api-key'] || '');
    const a = crypto.createHash('sha256').update(got).digest(); const b = crypto.createHash('sha256').update(key).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // ---- Registration ----------------------------------------------------------
  async function register(req, res, ev) {
    if (rateLimited(clientIp(req), 'event-register', 5, 60_000)) return send(res, 429, { ok: false, error: 'Too many requests' });
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true }); // honeypot
    const name = cleanText(b.name, 120); const phone = cleanText(b.phone, 30); const email = cleanText(b.email, 200);
    if (!name || !/^\+?[\d\s().-]{8,18}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Invalid input');
    if (ev.status !== 'published' || phase(ev) === 'past') throw fail(409, 'Sự kiện đã kết thúc');
    if (!ev.registrationOpen) throw fail(409, 'Sự kiện hiện chưa mở đăng ký');

    // Reserve synchronously (before any await) so concurrent requests can never exceed the capacity.
    const idx = regEntry(ev.id);
    const rec = { at: new Date().toISOString(), eventId: ev.id, event: ev.title, name, phone, email, utm: attribution.parse(b.utm) };
    // TODO(TESTING): duplicate-registration rule is switched off so the same phone/email can register repeatedly while testing.
    // RE-ENABLE AFTER THE PRODUCTION DEPLOYMENT (uncomment the next line):
    // if (keysOf(rec).some((k) => idx.keys.has(k))) return send(res, 200, { ok: true, duplicate: true, seatsLeft: seatsLeft(ev) }); // already registered: no second lead
    if (ev.capacity && idx.count >= ev.capacity) throw fail(409, 'Sự kiện đã đủ chỗ');
    indexReg(rec);
    fs.appendFile(REG_FILE, JSON.stringify(rec) + '\n', () => {});

    try {
      if (!twentyReady()) throw new Error('TWENTY_URL / TWENTY_API_KEY not configured');
      await twenty('POST', '/leads', {
        name, emails: { primaryEmail: email }, phones: normalizePhone(phone),
        status: 'NEW', ...attribution.leadFields({ type: 'event', requestedItem: ev.title, utm: b.utm }),
      });
    } catch (e) {
      // The registration is already saved in event-registrations.jsonl; keep the lead for recovery too.
      console.error('event lead failed (registration kept):', e.message);
      fs.appendFile(FAILED_LEADS, JSON.stringify({ at: rec.at, name, phone, email, event: ev.title, utm: rec.utm }) + '\n', () => {});
    }
    const z = ev.zalo;
    const zalo = z && z.enabled && (z.image || z.linkUrl) ? { title: z.title || 'Tham gia nhóm Zalo', text: z.text || '', image: z.image || '', link: z.linkUrl || '' } : null;
    mailer.invalidateLeads();
    mailer.kick(true); // direct mode: send the confirmation now (fresh lead list), not at the next timer tick
    return send(res, 200, { ok: true, seatsLeft: seatsLeft(ev), zalo, emailSoon: mailer.confirmationOn(ev) });
  }

  // ---- Admin -----------------------------------------------------------------
  async function admin(req, res, pathname) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Login required' });
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'erasight-admin') return send(res, 403, { error: 'Bad request' });
    const m = pathname.match(/^\/api\/admin\/events(?:\/([a-f0-9]{16})(?:\/(banner))?)?$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const [, id, sub] = m;

    if (!id) {
      if (req.method === 'GET') {
        const tw = await mailer.twentyRegistrationCounts(events);
        return send(res, 200, { events: [...events].sort((a, b) => startMs(b) - startMs(a)).map((e) => adminEvent(e, tw && tw.get(e.id))) });
      }
      if (req.method === 'POST') {
        const b = await readJson(req, 64 * 1024);
        const now = new Date().toISOString();
        const e = { id: crypto.randomBytes(8).toString('hex'), banner: null, createdAt: now, updatedAt: now };
        applyFields(e, Object.assign({}, b, { status: 'draft' }), true); // a banner is required before publishing
        e.slug = uniqueSlug(e.title, e.id);
        events.push(e); save();
        return send(res, 201, { event: adminEvent(e) });
      }
      return send(res, 405, { error: 'Method not allowed' });
    }

    const ev = events.find((x) => x.id === id);
    if (!ev) return send(res, 404, { error: 'Not found' });

    if (sub === 'banner') {
      if (req.method === 'GET') {
        const file = ev.banner && path.join(BANNERS_DIR, path.basename(ev.banner));
        if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': BANNER_TYPES[path.extname(file).slice(1)].mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method !== 'PUT') return send(res, 405, { error: 'Method not allowed' });
      let ext = String(new URL(req.url, 'http://x').searchParams.get('ext') || '').toLowerCase().replace(/^\./, '');
      if (ext === 'jpeg') ext = 'jpg';
      const name = `${ev.id}-${Date.now().toString(36)}.${ext}`; // new name each time -> no stale CDN/browser copy
      await receiveBanner(req, path.join(BANNERS_DIR, name), ext);
      const old = ev.banner; ev.banner = name; ev.updatedAt = new Date().toISOString();
      if (old) removeBanner(old);
      save();
      return send(res, 200, { event: adminEvent(ev) });
    }

    const twCount = async () => { const tw = await mailer.twentyRegistrationCounts([ev]); return tw ? tw.get(ev.id) : undefined; };
    if (req.method === 'GET') return send(res, 200, { event: adminEvent(ev, await twCount()) });
    if (req.method === 'PATCH') {
      const b = await readJson(req, 64 * 1024);
      applyFields(ev, b, false);
      applyExtras(ev, b);
      ev.updatedAt = new Date().toISOString(); save();
      return send(res, 200, { event: adminEvent(ev, await twCount()) });
    }
    if (req.method === 'DELETE') {
      removeBanner(ev.banner); mailer.removeImages(ev.id);
      events = events.filter((x) => x !== ev); save();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // ---- Public API ------------------------------------------------------------
  async function pub(req, res, pathname) {
    const m = pathname.match(/^\/api\/events\/([a-f0-9]{16})\/(banner|register)$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const ev = events.find((x) => x.id === m[1]);
    // Drafts are hidden from the public (the admin preview uses the admin API's own bannerUrl, which is the same route)
    if (!ev || !ev.banner) { res.writeHead(404); return res.end(); }
    if (m[2] === 'register') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      return register(req, res, ev);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    if (ev.status !== 'published' && !isAdmin(req)) { res.writeHead(404); return res.end(); }
    const file = path.join(BANNERS_DIR, path.basename(ev.banner));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': BANNER_TYPES[path.extname(file).slice(1)].mime, 'Content-Length': fs.statSync(file).size,
      'Cache-Control': ev.status === 'published' ? 'public, max-age=86400' : 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  // Feedback surveys: questions, personal answer links, responses, analytics (the email that carries the link is in event-mailer.js)
  const surveyKey = () => process.env.SESSION_SECRET || process.env.WORKFLOW_API_KEY || process.env.ADMIN_PASSWORD || 'erasight-unsubscribe';
  const surveys = require('./surveys')({
    DATA_DIR, SITE_URL: SITE, send, readJson, rateLimited, isAdmin,
    getEvents: () => events, saveEvents: save, secret: surveyKey,
  });
  const mailer = require('./event-mailer')({
    DATA_DIR, SITE, twenty, twentyReady, send, readJson, rateLimited, isAdmin,
    getEvents: () => events, saveEvents: save, surveys,
    helpers: { fail, cleanText, clientIp, parseLocal, toLocal, startMs, endMs, norm, fillTokens, eventVars, renderEmail, wrapEmail, workflowAuthorized },
    images: { receive: receiveBanner, TYPES: BANNER_TYPES },
  });
  surveys.attach({ invitedFor: mailer.invitedFor, participantsFor: mailer.participantsFor });

  return {
    async handle(req, res, pathname) {
      try {
        if (pathname.startsWith('/khao-sat/') || pathname.startsWith('/api/survey/') || pathname === '/api/admin/surveys/summary'
          || /^\/api\/admin\/events\/[a-f0-9]{16}\/survey(\/results)?$/.test(pathname)) return await surveys.handle(req, res, pathname);
        if (pathname === '/api/workflow/due-emails') return await mailer.workflowDue(req, res);
        if (pathname === '/api/workflow/email-sent') return await mailer.workflowSent(req, res);
        if (pathname === '/huy-dang-ky-email') return await mailer.unsubscribe(req, res);
        if (pathname.startsWith('/api/email-images/')) return mailer.image(req, res, pathname);
        if (/^\/api\/admin\/events\/[a-f0-9]{16}\/emails/.test(pathname)) return await mailer.admin(req, res, pathname);
        if (pathname.startsWith('/api/admin/events')) return await admin(req, res, pathname);
        return await pub(req, res, pathname);
      } catch (e) {
        if (!e.status) console.error('events error:', e);
        if (res.headersSent) return res.end();
        res.setHeader('Connection', 'close');
        send(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Server error' });
        if (e.status === 413) res.on('finish', () => req.destroy());
      }
    },

    list(req, res) {
      const q = new URL(req.url, 'http://x').searchParams;
      const pg = /^\d{1,3}$/.test(q.get('past') || '') ? Math.max(1, Number(q.get('past'))) : 1;
      page(req, res, 200, 'su-kien.html', renderList(pg));
    },

    detail(req, res, slug) {
      const e = slug && /^[a-z0-9-]+$/.test(slug) ? published().find((x) => x.slug === slug) : null;
      if (!e) {
        return page(req, res, 404, 'su-kien-chi-tiet.html', {
          head: headTags({ title: `Không tìm thấy sự kiện — ${ORG}`, description: 'Sự kiện không tồn tại.', canonical: SITE + '/su-kien', robots: 'noindex,nofollow' }), main: notFoundMain,
        });
      }
      page(req, res, 200, 'su-kien-chi-tiet.html', renderDetail(e));
    },

    // Used by sitemap.xml
    sitemapEntries: () => published().map((e) => ({ path: eventUrl(e), lastmod: String(e.updatedAt).slice(0, 10) })),
  };
};
