/**
 * ERASIGHT ADMIN — "Email theo lịch" (scheduled event emails)
 * Seeding sequence (+ last call), event notifications and the last notification. Config is stored by the
 * website (/api/admin/events/:id/emails...); a Twenty workflow sends what is due. Shown as the "Email theo lịch"
 * tab of the event detail panel: admin-events.js calls AdminEventEmails.show(eventId) when that tab opens.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HDR = { 'X-Requested-With': 'erasight-admin' };
  const JH = Object.assign({ 'Content-Type': 'application/json' }, HDR);
  const FIELDS = ['name', 'first_name', 'email', 'requested_item', 'event_title', 'event_date', 'event_time', 'event_mode', 'event_location', 'join_link', 'event_url'];

  let testerInfo = new Map(); let leadTimer = null; let leadSeq = 0; let leadIdx = -1;
  let ov = null; let evId = null; let editing = null; let previewTimer = null; let previewSeq = 0;

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Lỗi ' + res.status));
    return data;
  }

  // 'YYYY-MM-DDTHH:mm' (Vietnam wall time) helpers
  const parts = (l) => /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(l || '');
  const fmt = (l) => { const m = parts(l); return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : ''; };
  const fmtFull = (l) => { const m = parts(l); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : ''; };
  const addHours = (l, h) => { const m = parts(l); if (!m) return ''; return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + h * 3600e3).toISOString().slice(0, 16); };

  // ---- Load (the event is chosen in the event detail panel, admin-events.js) ----
  async function show(id) {
    if (id !== evId) { closeEditor(); testerInfo = new Map(); hideLeads(); $('emLeadQ').value = ''; $('emTestErr').hidden = true; }
    evId = id || null;
    await loadOverview();
  }

  async function loadOverview() {
    $('emBody').hidden = !evId;
    if (!evId) { $('emEventInfo').innerHTML = ''; return; }
    const want = evId;
    try { const d = await api(`/api/admin/events/${want}/emails`, { cache: 'no-store' }); if (want !== evId) return; ov = d; render(); loadTesters(false); }
    catch (e) { if (want !== evId) return; $('emBody').hidden = true; $('emEventInfo').innerHTML = `<span class="em-badge r">${esc(e.message)}</span>`; }
  }

  // ---- Render ----------------------------------------------------------------
  function render() {
    const tm = ov.testMode || { on: false, emails: [] };
    const pub = ov.published ? '<span class="em-badge">Đã xuất bản</span>' : `<span class="em-badge g">${tm.on ? 'Bản nháp' : 'Bản nháp — chưa gửi email'}</span>`;
    $('emEventInfo').innerHTML = `${pub} ${tm.on ? `<span class="em-badge o">Thử nghiệm: chỉ gửi cho ${tm.emails.length} lead</span> ` : ''}<span class="em-badge g">Sự kiện: ${esc(fmtFull(ov.eventStartLocal))}</span>`;
    renderTest();
    // timeline
    const nodes = ov.timeline.nodes;
    $('emTimeline').innerHTML = nodes.length ? nodes.map((n, i) => {
      const cls = ['em-nd', n.kind === 'lastcall' ? 'lc' : n.kind === 'event' ? 'ev' : n.kind === 'notification' ? 'no' : '', n.cancelled ? 'x cut' : '', n.enabled ? '' : 'off'].filter(Boolean).join(' ');
      const dot = n.kind === 'lastcall' ? '★' : n.kind === 'event' ? '✦' : n.kind === 'notification' ? '✉' : esc((n.label.match(/\d+/) || [i + 1])[0]);
      return `<div class="${cls}"><div class="em-dot">${dot}</div><b>${esc(n.label)}</b><small>${esc(fmt(n.local))}${n.cancelled ? ' · huỷ' : ''}</small></div>`;
    }).join('') : '<div class="em-empty" style="width:100%">Chưa có email nào. Đặt giờ bắt đầu và thêm email bên dưới.</div>';
    const lcl = ov.timeline.lastCallLocal;
    $('emZone').textContent = lcl
      ? `⚑ Ai đăng ký từ ${fmtFull(lcl)} (sau last call) sẽ nhận Email thông báo cuối thay cho email xác nhận thường.`
      : 'Chưa có Last call hợp lệ — hãy đánh dấu email cuối của sequence là Last call (phải gửi trước giờ sự kiện bắt đầu).';
    $('emLastHint').textContent = lcl ? `Gửi cho mọi người đăng ký từ ${fmtFull(lcl)} trở đi, thay cho email xác nhận. Mỗi sự kiện có một email này.` : 'Chỉ có hiệu lực khi sequence có email Last call. Mỗi sự kiện có một email này.';

    // seeding
    const seeds = ov.emails.filter((m) => m.type === 'seeding').sort((a, b) => a.offsetHours - b.offsetHours);
    $('emSeedStart').value = ov.seedingStartLocal || '';
    $('emSeedCount').textContent = `${seeds.length} email`;
    $('emSeedList').innerHTML = seeds.length ? `<table class="em-tbl"><tr><th>#</th><th>Gửi lúc</th><th>Tiêu đề</th><th>Trạng thái</th><th class="em-num">Đã gửi</th><th></th></tr>${seeds.map((m, i) => {
      const when = m.plannedLocal ? `${m.offsetHours === 0 ? 'Bắt đầu' : '+' + m.offsetHours + ' giờ'} · ${fmt(m.plannedLocal)}` : (m.offsetHours === 0 ? 'Bắt đầu' : '+' + m.offsetHours + ' giờ') + ' · chưa đặt giờ';
      const st = m.afterEvent ? '<span class="em-badge r">Huỷ — sau sự kiện</span>' : !m.enabled ? '<span class="em-badge g">Tắt</span>' : m.sent > 0 ? '<span class="em-badge">Đã gửi</span>' : '<span class="em-badge g">Chờ gửi</span>';
      return `<tr class="${m.afterEvent ? 'x' : ''}"><td>${i + 1}${m.isLastCall ? ' <span class="em-badge o">★ Last call</span>' : ''}</td><td class="em-num">${esc(when)}</td><td class="em-t">${esc(m.subject)}</td><td>${st}</td><td class="em-num">${m.sent}</td><td><button type="button" class="crm-btn sm" data-edit="${esc(m.id)}">Sửa</button></td></tr>`;
    }).join('')}</table>` : '<div class="em-empty">Chưa có email seeding. Bấm “Thêm email vào sequence”.</div>';

    // notifications
    const nots = ov.emails.filter((m) => m.type === 'notification');
    $('emNotCount').textContent = `${nots.length} email`;
    $('emNotList').innerHTML = nots.length ? `<table class="em-tbl"><tr><th>Tên</th><th>Thời điểm gửi</th><th>Đối tượng</th><th>Trạng thái</th><th class="em-num">Đã gửi</th><th></th></tr>${nots.map((m) => {
      const t = m.timing;
      const when = t.mode === 'on_register' ? 'Ngay khi đăng ký' + (t.delayHours ? ` (+${t.delayHours} giờ)` : '') : t.mode === 'before' ? `${t.hours} giờ trước · ${fmt(m.plannedLocal)}` : `Cố định · ${fmt(m.plannedLocal)}`;
      return `<tr class="${m.afterEvent ? 'x' : ''}"><td class="em-t">${esc(m.name)}</td><td class="em-num">${esc(when)}</td><td>${m.audience === 'all' ? 'Tất cả lead' : 'Đã đăng ký'}</td><td>${m.enabled ? '<span class="em-badge">Bật</span>' : '<span class="em-badge g">Tắt</span>'}</td><td class="em-num">${m.sent}</td><td><button type="button" class="crm-btn sm" data-edit="${esc(m.id)}">Sửa</button></td></tr>`;
    }).join('')}</table>` : '<div class="em-empty">Chưa có email thông báo. Người đăng ký sẽ không nhận email nào cho đến khi bạn thêm.</div>';

    // last notification
    const ln = ov.emails.find((m) => m.type === 'last_notification');
    $('emLastBox').innerHTML = ln
      ? `<table class="em-tbl"><tr><td class="em-t">${esc(ln.name)}</td><td>Gửi ngay sau khi đăng ký</td><td>${ln.enabled ? '<span class="em-badge">Bật</span>' : '<span class="em-badge g">Tắt</span>'}</td><td class="em-num">${ln.sent} đã gửi</td><td style="text-align:right"><button type="button" class="crm-btn sm" data-edit="${esc(ln.id)}">Sửa</button></td></tr></table>`
      : '<div class="em-empty">Chưa có. <button type="button" class="crm-btn sm accent" id="emAddLast">+ Tạo email thông báo cuối</button></div>';
  }

  // ---- Test mode -------------------------------------------------------------
  function testTags(em) {
    const i = testerInfo.get(em);
    if (!i) return '<span class="em-badge g">…</span>';
    if (!i.inCrm) return '<span class="em-badge r">Không có trong CRM</span>';
    const reg = i.registered ? '<span class="em-badge">Đã đăng ký sự kiện</span>' : '<span class="em-badge g">Chưa đăng ký sự kiện</span>';
    return reg + (i.optOut ? ' <span class="em-badge r">Đã huỷ nhận email</span>' : '');
  }
  function leadRow(name, email, tags) {
    return `<span class="em-tester-main"><b>${esc(name || email)}</b>${name ? `<small>${esc(email)}</small>` : ''}</span><span class="em-tester-tags">${tags}</span>`;
  }

  function renderTest() {
    const tm = ov.testMode || { on: false, emails: [], max: 20 };
    $('emTest').classList.toggle('on', tm.on);
    $('emTestOn').checked = tm.on;
    $('emTestBadge').hidden = !tm.on;
    $('emTestBadge').textContent = `Đang bật — chỉ gửi cho ${tm.emails.length} lead`;
    $('emTesters').innerHTML = tm.emails.length
      ? tm.emails.map((em) => `<div class="em-tester">${leadRow((testerInfo.get(em) || {}).name, em, testTags(em))}<button type="button" class="em-x" data-unt="${esc(em)}" aria-label="Bỏ ${esc(em)} khỏi danh sách thử">×</button></div>`).join('')
      : '<div class="em-empty">Chưa có lead thử nghiệm. Tìm và thêm lead bên dưới (ví dụ chính email của bạn).</div>';
    const full = tm.emails.length >= (tm.max || 20);
    $('emLeadQ').disabled = full;
    $('emLeadQ').placeholder = full ? `Đã đủ ${tm.max} lead thử nghiệm` : 'Thêm lead: tìm theo tên hoặc email trong Twenty, hoặc gõ email rồi Enter';
  }

  function testErr(text) { $('emTestErr').textContent = text || ''; $('emTestErr').hidden = !text; }

  async function loadTesters(fresh) {
    if (!evId || !ov || !(ov.testMode && ov.testMode.emails.length)) return;
    const want = evId;
    try {
      const d = await api(`/api/admin/events/${want}/emails/leads?selected=1${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' });
      if (want !== evId) return;
      for (const l of d.leads) testerInfo.set(l.email, l);
      renderTest(); testErr('');
    } catch (e) { if (want === evId) testErr(e.message); }
  }

  async function saveTest(patch) {
    testErr('');
    try { ov = await api(`/api/admin/events/${evId}/emails`, { method: 'PATCH', headers: JH, body: JSON.stringify({ testMode: patch }) }); render(); loadTesters(false); return true; }
    catch (e) { testErr(e.message); render(); return false; }
  }

  function addTester(email) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { testErr('Email không hợp lệ.'); return; }
    const list = ov.testMode.emails;
    if (list.includes(email)) { testErr('Lead này đã có trong danh sách thử.'); return; }
    $('emLeadQ').value = ''; hideLeads();
    saveTest({ emails: [...list, email] });
  }

  function removeTester(email) {
    const list = ov.testMode.emails.filter((x) => x !== email);
    if (ov.testMode.on && !list.length) {
      if (!confirm('Đây là lead thử cuối cùng. Bỏ lead này sẽ tắt chế độ thử nghiệm. Tiếp tục?')) return;
      return toggleTest(false, list);
    }
    saveTest({ emails: list });
  }

  async function toggleTest(on, emails) {
    if (!on) {
      const warn = ov.published
        ? 'Tắt chế độ thử nghiệm?\n\nSự kiện đã xuất bản: từ lần chạy tiếp theo, email sẽ gửi cho TẤT CẢ lead đủ điều kiện.\nLịch sử gửi của các lead thử sẽ được xoá (họ được tính như người nhận thật).'
        : 'Tắt chế độ thử nghiệm?\n\nSự kiện đang là bản nháp nên sẽ không gửi email nào cho đến khi xuất bản.\nLịch sử gửi của các lead thử sẽ được xoá.';
      if (!confirm(warn)) { $('emTestOn').checked = true; return; }
    }
    await saveTest(emails ? { on, emails } : { on });
  }

  // lead search dropdown
  function hideLeads() { $('emLeadRes').hidden = true; leadIdx = -1; }
  function queueSearch() { clearTimeout(leadTimer); leadTimer = setTimeout(searchLeads, 250); }
  async function searchLeads() {
    if (!evId || $('emLeadQ').disabled) return;
    const seq = ++leadSeq; const q = $('emLeadQ').value.trim();
    const box = $('emLeadRes');
    box.hidden = false; box.innerHTML = '<div class="em-lead-none">Đang tìm trong Twenty...</div>';
    try {
      const d = await api(`/api/admin/events/${evId}/emails/leads?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      if (seq !== leadSeq) return;
      const taken = new Set(ov.testMode.emails);
      for (const l of d.leads) if (!testerInfo.has(l.email)) testerInfo.set(l.email, l);
      const typed = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(q) && !d.leads.some((l) => l.email === q.toLowerCase());
      box.innerHTML = (d.leads.length ? d.leads.map((l) => `<button type="button" class="em-lead-opt" role="option" data-add="${esc(l.email)}" ${taken.has(l.email) ? 'disabled' : ''}>${leadRow(l.name, l.email, taken.has(l.email) ? '<span class="em-badge g">Đã thêm</span>' : (l.registered ? '<span class="em-badge">Đã đăng ký</span>' : ''))}</button>`).join('') : '')
        + (typed ? `<button type="button" class="em-lead-opt" role="option" data-add="${esc(q.toLowerCase())}">${leadRow('', q.toLowerCase(), '<span class="em-badge r">Không có trong CRM</span>')}</button>` : '')
        || `<div class="em-lead-none">${q ? 'Không tìm thấy lead nào.' : 'Chưa có lead trong Twenty.'}</div>`;
      leadIdx = -1;
    } catch (e) { if (seq === leadSeq) box.innerHTML = `<div class="em-lead-none">${esc(e.message)}</div>`; }
  }
  function moveLead(dir) {
    const opts = Array.from($('emLeadRes').querySelectorAll('.em-lead-opt:not([disabled])')); if (!opts.length) return;
    leadIdx = (leadIdx + dir + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle('on', i === leadIdx)); opts[leadIdx].scrollIntoView({ block: 'nearest' });
  }

  // ---- Rich-text body editor ---------------------------------------------------
  // contenteditable + toolbar (no library). Whatever is typed, pasted or edited as HTML is cleaned by the server
  // (/emails/sanitize on paste + source view, email-html.js on save), so the stored body only has allowed tags.
  const ed = () => $('emEditor');
  let savedRange = null; let selImg = null; let srcMode = false; let lastField = 'editor';
  const PRESS = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight'];

  function textToHtml(t) { // older plain-text mails ("## heading", "- item", blank line = paragraph) -> editor html
    const out = []; let list = [];
    const flush = () => { if (list.length) { out.push('<ul>' + list.map((x) => '<li>' + x + '</li>').join('') + '</ul>'); list = []; } };
    const link = (x) => x.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    for (const block of String(t || '').split(/\n{2,}/)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean); let para = [];
      const fp = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
      for (const l of lines) {
        if (/^##\s+/.test(l)) { fp(); flush(); out.push('<h2>' + esc(l.replace(/^##\s+/, '')) + '</h2>'); }
        else if (/^[-•*]\s+/.test(l)) { fp(); list.push(link(esc(l.replace(/^[-•*]\s+/, '')))); }
        else { flush(); para.push(link(esc(l))); }
      }
      fp(); flush();
    }
    return out.join('');
  }

  const inEditor = (n) => !!n && ed().contains(n.nodeType === 3 ? n.parentNode : n);
  function saveSel() { const s = window.getSelection(); if (s && s.rangeCount && inEditor(s.getRangeAt(0).commonAncestorContainer)) savedRange = s.getRangeAt(0).cloneRange(); }
  function restoreSel() {
    ed().focus();
    if (!savedRange || !inEditor(savedRange.commonAncestorContainer)) { const r = document.createRange(); r.selectNodeContents(ed()); r.collapse(false); savedRange = r; }
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange);
  }
  function exec(cmd, val) {
    if (srcMode) return;
    restoreSel();
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, cmd === 'foreColor' || cmd.indexOf('justify') === 0); } catch (e) { /* ignore */ }
    document.execCommand(cmd, false, val);
    afterEdit();
  }
  function afterEdit() { saveSel(); refreshToolbar(); schedulePreview(); }

  function blockNow() { try { return String(document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase(); } catch (e) { return ''; } }
  function refreshToolbar() {
    if (srcMode || document.activeElement !== ed()) return;
    for (const c of PRESS) { const b = $('emTb').querySelector(`[data-cmd="${c}"]`); if (b) { let on = false; try { on = document.queryCommandState(c); } catch (e) { /* ignore */ } b.setAttribute('aria-pressed', String(on)); } }
    const blk = blockNow();
    $('emTb').querySelector('[data-cmd="formatBlockquote"]').setAttribute('aria-pressed', String(blk === 'blockquote'));
    $('emFmt').value = ['h2', 'h3'].includes(blk) ? blk : 'p';
  }

  // links and buttons
  function anchorAtSel() {
    const s = window.getSelection(); if (!s.rangeCount) return null;
    let n = s.getRangeAt(0).commonAncestorContainer; if (n.nodeType === 3) n = n.parentNode;
    const a = n.closest && n.closest('a'); return a && ed().contains(a) ? a : null;
  }
  function openLinkBar() {
    if (srcMode) return;
    saveSel(); const a = anchorAtSel(); selectImg(null);
    $('emLinkUrl').value = a ? (a.getAttribute('href') || '') : ''; $('emLinkBtn').checked = !!(a && a.getAttribute('data-btn') === '1');
    $('emLinkBar').hidden = false; $('emLinkUrl').focus(); $('emLinkUrl').select();
  }
  function applyLink() {
    let url = $('emLinkUrl').value.trim(); if (!url) return;
    if (!/^(https?:\/\/|mailto:|tel:|\{\{)/i.test(url)) url = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(url) ? 'mailto:' + url : 'https://' + url;
    const btn = $('emLinkBtn').checked;
    restoreSel();
    let a = anchorAtSel(); const tmp = '#em-tmp-' + Date.now();
    if (!a) {
      if (window.getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${tmp}">${esc(btn ? 'Đăng ký ngay' : url)}</a>`);
      else document.execCommand('createLink', false, tmp);
    }
    const links = a ? [a] : Array.from(ed().querySelectorAll(`a[href="${tmp}"]`));
    for (const x of links) { x.setAttribute('href', url); if (btn) x.setAttribute('data-btn', '1'); else x.removeAttribute('data-btn'); }
    $('emLinkBar').hidden = true; afterEdit();
  }
  function removeLink() {
    restoreSel(); const a = anchorAtSel();
    if (a) { const r = document.createRange(); r.selectNodeContents(a); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    document.execCommand('unlink'); $('emLinkBar').hidden = true; afterEdit();
  }

  // pictures
  function selectImg(img) {
    if (selImg) selImg.classList.remove('sel');
    selImg = img;
    $('emImgBar').hidden = !img;
    if (!img) return;
    img.classList.add('sel'); $('emLinkBar').hidden = true;
    $('emImgAlt').value = img.getAttribute('alt') || '';
    const la = img.parentElement && img.parentElement.closest('a'); $('emImgLink').value = la ? (la.getAttribute('href') || '') : '';
    const w = img.getAttribute('width') || '100%';
    $('emImgBar').querySelectorAll('[data-isz]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.isz === w)));
    const c = img.getAttribute('data-align') === 'center';
    $('emImgBar').querySelectorAll('[data-ial]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.ial === 'center') === c)));
  }
  function setImgLink(raw) {
    if (!selImg) return;
    let url = String(raw || '').trim();
    if (url && !/^(https?:\/\/|mailto:|tel:|\{\{)/i.test(url)) url = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(url) ? 'mailto:' + url : 'https://' + url;
    const a = selImg.parentElement && selImg.parentElement.closest('a');
    if (!url) { if (a && a.querySelector('img') === selImg && a.textContent.trim() === '') a.replaceWith(selImg); else if (a) a.removeAttribute('href'); }
    else if (a) a.setAttribute('href', url);
    else { const w = document.createElement('a'); w.setAttribute('href', url); selImg.replaceWith(w); w.appendChild(selImg); }
    schedulePreview();
  }
  async function uploadImage(file) {
    let ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : String(file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (!['png', 'jpg', 'webp'].includes(ext)) throw new Error('Ảnh chỉ nhận PNG, JPG hoặc WebP.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Ảnh vượt quá 3MB.');
    $('emRt').classList.add('busy');
    try { return (await api(`/api/admin/events/${evId}/emails/images?ext=${ext}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, HDR), body: file })).url; }
    finally { $('emRt').classList.remove('busy'); }
  }
  async function insertImageFile(file) {
    $('emErr').hidden = true; saveSel();
    try {
      const url = await uploadImage(file);
      restoreSel(); document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt=""><p><br></p>`); afterEdit();
      const img = Array.from(ed().querySelectorAll('img')).find((i) => i.getAttribute('src') === url); if (img) selectImg(img);
    } catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; }
  }

  // HTML source view (also the way to paste a ready-made HTML email)
  const peekHtml = () => (srcMode ? $('emSrc').value : ed().innerHTML);
  async function commitSource() {
    if (!srcMode) return;
    const d = await api(`/api/admin/events/${evId}/emails/sanitize`, { method: 'POST', headers: JH, body: JSON.stringify({ html: $('emSrc').value }) });
    ed().innerHTML = d.html; savedRange = null; srcMode = false;
    ed().hidden = false; $('emSrc').hidden = true; $('emRt').classList.remove('src');
    $('emTb').querySelector('[data-act="source"]').setAttribute('aria-pressed', 'false'); schedulePreview(0);
  }
  async function toggleSource() {
    $('emErr').hidden = true;
    try {
      if (srcMode) return await commitSource();
      selectImg(null); $('emLinkBar').hidden = true;
      $('emSrc').value = ed().innerHTML.replace(/(<\/(?:p|h2|h3|ul|ol|li|blockquote)>|<hr>|<br>)/g, '$1\n');
      srcMode = true; ed().hidden = true; $('emSrc').hidden = false; $('emRt').classList.add('src');
      $('emTb').querySelector('[data-act="source"]').setAttribute('aria-pressed', 'true'); $('emSrc').focus();
    } catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; }
  }
  async function getHtml() { await commitSource(); return ed().innerHTML; }
  function setHtml(html) {
    ed().innerHTML = html || ''; savedRange = null; srcMode = false; ed().hidden = false; $('emSrc').hidden = true; $('emRt').classList.remove('src');
    $('emTb').querySelector('[data-act="source"]').setAttribute('aria-pressed', 'false');
    $('emLinkBar').hidden = true; selectImg(null);
  }

  function insertPlaceholder(ph) {
    if (lastField === 'subject') {
      const t = $('emSubject'); const i = t.selectionStart == null ? t.value.length : t.selectionStart;
      t.value = t.value.slice(0, i) + ph + t.value.slice(t.selectionEnd == null ? i : t.selectionEnd); t.focus(); t.setSelectionRange(i + ph.length, i + ph.length);
    } else if (srcMode) {
      const t = $('emSrc'); const i = t.selectionStart == null ? t.value.length : t.selectionStart;
      t.value = t.value.slice(0, i) + ph + t.value.slice(t.selectionEnd == null ? i : t.selectionEnd); t.focus(); t.setSelectionRange(i + ph.length, i + ph.length);
    } else exec('insertText', ph);
    schedulePreview();
  }

  function initEditor() {
    const tb = $('emTb');
    tb.addEventListener('mousedown', (e) => { if (!e.target.closest('select')) e.preventDefault(); }); // keep the text selection
    tb.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-color]'); if (sw) return exec('foreColor', sw.dataset.color || '#0C2A3A');
      const b = e.target.closest('[data-cmd],[data-act]'); if (!b) return;
      if (b.dataset.cmd === 'formatBlockquote') return exec('formatBlock', blockNow() === 'blockquote' ? '<p>' : '<blockquote>');
      if (b.dataset.cmd) return exec(b.dataset.cmd);
      if (b.dataset.act === 'link') return openLinkBar();
      if (b.dataset.act === 'image') { if (!srcMode) { saveSel(); $('emImgFile').click(); } return; }
      if (b.dataset.act === 'source') return toggleSource();
    });
    $('emFmt').addEventListener('change', () => exec('formatBlock', '<' + $('emFmt').value + '>'));
    document.addEventListener('selectionchange', () => { if (document.activeElement === ed()) { saveSel(); refreshToolbar(); } });
    ed().addEventListener('input', () => { saveSel(); schedulePreview(); });
    ed().addEventListener('focus', () => { lastField = 'editor'; });
    ed().addEventListener('click', (e) => { if (e.target.tagName === 'IMG') selectImg(e.target); else if (selImg) selectImg(null); });
    ed().addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openLinkBar(); } });
    $('emSrc').addEventListener('input', () => schedulePreview());
    $('emSrc').addEventListener('focus', () => { lastField = 'editor'; });
    $('emSubject').addEventListener('focus', () => { lastField = 'subject'; });

    // link bar
    $('emLinkApply').addEventListener('click', applyLink); $('emLinkRemove').addEventListener('click', removeLink);
    $('emLinkClose').addEventListener('click', () => { $('emLinkBar').hidden = true; restoreSel(); });
    $('emLinkUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } else if (e.key === 'Escape') { e.stopPropagation(); $('emLinkBar').hidden = true; restoreSel(); } });
    $('emLinkBar').addEventListener('click', (e) => { const c = e.target.closest('[data-url]'); if (c) { $('emLinkUrl').value = c.dataset.url; $('emLinkUrl').focus(); } });

    // image bar
    $('emImgBar').addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    $('emImgBar').addEventListener('click', (e) => {
      if (!selImg) return;
      const z = e.target.closest('[data-isz]'); const a = e.target.closest('[data-ial]');
      if (z) { selImg.setAttribute('width', z.dataset.isz); selectImg(selImg); schedulePreview(); }
      if (a) { if (a.dataset.ial === 'center') selImg.setAttribute('data-align', 'center'); else selImg.removeAttribute('data-align'); selectImg(selImg); schedulePreview(); }
    });
    $('emImgAlt').addEventListener('input', () => { if (selImg) { selImg.setAttribute('alt', $('emImgAlt').value); schedulePreview(); } });
    $('emImgLink').addEventListener('input', () => setImgLink($('emImgLink').value));
    $('emImgLink').addEventListener('blur', () => { if (selImg) { const a = selImg.parentElement && selImg.parentElement.closest('a'); $('emImgLink').value = a ? (a.getAttribute('href') || '') : ''; } });
    $('emImgBar').addEventListener('click', (e) => { const c = e.target.closest('[data-imgurl]'); if (c) { $('emImgLink').value = c.dataset.imgurl; setImgLink(c.dataset.imgurl); } });
    $('emImgDel').addEventListener('click', () => { if (selImg) { const i = selImg; selectImg(null); i.remove(); afterEdit(); } });
    $('emImgFile').addEventListener('change', () => { const f = $('emImgFile').files[0]; $('emImgFile').value = ''; if (f) insertImageFile(f); });

    // paste: clean html through the server, pictures are uploaded, everything else as plain text
    ed().addEventListener('paste', async (e) => {
      const cd = e.clipboardData; if (!cd) return;
      const html = cd.getData('text/html'); const text = cd.getData('text/plain');
      const file = Array.from(cd.files || []).find((f) => /^image\//.test(f.type));
      e.preventDefault(); saveSel();
      if (file && !html) return insertImageFile(file);
      if (html) {
        try {
          const d = await api(`/api/admin/events/${evId}/emails/sanitize`, { method: 'POST', headers: JH, body: JSON.stringify({ html }) });
          restoreSel(); document.execCommand('insertHTML', false, d.html); return afterEdit();
        } catch (err) { /* fall back to text */ }
      }
      if (text) { restoreSel(); document.execCommand('insertText', false, text); afterEdit(); }
    });
    ed().addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    ed().addEventListener('drop', (e) => {
      const f = e.dataTransfer && Array.from(e.dataTransfer.files || []).find((x) => /^image\//.test(x.type));
      if (!f) return; e.preventDefault(); insertImageFile(f);
    });
  }

  // ---- Editor ----------------------------------------------------------------
  const field = (id) => $(id);

  function buildChips() {
    $('emChips').innerHTML = FIELDS.map((k) => `<button type="button" class="em-chip" data-ph="{{${k}}}">{{${k}}}</button>`).join('');
  }

  function setMode() {
    const m = $('emMode').value;
    $('emModeL').textContent = m === 'on_register' ? 'Trễ sau khi đăng ký (giờ)' : m === 'before' ? 'Bao nhiêu giờ trước sự kiện' : 'Ngày giờ gửi';
    const v = $('emModeV');
    if (m === 'at') { v.type = 'datetime-local'; v.removeAttribute('min'); if (!v.value || v.value.length < 10) v.value = addHours(ov.eventStartLocal, -24); }
    else { v.type = 'number'; v.min = m === 'before' ? '1' : '0'; v.max = '720'; v.step = '1'; if (v.value === '' || v.value.indexOf('T') > -1) v.value = m === 'before' ? '24' : '0'; }
    $('emNotAudRow').hidden = m === 'on_register';
  }

  function calc() {
    if (!ov || !ov.seedingStartLocal) { $('emCalc').textContent = 'Hãy đặt “Email đầu gửi lúc” trước.'; return; }
    const at = addHours(ov.seedingStartLocal, Number($('emOffset').value) || 0);
    const after = at >= ov.eventStartLocal;
    $('emCalc').innerHTML = '→ ' + esc(fmtFull(at)) + (after ? ' · <span style="color:#9b1c1c">sau giờ sự kiện → sẽ bị huỷ</span>' : '');
  }

  function openEditor(type, id) {
    const m = id ? ov.emails.find((x) => x.id === id) : null;
    editing = { id: id || null, type: m ? m.type : type };
    const t = editing.type;
    $('emTitle').textContent = m ? `Sửa email — ${m.name}` : 'Thêm email mới';
    $('emErr').hidden = true; $('emTestOk').hidden = true;
    $('emSeedF').hidden = t !== 'seeding'; $('emNotF').hidden = t !== 'notification'; $('emLnF').hidden = t !== 'last_notification';
    $('emName').value = m ? m.name : (t === 'last_notification' ? 'Email thông báo cuối' : '');
    $('emSubject').value = m ? m.subject : '';
    setHtml(m ? (m.format === 'html' ? m.body : textToHtml(m.body)) : '');
    $('emSize').textContent = ''; lastField = 'editor';
    $('emEnabled').checked = m ? m.enabled : true;
    if (t === 'seeding') {
      const isAnchor = m ? m.offsetHours === 0 : !ov.emails.some((x) => x.type === 'seeding');
      const maxOff = Math.max(0, ...ov.emails.filter((x) => x.type === 'seeding').map((x) => x.offsetHours));
      $('emOffset').value = m ? m.offsetHours : (isAnchor ? 0 : maxOff + 24);
      $('emOffset').disabled = isAnchor;
      $('emAud').value = m ? m.audience : 'all';
      $('emSkip').checked = m ? m.skipRegistered : true;
      $('emLast').checked = m ? !!m.isLastCall : false;
      $('emSkipRow').hidden = $('emAud').value === 'registered';
      calc();
    } else if (t === 'notification') {
      const tm = m ? m.timing : { mode: 'on_register', delayHours: 0 };
      $('emMode').value = tm.mode;
      $('emModeV').type = 'number';
      $('emModeV').value = tm.mode === 'on_register' ? tm.delayHours : tm.mode === 'before' ? tm.hours : tm.atLocal;
      $('emNotAud').value = m ? m.audience : 'registered';
      setMode();
      if (tm.mode === 'at') $('emModeV').value = tm.atLocal;
    }
    $('emStatWrap').hidden = !m; $('emTestRow').hidden = !m; $('emResendRow').hidden = !m;
    $('emDel').hidden = !m;
    $('emOv').classList.add('on');
    $('emStat').innerHTML = ''; $('emSample').textContent = '';
    schedulePreview(0);
    if (m) loadStats(m.id);
  }

  function closeEditor() { $('emOv').classList.remove('on'); editing = null; }

  function schedulePreview(ms) { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, ms == null ? 350 : ms); }
  async function refreshPreview() {
    if (!editing) return;
    const seq = ++previewSeq;
    try {
      const aud = editing.type === 'seeding' ? $('emAud').value : editing.type === 'notification' ? ($('emMode').value === 'on_register' ? 'registered' : $('emNotAud').value) : 'registered';
      const d = await api(`/api/admin/events/${evId}/emails/preview`, { method: 'POST', headers: JH, body: JSON.stringify({ type: editing.type, subject: $('emSubject').value, format: 'html', body: peekHtml(), audience: aud, name: $('emWho').value }) });
      if (seq !== previewSeq) return;
      $('emPvS').textContent = 'Tiêu đề: ' + d.subject;
      $('emPvF').srcdoc = d.html;
      const kb = new Blob([d.html]).size / 1024;
      $('emSize').textContent = `Kích thước email: ${kb.toFixed(0)} KB` + (kb > 90 ? ' — gần/vượt giới hạn ~102KB, Gmail sẽ cắt bớt email này. Hãy giảm bớt nội dung.' : '');
      const noJoin = ov && ov.hasJoinLink === false && /\{\{\s*join_link\s*\}\}/.test(peekHtml());
      if (noJoin) $('emSize').textContent += ' · ⚠ Sự kiện chưa có “Link tham gia” (tab Thông tin chung): link/nút {{join_link}} sẽ không có địa chỉ.';
      $('emSize').classList.toggle('warn', kb > 90 || noJoin);
    } catch (e) { $('emPvS').textContent = e.message; }
  }

  async function loadStats(mid) {
    try {
      const d = await api(`/api/admin/events/${evId}/emails/${mid}/recipients`, { cache: 'no-store' });
      $('emStat').innerHTML = `<span>Đủ điều kiện <b>${d.eligible}</b></span><span>Đã gửi <b>${d.sent}</b></span><span>Đến hạn <b>${d.due}</b></span><span>Chờ <b>${d.waiting}</b></span><span>Huỷ <b>${d.cancelled}</b></span>`;
      $('emSample').textContent = d.sample.length ? 'Ví dụ người nhận tiếp theo: ' + d.sample.map((s) => s.name).join(', ') : (d.enabled ? '' : 'Email đang tắt — chưa tính người nhận.');
    } catch (e) { $('emStat').innerHTML = `<span>${esc(e.message)}</span>`; }
  }

  async function collect() {
    const t = editing.type;
    const b = { type: t, name: $('emName').value, subject: $('emSubject').value, body: await getHtml(), format: 'html', enabled: $('emEnabled').checked };
    if (t === 'seeding') {
      Object.assign(b, { audience: $('emAud').value, skipRegistered: $('emSkip').checked, isLastCall: $('emLast').checked });
      if (!$('emOffset').disabled) b.offsetHours = $('emOffset').value;
    } else if (t === 'notification') {
      const mode = $('emMode').value; const v = $('emModeV').value;
      b.timing = mode === 'on_register' ? { mode, delayHours: v } : mode === 'before' ? { mode, hours: v } : { mode, atLocal: v };
      b.audience = $('emNotAud').value;
    }
    return b;
  }

  async function save() {
    $('emErr').hidden = true; $('emSave').disabled = true;
    try {
      const b = await collect();
      if (editing.id) ov = await api(`/api/admin/events/${evId}/emails/${editing.id}`, { method: 'PATCH', headers: JH, body: JSON.stringify(b) });
      else ov = await api(`/api/admin/events/${evId}/emails`, { method: 'POST', headers: JH, body: JSON.stringify(b) });
      closeEditor(); render();
    } catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; $('emOv').scrollTop = 0; }
    finally { $('emSave').disabled = false; }
  }

  async function del() {
    if (!editing || !editing.id || !confirm('Xoá email này? Lịch sử đã gửi vẫn được giữ.')) return;
    try { ov = await api(`/api/admin/events/${evId}/emails/${editing.id}`, { method: 'DELETE', headers: HDR }); closeEditor(); render(); }
    catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; }
  }

  async function saveStart() {
    $('emSeedMsg').textContent = '';
    try { ov = await api(`/api/admin/events/${evId}/emails`, { method: 'PATCH', headers: JH, body: JSON.stringify({ seedingStartLocal: $('emSeedStart').value }) }); render(); $('emSeedMsg').textContent = 'Đã lưu ✓'; }
    catch (e) { $('emSeedMsg').textContent = e.message; }
  }

  function init() {
    if (!$('emCard')) return;
    buildChips();
    $('emSeedSave').addEventListener('click', saveStart);
    $('emTestOn').addEventListener('change', () => toggleTest($('emTestOn').checked));
    $('emTestRefresh').addEventListener('click', () => loadTesters(true));
    $('emTesters').addEventListener('click', (e) => { const b = e.target.closest('[data-unt]'); if (b) removeTester(b.dataset.unt); });
    $('emLeadQ').addEventListener('input', queueSearch);
    $('emLeadQ').addEventListener('focus', () => { if ($('emLeadRes').hidden) queueSearch(); });
    $('emLeadQ').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if ($('emLeadRes').hidden) searchLeads(); else moveLead(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Escape') hideLeads();
      else if (e.key === 'Enter') {
        e.preventDefault();
        const hl = $('emLeadRes').querySelector('.em-lead-opt.on');
        if (hl) addTester(hl.dataset.add); else if ($('emLeadQ').value.trim()) addTester($('emLeadQ').value);
      }
    });
    $('emLeadRes').addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    $('emLeadRes').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b && !b.disabled) addTester(b.dataset.add); });
    $('emLeadQ').addEventListener('blur', () => setTimeout(hideLeads, 120));
    $('emAddSeed').addEventListener('click', () => openEditor('seeding'));
    $('emAddNot').addEventListener('click', () => openEditor('notification'));
    $('emCard').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) return openEditor(null, ed.dataset.edit);
      if (e.target.id === 'emAddLast') openEditor('last_notification');
    });
    $('emClose').addEventListener('click', closeEditor); $('emCancel').addEventListener('click', closeEditor);
    $('emOv').addEventListener('click', (e) => { if (e.target === $('emOv')) closeEditor(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('emOv').classList.contains('on')) closeEditor(); });
    $('emSave').addEventListener('click', save); $('emDel').addEventListener('click', del);
    ['emSubject', 'emWho', 'emAud', 'emNotAud'].forEach((id) => $(id).addEventListener('input', () => schedulePreview()));
    $('emOffset').addEventListener('input', calc);
    $('emAud').addEventListener('change', () => { $('emSkipRow').hidden = $('emAud').value === 'registered'; });
    $('emMode').addEventListener('change', () => { setMode(); schedulePreview(); });
    initEditor();
    $('emChips').addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret where it is
    $('emChips').addEventListener('click', (e) => { const c = e.target.closest('[data-ph]'); if (c) insertPlaceholder(c.dataset.ph); });
    $('emTestBtn').addEventListener('click', async () => {
      $('emTestOk').hidden = true; $('emErr').hidden = true;
      try { const d = await api(`/api/admin/events/${evId}/emails/${editing.id}/test`, { method: 'POST', headers: JH, body: JSON.stringify({ to: $('emTestTo').value, name: $('emWho').value }) }); $('emTestOk').textContent = d.note; $('emTestOk').hidden = false; }
      catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; }
    });
    $('emResendBtn').addEventListener('click', async () => {
      try { ov = await api(`/api/admin/events/${evId}/emails/${editing.id}/resend`, { method: 'POST', headers: JH, body: JSON.stringify({ email: $('emResendTo').value }) }); $('emTestOk').textContent = 'Đã đặt lại: email sẽ được gửi lại ở lần chạy kế tiếp nếu người này còn đủ điều kiện.'; $('emTestOk').hidden = false; render(); loadStats(editing.id); }
      catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; }
    });
    $('emResendAll').addEventListener('click', async () => {
      if (!confirm('Đặt lại toàn bộ? Mọi người đủ điều kiện sẽ nhận lại email này ở lần chạy tiếp theo.')) return;
      try { ov = await api(`/api/admin/events/${evId}/emails/${editing.id}/resend`, { method: 'POST', headers: JH, body: JSON.stringify({ all: true }) }); render(); loadStats(editing.id); }
      catch (e) { $('emErr').textContent = e.message; $('emErr').hidden = false; }
    });
  }

  window.AdminEventEmails = { show, reload: loadOverview };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
