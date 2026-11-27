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
  const TABS = ['info', 'emails', 'utm', 'reg', 'rep', 'survey'];
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
      $('aeRecUrl').value = e.recording ? e.recording.url : ''; $('aeRecTitle').value = e.recording ? (e.recording.title || '') : '';
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
    const map = { info: ['evTabInfo', 'evPaneInfo'], emails: ['evTabEmails', 'emCard'], utm: ['evTabUtm', 'evPaneUtm'], reg: ['evTabReg', 'evPaneReg'], rep: ['evTabRep', 'evPaneRep'], survey: ['evTabSurvey', 'evPaneSurvey'] };
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
    if (name === 'survey') fillSurvey();
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
      recording: { url: $('aeRecUrl').value.trim(), title: $('aeRecTitle').value.trim() },
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
      await api(`/api/admin/events/${id}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ status: wantStatus, recording: body.recording }) });
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
    const [source, medium] = $('utmChannel').value.split('|');
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

  // ---- feedback survey: questions, results ----
  const SV_TYPES = { rating: 'Đánh giá sao 1–5', nps: 'Mức độ giới thiệu 0–10 (NPS)', choice: 'Chọn một đáp án', multi: 'Chọn nhiều đáp án', text: 'Câu trả lời mở' };
  let svQs = [];   // the questions being edited
  let svOwner = null;
  const svNum = (n) => Number(n || 0).toLocaleString('vi-VN');
  const svWhen = (iso) => { try { return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); } catch (e) { return ''; } };
  const svPct = (n, of) => (of ? Math.round(n / of * 100) : 0);
  function svMsg(text, isErr) { const el = $('svMsg'); el.textContent = text || ''; el.style.color = isErr ? '#b3261e' : ''; }
  function svRenderQs() {
    $('svQs').innerHTML = svQs.length ? svQs.map((q, i) => `
      <div class="sv-q" data-i="${i}">
        <div class="sv-q__head"><b>${i + 1}.</b> <span class="em-badge">${esc(SV_TYPES[q.type])}</span>
          <span class="sv-q__tools"><button type="button" class="crm-btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Lên">↑</button>
          <button type="button" class="crm-btn sm" data-down="${i}" ${i === svQs.length - 1 ? 'disabled' : ''} aria-label="Xuống">↓</button>
          <button type="button" class="crm-btn sm danger" data-del="${i}">Xoá</button></span></div>
        <input type="text" class="sv-q__text" maxlength="300" value="${esc(q.text)}" data-f="text" placeholder="Nội dung câu hỏi" aria-label="Nội dung câu hỏi ${i + 1}" />
        <label class="em-check" style="margin:6px 0 0;"><input type="checkbox" data-f="required" ${q.required ? 'checked' : ''} /> Bắt buộc trả lời</label>
        ${q.type === 'choice' || q.type === 'multi' ? `<textarea class="sv-q__opts" rows="3" data-f="options" aria-label="Các đáp án, mỗi dòng một đáp án" placeholder="Mỗi dòng một đáp án">${esc((q.options || []).join('\n'))}</textarea>` : ''}
      </div>`).join('') : '<div class="em-empty">Chưa có câu hỏi. Thêm câu hỏi bên dưới.</div>';
  }
  function svReadQs() {
    return [...document.querySelectorAll('#svQs .sv-q')].map((row) => {
      const i = Number(row.dataset.i); const q = svQs[i];
      const out = { id: q.id, type: q.type, text: row.querySelector('[data-f="text"]').value.trim(), required: row.querySelector('[data-f="required"]').checked };
      const opts = row.querySelector('[data-f="options"]');
      if (opts) out.options = opts.value.split('\n').map((x) => x.trim()).filter(Boolean);
      return out;
    });
  }
  function svSyncFromDom() { svQs = svReadQs(); }
  function svApply(s) {
    $('svTitle').value = s.title || ''; $('svIntro').value = s.intro || ''; $('svThanks').value = s.thanks || ''; $('svOpen').checked = !!s.open;
    svQs = (s.questions || []).map((q) => ({ ...q, options: q.options ? [...q.options] : undefined }));
    svRenderQs();
    svRenderTesters(s.testers || []);
  }
  function svRenderTesters(list) {
    $('svTestList').innerHTML = list.length ? `<table class="em-tbl"><tr><th>Người thử</th><th>Link</th><th></th></tr>${list.map((t) =>
      `<tr><td class="em-t">${esc(t.email)}</td><td><code class="sv-test-link">${esc(t.link)}</code></td><td style="white-space:nowrap"><button type="button" class="crm-btn sm" data-tcopy="${esc(t.link)}">Sao chép</button></td></tr>`).join('')}</table>` : '<div class="em-empty">Chưa có link thử.</div>';
  }
  async function svMakeTesters() {
    if (!selectedId) return;
    const msg = $('svTestMsg'); msg.hidden = true;
    try {
      const d = await api(`/api/admin/events/${selectedId}/survey/test-links`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify({ emails: $('svTestEmails').value }) });
      $('svTestEmails').value = ''; svRenderTesters(d.survey.testers || []);
      msg.textContent = 'Đã tạo link. Sao chép và gửi cho người thử.'; msg.hidden = false;
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  }
  async function fillSurvey() {
    if (!selectedId) return;
    const id = selectedId; svOwner = id;
    const previewUrl = `/api/admin/events/${id}/survey/preview`;
    $('svPreviewOpen').href = previewUrl;
    if ($('svPreviewFrame').getAttribute('data-for') !== id) { $('svPreviewFrame').src = previewUrl; $('svPreviewFrame').setAttribute('data-for', id); }
    try {
      const d = await api(`/api/admin/events/${id}/survey`, { cache: 'no-store', headers: HDR });
      if (svOwner !== id) return;
      svApply(d.survey);
      svMsg('');
      $('svStatus').innerHTML = d.survey.open
        ? `<span class="em-badge">Đang nhận trả lời</span> Khảo sát được gửi qua “Email sau sự kiện”.`
        : `<span class="em-badge g">Đã đóng</span> Người tham dự không thể trả lời nữa.`;
    } catch (err) { svMsg(err.message, true); }
    loadSurveyResults(id);
    loadSurveySummary();
  }
  async function saveSurvey() {
    if (!selectedId) return;
    svSyncFromDom();
    svMsg('Đang lưu…');
    try {
      const d = await api(`/api/admin/events/${selectedId}/survey`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({
        title: $('svTitle').value.trim(), intro: $('svIntro').value, thanks: $('svThanks').value.trim(), open: $('svOpen').checked, questions: svQs.map((q) => ({ id: q.id, type: q.type, text: q.text, required: q.required, options: q.options })),
      }) });
      svApply(d.survey); svMsg('Đã lưu ✓');
      loadSurveyResults(selectedId);
    } catch (err) { svMsg(err.message, true); }
  }
  function svBar(n, of, cls) { return `<div class="rep-bar ${cls || ''}" title="${svNum(n)} (${svPct(n, of)}%)"><i style="width:${svPct(n, of)}%"></i></div>`; }
  async function loadSurveyResults(id) {
    try {
      const r = await api(`/api/admin/events/${id}/survey/results`, { cache: 'no-store', headers: HDR });
      if (id !== selectedId) return;
      renderSurveyResults(r);
    } catch (err) { $('svCards').innerHTML = `<div class="form-hint">${esc(err.message)}</div>`; }
  }
  let svLast = null;
  function renderSurveyResults(r) {
    svLast = r;
    const rating = r.questions.filter((q) => q.type === 'rating' && q.avg != null);
    const nps = r.questions.find((q) => q.type === 'nps' && q.score != null);
    const card = (n, label, cls) => `<div class="rep-card ${cls || ''}"><b>${n}</b><span>${label}</span></div>`;
    $('svCards').innerHTML = card(svNum(r.invited), 'Đã gửi email khảo sát') + card(svNum(r.responses), 'Đã trả lời', 'ok')
      + card(r.rate == null ? '—' : r.rate + '%', 'Tỉ lệ trả lời', r.rate >= 30 ? 'ok' : 'warn')
      + card(rating.length ? rating[0].avg + ' / 5' : '—', 'Điểm trung bình') + card(nps ? (nps.score > 0 ? '+' : '') + nps.score : '—', 'NPS');
    if (!r.questions.length) { $('svCharts').innerHTML = '<div class="em-empty">Chưa có câu hỏi.</div>'; }
    $('svCharts').innerHTML = r.questions.map((q) => {
      const head = `<div class="sv-chart__head"><b>${esc(q.text)}</b> <span class="form-hint">${svNum(q.answered)} người trả lời</span></div>`;
      let body = '';
      if (q.type === 'rating') {
        body = `<div class="sv-chart__sum">Trung bình <b>${q.avg == null ? '—' : q.avg}</b> / 5</div>` + [1, 2, 3, 4, 5].map((n) =>
          `<div class="sv-row"><span>${n} sao</span>${svBar(q.dist[n - 1], q.answered)}<span class="em-num">${svNum(q.dist[n - 1])}</span></div>`).join('');
      } else if (q.type === 'nps') {
        body = `<div class="sv-chart__sum">Điểm NPS <b>${q.score == null ? '—' : (q.score > 0 ? '+' : '') + q.score}</b></div>`
          + [['Người ủng hộ (9–10)', q.promoters, 'ok'], ['Trung lập (7–8)', q.passives, ''], ['Người phê bình (0–6)', q.detractors, 'bad']].map(([l, n, c]) =>
            `<div class="sv-row"><span>${l}</span>${svBar(n, q.answered, c)}<span class="em-num">${svNum(n)} (${svPct(n, q.answered)}%)</span></div>`).join('');
      } else if (q.type === 'choice' || q.type === 'multi') {
        body = q.options.map((o) => `<div class="sv-row"><span>${esc(o.option)}</span>${svBar(o.n, q.answered)}<span class="em-num">${svNum(o.n)} (${svPct(o.n, q.answered)}%)</span></div>`).join('');
      } else {
        body = (q.topWords && q.topWords.length ? `<div class="sv-words">${q.topWords.map((w) => `<span class="em-badge">${esc(w.word)} · ${w.n}</span>`).join(' ')}</div>` : '')
          + (q.texts.length ? `<ul class="sv-texts">${q.texts.slice(0, 40).map((t) => `<li><b>${esc(t.email)}</b> <small>${esc(svWhen(t.at))}</small><br>${esc(t.text)}</li>`).join('')}</ul>` : '<div class="em-empty">Chưa có câu trả lời.</div>');
      }
      return `<div class="sv-chart">${head}${body}</div>`;
    }).join('');
    const dailyMax = Math.max(1, ...r.daily.map((d) => d.n));
    if (r.daily.length) $('svCharts').innerHTML += `<div class="sv-chart"><div class="sv-chart__head"><b>Trả lời theo ngày</b></div>${r.daily.map((d) => `<div class="sv-row"><span>${esc(d.day)}</span>${svBar(d.n, dailyMax)}<span class="em-num">${svNum(d.n)}</span></div>`).join('')}</div>`;
    const answered = r.responders; const not = r.nonResponders;
    $('svPeople').innerHTML = `<table class="em-tbl"><tr><th>Đã trả lời</th><th>Thời gian</th></tr>${answered.map((x) => `<tr><td>${esc(x.email)}</td><td class="em-num">${esc(svWhen(x.at))}</td></tr>`).join('') || '<tr><td colspan="2" class="em-empty">Chưa ai trả lời.</td></tr>'}</table>`
      + `<table class="em-tbl" style="margin-top:10px;"><tr><th>Chưa trả lời (${svNum(not.length)})</th></tr>${not.map((e) => `<tr><td>${esc(e)}</td></tr>`).join('') || '<tr><td class="em-empty">Mọi người đã trả lời.</td></tr>'}</table>`;
  }
  async function loadSurveySummary() {
    try {
      const d = await api('/api/admin/surveys/summary', { cache: 'no-store', headers: HDR });
      $('svSummary').innerHTML = d.events.length ? `<table class="em-tbl"><tr><th>Sự kiện</th><th class="em-num">Đã gửi</th><th class="em-num">Đã trả lời</th><th class="em-num">Tỉ lệ</th><th class="em-num">Điểm TB</th><th class="em-num">NPS</th></tr>${d.events.map((e) =>
        `<tr><td class="em-t">${esc(e.title)}</td><td class="em-num">${svNum(e.invited)}</td><td class="em-num">${svNum(e.responses)}</td><td class="em-num">${e.rate == null ? '—' : e.rate + '%'}</td><td class="em-num">${e.avgRating == null ? '—' : e.avgRating}</td><td class="em-num">${e.nps == null ? '—' : (e.nps > 0 ? '+' : '') + e.nps}</td></tr>`).join('')}</table>` : '<div class="em-empty">Chưa có sự kiện.</div>';
    } catch (err) { $('svSummary').innerHTML = `<div class="form-hint">${esc(err.message)}</div>`; }
  }
  function svCsv() {
    if (!svLast) return;
    const cols = ['email', 'at', ...svLast.questionsMeta.map((q) => q.text)];
    const q = (v) => `"${String(v == null ? '' : Array.isArray(v) ? v.join('; ') : v).replace(/"/g, '""')}"`;
    const csv = [cols.map(q).join(','), ...svLast.rows.map((r) => [r.email, r.at, ...svLast.questionsMeta.map((m) => r.answers[m.id])].map(q).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `khao-sat-${selectedId}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }
  function svInitListeners() {
    $('svAddQ').addEventListener('click', () => {
      svSyncFromDom();
      const type = $('svNewType').value;
      const q = { id: 'q' + Math.random().toString(36).slice(2, 8), type, text: '', required: false };
      if (type === 'choice' || type === 'multi') q.options = ['Đáp án 1', 'Đáp án 2'];
      svQs.push(q); svRenderQs();
    });
    $('svQs').addEventListener('click', (e) => {
      const up = e.target.closest('[data-up]'); const down = e.target.closest('[data-down]'); const del = e.target.closest('[data-del]');
      if (!up && !down && !del) return;
      svSyncFromDom();
      if (up) { const i = Number(up.dataset.up); [svQs[i - 1], svQs[i]] = [svQs[i], svQs[i - 1]]; }
      if (down) { const i = Number(down.dataset.down); [svQs[i], svQs[i + 1]] = [svQs[i + 1], svQs[i]]; }
      if (del) svQs.splice(Number(del.dataset.del), 1);
      svRenderQs();
    });
    $('svSave').addEventListener('click', saveSurvey);
    $('svTestMake').addEventListener('click', svMakeTesters);
    $('svTestList').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tcopy]'); if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.tcopy); } catch (err) { window.prompt('Sao chép link:', b.dataset.tcopy); }
      b.textContent = 'Đã chép ✓'; setTimeout(() => { b.textContent = 'Sao chép'; }, 1500);
    });
    $('svRefresh').addEventListener('click', fillSurvey);
    $('svCsv').addEventListener('click', svCsv);
    $('svGoEmails').addEventListener('click', () => { showTab('emails'); });
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
      const code = $('utmShortCode').value.trim();
      const l = await api('/api/admin/short-links', { method: 'POST', headers: JSON_HDR, body: JSON.stringify(code ? { url, code } : { url }) });
      $('utmShortResult').value = location.origin + l.path; $('utmShortEdit').value = l.code; shortFor = url; $('utmShortBox').hidden = false;
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
    ['utmChannel', 'utmCampaign', 'utmContent'].forEach((id) => $(id).addEventListener('input', buildLink));
    $('utmCopy').addEventListener('click', async () => {
      const v = $('utmResult').value; if (!v) return;
      try { await navigator.clipboard.writeText(v); } catch (e) { $('utmResult').select(); document.execCommand('copy'); }
      $('utmCopied').hidden = false; setTimeout(() => { $('utmCopied').hidden = true; }, 1800);
    });
    $('utmShorten').addEventListener('click', shorten);
    $('rgSave').addEventListener('click', saveReg);
    svInitListeners();
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
    $('utmShortRename').addEventListener('click', async () => {
      const current = ($('utmShortResult').value.split('/s/')[1] || '');
      const want = $('utmShortEdit').value.trim().toLowerCase();
      if (!want || want === current) { shortErr(''); return; }
      shortErr('');
      try {
        const l = await api('/api/admin/short-links/' + encodeURIComponent(current), { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify({ code: want }) });
        $('utmShortResult').value = location.origin + l.path; $('utmShortEdit').value = l.code; loadShortList();
      } catch (err) { shortErr(err.message); }
    });
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
