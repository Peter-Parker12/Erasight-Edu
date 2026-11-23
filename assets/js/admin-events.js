/**
 * ERASIGHT ADMIN — "Sự kiện" tab: create/edit/publish events, banner upload, per-source registration
 * counts, and the UTM link builder. Loaded before admin.js, which calls AdminEvents.load() after login.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HDR = { 'X-Requested-With': 'erasight-admin' };
  const JSON_HDR = Object.assign({ 'Content-Type': 'application/json' }, HDR);
  const PHASE = { upcoming: ['Sắp diễn ra', '#E85D04'], live: ['Đang diễn ra', '#E85D04'], past: ['Đã diễn ra', '#6b8590'] };

  let events = [];
  let editingId = null;

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Lỗi ' + res.status));
    return data;
  }

  function msg(text, isErr) {
    const el = $('aeMsg');
    el.textContent = text; el.className = 'adm-msg ' + (isErr ? 'err' : 'ok'); el.hidden = false;
  }

  function updateKpis() {
    const up = events.filter((e) => e.phase !== 'past').length;
    if ($('sideEventCount')) $('sideEventCount').textContent = events.length;
    if ($('aeCount')) $('aeCount').textContent = `${events.length} sự kiện`;
    if ($('kpiEvTotal')) $('kpiEvTotal').textContent = events.length;
    if ($('kpiEvUpcoming')) $('kpiEvUpcoming').textContent = up;
    if ($('kpiEvPast')) $('kpiEvPast').textContent = events.length - up;
    if ($('kpiEvRegs')) $('kpiEvRegs').textContent = events.reduce((a, e) => a + (e.registrations || 0), 0).toLocaleString('vi-VN');
  }

  function rowHtml(e) {
    const [ph, color] = PHASE[e.phase] || PHASE.upcoming;
    const thumb = e.hasBanner ? `<img class="crm-row-thumb" src="${esc(e.bannerUrl)}" alt="" style="aspect-ratio:16/9;height:auto;" />`
      : '<div class="crm-row-thumb" style="display:grid;place-items:center;font-size:11px;color:#8C9FA8;text-align:center;padding:4px;aspect-ratio:16/9;height:auto;">Chưa có banner</div>';
    const src = Object.entries(e.bySource || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
    const seats = e.capacity ? `${e.registrations} / ${e.capacity} đăng ký` : `${e.registrations} đăng ký`;
    const when = e.startLocal.replace('T', ' ');
    return `
      <div class="crm-row" data-id="${esc(e.id)}">
        <div>${thumb}</div>
        <div class="crm-doc-fields">
          <div class="crm-row-header">
            <span class="crm-pill ${e.status === 'published' ? 'pub' : 'draft'}">${e.status === 'published' ? 'Đã xuất bản' : 'Bản nháp'}</span>
            <span class="crm-pill" style="background:${color};">${ph}</span>
            ${e.registrationOpen ? '' : '<span class="crm-pill" style="background:#6b8590;">Tắt đăng ký</span>'}
          </div>
          <div class="crm-row-title" style="font-weight:700;font-size:14px;">${esc(e.title)}</div>
          <div style="font-size:12.5px;color:var(--crm-slate);">${esc(when)} · ${e.mode === 'online' ? 'Online' : 'Trực tiếp'} · <b>${seats}</b></div>
          ${src ? `<div style="font-size:12px;color:var(--crm-slate);">Nguồn: ${src}</div>` : ''}
          <div class="crm-row-meta">
            <div class="crm-row-actions">
              <button type="button" class="crm-btn sm primary" data-act="edit">Sửa</button>
              <button type="button" class="crm-btn sm" data-act="toggle">${e.status === 'published' ? 'Ẩn' : 'Xuất bản'}</button>
              <a class="crm-btn sm" href="${esc(e.url)}" target="_blank" rel="noopener" style="text-decoration:none;">Xem</a>
            </div>
            <button type="button" class="crm-btn sm danger" data-act="del">Xoá</button>
          </div>
        </div>
      </div>`;
  }

  function render() {
    const list = $('aeList');
    list.innerHTML = events.length ? events.map(rowHtml).join('') : '<div class="adm-empty" style="text-align:center;padding:40px 20px;font-size:13.5px;">Chưa có sự kiện nào. Thêm sự kiện đầu tiên ở form bên trái.</div>';
    const sel = $('utmEvent'); const keep = sel.value;
    sel.innerHTML = events.filter((e) => e.status === 'published').map((e) => `<option value="${esc(e.url)}">${esc(e.title)}</option>`).join('')
      || '<option value="">(chưa có sự kiện đã xuất bản)</option>';
    if (keep) sel.value = keep;
    buildLink();
  }

  async function load() {
    try { events = (await api('/api/admin/events', { cache: 'no-store' })).events || []; updateKpis(); render(); }
    catch (err) { $('aeList').innerHTML = `<div class="adm-empty">Lỗi tải dữ liệu: ${esc(err.message)}</div>`; }
  }

  // ---- Form ------------------------------------------------------------------
  function resetForm() {
    editingId = null;
    $('aeForm').reset();
    $('aeFormTitle').textContent = 'Thêm sự kiện mới';
    $('aeCancel').hidden = true; $('aeBannerNote').textContent = '';
    $('aeEmailPreviewBtn').hidden = true; $('aeEmailPreview').hidden = true;
    $('aeSummaryHint').textContent = '0/220 ký tự';
    $('aeMsg').hidden = true;
  }

  function startEdit(e) {
    editingId = e.id;
    $('aeFormTitle').textContent = 'Sửa sự kiện';
    $('aeTitle').value = e.title; $('aeSummary').value = e.summary || ''; $('aeBody').value = e.body || '';
    $('aeStart').value = e.startLocal; $('aeEnd').value = e.endLocal; $('aeMode').value = e.mode; $('aeLocation').value = e.location || '';
    $('aeCapacity').value = e.capacity || ''; $('aeOpen').value = e.registrationOpen ? '1' : '0'; $('aeStatus').value = e.status;
    $('aeJoinLink').value = e.joinLink || ''; $('aeEmailSubject').value = e.emailSubject || ''; $('aeEmailBody').value = e.emailBody || '';
    $('aeEmailPreviewBtn').hidden = false; $('aeEmailPreview').hidden = true;
    $('aeBanner').value = ''; $('aeBannerNote').textContent = e.hasBanner ? '(đã có — chọn ảnh mới để thay)' : '';
    $('aeSummaryHint').textContent = `${$('aeSummary').value.length}/220 ký tự`;
    $('aeCancel').hidden = false; $('aeMsg').hidden = true;
    $('aeForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function putBanner(id, file) {
    let ext = file.name.split('.').pop().toLowerCase(); if (ext === 'jpeg') ext = 'jpg';
    if (!['png', 'jpg', 'webp'].includes(ext)) throw new Error('Banner chỉ nhận PNG, JPG hoặc WebP.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Banner vượt quá 3MB.');
    return api(`/api/admin/events/${id}/banner?ext=${encodeURIComponent(ext)}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, HDR), body: file });
  }

  async function submit(ev) {
    ev.preventDefault();
    const file = $('aeBanner').files[0] || null;
    const existing = editingId ? events.find((x) => x.id === editingId) : null;
    if (!$('aeTitle').value.trim()) return msg('Vui lòng nhập tiêu đề.', true);
    if (!$('aeStart').value) return msg('Vui lòng chọn thời gian bắt đầu.', true);
    if (!file && !(existing && existing.hasBanner)) return msg('Vui lòng chọn ảnh banner.', true);
    const wantStatus = $('aeStatus').value;
    const body = {
      title: $('aeTitle').value, summary: $('aeSummary').value, body: $('aeBody').value,
      startLocal: $('aeStart').value, endLocal: $('aeEnd').value, mode: $('aeMode').value, location: $('aeLocation').value,
      capacity: $('aeCapacity').value, registrationOpen: $('aeOpen').value === '1',
      joinLink: $('aeJoinLink').value, emailSubject: $('aeEmailSubject').value, emailBody: $('aeEmailBody').value,
    };
    const btn = $('aeSubmit'); const prog = $('aeProgress');
    btn.disabled = true; prog.hidden = false; prog.querySelector('i').style.width = '15%'; $('aeMsg').hidden = true;
    try {
      let id = editingId;
      if (id) await api(`/api/admin/events/${id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify(Object.assign({}, body, { status: existing.status === 'published' && wantStatus === 'published' ? 'published' : 'draft' })) });
      else id = (await api('/api/admin/events', { method: 'POST', headers: JSON_HDR, body: JSON.stringify(body) })).event.id;
      prog.querySelector('i').style.width = '55%';
      if (file) await putBanner(id, file);
      prog.querySelector('i').style.width = '85%';
      // Publishing needs the banner, so it is applied last.
      await api(`/api/admin/events/${id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ status: wantStatus }) });
      prog.querySelector('i').style.width = '100%';
      const wasEdit = !!editingId;
      resetForm(); await load();
      msg(wasEdit ? 'Đã lưu thay đổi.' : (wantStatus === 'published' ? 'Đã xuất bản sự kiện.' : 'Đã lưu bản nháp.'), false);
    } catch (err) {
      msg(err.message, true);
      await load(); // the event may exist as a draft even if a later step failed
    } finally { btn.disabled = false; setTimeout(() => { prog.hidden = true; }, 400); }
  }

  async function onListClick(ev) {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.crm-row').dataset.id; const e = events.find((x) => x.id === id); if (!e) return;
    try {
      if (b.dataset.act === 'edit') return startEdit(e);
      if (b.dataset.act === 'toggle') {
        await api(`/api/admin/events/${id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ status: e.status === 'published' ? 'draft' : 'published' }) });
        return load();
      }
      if (b.dataset.act === 'del') {
        if (!confirm(`Xoá sự kiện “${e.title}”? Danh sách đăng ký đã gửi vào CRM vẫn được giữ.`)) return;
        await api(`/api/admin/events/${id}`, { method: 'DELETE', headers: HDR });
        if (editingId === id) resetForm();
        return load();
      }
    } catch (err) { alert(err.message); }
  }

  // ---- UTM link builder ------------------------------------------------------
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function buildLink() {
    const path = $('utmEvent').value;
    const custom = $('utmChannel').value.startsWith('custom');
    $('utmCustomRow').hidden = !custom;
    let [source, medium] = $('utmChannel').value.split('|');
    if (custom) { source = slug($('utmSource').value); medium = slug($('utmMedium').value); }
    const p = new URLSearchParams();
    if (source) p.set('utm_source', source);
    if (medium) p.set('utm_medium', medium);
    if (slug($('utmCampaign').value)) p.set('utm_campaign', slug($('utmCampaign').value));
    if (slug($('utmContent').value)) p.set('utm_content', slug($('utmContent').value));
    $('utmResult').value = path ? `${location.origin}${path}?${p.toString()}` : '';
  }

  function init() {
    if (!$('aeForm')) return;
    $('aeForm').addEventListener('submit', submit);
    $('aeCancel').addEventListener('click', resetForm);
    $('aeEmailPreviewBtn').addEventListener('click', async () => {
      if (!editingId) return;
      try {
        const d = await api(`/api/admin/events/${editingId}/email-preview`, { cache: 'no-store' });
        $('aeEmailPreviewSubject').textContent = 'Tiêu đề: ' + d.subject;
        $('aeEmailPreviewFrame').srcdoc = d.html;
        $('aeEmailPreview').hidden = false;
      } catch (err) { msg(err.message, true); }
    });
    $('aeList').addEventListener('click', onListClick);
    $('aeSummary').addEventListener('input', () => { $('aeSummaryHint').textContent = `${$('aeSummary').value.length}/220 ký tự`; });
    ['utmEvent', 'utmChannel', 'utmCampaign', 'utmContent', 'utmSource', 'utmMedium'].forEach((id) => $(id).addEventListener('input', buildLink));
    $('utmCopy').addEventListener('click', async () => {
      const v = $('utmResult').value; if (!v) return;
      try { await navigator.clipboard.writeText(v); } catch (e) { $('utmResult').select(); document.execCommand('copy'); }
      $('utmCopied').hidden = false; setTimeout(() => { $('utmCopied').hidden = true; }, 1800);
    });
  }

  window.AdminEvents = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
