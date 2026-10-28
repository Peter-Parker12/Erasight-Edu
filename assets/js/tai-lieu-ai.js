/**
 * ERASIGHT ACADEMY — THƯ VIỆN TÀI LIỆU AI
 * Danh sách tài liệu lấy từ API (/api/documents), do admin tải lên tại /tai-lieu-ai-admin.
 * Bấm vào tài liệu -> (lần đầu) popup điền họ tên / email / SĐT -> tải về.
 * Sau khi điền form, trình duyệt giữ "token truy cập" 7 ngày: tải các tài liệu khác không cần điền lại.
 */
(function () {
  'use strict';

  const FILE_TYPES = [
    { id: 'pdf', label: 'PDF', cls: 'pdf' },
    { id: 'word', label: 'Word', cls: 'docx' },
    { id: 'excel', label: 'Excel / CSV', cls: 'xlsx' },
    { id: 'link', label: 'Link online', cls: 'link' }
  ];
  const typeGroup = (t) => {
    if (t === 'pdf') return 'pdf';
    if (t === 'doc' || t === 'docx') return 'word';
    if (t === 'xls' || t === 'xlsx' || t === 'csv') return 'excel';
    return 'link';
  };
  const typeLabel = (t) => ({
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOCX',
    xls: 'XLS',
    xlsx: 'XLSX',
    csv: 'CSV',
    link: 'LINK'
  }[t] || String(t || 'FILE').toUpperCase());

  const state = {
    docs: [],
    loaded: false,
    failed: false,
    search: '',
    types: new Set(),
    sort: 'newest',
    view: 'grid',
    visibleCount: 9,
    hasAccess: false,
    pendingDocId: null
  };

  // ---------- Tiện ích ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const fmtViews = (n) => Number(n || 0).toLocaleString('vi-VN');
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const $ = (id) => document.getElementById(id);

  function showToast(message) {
    const toast = $('resToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('is-show'), 3600);
  }

  // ---------- Dữ liệu ----------
  async function loadDocuments() {
    try {
      const [docsRes, accessRes] = await Promise.all([
        fetch('/api/documents', { cache: 'no-store' }),
        fetch('/api/documents/access', { cache: 'no-store', credentials: 'same-origin' }).catch(() => null)
      ]);
      if (!docsRes.ok) throw new Error('HTTP ' + docsRes.status);
      state.docs = (await docsRes.json()).documents || [];
      state.hasAccess = !!(accessRes && accessRes.ok && (await accessRes.json()).valid);
      state.failed = false;
    } catch (err) {
      console.warn('Không tải được danh sách tài liệu:', err.message);
      state.docs = [];
      state.failed = true;
    }
    state.loaded = true;
    render();
  }

  function getFilteredDocuments() {
    const q = state.search;
    const list = state.docs.filter((d) => {
      if (q && !(`${d.title} ${d.description}`.toLowerCase().includes(q))) return false;
      if (state.types.size > 0 && !state.types.has(typeGroup(d.type))) return false;
      return true;
    });
    return list.sort((a, b) => {
      if (state.sort === 'popular') return b.views - a.views;
      if (state.sort === 'az') return a.title.localeCompare(b.title, 'vi');
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  // ---------- Hiển thị ----------
  function renderTypeFilters() {
    const box = $('libTypes');
    if (!box) return;
    box.innerHTML = FILE_TYPES.map((t) => `
      <label class="lib-type-chip">
        <input type="checkbox" value="${t.id}" />
        <span class="dot"></span>
        <span>${t.label}</span>
      </label>`).join('');
    box.querySelectorAll('input').forEach((chk) => {
      chk.addEventListener('change', () => {
        if (chk.checked) state.types.add(chk.value); else state.types.delete(chk.value);
        state.visibleCount = 9;
        render();
      });
    });
  }

  function cardHtml(d) {
    const group = typeGroup(d.type);
    const cls = FILE_TYPES.find((t) => t.id === group)?.cls || (d.type === 'csv' ? 'csv' : 'pdf');
    const isLinkOnly = !d.size && d.link;
    const btnLabel = isLinkOnly ? 'Truy cập' : 'Tải về';
    const btnIcon = isLinkOnly ? '↗' : '↓';
    const sizeStr = d.size ? `· ${fmtSize(d.size)}` : (d.link ? '· Trực tuyến' : '');
    return `
      <article class="doc-card" data-id="${esc(d.id)}" tabindex="0" role="button" aria-label="${isLinkOnly ? 'Truy cập' : 'Tải về'}: ${esc(d.title)}">
        <div class="doc-cover has-img doc-type--${cls}">
          <img src="${esc(d.coverUrl)}" alt="" loading="lazy" onerror="this.remove()" />
          <span class="ext">${esc(typeLabel(d.type))}</span>
        </div>
        <div class="doc-body">
          <h3>${esc(d.title)}</h3>
          <p>${esc(d.description)}</p>
          <div class="doc-views" title="Lượt xem">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            <span class="doc-views-n">${fmtViews(d.views)}</span> lượt xem
            <span class="doc-size">${sizeStr}</span>
          </div>
          <div class="doc-actions">
            <span class="doc-btn doc-btn--primary"><span>${btnLabel}</span><span>${btnIcon}</span></span>
          </div>
        </div>
      </article>`;
  }

  function render() {
    const grid = $('libGrid');
    const resultEl = $('libResult');
    const moreBtn = $('libMoreBtn');
    if (!grid) return;
    if (!state.loaded) return;

    if (state.failed) {
      if (resultEl) resultEl.textContent = '';
      grid.innerHTML = `
        <div class="lib-empty">
          <div class="big">⚠️</div>
          <h3>Chưa tải được danh sách tài liệu</h3>
          <p>Vui lòng thử lại sau ít phút.</p>
          <button type="button" class="btn btn-ghost btn-sm" id="libRetryBtn">Thử lại</button>
        </div>`;
      const retry = $('libRetryBtn');
      if (retry) retry.addEventListener('click', loadDocuments);
      if (moreBtn) moreBtn.hidden = true;
      return;
    }

    const list = getFilteredDocuments();
    if (resultEl) resultEl.innerHTML = `Có <b>${list.length}</b> tài liệu`;

    if (state.docs.length === 0) {
      grid.innerHTML = `
        <div class="lib-empty">
          <div class="big">📚</div>
          <h3>Thư viện đang được cập nhật</h3>
          <p>Tài liệu mới sẽ sớm có mặt tại đây. Quay lại sau nhé!</p>
        </div>`;
      if (moreBtn) moreBtn.hidden = true;
      return;
    }
    if (list.length === 0) {
      grid.innerHTML = `
        <div class="lib-empty">
          <div class="big">🔍</div>
          <h3>Không tìm thấy tài liệu phù hợp</h3>
          <p>Thử tìm với từ khoá khác hoặc bỏ bớt bộ lọc đang chọn.</p>
          <button type="button" class="btn btn-ghost btn-sm" id="libResetBtn">Đặt lại bộ lọc</button>
        </div>`;
      const reset = $('libResetBtn');
      if (reset) reset.addEventListener('click', resetFilters);
      if (moreBtn) moreBtn.hidden = true;
      return;
    }

    grid.innerHTML = list.slice(0, state.visibleCount).map(cardHtml).join('');
    if (moreBtn) {
      moreBtn.hidden = list.length <= state.visibleCount;
      moreBtn.onclick = () => { state.visibleCount += 9; render(); };
    }
  }

  function resetFilters() {
    state.search = '';
    state.types.clear();
    state.sort = 'newest';
    const input = $('libSearchInput');
    if (input) input.value = '';
    const sort = $('libSort');
    if (sort) sort.value = 'newest';
    document.querySelectorAll('#libTypes input').forEach((c) => { c.checked = false; });
    render();
  }

  // ---------- Bấm vào tài liệu ----------
  async function openDocument(id) {
    const doc = state.docs.find((d) => d.id === id);
    if (!doc) return;

    // +1 lượt xem cho mỗi lần bấm (server chặn bấm lặp lại từ cùng một người trong 30 phút)
    fetch(`/api/documents/${encodeURIComponent(id)}/view`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || typeof data.views !== 'number') return;
        doc.views = data.views;
        const el = document.querySelector(`.doc-card[data-id="${CSS.escape(id)}"] .doc-views-n`);
        if (el) el.textContent = fmtViews(doc.views);
        const scViews = $('scViews');
        if (scViews && activeShowcaseDoc && activeShowcaseDoc.id === id) {
          scViews.textContent = fmtViews(doc.views);
        }
      })
      .catch(() => {});

    // Token 7 ngày còn hạn -> kiểm tra lại với server phòng khi vừa hết hạn.
    if (state.hasAccess) {
      try {
        const r = await fetch('/api/documents/access', { cache: 'no-store', credentials: 'same-origin' });
        state.hasAccess = r.ok && (await r.json()).valid === true;
      } catch (e) { /* giữ trạng thái cũ */ }
    }

    // Nếu đã ghi danh (có access token) -> mở popup showcase thông tin tài liệu
    if (state.hasAccess) {
      return openShowcaseModal(doc);
    }
    openModal(doc);
  }

  function startDownload(doc) {
    if (!doc.size && doc.link) {
      window.open(doc.link, '_blank', 'noopener,noreferrer');
      showToast('Đang mở liên kết: ' + doc.title);
      return;
    }
    const a = document.createElement('a');
    a.href = `/api/documents/${encodeURIComponent(doc.id)}/download`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Đang tải: ' + doc.title);
  }

  // ---------- Popup Showcase thông tin tài liệu (khi đã ghi danh) ----------
  let activeShowcaseDoc = null;

  function openShowcaseModal(doc) {
    activeShowcaseDoc = doc;
    const modal = $('showcaseModal');
    if (!modal) return startDownload(doc);

    const group = typeGroup(doc.type);
    const cls = FILE_TYPES.find((t) => t.id === group)?.cls || (doc.type === 'csv' ? 'csv' : 'pdf');
    const cover = $('scCover');
    if (cover) cover.className = `doc-cover has-img doc-type--${cls}`;

    const img = $('scImg');
    if (img) {
      img.src = doc.coverUrl;
      img.alt = doc.title;
      img.style.display = '';
      img.onerror = () => { img.style.display = 'none'; };
    }

    const ext = $('scExt');
    if (ext) ext.textContent = typeLabel(doc.type);

    const title = $('scTitle');
    if (title) title.textContent = doc.title;

    const desc = $('scDesc');
    if (desc) desc.textContent = doc.description || 'Chưa có thông tin mô tả chi tiết cho tài liệu này.';

    const type = $('scType');
    if (type) {
      if (doc.type === 'link') type.textContent = 'Link trực tuyến';
      else type.textContent = typeLabel(doc.type);
    }

    const size = $('scSize');
    if (size) {
      if (doc.size > 0 && doc.link) size.textContent = `${fmtSize(doc.size)} + Link`;
      else if (doc.size > 0) size.textContent = fmtSize(doc.size);
      else if (doc.link) size.textContent = 'Trực tuyến';
      else size.textContent = '0 KB';
    }

    const views = $('scViews');
    if (views) views.textContent = fmtViews(doc.views);

    const date = $('scDate');
    if (date) {
      if (doc.createdAt) {
        const dt = new Date(doc.createdAt);
        date.textContent = isNaN(dt.getTime()) ? 'Mới cập nhật' : dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
      } else {
        date.textContent = 'Mới cập nhật';
      }
    }

    const isLinkOnly = !doc.size && doc.link;
    const hasBoth = doc.size > 0 && doc.link;

    const btn = $('scDownloadBtn');
    if (btn) {
      if (isLinkOnly) {
        btn.innerHTML = `<span>Mở liên kết ngay</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
      } else {
        btn.innerHTML = `<span>Tải tài liệu ngay</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
      }
      btn.onclick = () => {
        startDownload(doc);
      };
    }

    const linkBtn = $('scLinkBtn');
    if (linkBtn) {
      if (hasBoth) {
        linkBtn.href = doc.link;
        linkBtn.hidden = false;
        linkBtn.style.display = 'inline-flex';
      } else {
        linkBtn.hidden = true;
        linkBtn.style.display = 'none';
      }
    }

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeShowcaseModal() {
    const modal = $('showcaseModal');
    if (modal) modal.classList.remove('is-open');
    document.body.style.overflow = '';
    activeShowcaseDoc = null;
  }

  // ---------- Popup điền thông tin ----------
  function openModal(doc) {
    state.pendingDocId = doc.id;
    $('dlTitle').textContent = doc.title;
    $('dlError').hidden = true;
    $('dlModal').classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('dlName').focus(), 60);
  }

  function closeModal() {
    $('dlModal').classList.remove('is-open');
    document.body.style.overflow = '';
    state.pendingDocId = null;
  }

  function showError(msg) {
    const el = $('dlError');
    el.textContent = msg;
    el.hidden = false;
  }

  function initModal() {
    const dlModal = $('dlModal');
    if (dlModal) {
      const dlClose = $('dlClose');
      if (dlClose) dlClose.addEventListener('click', closeModal);
      dlModal.addEventListener('click', (e) => { if (e.target === dlModal) closeModal(); });
    }

    const scModal = $('showcaseModal');
    if (scModal) {
      const scClose = $('scClose');
      if (scClose) scClose.addEventListener('click', closeShowcaseModal);
      const scCloseBtn = $('scCloseBtn');
      if (scCloseBtn) scCloseBtn.addEventListener('click', closeShowcaseModal);
      scModal.addEventListener('click', (e) => { if (e.target === scModal) closeShowcaseModal(); });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dlModal && dlModal.classList.contains('is-open')) closeModal();
        if (scModal && scModal.classList.contains('is-open')) closeShowcaseModal();
      }
    });

    $('dlForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('dlName').value.trim();
      const email = $('dlEmail').value.trim();
      const phone = $('dlPhone').value.trim();
      if (!name) return showError('Vui lòng nhập họ và tên.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Email chưa đúng định dạng.');
      if (!/^\+?[\d\s().-]{8,18}$/.test(phone)) return showError('Số điện thoại chưa đúng (8–18 chữ số).');

      const doc = state.docs.find((d) => d.id === state.pendingDocId);
      if (!doc) return closeModal();
      const btn = $('dlSubmit');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Đang xử lý...';
      $('dlError').hidden = true;

      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/request`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, website: $('dlWebsite').value })
        });
        if (res.status === 429) throw new Error('Bạn thao tác hơi nhanh, vui lòng thử lại sau ít phút.');
        if (!res.ok) throw new Error('Thông tin chưa hợp lệ hoặc có lỗi hệ thống. Vui lòng kiểm tra lại và thử lần nữa.');
        const data = await res.json();
        state.hasAccess = !!data.downloadUrl; // honeypot trả về ok nhưng không có downloadUrl
        $('dlForm').reset();
        closeModal();
        if (state.hasAccess) {
          startDownload(doc);
          showToast('Cảm ơn bạn! Bạn có thể tải thêm các tài liệu khác trong 7 ngày.');
        }
      } catch (err) {
        showError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

  // ---------- Tìm kiếm, sắp xếp, chế độ xem ----------
  function initToolbar() {
    const input = $('libSearchInput');
    const form = $('libSearchForm');
    if (input) {
      input.addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); state.visibleCount = 9; render(); });
      document.addEventListener('keydown', (e) => {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) { e.preventDefault(); input.focus(); }
      });
    }
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); render(); });

    document.querySelectorAll('#libPopular .lib-tag').forEach((tag) => {
      tag.addEventListener('click', () => {
        if (!input) return;
        input.value = tag.dataset.q;
        state.search = tag.dataset.q.toLowerCase();
        state.visibleCount = 9;
        render();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    const sort = $('libSort');
    if (sort) sort.addEventListener('change', (e) => { state.sort = e.target.value; render(); });

    const gridBtn = $('viewGridBtn');
    const listBtn = $('viewListBtn');
    const grid = $('libGrid');
    if (gridBtn && listBtn && grid) {
      gridBtn.addEventListener('click', () => { gridBtn.classList.add('is-active'); listBtn.classList.remove('is-active'); grid.classList.remove('is-list'); state.view = 'grid'; });
      listBtn.addEventListener('click', () => { listBtn.classList.add('is-active'); gridBtn.classList.remove('is-active'); grid.classList.add('is-list'); state.view = 'list'; });
    }

    // Bấm cả thẻ tài liệu (hoặc Enter / Space khi đang focus) để tải
    if (grid) {
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.doc-card');
        if (card) openDocument(card.dataset.id);
      });
      grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.doc-card');
        if (card) { e.preventDefault(); openDocument(card.dataset.id); }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderTypeFilters();
    initToolbar();
    initModal();
    loadDocuments();
  });

  window.ErasightLibrary = { reload: loadDocuments, resetFilters, openShowcaseModal, state };
})();
