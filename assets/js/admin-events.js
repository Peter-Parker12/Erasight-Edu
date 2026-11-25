/**
 * ERASIGHT ADMIN — "Sự kiện" tab. Event list on the left; clicking an event opens its detail in the main
 * column with tabs: Thông tin chung (create/edit form, banner upload), Email theo lịch (admin-event-emails.js)
 * and Link theo dõi (UTM builder for that event). Loaded before admin.js, which calls AdminEvents.load().
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HDR = { 'X-Requested-With': 'erasight-admin' };
  const JSON_HDR = Object.assign({ 'Content-Type': 'application/json' }, HDR);
  const PHASE = { upcoming: ['Sắp diễn ra', '#E85D04'], live: ['Đang diễn ra', '#E85D04'], past: ['Đã diễn ra', '#6b8590'] };
  const TABS = ['info', 'emails', 'utm'];
  const STORE_SEL = 'erasight.admin.event.selected';
  const STORE_TAB = 'erasight.admin.event.tab';

  let events = [];
  let selectedId = null;   // event shown in the detail column
  let isNew = false;       // detail column shows the "new event" form
  let tab = 'info';
  let dirty = false;       // form has unsaved edits
  let loadedOnce = false;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

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

  const fmtWhen = (l) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(l || ''); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : ''; };
  const current = () => (selectedId ? events.find((x) => x.id === selectedId) || null : null);

  function updateKpis() {
    const up = events.filter((e) => e.phase !== 'past').length;
    if ($('sideEventCount')) $('sideEventCount').textContent = events.length;
    $('aeCount').textContent = events.length;
    $('kpiEvTotal').textContent = events.length;
    $('kpiEvUpcoming').textContent = up;
    $('kpiEvPast').textContent = events.length - up;
    $('kpiEvRegs').textContent = events.reduce((a, e) => a + (e.registrations || 0), 0).toLocaleString('vi-VN');
  }

  function pills(e, small) {
    const [ph, color] = PHASE[e.phase] || PHASE.upcoming;
    return `<span class="crm-pill ${e.status === 'published' ? 'pub' : 'draft'}">${e.status === 'published' ? (small ? 'Xuất bản' : 'Đã xuất bản') : 'Bản nháp'}</span>`
      + `<span class="crm-pill" style="background:${color};">${ph}</span>`
      + (e.registrationOpen ? '' : '<span class="crm-pill" style="background:#6b8590;">Tắt đăng ký</span>');
  }
  const seats = (e) => (e.capacity ? `${e.registrations} / ${e.capacity} đăng ký` : `${e.registrations} đăng ký`);

  // ---- List (left column) ----------------------------------------------------
  function renderList() {
    const q = $('aeSearch').value.trim().toLowerCase();
    const shown = q ? events.filter((e) => e.title.toLowerCase().includes(q)) : events;
    const list = $('aeList');
    if (!events.length) { list.innerHTML = '<div class="ev-none">Chưa có sự kiện nào.<br />Bấm “+ Thêm” để tạo sự kiện đầu tiên.</div>'; return; }
    if (!shown.length) { list.innerHTML = '<div class="ev-none">Không có sự kiện khớp với tìm kiếm.</div>'; return; }
    list.innerHTML = shown.map((e) => {
      const on = !isNew && e.id === selectedId;
      const thumb = e.hasBanner ? `<img class="ev-thumb" src="${esc(e.bannerUrl)}" alt="" loading="lazy" />` : '<span class="ev-thumb">Chưa có banner</span>';
      return `<button type="button" class="ev-item${on ? ' is-active' : ''}" role="option" aria-selected="${on}" data-id="${esc(e.id)}">
        ${thumb}
        <span class="ev-item-main">
          <span class="ev-item-title">${esc(e.title)}</span>
          <span class="ev-item-meta">${esc(fmtWhen(e.startLocal))} · ${e.mode === 'online' ? 'Online' : 'Trực tiếp'}</span>
          <span class="ev-item-tags">${pills(e, true)}<span>${esc(seats(e))}</span></span>
        </span>
      </button>`;
    }).join('');
  }

  // ---- Detail (main column) --------------------------------------------------
  function renderHead() {
    const e = current();
    $('aeBlank').hidden = !!(e || isNew);
    $('aeDetailBody').hidden = !(e || isNew);
    if (isNew) {
      $('aeHeadImg').innerHTML = 'Banner';
      $('aeHeadPills').innerHTML = '<span class="crm-pill draft">Chưa lưu</span>';
      $('aeFormTitle').textContent = 'Sự kiện mới';
      $('aeHeadMeta').textContent = 'Điền thông tin và bấm “Tạo sự kiện”. Email theo lịch và link UTM dùng được sau khi lưu.';
      $('aeHeadActions').hidden = true;
      return;
    }
    if (!e) return;
    $('aeHeadImg').innerHTML = e.hasBanner ? `<img src="${esc(e.bannerUrl)}" alt="" />` : 'Chưa có banner';
    $('aeHeadPills').innerHTML = pills(e);
    $('aeFormTitle').textContent = e.title;
    const src = Object.entries(e.bySource || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
    const end = e.endLocal && e.endLocal.slice(0, 10) === e.startLocal.slice(0, 10) ? e.endLocal.slice(11, 16) : fmtWhen(e.endLocal);
    $('aeHeadMeta').innerHTML = `${esc(fmtWhen(e.startLocal))}${end ? ' – ' + esc(end) : ''} · ${e.mode === 'online' ? 'Online' : 'Trực tiếp'}${e.location ? ' · ' + esc(e.location) : ''}<br /><b>${esc(seats(e))}</b>${src ? ' · Nguồn: ' + src : ''}`;
    $('aeHeadActions').hidden = false;
    $('aeView').href = e.url;
    $('aeToggle').textContent = e.status === 'published' ? 'Ẩn (về nháp)' : 'Xuất bản';
    $('aeToggle').className = 'crm-btn sm ' + (e.status === 'published' ? '' : 'primary');
  }

  function fillForm(e) {
    $('aeForm').reset(); $('aeMsg').hidden = true;
    if (e) {
      $('aeTitle').value = e.title; $('aeSummary').value = e.summary || ''; $('aeBody').value = e.body || '';
      $('aeStart').value = e.startLocal; $('aeEnd').value = e.endLocal; $('aeMode').value = e.mode; $('aeLocation').value = e.location || '';
      $('aeCapacity').value = e.capacity || ''; $('aeOpen').value = e.registrationOpen ? '1' : '0'; $('aeStatus').value = e.status;
      $('aeJoinLink').value = e.joinLink || '';
    }
    $('aeBanner').value = '';
    $('aeBannerNote').textContent = e && e.hasBanner ? '(đã có — chọn ảnh mới để thay)' : '';
    $('aeSummaryHint').textContent = `${$('aeSummary').value.length}/220 ký tự`;
    $('aeSubmitLbl').textContent = e ? 'Lưu thay đổi' : 'Tạo sự kiện';
    $('aeCancel').hidden = !!e;
    dirty = false;
  }

  function showTab(name) {
    if (isNew || !TABS.includes(name)) name = 'info';
    tab = name;
    const map = { info: ['evTabInfo', 'evPaneInfo'], emails: ['evTabEmails', 'emCard'], utm: ['evTabUtm', 'evPaneUtm'] };
    for (const [k, [b, p]] of Object.entries(map)) {
      const on = k === name;
      $(b).classList.toggle('is-active', on); $(b).setAttribute('aria-selected', String(on)); $(b).tabIndex = on ? 0 : -1;
      $(b).disabled = isNew && k !== 'info';
      $(p).hidden = !on;
    }
    if (!isNew) store.set(STORE_TAB, name);
    if (name === 'emails' && window.AdminEventEmails) window.AdminEventEmails.show(selectedId);
    if (name === 'utm') setUtmEvent();
  }

  function confirmDiscard() {
    return !dirty || confirm('Bạn có thay đổi chưa lưu ở “Thông tin chung”. Bỏ các thay đổi này?');
  }

  function select(id, opts) {
    opts = opts || {};
    if (!opts.force && !confirmDiscard()) return;
    const e = events.find((x) => x.id === id); if (!e) return;
    selectedId = id; isNew = false;
    store.set(STORE_SEL, id);
    fillForm(e); renderHead(); renderList(); showTab(opts.tab || tab);
    if (opts.scroll && window.matchMedia('(max-width: 1080px)').matches) $('aeDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startNew() {
    if (!confirmDiscard()) return;
    isNew = true;
    fillForm(null); renderHead(); renderList(); showTab('info');
    $('aeTitle').focus();
    if (window.matchMedia('(max-width: 1080px)').matches) $('aeDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelNew() {
    if (!confirmDiscard()) return;
    isNew = false; dirty = false;
    if (current()) select(selectedId, { force: true }); else { selectedId = null; renderHead(); renderList(); }
  }

  async function load() {
    try {
      events = (await api('/api/admin/events', { cache: 'no-store' })).events || [];
    } catch (err) { $('aeList').innerHTML = `<div class="ev-none">Lỗi tải dữ liệu: ${esc(err.message)}</div>`; return; }
    updateKpis();
    if (!loadedOnce) {   // first load: restore the last opened event and tab, else open the first event
      loadedOnce = true;
      const saved = store.get(STORE_SEL); const savedTab = store.get(STORE_TAB);
      if (TABS.includes(savedTab)) tab = savedTab;
      selectedId = events.some((e) => e.id === saved) ? saved : (events[0] ? events[0].id : null);
      if (selectedId) return select(selectedId, { force: true });
    }
    if (isNew) { renderList(); return; }
    if (selectedId && !current()) { selectedId = null; store.set(STORE_SEL, null); }
    renderList(); renderHead();
    if (current() && !dirty) fillForm(current());
    if (current() && tab === 'emails' && window.AdminEventEmails) window.AdminEventEmails.show(selectedId);
    if (tab === 'utm') setUtmEvent();
  }

  // ---- Save (Thông tin chung) ------------------------------------------------
  async function putBanner(id, file) {
    let ext = file.name.split('.').pop().toLowerCase(); if (ext === 'jpeg') ext = 'jpg';
    if (!['png', 'jpg', 'webp'].includes(ext)) throw new Error('Banner chỉ nhận PNG, JPG hoặc WebP.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Banner vượt quá 3MB.');
    return api(`/api/admin/events/${id}/banner?ext=${encodeURIComponent(ext)}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, HDR), body: file });
  }

  async function submit(ev) {
    ev.preventDefault();
    const file = $('aeBanner').files[0] || null;
    const existing = isNew ? null : current();
    if (!$('aeTitle').value.trim()) return msg('Vui lòng nhập tiêu đề.', true);
    if (!$('aeStart').value) return msg('Vui lòng chọn thời gian bắt đầu.', true);
    if (!file && !(existing && existing.hasBanner)) return msg('Vui lòng chọn ảnh banner.', true);
    const wantStatus = $('aeStatus').value;
    const body = {
      title: $('aeTitle').value, summary: $('aeSummary').value, body: $('aeBody').value,
      startLocal: $('aeStart').value, endLocal: $('aeEnd').value, mode: $('aeMode').value, location: $('aeLocation').value,
      capacity: $('aeCapacity').value, registrationOpen: $('aeOpen').value === '1',
      joinLink: $('aeJoinLink').value,
    };
    const btn = $('aeSubmit'); const prog = $('aeProgress');
    btn.disabled = true; prog.hidden = false; prog.querySelector('i').style.width = '15%'; $('aeMsg').hidden = true;
    let id = existing ? existing.id : null;
    try {
      if (id) await api(`/api/admin/events/${id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify(Object.assign({}, body, { status: existing.status === 'published' && wantStatus === 'published' ? 'published' : 'draft' })) });
      else id = (await api('/api/admin/events', { method: 'POST', headers: JSON_HDR, body: JSON.stringify(body) })).event.id;
      prog.querySelector('i').style.width = '55%';
      if (file) await putBanner(id, file);
      prog.querySelector('i').style.width = '85%';
      // Publishing needs the banner, so it is applied last.
      await api(`/api/admin/events/${id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ status: wantStatus }) });
      prog.querySelector('i').style.width = '100%';
      const created = !existing;
      dirty = false; isNew = false; selectedId = id;
      await load(); select(id, { force: true, tab: 'info' });
      msg(created ? (wantStatus === 'published' ? 'Đã tạo và xuất bản sự kiện. Bạn có thể cấu hình “Email theo lịch” ngay bây giờ.' : 'Đã lưu bản nháp. Bạn có thể cấu hình “Email theo lịch” ngay bây giờ.') : 'Đã lưu thay đổi.', false);
    } catch (err) {
      const keep = dirty; await load(); dirty = keep; // the event may exist as a draft even if a later step failed
      if (id && isNew) { isNew = false; selectedId = id; renderHead(); renderList(); showTab('info'); }
      msg(err.message, true);
    } finally { btn.disabled = false; setTimeout(() => { prog.hidden = true; }, 400); }
  }

  async function togglePublish() {
    const e = current(); if (!e) return;
    try {
      await api(`/api/admin/events/${e.id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ status: e.status === 'published' ? 'draft' : 'published' }) });
      const keep = dirty; await load(); dirty = keep;
      if (!keep) $('aeStatus').value = current() ? current().status : $('aeStatus').value;
    } catch (err) { alert(err.message); }
  }

  async function removeEvent() {
    const e = current(); if (!e) return;
    if (!confirm(`Xoá sự kiện “${e.title}”? Danh sách đăng ký đã gửi vào CRM vẫn được giữ.`)) return;
    try {
      await api(`/api/admin/events/${e.id}`, { method: 'DELETE', headers: HDR });
      dirty = false; selectedId = null; store.set(STORE_SEL, null);
      await load();
    } catch (err) { alert(err.message); }
  }

  // ---- UTM link builder (for the selected event) ------------------------------
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function setUtmEvent() {
    const e = current();
    $('utmEvent').value = e ? e.url : '';
    $('utmNote').hidden = !e || e.status === 'published';
    buildLink(); shortErr(''); loadShortList();
  }
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
    syncShortBox();
  }

  // ---- short links (the UTM link above, shortened; the short link redirects to the full URL so UTM tags are kept) ----
  let shortFor = '';   // the long link the visible short link was made for
  const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString('vi-VN'); } catch (e) { return ''; } };
  function shortErr(text) { $('utmShortErr').textContent = text || ''; $('utmShortErr').hidden = !text; }
  function syncShortBox() { if ($('utmResult').value !== shortFor) $('utmShortBox').hidden = true; }
  async function loadShortList() {
    const e = current(); const box = $('utmShortList');
    if (!e) { box.innerHTML = ''; return; }
    try {
      const d = await api('/api/admin/short-links?path=' + encodeURIComponent(e.url), { cache: 'no-store', headers: HDR });
      if (!d.links.length) { box.innerHTML = '<div class="form-hint">Chưa có link rút gọn nào.</div>'; return; }
      box.innerHTML = '<table class="em-tbl"><tr><th>Link rút gọn</th><th>Nguồn / chiến dịch</th><th>Lượt bấm</th><th></th></tr>' + d.links.map((l) =>
        `<tr><td class="em-t"><code>${esc(location.origin + l.path)}</code></td><td>${esc(l.label || '—')}<br><small class="form-hint">${esc(fmtDay(l.createdAt))}</small></td><td class="em-num">${l.clicks}</td>`
        + `<td style="white-space:nowrap"><button type="button" class="crm-btn sm" data-scopy="${esc(l.path)}">Sao chép</button> <button type="button" class="crm-btn sm danger" data-sdel="${esc(l.code)}">Xoá</button></td></tr>`).join('') + '</table>';
    } catch (err) { box.innerHTML = `<div class="form-hint">${esc(err.message)}</div>`; }
  }
  async function shorten() {
    const url = $('utmResult').value; if (!url) return;
    shortErr(''); $('utmShorten').disabled = true;
    try {
      const l = await api('/api/admin/short-links', { method: 'POST', headers: JSON_HDR, body: JSON.stringify({ url }) });
      $('utmShortResult').value = location.origin + l.path; shortFor = url; $('utmShortBox').hidden = false;
      loadShortList();
    } catch (err) { shortErr(err.message); }
    finally { $('utmShorten').disabled = false; }
  }
  async function copyText(text, input, flag) {
    try { await navigator.clipboard.writeText(text); } catch (e) { if (input) { input.select(); document.execCommand('copy'); } }
    flag.hidden = false; setTimeout(() => { flag.hidden = true; }, 1800);
  }

  function init() {
    if (!$('aeForm')) return;
    $('aeForm').addEventListener('submit', submit);
    $('aeForm').addEventListener('input', () => { dirty = true; });
    $('aeForm').addEventListener('change', () => { dirty = true; });
    $('aeCancel').addEventListener('click', cancelNew);
    $('aeNew').addEventListener('click', startNew);
    $('aeSearch').addEventListener('input', renderList);
    $('aeList').addEventListener('click', (ev) => { const b = ev.target.closest('.ev-item'); if (b) select(b.dataset.id, { scroll: true }); });
    $('aeList').addEventListener('keydown', (ev) => {   // arrow keys move through the list
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      const items = Array.from($('aeList').querySelectorAll('.ev-item')); const i = items.indexOf(document.activeElement);
      const n = items[ev.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
      if (n) { ev.preventDefault(); n.focus(); }
    });
    document.querySelector('.ev-tabs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-etab]'); if (b && !b.disabled) showTab(b.dataset.etab); });
    document.querySelector('.ev-tabs').addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      const btns = Array.from(document.querySelectorAll('.ev-tab:not(:disabled)')); const i = btns.indexOf(document.activeElement);
      const n = btns[(i + (ev.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      if (n) { ev.preventDefault(); n.focus(); showTab(n.dataset.etab); }
    });
    $('aeToggle').addEventListener('click', togglePublish);
    $('aeDelete').addEventListener('click', removeEvent);
    $('aeSummary').addEventListener('input', () => { $('aeSummaryHint').textContent = `${$('aeSummary').value.length}/220 ký tự`; });
    ['utmChannel', 'utmCampaign', 'utmContent', 'utmSource', 'utmMedium'].forEach((id) => $(id).addEventListener('input', buildLink));
    $('utmCopy').addEventListener('click', async () => {
      const v = $('utmResult').value; if (!v) return;
      try { await navigator.clipboard.writeText(v); } catch (e) { $('utmResult').select(); document.execCommand('copy'); }
      $('utmCopied').hidden = false; setTimeout(() => { $('utmCopied').hidden = true; }, 1800);
    });
    $('utmShorten').addEventListener('click', shorten);
    $('utmShortCopy').addEventListener('click', () => copyText($('utmShortResult').value, $('utmShortResult'), $('utmShortCopied')));
    $('utmShortList').addEventListener('click', async (ev) => {
      const c = ev.target.closest('[data-scopy]'); const d = ev.target.closest('[data-sdel]');
      if (c) { try { await navigator.clipboard.writeText(location.origin + c.dataset.scopy); c.textContent = 'Đã chép ✓'; setTimeout(() => { c.textContent = 'Sao chép'; }, 1500); } catch (e) { /* ignore */ } }
      if (d && confirm('Xoá link rút gọn này? Link đã đăng ở đâu đó sẽ chuyển về trang chủ.')) {
        try { await api('/api/admin/short-links/' + d.dataset.sdel, { method: 'DELETE', headers: HDR }); $('utmShortBox').hidden = true; loadShortList(); } catch (err) { shortErr(err.message); }
      }
    });
    window.addEventListener('beforeunload', (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  }

  window.AdminEvents = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
