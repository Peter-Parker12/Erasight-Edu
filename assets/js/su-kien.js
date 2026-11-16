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
      $('evDoneTitle').textContent = data.duplicate ? 'Bạn đã đăng ký rồi' : 'Đăng ký thành công!';
      $('evDoneText').textContent = data.duplicate
        ? 'Chúng tôi đã có thông tin của bạn cho sự kiện này. Giáo vụ sẽ liên hệ qua Zalo/email.'
        : 'Giáo vụ sẽ liên hệ xác nhận và gửi thông tin tham dự qua Zalo/email trong vòng 2 giờ làm việc.';
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
