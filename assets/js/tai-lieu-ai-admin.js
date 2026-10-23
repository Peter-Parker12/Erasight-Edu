/**
 * ERASIGHT ACADEMY — QUẢN TRỊ TÀI LIỆU AI (/tai-lieu-ai-admin)
 * Đăng nhập bằng ADMIN_PASSWORD, tải tài liệu (PDF/Word + ảnh bìa), sửa thông tin, thay file, xoá.
 * File được gửi dạng raw body (PUT ?ext=...) để server ghi thẳng ra đĩa, không cần thư viện multipart.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const HEADERS = { 'X-Requested-With': 'erasight-admin' };
  const DOC_EXT = ['pdf', 'doc', 'docx'];
  const COVER_EXT = ['png', 'jpg', 'jpeg', 'webp'];
  const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

  async function api(method, url, body) {
    const opts = { method, headers: { ...HEADERS }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error('Phiên đăng nhập đã hết hạn.'); }
    if (!res.ok) throw new Error(data.error || 'Lỗi ' + res.status);
    return data;
  }

  // Gửi file bằng XHR để có thanh tiến trình
  function uploadFile(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('X-Requested-With', 'erasight-admin');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status === 401) { showLogin(); return reject(new Error('Phiên đăng nhập đã hết hạn.')); }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const msgs = { 413: 'File quá lớn.', 400: data.error === 'Unsupported file type' ? 'Định dạng không được hỗ trợ.' : 'File không đúng định dạng (nội dung không khớp phần mở rộng).' };
        reject(new Error(msgs[xhr.status] || data.error || 'Lỗi ' + xhr.status));
      };
      xhr.onerror = () => reject(new Error('Mất kết nối khi tải lên (file có thể quá lớn).'));
      xhr.send(file);
    });
  }

  function msg(el, text, kind) {
    el.textContent = text;
    el.className = 'adm-msg ' + (kind || '');
    el.hidden = !text;
  }

  // ---------- Hiển thị các khu vực ----------
  function showLogin() {
    $('admLoginBox').hidden = false; $('admPanel').hidden = true; $('admLogout').hidden = true; $('admDisabled').hidden = true;
  }
  function showPanel() {
    $('admLoginBox').hidden = true; $('admPanel').hidden = false; $('admLogout').hidden = false; $('admDisabled').hidden = true;
    loadList();
  }

  async function init() {
    try {
      const res = await fetch('/api/admin/session', { credentials: 'same-origin' });
      if (res.status === 503) { $('admDisabled').hidden = false; return; }
      const data = await res.json();
      data.admin ? showPanel() : showLogin();
    } catch (e) {
      showLogin();
    }
  }

  // ---------- Đăng nhập / đăng xuất ----------
  $('admLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('admLoginMsg');
    msg(m, '');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('admPassword').value })
      });
      if (res.status === 429) throw new Error('Thử quá nhiều lần, vui lòng đợi 1 phút.');
      if (!res.ok) throw new Error('Mật khẩu không đúng.');
      $('admPassword').value = '';
      showPanel();
    } catch (err) {
      msg(m, err.message, 'err');
    }
  });

  $('admLogout').addEventListener('click', async () => {
    try { await api('POST', '/api/admin/logout', {}); } catch (e) { /* ignore */ }
    showLogin();
  });

  // ---------- Danh sách ----------
  let docs = [];

  async function loadList() {
    try {
      docs = (await api('GET', '/api/admin/documents')).documents;
      renderList();
    } catch (err) {
      $('admList').innerHTML = `<div class="adm-empty">${esc(err.message)}</div>`;
    }
  }

  function rowHtml(d) {
    const ready = d.hasFile && d.hasCover;
    const thumb = d.hasCover
      ? `<img class="adm-thumb" src="${esc(d.coverUrl)}" alt="" />`
      : '<div class="adm-thumb none">Chưa có ảnh bìa</div>';
    return `
      <div class="adm-row" data-id="${esc(d.id)}">
        ${thumb}
        <div class="adm-fields">
          <input type="text" class="f-title" value="${esc(d.title)}" maxlength="150" aria-label="Tên tài liệu" />
          <input type="number" class="f-views" value="${esc(d.views)}" min="0" step="1" aria-label="Lượt xem" />
          <textarea class="f-desc" maxlength="400" aria-label="Mô tả ngắn">${esc(d.description)}</textarea>
          <div class="adm-meta">
            <span class="adm-badge ${ready ? '' : 'draft'}">${ready ? esc(String(d.type).toUpperCase()) : 'NHÁP'}</span>
            <span>${ready ? 'Đang hiển thị' : 'Thiếu ' + [!d.hasFile && 'file', !d.hasCover && 'ảnh bìa'].filter(Boolean).join(' + ') + ' — chưa hiển thị trên trang'}</span>
            <div class="adm-actions">
              <button type="button" class="adm-btn primary" data-act="save">Lưu</button>
              <button type="button" class="adm-btn" data-act="file">${d.hasFile ? 'Đổi file' : 'Thêm file'}</button>
              <button type="button" class="adm-btn" data-act="cover">${d.hasCover ? 'Đổi ảnh bìa' : 'Thêm ảnh bìa'}</button>
              <button type="button" class="adm-btn danger" data-act="delete">Xoá</button>
            </div>
          </div>
          <div class="adm-msg" hidden></div>
        </div>
      </div>`;
  }

  function renderList() {
    $('admCount').textContent = docs.length ? `(${docs.length})` : '';
    $('admList').innerHTML = docs.length
      ? docs.map(rowHtml).join('')
      : '<div class="adm-empty">Chưa có tài liệu nào. Hãy tải tài liệu đầu tiên ở phía trên.</div>';
  }

  // Thay file / ảnh bìa: dùng một <input type=file> ẩn dùng chung
  let replaceCtx = null;
  $('admReplaceInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !replaceCtx) return;
    const { id, kind, row } = replaceCtx;
    replaceCtx = null;
    const m = row.querySelector('.adm-msg');
    const ext = extOf(file.name);
    if (!(kind === 'file' ? DOC_EXT : COVER_EXT).includes(ext)) return msg(m, kind === 'file' ? 'Chỉ nhận PDF, DOC, DOCX.' : 'Chỉ nhận PNG, JPG, WebP.', 'err');
    msg(m, 'Đang tải lên...', 'ok');
    try {
      await uploadFile(`/api/admin/documents/${id}/${kind}?ext=${ext}`, file);
      await loadList();
    } catch (err) {
      msg(m, err.message, 'err');
    }
  });

  $('admList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.adm-row');
    const id = row.dataset.id;
    const m = row.querySelector('.adm-msg');
    const act = btn.dataset.act;

    if (act === 'file' || act === 'cover') {
      const input = $('admReplaceInput');
      input.accept = act === 'file' ? '.pdf,.doc,.docx' : 'image/png,image/jpeg,image/webp';
      replaceCtx = { id, kind: act, row };
      return input.click();
    }
    if (act === 'delete') {
      const title = row.querySelector('.f-title').value;
      if (!confirm(`Xoá tài liệu "${title}"? File và ảnh bìa sẽ bị xoá vĩnh viễn.`)) return;
      btn.disabled = true;
      try { await api('DELETE', `/api/admin/documents/${id}`); await loadList(); } catch (err) { btn.disabled = false; msg(m, err.message, 'err'); }
      return;
    }
    if (act === 'save') {
      btn.disabled = true;
      try {
        await api('PATCH', `/api/admin/documents/${id}`, {
          title: row.querySelector('.f-title').value,
          description: row.querySelector('.f-desc').value,
          views: row.querySelector('.f-views').value
        });
        msg(m, 'Đã lưu.', 'ok');
        setTimeout(() => { m.hidden = true; }, 2200);
      } catch (err) {
        msg(m, err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    }
  });

  // ---------- Tải tài liệu mới ----------
  $('admUploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('upMsg');
    const bar = $('upProgress');
    const title = $('upTitle').value.trim();
    const file = $('upFile').files[0];
    const cover = $('upCover').files[0];
    const fileExt = file && extOf(file.name);
    const coverExt = cover && extOf(cover.name);

    if (!title) return msg(m, 'Vui lòng nhập tên tài liệu.', 'err');
    if (!file || !DOC_EXT.includes(fileExt)) return msg(m, 'Vui lòng chọn file PDF hoặc Word (.pdf, .doc, .docx).', 'err');
    if (!cover || !COVER_EXT.includes(coverExt)) return msg(m, 'Vui lòng chọn ảnh bìa (PNG, JPG hoặc WebP).', 'err');

    const submit = $('upSubmit');
    submit.disabled = true;
    bar.hidden = false;
    const setBar = (p) => { bar.firstElementChild.style.width = Math.round(p * 100) + '%'; };
    setBar(0);
    let created = null;

    try {
      msg(m, 'Đang tạo tài liệu...', 'ok');
      const body = { title, description: $('upDesc').value };
      if ($('upViews').value.trim() !== '') body.views = $('upViews').value.trim();
      created = (await api('POST', '/api/admin/documents', body)).document;

      msg(m, 'Đang tải file tài liệu...', 'ok');
      await uploadFile(`/api/admin/documents/${created.id}/file?ext=${fileExt}`, file, (p) => setBar(p * 0.85));
      msg(m, 'Đang tải ảnh bìa...', 'ok');
      await uploadFile(`/api/admin/documents/${created.id}/cover?ext=${coverExt === 'jpeg' ? 'jpg' : coverExt}`, cover, (p) => setBar(0.85 + p * 0.15));

      msg(m, `Đã tải lên "${title}". Tài liệu đã hiển thị trên trang.`, 'ok');
      $('admUploadForm').reset();
      await loadList();
    } catch (err) {
      msg(m, err.message + (created ? ' Tài liệu đã được lưu ở dạng NHÁP — bạn có thể thêm file/ảnh bìa trong danh sách bên dưới.' : ''), 'err');
      if (created) await loadList();
    } finally {
      submit.disabled = false;
      setTimeout(() => { bar.hidden = true; }, 600);
    }
  });

  init();
})();
