/**
 * ERASIGHT ADMIN — "Email theo lịch" (scheduled event emails)
 * Seeding sequence (+ last call), event notifications and the last notification. Config is stored by the
 * website (/api/admin/events/:id/emails...); a Twenty workflow sends what is due. Loaded before admin.js,
 * which calls AdminEventEmails.load() after login.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HDR = { 'X-Requested-With': 'erasight-admin' };
  const JH = Object.assign({ 'Content-Type': 'application/json' }, HDR);
  const FIELDS = ['name', 'first_name', 'email', 'requested_item', 'event_title', 'event_date', 'event_time', 'event_mode', 'event_location', 'join_link', 'event_url'];

  let events = []; let ov = null; let evId = null; let editing = null; let previewTimer = null; let previewSeq = 0;

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

  // ---- Load ------------------------------------------------------------------
  async function load() {
    try {
      events = (await api('/api/admin/events', { cache: 'no-store' })).events || [];
    } catch (e) { events = []; }
    const sel = $('emEvent'); const keep = evId || sel.value;
    sel.innerHTML = events.length
      ? events.map((e) => `<option value="${esc(e.id)}">${esc(e.title)} — ${esc(fmtFull(e.startLocal))}${e.status === 'published' ? '' : ' (nháp)'}</option>`).join('')
      : '<option value="">(chưa có sự kiện)</option>';
    if (keep && events.some((e) => e.id === keep)) sel.value = keep;
    evId = sel.value || null;
    await loadOverview();
  }

  async function loadOverview() {
    $('emBody').hidden = !evId;
    if (!evId) { $('emEventInfo').innerHTML = ''; return; }
    try { ov = await api(`/api/admin/events/${evId}/emails`, { cache: 'no-store' }); render(); }
    catch (e) { $('emBody').hidden = true; $('emEventInfo').innerHTML = `<span class="em-badge r">${esc(e.message)}</span>`; }
  }

  // ---- Render ----------------------------------------------------------------
  function render() {
    $('emEventInfo').innerHTML = `<span class="em-badge ${ov.published ? '' : 'g'}">${ov.published ? 'Đã xuất bản' : 'Bản nháp — chưa gửi email'}</span> <span class="em-badge g">Sự kiện: ${esc(fmtFull(ov.eventStartLocal))}</span>`;
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
    $('emText').value = m ? m.body : '';
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
      const d = await api(`/api/admin/events/${evId}/emails/preview`, { method: 'POST', headers: JH, body: JSON.stringify({ type: editing.type, subject: $('emSubject').value, body: $('emText').value, audience: aud, name: $('emWho').value }) });
      if (seq !== previewSeq) return;
      $('emPvS').textContent = 'Tiêu đề: ' + d.subject;
      $('emPvF').srcdoc = d.html;
    } catch (e) { $('emPvS').textContent = e.message; }
  }

  async function loadStats(mid) {
    try {
      const d = await api(`/api/admin/events/${evId}/emails/${mid}/recipients`, { cache: 'no-store' });
      $('emStat').innerHTML = `<span>Đủ điều kiện <b>${d.eligible}</b></span><span>Đã gửi <b>${d.sent}</b></span><span>Đến hạn <b>${d.due}</b></span><span>Chờ <b>${d.waiting}</b></span><span>Huỷ <b>${d.cancelled}</b></span>`;
      $('emSample').textContent = d.sample.length ? 'Ví dụ người nhận tiếp theo: ' + d.sample.map((s) => s.name).join(', ') : (d.enabled ? '' : 'Email đang tắt — chưa tính người nhận.');
    } catch (e) { $('emStat').innerHTML = `<span>${esc(e.message)}</span>`; }
  }

  function collect() {
    const t = editing.type;
    const b = { type: t, name: $('emName').value, subject: $('emSubject').value, body: $('emText').value, enabled: $('emEnabled').checked };
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
      const b = collect();
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
    $('emEvent').addEventListener('change', () => { evId = $('emEvent').value || null; loadOverview(); });
    $('emSeedSave').addEventListener('click', saveStart);
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
    ['emSubject', 'emText', 'emWho', 'emAud', 'emNotAud'].forEach((id) => $(id).addEventListener('input', () => schedulePreview()));
    $('emOffset').addEventListener('input', calc);
    $('emAud').addEventListener('change', () => { $('emSkipRow').hidden = $('emAud').value === 'registered'; });
    $('emMode').addEventListener('change', () => { setMode(); schedulePreview(); });
    let lastField = $('emText');
    $('emSubject').addEventListener('focus', () => { lastField = $('emSubject'); }); $('emText').addEventListener('focus', () => { lastField = $('emText'); });
    $('emChips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-ph]'); if (!c) return;
      const t = lastField; const i = t.selectionStart == null ? t.value.length : t.selectionStart;
      t.value = t.value.slice(0, i) + c.dataset.ph + t.value.slice(t.selectionEnd == null ? i : t.selectionEnd); t.focus(); schedulePreview();
    });
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

  window.AdminEventEmails = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
