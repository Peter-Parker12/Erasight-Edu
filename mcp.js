// MCP server (Model Context Protocol, "streamable HTTP" transport, JSON responses, zero dependencies) for the admin end of
// Erasight Academy: events, seeding emails, event notification emails, the last-call email and the email settings.
//
//   Endpoint:  POST /mcp   with  Authorization: Bearer <MCP_TOKEN>   (header only: the secret never appears in a URL or access log)
//   Disabled unless MCP_TOKEN (>= 24 chars) is set.
//
// Every tool calls the existing admin REST API of this same process over loopback (header X-MCP-Internal = a random per-process
// secret that server.js accepts as "admin"), so all validation, sanitising and scheduling rules are exactly the admin UI's.
'use strict';
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const emailHtml = require('./email-html');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const IMG_MAX = 3 * 1024 * 1024;
const PLACEHOLDERS = '{{name}} {{first_name}} {{email}} {{requested_item}} {{event_title}} {{event_date}} {{event_time}} {{event_mode}} {{event_location}} {{join_link}} {{event_url}}';
const BODY_HELP = 'Email body as HTML (format "html"). Allowed: p, br, hr, h2, h3, strong, em, u, s, ul/ol/li, blockquote, a, img, span (inline color/font-size/text-align styles). '
  + 'Anything else is stripped. Placeholders filled per recipient: ' + PLACEHOLDERS + '. A link can be a call-to-action button with <a href="{{join_link}}" data-btn="1">Text</a>. '
  + 'A clickable picture is <a href="https://…"><img src="/api/email-images/…"></a> (get the src from upload_email_image).';
const TIMING_HELP = 'Only for type "notification". {"mode":"on_register","delayHours":0} = after a lead registers for this event; {"mode":"before","hours":24} = N hours before the event starts (to all registered leads, or all leads if audience is "all"); {"mode":"at","atLocal":"2026-12-01T09:00"} = at a fixed Vietnam-time moment.';

module.exports = function init({ PORT, INTERNAL, rateLimited, send, readJson }) {
  const TOKEN = String(process.env.MCP_TOKEN || '');
  const enabled = TOKEN.length >= 24;
  const BASE = `http://127.0.0.1:${PORT}`;
  const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const tokenOk = (got) => !!got && crypto.timingSafeEqual(sha(got), sha(TOKEN));

  // ---- loopback call to the admin API ----------------------------------------------------------------------------
  async function api(method, path, body, raw) {
    const headers = { 'X-MCP-Internal': INTERNAL, 'X-Requested-With': 'erasight-admin' };
    let payload;
    if (raw) { payload = raw.buf; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    const text = await r.text(); let d = {};
    try { d = text ? JSON.parse(text) : {}; } catch { /* not json */ }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  // ---- fetch a picture from a public https url (SSRF-guarded) ----------------------------------------------------
  const privateIp = (ip) => {
    if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
    const x = ip.toLowerCase(); return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:');
  };
  // Downloads a file from a public https address. types: { ext: mime }, max: bytes. Returns { buf, ext }.
  async function fetchFile(url, types, max, what) {
    let u; try { u = new URL(String(url)); } catch { throw new Error(`${what} URL is not valid`); }
    if (u.protocol !== 'https:') throw new Error(`${what} URL must start with https://`);
    if (net.isIP(u.hostname) || /^localhost$|\.local$|\.internal$/i.test(u.hostname)) throw new Error(`${what} URL must use a public host name`);
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error(`${what} URL resolves to a non-public address`);
    const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Could not download the ${what} (HTTP ${r.status})`);
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = Object.keys(types).find((k) => types[k] === type) || (type === 'application/octet-stream' ? String(u.pathname).split('.').pop().toLowerCase() : '');
    if (!ext || !types[ext]) throw new Error(`${what} type not accepted (${type || 'unknown'})`);
    if (Number(r.headers.get('content-length')) > max) throw new Error(`${what} is too large`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error(`${what} is too large`);
    return { buf, ext };
  }
    const fetchImage = (url) => fetchFile(url, { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }, IMG_MAX, 'image');

  // ---- drafting helpers (no saving here: the result is a preview to check, then add_email / update_email saves it) ----
  const slugOf = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const KNOWN_TOKENS = ['name', 'first_name', 'email', 'requested_item', 'event_title', 'event_date', 'event_time', 'event_mode', 'event_location', 'join_link', 'event_url'];
  const BLOCK_TYPES = ['heading', 'subheading', 'paragraph', 'bullets', 'button', 'image', 'divider'];
  function blocksToHtml(blocks) {
    const E = emailHtml.esc;
    const t = (x) => E(String(x == null ? '' : x)).replace(/\n/g, '<br>');
    return blocks.map((b) => {
      switch (b.type) {
        case 'heading': return `<h2>${t(b.text)}</h2>`;
        case 'subheading': return `<h3>${t(b.text)}</h3>`;
        case 'paragraph': return `<p>${t(b.text)}</p>`;
        case 'bullets': return `<ul>${(b.items || []).map((i) => `<li>${t(i)}</li>`).join('')}</ul>`;
        case 'button': return `<p><a href="${E(b.url)}" data-btn="1">${t(b.label || 'Xem thêm')}</a></p>`;
        case 'image': {
          const img = `<img src="${E(b.src)}" alt="${E(b.alt || '')}" width="${/^\d{2,3}$/.test(String(b.width)) ? Number(b.width) : 560}">`;
          return `<p>${b.url ? `<a href="${E(b.url)}">${img}</a>` : img}</p>`;
        }
        case 'divider': return '<hr>';
        default: throw new Error(`Unknown block type "${b.type}". Use one of: ${BLOCK_TYPES.join(', ')}`);
      }
    }).join('');
  }
  function placeholdersIn(text) {
    const found = new Set(); for (const m of String(text).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) found.add(m[1].toLowerCase());
    return { found: [...found], unknown: [...found].filter((x) => !KNOWN_TOKENS.includes(x)) };
  }

  // ---- views -------------------------------------------------------------------------------------------------------
  const evView = (e) => ({ id: e.id, title: e.title, status: e.status, phase: e.phase, startLocal: e.startLocal, endLocal: e.endLocal, mode: e.mode, location: e.location, capacity: e.capacity, registrationOpen: e.registrationOpen, registrations: e.registrations, hasBanner: e.hasBanner, url: e.url });
  const mailView = (m, bodies) => { const c = Object.assign({}, m); if (!bodies) { c.bodyChars = String(c.body || '').length; delete c.body; } return c; };
  const ovView = (o, bodies) => Object.assign({}, o, { emails: (o.emails || []).map((m) => mailView(m, bodies)) });
  const pick = (a, keys) => { const o = {}; for (const k of keys) if (a[k] !== undefined) o[k] = a[k]; return o; };
  const eid = (a) => { if (!/^[a-f0-9]{16}$/.test(String(a.event_id || ''))) throw new Error('event_id must be a 16-character event id (see list_events)'); return a.event_id; };
  const mid = (a) => { if (!/^[a-f0-9]{12}$/.test(String(a.mail_id || ''))) throw new Error('mail_id must be a 12-character email id (see get_email_config)'); return a.mail_id; };
  const EV = (a) => `/api/admin/events/${eid(a)}`;
  const EM = (a) => `${EV(a)}/emails`;
  const docId = (a) => { if (!/^[a-f0-9]{16}$/.test(String(a.document_id || ''))) throw new Error('document_id must be a 16-character id (see list_documents)'); return a.document_id; };
  const showId = (a) => { if (!/^shc_[a-f0-9]{12}$/.test(String(a.showcase_id || ''))) throw new Error('showcase_id must look like shc_xxxxxxxxxxxx (see list_showcases)'); return a.showcase_id; };

  const S = { type: 'string' }, B = { type: 'boolean' }, N = { type: 'integer' };
  const EVENT_PROPS = {
    title: { ...S, description: 'Event title (max 150 chars)' },
    summary: { ...S, description: 'One-line summary shown in listings (max 220 chars)' },
    body: { ...S, description: 'Event description, plain text with blank lines between paragraphs (max 20000 chars)' },
    mode: { type: 'string', enum: ['online', 'offline'] },
    location: { ...S, description: 'Venue, or platform name for online events (max 200 chars)' },
    start_local: { ...S, description: 'Start, Vietnam time, "YYYY-MM-DDTHH:mm" e.g. 2026-12-05T19:30' },
    end_local: { ...S, description: 'End, Vietnam time, same format. Defaults to start + 2 hours' },
    capacity: { type: ['integer', 'null'], description: 'Max registrations; null = unlimited' },
    registration_open: { ...B, description: 'Whether the registration form accepts sign-ups' },
    join_link: { ...S, description: 'Zoom/Meet link used by {{join_link}} in emails (https://…)' },
  };
  const evBody = (a) => pick({ title: a.title, summary: a.summary, body: a.body, mode: a.mode, location: a.location, startLocal: a.start_local, endLocal: a.end_local, capacity: a.capacity, registrationOpen: a.registration_open, joinLink: a.join_link }, ['title', 'summary', 'body', 'mode', 'location', 'startLocal', 'endLocal', 'capacity', 'registrationOpen', 'joinLink']);
  const MAIL_PROPS = {
    name: { ...S, description: 'Internal label for the email (max 100 chars)' },
    subject: { ...S, description: 'Subject line; placeholders allowed (max 200 chars)' },
    body: { ...S, description: BODY_HELP },
    format: { type: 'string', enum: ['html', 'text'], description: 'Defaults to "html" for new emails' },
    enabled: { ...B, description: 'Disabled emails are never sent' },
    audience: { type: 'string', enum: ['all', 'registered'], description: 'seeding: "all" leads or only leads "registered" for this event. notification: "registered" (default) or "all" leads' },
    skip_registered: { ...B, description: 'Seeding only: skip leads who already registered for this event (default true)' },
    timing: { type: 'object', description: TIMING_HELP },
    offset_hours: { ...N, description: 'Seeding only: hours after the FIRST seeding email (the first one is always 0)' },
    is_last_call: { ...B, description: 'Seeding only: mark this seeding email as the "last call" email (only one per event)' },
  };
  const mailBody = (a, creating) => {
    const o = pick({ name: a.name, subject: a.subject, body: a.body, format: a.format, enabled: a.enabled, audience: a.audience, skipRegistered: a.skip_registered, timing: a.timing, offsetHours: a.offset_hours, isLastCall: a.is_last_call }, ['name', 'subject', 'body', 'format', 'enabled', 'audience', 'skipRegistered', 'timing', 'offsetHours', 'isLastCall']);
    if (o.body !== undefined && o.format === undefined && creating) o.format = 'html';
    return o;
  };

  const TOOLS = [
    // ---- events ----
    { name: 'list_events', description: 'List all events (newest first) with status, schedule, registration counts and public URL.', props: {}, req: [],
      run: async () => ({ events: (await api('GET', '/api/admin/events')).events.map(evView) }) },
    { name: 'get_event', description: 'Get one event with all its details (description, location, join link, dates).', props: { event_id: S }, req: ['event_id'],
      run: async (a) => (await api('GET', EV(a))).event },
    { name: 'create_event', description: 'Create a new event as a DRAFT. A banner is required before it can be published (use set_event_banner), then call update_event with status "published".', props: EVENT_PROPS, req: ['title', 'start_local'],
      run: async (a) => (await api('POST', '/api/admin/events', evBody(a))).event },
    { name: 'update_event', description: 'Change any field of an event; send only what changes. status "published" makes it public (needs a banner), "draft" hides it.', props: { event_id: S, ...EVENT_PROPS, status: { type: 'string', enum: ['draft', 'published'] } }, req: ['event_id'],
      run: async (a) => (await api('PATCH', EV(a), Object.assign(evBody(a), a.status !== undefined ? { status: a.status } : {}))).event },
    { name: 'set_event_banner', description: 'Set the event banner (16:9 recommended) from a public https image URL (PNG/JPG/WebP, up to 3MB).', props: { event_id: S, image_url: { ...S, description: 'https:// URL of the image' } }, req: ['event_id', 'image_url'],
      run: async (a) => { const img = await fetchImage(a.image_url); return (await api('PUT', `${EV(a)}/banner?ext=${img.ext}`, undefined, img)).event; } },
    { name: 'delete_event', description: 'PERMANENTLY delete an event, its banner and its email pictures. confirm_title must equal the event title exactly.', props: { event_id: S, confirm_title: S }, req: ['event_id', 'confirm_title'],
      run: async (a) => { const e = (await api('GET', EV(a))).event; if (String(a.confirm_title) !== e.title) throw new Error(`confirm_title does not match. The event is called: "${e.title}"`); await api('DELETE', EV(a)); return { ok: true, deleted: e.title }; } },
    // ---- email configuration ----
    { name: 'get_email_config', description: 'Full email setup of an event: seeding start time, every email (seeding / notification / last notification) with timing and sent counts, the timeline, test mode and internal-copy list.', props: { event_id: S, include_bodies: { ...B, description: 'Include full email bodies (default false)' } }, req: ['event_id'],
      run: async (a) => ovView(await api('GET', EM(a)), a.include_bodies === true) },
    { name: 'set_seeding_start', description: 'Set when the first seeding email goes out (Vietnam time); later seeding emails follow at their offset_hours. Empty string clears it.', props: { event_id: S, start_local: { ...S, description: '"YYYY-MM-DDTHH:mm" or ""' } }, req: ['event_id', 'start_local'],
      run: async (a) => ovView(await api('PATCH', EM(a), { seedingStartLocal: a.start_local })) },
    { name: 'add_email', description: 'Add an email. type "seeding" = the seeding sequence (first one anchors the sequence, later ones need offset_hours; set is_last_call for the last-call email); "notification" = event notification (needs timing); "last_notification" = the single final notification, sent to leads registering after the last call. Returns the updated setup — the new email has the newest id.', props: { event_id: S, type: { type: 'string', enum: ['seeding', 'notification', 'last_notification'] }, ...MAIL_PROPS }, req: ['event_id', 'type', 'subject', 'body'],
      run: async (a) => ovView(await api('POST', EM(a), Object.assign({ type: a.type }, mailBody(a, true)))) },
    { name: 'update_email', description: 'Edit an email; send only the fields that change (get mail_id from get_email_config).', props: { event_id: S, mail_id: S, ...MAIL_PROPS }, req: ['event_id', 'mail_id'],
      run: async (a) => ovView(await api('PATCH', `${EM(a)}/${mid(a)}`, mailBody(a, false))) },
    { name: 'delete_email', description: 'Delete an email from the event (its send history is kept in the ledger).', props: { event_id: S, mail_id: S }, req: ['event_id', 'mail_id'],
      run: async (a) => ovView(await api('DELETE', `${EM(a)}/${mid(a)}`)) },
    { name: 'preview_email', description: 'Render an email exactly as a recipient would get it (subject + HTML) using a sample recipient name.', props: { event_id: S, mail_id: S, recipient_name: S }, req: ['event_id', 'mail_id'],
      run: async (a) => api('GET', `${EM(a)}/${mid(a)}/preview?name=${encodeURIComponent(a.recipient_name || '')}`) },
    { name: 'email_recipients', description: 'Who an email applies to right now: eligible / already sent / cancelled / due / waiting counts, plus a sample of names (reads leads from Twenty).', props: { event_id: S, mail_id: S }, req: ['event_id', 'mail_id'],
      run: async (a) => api('GET', `${EM(a)}/${mid(a)}/recipients`) },
    { name: 'send_test_email', description: 'Queue a test copy of an email to one address. It goes out on the next run of the Twenty workflow (up to 15 minutes), subject prefixed "[GỬI THỬ]".', props: { event_id: S, mail_id: S, to: S, name: S }, req: ['event_id', 'mail_id', 'to'],
      run: async (a) => api('POST', `${EM(a)}/${mid(a)}/test`, { to: a.to, name: a.name }) },
    { name: 'list_sent_recipients', description: 'Every lead this email has been handed to, oldest first (the workflow sends in this order), with status sent / pending (waiting for delivery confirmation) / failed and the timestamp. Use it to find who an interrupted run never reached.', props: { event_id: S, mail_id: S }, req: ['event_id', 'mail_id'],
      run: async (a) => api('GET', `${EM(a)}/${mid(a)}/sent`) },
    { name: 'resend_email', description: 'Reset the sent status so an email is sent again on the next workflow run — for one lead (email), for a list (emails, max 500), or, with all=true and confirm=true, for EVERYONE (can re-send to many leads).', props: { event_id: S, mail_id: S, email: S, emails: { type: 'array', items: S }, all: B, confirm: { ...B, description: 'Must be true when all=true' } }, req: ['event_id', 'mail_id'],
      run: async (a) => { if (a.all === true && a.confirm !== true) throw new Error('all=true re-sends to every lead. Pass confirm=true if that is really intended.'); return ovView(await api('POST', `${EM(a)}/${mid(a)}/resend`, a.all === true ? { all: true } : Array.isArray(a.emails) ? { emails: a.emails } : { email: a.email })); } },
    { name: 'set_test_mode', description: 'Test mode: when on, the real scheduler runs for this event but ONLY the listed lead emails (max 20, must be valid emails) receive anything — even for draft events. Turning it off resets the testers\' sent history.', props: { event_id: S, on: B, emails: { type: 'array', items: S, description: 'Lead emails to test with (replaces the list)' } }, req: ['event_id', 'on'],
      run: async (a) => ovView(await api('PATCH', EM(a), { testMode: pick({ on: a.on, emails: a.emails }, ['on', 'emails']) })) },
    { name: 'set_internal_copy', description: 'Internal recipients (max 20) who each get ONE copy of every seeding / notification email when it goes out ("[BẢN SAO NỘI BỘ]" prefix). Replaces the per-event list; the server-wide INTERNAL_COPY_EMAILS list is added on top.', props: { event_id: S, emails: { type: 'array', items: S } }, req: ['event_id', 'emails'],
      run: async (a) => ovView(await api('PATCH', EM(a), { internalCopy: a.emails })) },
    { name: 'set_registration_extras', description: 'Registration extras. confirmation_enabled switches the automatic confirmation email on or off (it is the email named "Xác nhận đăng ký" in get_email_config; edit its subject, body, QR picture and buttons with update_email, using upload_email_image for pictures). zalo_* set the Zalo group popup shown right after registering (zalo_image / zalo_link). Send only the parts that change.', props: { event_id: S, confirmation_enabled: B, zalo_enabled: B, zalo_title: S, zalo_text: S, zalo_image: { ...S, description: 'src from upload_email_image' }, zalo_link: { ...S, description: 'https://zalo.me/g/… group link' } }, req: ['event_id'],
      run: async (a) => {
        const cur = (await api('GET', EV(a))).event;
        const z = cur.zalo || {};
        const pickStr = (v, old) => (v !== undefined ? v : old);
        const body = {};
        if (a.confirmation_enabled !== undefined) body.confirmation = { enabled: a.confirmation_enabled };
        if (a.zalo_enabled !== undefined || a.zalo_title !== undefined || a.zalo_text !== undefined || a.zalo_image !== undefined || a.zalo_link !== undefined) {
          body.zalo = { enabled: a.zalo_enabled !== undefined ? a.zalo_enabled : !!z.enabled, title: pickStr(a.zalo_title, z.title || ''), text: pickStr(a.zalo_text, z.text || ''), image: pickStr(a.zalo_image, z.image || ''), linkUrl: pickStr(a.zalo_link, z.linkUrl || '') };
        }
        return (await api('PATCH', EV(a), body)).event;
      } },
    // ---- drafting ----
    { name: 'draft_email', description: 'Draft an event email from simple blocks and preview it (nothing is saved). Blocks: heading, subheading, paragraph, bullets (items), button (label + url), image (src from upload_email_image, optional url and width), divider. Placeholders you can use in text, links and the subject: {{name}} {{first_name}} {{email}} {{requested_item}} {{event_title}} {{event_date}} {{event_time}} {{event_mode}} {{event_location}} {{join_link}} {{event_url}}. With event_id the preview fills the event details and a sample name. Save the result with add_email (type, subject, body = the html returned).',
      props: { subject: S, blocks: { type: 'array', description: 'Email content in order', items: { type: 'object', properties: { type: { type: 'string', enum: BLOCK_TYPES }, text: S, items: { type: 'array', items: S }, label: S, url: S, src: S, alt: S, width: S } } }, event_id: S, sample_name: S }, req: ['subject', 'blocks'],
      run: async (a) => {
        if (!Array.isArray(a.blocks) || !a.blocks.length) throw new Error('blocks must be a non-empty list');
        const html = emailHtml.sanitize(blocksToHtml(a.blocks));
        if (emailHtml.isEmpty(html)) throw new Error('The email has no text or picture');
        const subject = String(a.subject).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
        const ph = placeholdersIn(subject + ' ' + html);
        const warnings = [];
        if (ph.unknown.length) warnings.push(`Unknown placeholders (they will stay as typed): ${ph.unknown.map((x) => '{{' + x + '}}').join(', ')}`);
        if (/\{\{(join_link|event_url)\}\}/.test(html) && !a.event_id) warnings.push('The email uses {{join_link}} / {{event_url}}: pass event_id to preview their values');
        let preview = { subject, html };
        if (a.event_id) {
          const ev = (await api('GET', EV(a))).event;
          const sample = a.sample_name || 'Nguyễn Văn An';
          const vals = { name: sample, first_name: sample.split(/\s+/).pop(), email: 'an@example.com', requested_item: ev.title,
            event_title: ev.title, event_date: ev.startLocal ? ev.startLocal.slice(0, 10) : '', event_time: ev.startLocal ? ev.startLocal.slice(11, 16) : '', event_mode: ev.mode === 'offline' ? 'Trực tiếp' : 'Trực tuyến',
            event_location: ev.location || '', join_link: ev.joinLink || '', event_url: ev.url || '' };
          const fill = (x) => String(x).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (vals[k.toLowerCase()] !== undefined ? emailHtml.esc(vals[k.toLowerCase()]) : m));
          preview = { subject: subject.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (vals[k.toLowerCase()] !== undefined ? vals[k.toLowerCase()] : m)), html: fill(html) };
          if (!ev.joinLink && /join_link/.test(html)) warnings.push('The event has no join link yet: the {{join_link}} link will be empty');
        }
        return { ...preview, text: require('./mail-smtp').textOf(preview.html), placeholders: ph.found, warnings, next: 'Save with add_email (type, subject, body = html) or update_email' };
      } },
    { name: 'build_utm_link', description: 'Build a campaign (UTM) link for an event, optionally shortened (the short link keeps the tags and counts clicks). Source, medium, campaign and content are written like the admin page does (lowercase, dashes). Example: source "facebook", medium "social", campaign "workshop-t12".', props: { event_id: S, source: S, medium: S, campaign: S, content: S, shorten: B }, req: ['event_id', 'source', 'campaign'],
      run: async (a) => {
        const ev = (await api('GET', EV(a))).event;
        const p = new URLSearchParams();
        p.set('utm_source', slugOf(a.source)); if (slugOf(a.medium)) p.set('utm_medium', slugOf(a.medium));
        p.set('utm_campaign', slugOf(a.campaign)); if (slugOf(a.content)) p.set('utm_content', slugOf(a.content));
        const path = `${ev.url}?${p.toString()}`;
        if (!a.shorten) return { path, note: 'Relative to the site: https://academy.erasight.net' + path };
        const sl = await api('POST', '/api/admin/short-links', { url: path });
        return { path, shortUrl: sl.shortUrl, code: sl.code, clicks: sl.clicks };
      } },

    // ---- event sending report ----
    { name: 'get_email_report', description: 'Sending report for one event: sent / pending / retrying / failed / cancelled per email, daily numbers and the reasons for refused messages, plus the sending setup (mode, account, daily cap).', props: { event_id: S, days: { type: 'integer', minimum: 1, maximum: 90, description: 'Days of history (default 14)' } }, req: ['event_id'],
      run: async (a) => api('GET', `${EM(a)}/report?days=${Math.min(90, Math.max(1, Number(a.days) || 14))}`) },

    // ---- Tài liệu AI (documents) ----
    { name: 'list_documents', description: 'AI documents in the library (Tài liệu AI), newest first: id, title, description, type, views, status, link, whether a file and a cover are set.', props: {}, req: [],
      run: async () => (await api('GET', '/api/admin/documents')).documents },
    { name: 'create_document', description: 'Add a document. Give a link (external page), then add the file with set_document_file if needed.', props: { title: S, description: S, link: { ...S, description: 'https:// link to the document or page' }, views: { type: 'integer', description: 'Starting view count (random if omitted)' } }, req: ['title'],
      run: async (a) => (await api('POST', '/api/admin/documents', pick(a, ['title', 'description', 'link', 'views']))).document },
    { name: 'update_document', description: 'Change a document’s title, description, link or view count (send only what changes).', props: { document_id: S, title: S, description: S, link: S, views: { type: 'integer' } }, req: ['document_id'],
      run: async (a) => (await api('PATCH', `/api/admin/documents/${docId(a)}`, pick(a, ['title', 'description', 'link', 'views']))).document },
    { name: 'set_document_file', description: 'Attach the file for a document from a public https URL. Accepted: pdf, docx, doc, xlsx, xls, csv (max 25 MB).', props: { document_id: S, file_url: S }, req: ['document_id', 'file_url'],
      run: async (a) => { const f = await fetchFile(a.file_url, { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv' }, 25 * 1024 * 1024, 'file'); return (await api('PUT', `/api/admin/documents/${docId(a)}/file?ext=${f.ext}`, undefined, f)).document; } },
    { name: 'set_document_cover', description: 'Set the cover picture of a document from a public https image URL (PNG, JPG or WebP, max 3 MB).', props: { document_id: S, image_url: S }, req: ['document_id', 'image_url'],
      run: async (a) => { const f = await fetchImage(a.image_url); return (await api('PUT', `/api/admin/documents/${docId(a)}/cover?ext=${f.ext}`, undefined, f)).document; } },
    { name: 'delete_document', description: 'PERMANENTLY delete a document and its file and cover. confirm_title must equal the document title exactly.', props: { document_id: S, confirm_title: S }, req: ['document_id', 'confirm_title'],
      run: async (a) => { const d = (await api('GET', '/api/admin/documents')).documents.find((x) => x.id === docId(a)); if (!d) throw new Error('Document not found'); if (String(a.confirm_title) !== d.title) throw new Error(`confirm_title does not match. The document is called: "${d.title}"`); await api('DELETE', `/api/admin/documents/${d.id}`); return { ok: true, deleted: d.title }; } },

    // ---- Sản phẩm học viên (showcases) ----
    { name: 'list_showcases', description: 'Student showcases (Sản phẩm học viên): id, title, student, course, category, badge, description, media type and whether media / thumb / avatar are set.', props: {}, req: [],
      run: async () => (await api('GET', '/api/admin/showcases')).showcases },
    { name: 'create_showcase', description: 'Add a student showcase. Then add its picture or video with set_showcase_media.', props: { title: S, student_name: S, student_role: S, course: { type: 'string', enum: ['mkt', 'eng'], description: 'mkt = AI Marketing, eng = English Track' }, category: S, badge: S, description: S, media_type: { type: 'string', enum: ['video', 'image'] } }, req: ['title', 'student_name'],
      run: async (a) => (await api('POST', '/api/admin/showcases', { title: a.title, studentName: a.student_name, studentRole: a.student_role, course: a.course, category: a.category, badge: a.badge, description: a.description, mediaType: a.media_type })).showcase },
    { name: 'update_showcase', description: 'Change a showcase’s text fields (send only what changes).', props: { showcase_id: S, title: S, student_name: S, student_role: S, course: { type: 'string', enum: ['mkt', 'eng'] }, category: S, badge: S, description: S }, req: ['showcase_id'],
      run: async (a) => (await api('PATCH', `/api/admin/showcases/${showId(a)}`, pick({ title: a.title, studentName: a.student_name, studentRole: a.student_role, course: a.course, category: a.category, badge: a.badge, description: a.description }, ['title', 'studentName', 'studentRole', 'course', 'category', 'badge', 'description']))).showcase },
    { name: 'set_showcase_media', description: 'Set a showcase picture from a public https URL. kind: "media" = the video (mp4 or webm, up to 60 MB) or a main image; "thumb" = poster / cover image (max 12 MB); "avatar" = student photo (max 5 MB). Pictures: png, jpg or webp.', props: { showcase_id: S, kind: { type: 'string', enum: ['media', 'thumb', 'avatar'] }, url: S }, req: ['showcase_id', 'kind', 'url'],
      run: async (a) => {
        const kind = String(a.kind);
        const images = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
        const f = kind === 'media'
          ? await fetchFile(a.url, { mp4: 'video/mp4', webm: 'video/webm', ...images }, 60 * 1024 * 1024, 'media')
          : await fetchFile(a.url, images, kind === 'thumb' ? 12 * 1024 * 1024 : 5 * 1024 * 1024, kind === 'thumb' ? 'cover image' : 'avatar');
        return (await api('PUT', `/api/admin/showcases/${showId(a)}/${kind}?ext=${f.ext}`, undefined, f)).showcase;
      } },
    { name: 'delete_showcase', description: 'PERMANENTLY delete a showcase and its files. confirm_title must equal the showcase title exactly.', props: { showcase_id: S, confirm_title: S }, req: ['showcase_id', 'confirm_title'],
      run: async (a) => { const x = (await api('GET', '/api/admin/showcases')).showcases.find((s) => s.id === showId(a)); if (!x) throw new Error('Showcase not found'); if (String(a.confirm_title) !== x.title) throw new Error(`confirm_title does not match. The showcase is called: "${x.title}"`); await api('DELETE', `/api/admin/showcases/${x.id}`); return { ok: true, deleted: x.title }; } },

    // ---- short links ----
    { name: 'create_short_link', description: 'Shorten a campaign link: returns a short URL (https://…/s/abc123) that redirects to the full URL with all its utm_* tags kept, and counts clicks. Only links on the Erasight Academy site can be shortened. The same URL always gives the same short link.', props: { url: { ...S, description: 'Full URL (or a path like /su-kien/x?utm_source=facebook&utm_medium=social&utm_campaign=t11)' }, label: { ...S, description: 'Optional name; defaults to source/medium · campaign · content' } }, req: ['url'],
      run: async (a) => api('POST', '/api/admin/short-links', pick(a, ['url', 'label'])) },
    { name: 'list_short_links', description: 'Short links with their click counts, newest first (max 200). Optionally only those pointing at one page path, e.g. /su-kien/my-event.', props: { path: { ...S, description: 'Page path to filter on' } }, req: [],
      run: async (a) => api('GET', '/api/admin/short-links' + (a.path ? '?path=' + encodeURIComponent(a.path) : '')) },
    { name: 'delete_short_link', description: 'Delete a short link (anyone who still has it is redirected to the home page).', props: { code: S }, req: ['code'],
      run: async (a) => { if (!/^[a-z0-9]{4,12}$/i.test(String(a.code))) throw new Error('code is invalid'); return api('DELETE', '/api/admin/short-links/' + a.code); } },
    { name: 'upload_email_image', description: 'Upload a picture from a public https URL for use inside an email body; returns the src to put in <img src="…"> (max 40 per event).', props: { event_id: S, image_url: S }, req: ['event_id', 'image_url'],
      run: async (a) => { const img = await fetchImage(a.image_url); const d = await api('PUT', `${EM(a)}/images?ext=${img.ext}`, undefined, img); return { src: d.url, example: `<img src="${d.url}" alt="">` }; } },
  ];
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  const toolList = TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: t.props, required: t.req, additionalProperties: false } }));

  // ---- JSON-RPC -------------------------------------------------------------------------------------------------------
  async function handleRpc(msg) {
    const id = msg && msg.id;
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const err = (code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(-32600, 'Invalid request');
    if (id === undefined) return null; // notification: no answer
    switch (msg.method) {
      case 'initialize': {
        const want = msg.params && msg.params.protocolVersion;
        return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'erasight-academy-admin', version: '1.0.0' },
          instructions: 'Admin tools for Erasight Academy. Times are Vietnam time (UTC+7) written "YYYY-MM-DDTHH:mm". Typical flow: create_event → set_event_banner → set_seeding_start + add_email (seeding, notification, last_notification) → set_test_mode / send_test_email → update_event status "published". Emails are delivered by a Twenty workflow that runs every 15 minutes.' });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: toolList });
      case 'tools/call': {
        const p = msg.params || {}; const t = byName.get(p.name);
        if (!t) return err(-32602, `Unknown tool: ${p.name}`);
        const args = p.arguments && typeof p.arguments === 'object' ? p.arguments : {};
        try {
          for (const k of t.req) if (args[k] === undefined || args[k] === null) throw new Error(`Missing required argument: ${k}`);
          const out = await t.run(args);
          return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
        } catch (e) {
          return ok({ isError: true, content: [{ type: 'text', text: String(e && e.message || e).slice(0, 2000) }] });
        }
      }
      default: return err(-32601, `Method not found: ${msg.method}`);
    }
  }

  async function handle(req, res, pathname) {
    if (!enabled) return send(res, 404, { error: 'Not found' });
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const m = pathname.match(/^\/mcp\/?$/);
    if (!m) return send(res, 404, { error: 'Not found' });
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (!tokenOk(bearer && bearer[1].trim())) {
      if (rateLimited(ip, 'mcp-bad-auth', 10, 60_000)) return send(res, 429, { error: 'Too many requests' });
      res.setHeader('WWW-Authenticate', 'Bearer');
      return send(res, 401, { error: 'Unauthorized' });
    }
    if (rateLimited(ip, 'mcp', 300, 60_000)) return send(res, 429, { error: 'Too many requests' });
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); } // no sessions to close
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, DELETE'); return send(res, 405, { error: 'Use POST' }); }
    let body;
    try { body = await readJson(req, 512 * 1024); } catch (e) { return send(res, e.status === 413 ? 413 : 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleRpc))).filter(Boolean);
      if (!out.length) { res.writeHead(202); return res.end(); }
      return send(res, 200, out);
    }
    const out = await handleRpc(body);
    if (!out) { res.writeHead(202); return res.end(); }
    return send(res, 200, out);
  }

  return { handle, enabled, tools: TOOLS };
};
