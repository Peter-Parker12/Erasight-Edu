/**
 * ERASIGHT — EVENT DETAIL: registration popup
 * The page itself is rendered by the server (events.js); this only handles the "Đăng ký tham dự" popup.
 * The visitor's campaign tags (UTM) are attached only if they accepted measurement cookies (tracking.js).
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const btn = $('evRegBtn');
  const modal = $('evModal');
  if (!modal) return;

  const form = $('evForm');
  let eventId = null;
  let lastFocus = null;

  function open() {
    if (!btn) return;
    eventId = btn.dataset.eventId;
    $('evTitle').textContent = btn.dataset.eventTitle || '';
    const seats = btn.dataset.seats ? ` · Còn ${btn.dataset.seats} chỗ` : '';
    $('evWhen').textContent = (btn.dataset.eventWhen || '') + seats;
    $('evError').hidden = true;
    $('evFormView').hidden = false;
    $('evDoneView').hidden = true;
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('evName').focus(), 60);
  }

  function close() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function showError(msg) { const el = $('evError'); el.textContent = msg; el.hidden = false; }

  // Popup shown right after a successful registration when the admin set up a Zalo group (QR and/or link).
  function showZalo(z) {
    const wrap = document.createElement('div');
    wrap.className = 'doc-modal is-open'; wrap.id = 'zaloModal';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', 'zaloTitle');
    const box = document.createElement('div'); box.className = 'dl-box'; box.style.textAlign = 'center';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'doc-modal-close'; x.setAttribute('aria-label', 'Đóng'); x.textContent = '×';
    const h = document.createElement('h3'); h.id = 'zaloTitle'; h.style.margin = '6px 0 8px'; h.textContent = z.title || 'Tham gia nhóm Zalo';
    box.append(x, h);
    if (z.text) { const p = document.createElement('p'); p.className = 'dl-sub'; p.textContent = z.text; box.append(p); }
    if (z.image) {
      const img = document.createElement('img'); img.src = z.image; img.alt = 'Mã QR nhóm Zalo'; img.width = 220; img.height = 220;
      img.style.cssText = 'display:block;margin:10px auto;max-width:100%;height:auto;border-radius:8px;'; box.append(img);
    }
    if (z.link) {
      const a = document.createElement('a'); a.href = z.link; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'btn btn-primary'; a.style.marginTop = '8px'; a.textContent = 'Mở nhóm Zalo'; box.append(a);
    }
    wrap.append(box); document.body.append(wrap);
    document.body.style.overflow = 'hidden';
    const done = () => { wrap.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    x.addEventListener('click', done);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => x.focus(), 60);
  }

  if (btn) btn.addEventListener('click', open);
  $('evClose').addEventListener('click', close);
  $('evDoneClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('is-open')) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('evName').value.trim();
    const phone = $('evPhone').value.trim();
    const email = $('evEmail').value.trim();
    if (!name) return showError('Vui lòng nhập họ và tên.');
    if (!/^\+?[\d\s().-]{8,18}$/.test(phone)) return showError('Số điện thoại chưa đúng (8–18 chữ số).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Email chưa đúng định dạng.');

    const submit = $('evSubmit');
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Đang gửi...';
    $('evError').hidden = true;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, website: $('evWebsite').value, utm: window.ErasightTracking ? window.ErasightTracking.utm() : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error('Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút.');
      if (res.status === 409) throw new Error(data.error || 'Sự kiện hiện không nhận thêm đăng ký.');
      if (!res.ok) throw new Error('Thông tin chưa hợp lệ hoặc có lỗi hệ thống. Vui lòng kiểm tra lại và thử lần nữa.');
      form.reset();
      if (!data.duplicate && window.ErasightTracking) window.ErasightTracking.track('generate_lead', { lead_type: 'event_registration', item_id: eventId });
      $('evDoneTitle').textContent = data.duplicate ? 'Bạn đã đăng ký rồi' : 'Đăng ký thành công!';
      $('evDoneText').textContent = data.duplicate
        ? 'Chúng tôi đã có thông tin của bạn cho sự kiện này. Giáo vụ sẽ liên hệ qua Zalo/email.'
        : (data.emailSoon ? `Email xác nhận đã được đăng ký gửi tới ${email} trong vài phút tới. ` : '') + 'Giáo vụ sẽ liên hệ xác nhận và gửi thông tin tham dự qua Zalo/email trong vòng 2 giờ làm việc.';
      if (data.zalo && !data.duplicate) { close(); showZalo(data.zalo); return; } // the Zalo popup replaces the success text
      $('evFormView').hidden = true;
      $('evDoneView').hidden = false;
    } catch (err) {
      showError(err.message);
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
})();
