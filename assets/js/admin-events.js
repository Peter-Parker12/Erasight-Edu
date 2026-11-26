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
  const TABS = ['info', 'emails', 'utm', 'reg', 'rep'];
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
    const map = { info: ['evTabInfo', 'evPaneInfo'], emails: ['evTabEmails', 'emCard'], utm: ['evTabUtm', 'evPaneUtm'], reg: ['evTabReg', 'evPaneReg'], rep: ['evTabRep', 'evPaneRep'] };
    for (const [k, [b, p]] of Object.entries(map)) {
      const on = k === name;
      $(b).classList.toggle('is-active', on); $(b).setAttribute('aria-selected', String(on)); $(b).tabIndex = on ? 0 : -1;
      $(b).disabled = isNew && k !== 'info';
      $(p).hidden = !on;
    }
    if (!isNew) store.set(STORE_TAB, name);
    if (name === 'emails' && window.AdminEventEmails) window.AdminEventEmails.show(selectedId);
    if (name === 'utm') setUtmEvent();
    if (name === 'reg') fillReg();
    if (name === 'rep') fillReport();
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

  // ---- registration extras: confirmation email (+ QR picture) and the Zalo popup ----
  const regPic = { qr: '', zalo: '' };   // uploaded picture urls, applied on save
  function rgMsg(text, isErr) { const el = $('rgMsg'); el.textContent = text || ''; el.style.color = isErr ? '#b3261e' : ''; }
  function paintPics() {
    for (const [img, url] of [[$('rgZaloPreview'), regPic.zalo]]) { img.hidden = !url; if (url) img.src = url; }
  }
  function fillReg() {
    const e = current(); if (!e) return;
    const c = e.confirmation || {}; const z = e.zalo || {};
    $('rgConfEnabled').checked = !!c.enabled;
    $('rgEditMail').disabled = !c.mailId;
    $('rgConfNote').textContent = c.mailId
      ? (c.enabled ? `Đang bật — đã gửi ${c.sent || 0} email xác nhận. Gửi cho tất cả người đã đăng ký, kể cả người đăng ký trước khi bật; mỗi người chỉ nhận một lần. Email đi trong lần chạy kế tiếp của workflow (mỗi lần tối đa 50 email).` : 'Đang tắt — chưa gửi email xác nhận nào.')
      : 'Bật để tạo email xác nhận.';
    $('rgZaloOn').checked = !!z.enabled; $('rgZaloTitle').value = z.title || ''; $('rgZaloText').value = z.text || ''; $('rgZaloLink').value = z.linkUrl || '';
    regPic.zalo = z.image || '';
    paintPics(); rgMsg('');
    $('rgConfNote').textContent = c.enabled
      ? `Đã gửi ${e.confirmationSent || 0} email xác nhận. Chỉ người đăng ký sau khi bật mới nhận được. Email đi trong lần chạy kế tiếp của workflow (tối đa 15 phút).`
      : 'Đang tắt — chưa gửi email xác nhận nào.';
  }
  async function uploadPic(file) {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : '';
    if (!ext) throw new Error('Ảnh chỉ nhận PNG, JPG hoặc WebP');
    if (file.size > 3 * 1024 * 1024) throw new Error('Ảnh tối đa 3MB');
    const d = await api(`/api/admin/events/${selectedId}/emails/images?ext=${ext}`, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, HDR), body: file });
    return d.url;
  }
  async function pickPic(inputId, key) {
    const input = $(inputId); const f = input.files[0]; input.value = ''; if (!f) return;
    rgMsg('Đang tải ảnh…');
    try { regPic[key] = await uploadPic(f); paintPics(); rgMsg('Đã tải ảnh. Bấm “Lưu cài đặt” để áp dụng.'); }
    catch (err) { rgMsg(err.message, true); }
  }
  async function saveReg() {
    const e = current(); if (!e) return;
    const body = {
      confirmation: { enabled: $('rgConfEnabled').checked },
      zalo: {
        enabled: $('rgZaloOn').checked, title: $('rgZaloTitle').value.trim(), text: $('rgZaloText').value,
        image: regPic.zalo, linkUrl: $('rgZaloLink').value.trim(),
      },
    };
    rgMsg('Đang lưu…');
    try {
      const d = await api(`/api/admin/events/${e.id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify(body) });
      const i = events.findIndex((x) => x.id === e.id); if (i >= 0) events[i] = d.event;
      fillReg(); rgMsg('Đã lưu ✓');
    } catch (err) { rgMsg(err.message, true); }
  }

  // ---- sending report (sent / failed counts from the server) ----
  let repData = null;
  const numFmt = (n) => Number(n || 0).toLocaleString('vi-VN');
  function fillReport() {
    if (!selectedId) return;
    $('repCards').innerHTML = '<div class="form-hint">Đang tải…</div>';
    const id = selectedId;
    api(`/api/admin/events/${id}/emails/report?days=${encodeURIComponent($('repDays').value)}`, { cache: 'no-store', headers: HDR }).then((d) => {
      if (id !== selectedId) return;
      repData = d; renderReport(d);
    }).catch((err) => { $('repCards').innerHTML = `<div class="form-hint">${esc(err.message)}</div>`; });
  }
  function renderReport(d) {
    const st = d.setup || {};
    const warn = [];
    if (st.mode !== 'direct') warn.push('Đang gửi qua workflow Twenty. Đặt MAIL_MODE=direct để máy chủ tự gửi.');
    else if (!st.ready) warn.push('Chưa đặt MAIL_FROM — máy chủ chưa gửi được email.');
    if (st.mode === 'direct' && !st.dkim) warn.push('Chưa cấu hình DKIM — email dễ bị đưa vào thư rác.');
    $('repSetup').innerHTML = `<b>Chế độ gửi:</b> ${st.mode === 'direct' ? 'máy chủ tự gửi' : 'Twenty workflow'}${st.from ? ` · từ <code>${esc(st.from)}</code>` : ''}${st.relay ? ` · qua ${esc(st.relay)}` : ''}${st.dkim ? ' · DKIM ✓' : ''}`
      + (warn.length ? `<div class="em-zone" style="margin-top:8px;">${warn.map(esc).join('<br>')}</div>` : '');
    const t = d.totals;
    const card = (n, label, cls) => `<div class="rep-card ${cls || ''}"><b>${numFmt(n)}</b><span>${label}</span></div>`;
    $('repCards').innerHTML = card(t.sent, 'Đã gửi (máy chủ nhận)', 'ok') + card(t.pending, 'Đang gửi') + card(t.retry, 'Sẽ thử lại', 'warn')
      + card(t.failed, 'Thất bại', 'bad') + card(t.cancelled, 'Đã huỷ') + card(t.copies, 'Bản sao nội bộ');
    const rows = d.perMail.map((m) => `<tr><td class="em-t">${esc(m.name)}${m.confirm ? ' <span class="em-badge o">Tự động</span>' : ''}</td><td>${m.enabled ? 'Bật' : '<span class="em-badge g">Tắt</span>'}</td><td class="em-num">${numFmt(m.sent)}</td><td class="em-num">${numFmt(m.pending)}</td><td class="em-num">${numFmt(m.retry)}</td><td class="em-num">${numFmt(m.failed)}</td><td class="em-num">${numFmt(m.cancelled)}</td></tr>`).join('');
    $('repMails').innerHTML = d.perMail.length ? `<table class="em-tbl"><tr><th>Email</th><th>Trạng thái</th><th>Đã gửi</th><th>Đang gửi</th><th>Sẽ thử lại</th><th>Thất bại</th><th>Huỷ</th></tr>${rows}</table>` : '<div class="em-empty">Sự kiện chưa có email nào.</div>';
    const max = Math.max(1, ...d.byDay.map((x) => x.accepted + x.rejected + x.retry));
    $('repDaily').innerHTML = d.byDay.length ? `<table class="em-tbl"><tr><th>Ngày</th><th>Đã nhận</th><th>Bị từ chối</th><th>Thử lại</th><th style="width:40%">Biểu đồ</th></tr>${d.byDay.map((x) =>
      `<tr><td>${esc(x.day)}</td><td class="em-num">${numFmt(x.accepted)}</td><td class="em-num">${numFmt(x.rejected)}</td><td class="em-num">${numFmt(x.retry)}</td><td><div class="rep-bar"><i style="width:${Math.round(x.accepted / max * 100)}%"></i><u style="width:${Math.round((x.rejected + x.retry) / max * 100)}%"></u></div></td></tr>`).join('')}</table>`
      : '<div class="em-empty">Chưa có lần gửi nào trong khoảng này.</div>';
    $('repFail').innerHTML = d.failures.length ? `<table class="em-tbl"><tr><th>Thời gian</th><th>Email nhận</th><th>Mã</th><th>Lý do từ máy chủ nhận</th><th>Kết quả</th></tr>${d.failures.map((f) =>
      `<tr><td>${esc(new Date(f.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))}</td><td>${esc(f.to)}</td><td class="em-num">${esc(f.code || '')}</td><td>${esc(f.msg)}</td><td>${f.status === 'rejected' ? '<span class="em-badge r">Không gửi được</span>' : '<span class="em-badge o">Sẽ thử lại</span>'}</td></tr>`).join('')}</table>`
      : '<div class="em-empty">Không có lỗi.</div>';
  }
  function reportCsv() {
    if (!repData) return;
    const cols = ['name', 'type', 'enabled', 'sent', 'pending', 'retry', 'failed', 'cancelled', 'copies'];
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...repData.perMail.map((m) => cols.map((c) => q(m[c])).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `bao-cao-gui-${selectedId}.csv`; document.body.appendChild(a); a.click(); a.remove();
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
    $('rgSave').addEventListener('click', saveReg);
    $('repRefresh').addEventListener('click', fillReport);
    $('repDays').addEventListener('change', fillReport);
    $('repCsv').addEventListener('click', reportCsv);
    $('rgEditMail').addEventListener('click', () => {
      const c = (current() || {}).confirmation || {}; if (!c.mailId || !selectedId) return;
      showTab('emails'); window.AdminEventEmails && window.AdminEventEmails.openMail(selectedId, c.mailId);
    });
    $('rgZaloFile').addEventListener('change', () => pickPic('rgZaloFile', 'zalo'));
    $('rgZaloClear').addEventListener('click', () => { regPic.zalo = ''; paintPics(); rgMsg('Đã gỡ ảnh. Bấm “Lưu cài đặt” để áp dụng.'); });
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
