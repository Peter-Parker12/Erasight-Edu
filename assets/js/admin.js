/**
 * ERASIGHT ACADEMY — ADMIN CRM CONSOLE
 * Bố cục Split 8 - 2 (Sidebar Trái + CRM Dashboard Phải)
 * Quản trị 2 phân hệ:
 * 1. Thư viện Tài liệu AI (Tệp, Link online, Bìa, Duyệt xuất bản)
 * 2. Sản phẩm Học viên (Video demo, Ảnh đồ án, Avatar học viên thật)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  let currentTab = 'doc';
  let docs = [];
  let showcases = [];

  // =========================================================================
  // XÁC THỰC ADMIN & CHUYỂN TAB
  // =========================================================================
  async function checkSession() {
    try {
      const res = await fetch('/api/admin/session', { cache: 'no-store' });
      if (res.status === 503) {
        if ($('admDisabled')) $('admDisabled').hidden = false;
        if ($('admLoginBox')) $('admLoginBox').hidden = true;
        if ($('admMainPanes')) $('admMainPanes').hidden = true;
        return;
      }
      const data = await res.json();
      if (data.admin) {
        showAdmin();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  function showLogin() {
    if ($('admLoginBox')) $('admLoginBox').hidden = false;
    if ($('admMainPanes')) $('admMainPanes').hidden = true;
    if ($('admPassword')) $('admPassword').focus();
  }

  function showAdmin() {
    if ($('admLoginBox')) $('admLoginBox').hidden = true;
    if ($('admMainPanes')) $('admMainPanes').hidden = false;
    loadDocs();
    loadShowcases();
  }

  function initTabs() {
    const tabDocBtn = $('tabDocBtn');
    const tabShowcaseBtn = $('tabShowcaseBtn');
    const paneDoc = $('paneDoc');
    const paneShowcase = $('paneShowcase');
    const viewLink = $('admViewPageLink');
    const titleEl = $('crmPaneTitle');
    const subEl = $('crmPaneSub');

    function switchTab(tab) {
      currentTab = tab;
      if (tab === 'doc') {
        tabDocBtn.classList.add('is-active');
        tabDocBtn.setAttribute('aria-selected', 'true');
        tabShowcaseBtn.classList.remove('is-active');
        tabShowcaseBtn.setAttribute('aria-selected', 'false');
        paneDoc.hidden = false;
        paneShowcase.hidden = true;
        if (titleEl) titleEl.textContent = 'Quản trị Thư viện Tài liệu AI';
        if (subEl) subEl.textContent = 'Upload file tài liệu, quản lý link trực tuyến và duyệt xuất bản tài liệu công khai.';
        if (viewLink) {
          viewLink.href = '/tai-lieu-ai';
          const span = viewLink.querySelector('span');
          if (span) span.textContent = 'Xem Thư viện AI';
        }
      } else {
        tabShowcaseBtn.classList.add('is-active');
        tabShowcaseBtn.setAttribute('aria-selected', 'true');
        tabDocBtn.classList.remove('is-active');
        tabDocBtn.setAttribute('aria-selected', 'false');
        paneDoc.hidden = true;
        paneShowcase.hidden = false;
        if (titleEl) titleEl.textContent = 'Quản trị Sản phẩm Học viên';
        if (subEl) subEl.textContent = 'Upload video đồ án, showcase hình ảnh và hồ sơ học viên thực chiến.';
        if (viewLink) {
          viewLink.href = '/san-pham-hoc-vien';
          const span = viewLink.querySelector('span');
          if (span) span.textContent = 'Xem Sản phẩm học viên';
        }
      }
    }

    if (tabDocBtn) tabDocBtn.addEventListener('click', () => switchTab('doc'));
    if (tabShowcaseBtn) tabShowcaseBtn.addEventListener('click', () => switchTab('showcase'));
  }

  function initLogin() {
    const loginForm = $('admLoginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = $('admPassword').value;
        const msg = $('admLoginMsg');
        msg.hidden = true;
        try {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Mật khẩu chưa đúng.');
          }
          $('admPassword').value = '';
          showAdmin();
        } catch (err) {
          msg.textContent = err.message;
          msg.hidden = false;
        }
      });
    }

    const logoutBtn = $('admLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await fetch('/api/admin/logout', { method: 'POST' });
        showLogin();
      });
    }
  }

  // =========================================================================
  // CẬP NHẬT CHỈ SỐ KPI & BADGES
  // =========================================================================
  function updateKpis() {
    // 1. Phân hệ Tài liệu
    if ($('sideDocCount')) $('sideDocCount').textContent = docs.length;
    if ($('admCount')) $('admCount').textContent = `${docs.length} tài liệu`;
    if ($('kpiDocTotal')) $('kpiDocTotal').textContent = docs.length;
    
    const pubDocs = docs.filter(d => d.status === 'published' || (d.hasCover && (d.hasFile || d.link)));
    if ($('kpiDocPub')) $('kpiDocPub').textContent = pubDocs.length;

    const totalViews = docs.reduce((acc, d) => acc + (Number(d.views) || 0), 0);
    if ($('kpiDocViews')) $('kpiDocViews').textContent = totalViews.toLocaleString('vi-VN');

    const linkDocs = docs.filter(d => !!d.link);
    if ($('kpiDocLinks')) $('kpiDocLinks').textContent = linkDocs.length;

    // 2. Phân hệ Sản phẩm Học viên
    if ($('sideShowcaseCount')) $('sideShowcaseCount').textContent = showcases.length;
    if ($('shcCount')) $('shcCount').textContent = `${showcases.length} sản phẩm`;
    if ($('kpiShcTotal')) $('kpiShcTotal').textContent = showcases.length;

    const videoShc = showcases.filter(s => s.mediaType === 'video');
    if ($('kpiShcVideo')) $('kpiShcVideo').textContent = videoShc.length;

    const imgShc = showcases.filter(s => s.mediaType === 'image');
    if ($('kpiShcImage')) $('kpiShcImage').textContent = imgShc.length;

    const uniqueStudents = new Set(showcases.map(s => (s.studentName || '').trim()).filter(Boolean));
    if ($('kpiShcStudents')) $('kpiShcStudents').textContent = uniqueStudents.size;
  }

  // =========================================================================
  // PHÂN HỆ 1: QUẢN LÝ TÀI LIỆU AI
  // =========================================================================
  const DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv'];

  async function loadDocs() {
    const listEl = $('admList');
    try {
      const res = await fetch('/api/admin/documents', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      docs = (await res.json()).documents || [];
      updateKpis();
      renderDocs();
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="adm-empty">Lỗi tải dữ liệu: ${esc(err.message)}</div>`;
    }
  }

  function renderDocs() {
    const listEl = $('admList');
    if (!listEl) return;
    if (docs.length === 0) {
      listEl.innerHTML = '<div class="adm-empty" style="text-align:center;padding:40px 20px;color:var(--crm-slate);font-size:13.5px;">Chưa có tài liệu nào. Tải tài liệu đầu tiên ở form bên trái.</div>';
      return;
    }
    listEl.innerHTML = docs.map(docRowHtml).join('');
  }

  function docRowHtml(d) {
    const thumb = d.hasCover
      ? `<img class="crm-row-thumb" src="${esc(d.coverUrl)}" alt="" />`
      : '<div class="crm-row-thumb" style="display:grid;place-items:center;font-size:11px;color:#8C9FA8;text-align:center;padding:4px;">Chưa có bìa</div>';
    
    const isPub = d.status === 'published' || (d.hasCover && (d.hasFile || d.link));
    const badgePub = isPub ? '<span class="crm-pill pub">Đã xuất bản</span>' : '<span class="crm-pill draft">Thiếu bìa/tệp</span>';
    const typeBadge = d.type ? `<span class="crm-pill" style="background:#0DA096;">${esc(String(d.type).toUpperCase())}</span>` : '';
    const linkBadge = d.link ? `<a class="crm-pill link" href="${esc(d.link)}" target="_blank" rel="noopener" style="text-decoration:none;">🔗 LINK ONLINE</a>` : '';

    return `
      <div class="crm-row" data-id="${esc(d.id)}">
        <div>
          ${thumb}
          <button type="button" class="crm-btn sm" data-act="cover" style="width:100%;margin-top:6px;font-size:11px;padding:4px 2px;">Đổi bìa</button>
        </div>
        <div class="crm-doc-fields">
          <div class="crm-row-header">
            ${badgePub}
            ${typeBadge}
            ${linkBadge}
            <span style="font-size:11.5px;color:var(--crm-slate);margin-left:auto;">
              ${d.hasFile ? `${d.type || 'file'} · ${Math.max(1, Math.round((d.size || 0)/1024))} KB` : (d.link ? 'Tài liệu trực tuyến' : 'Chưa có file')}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 110px;gap:8px;">
            <input type="text" class="crm-input-inline f-title" value="${esc(d.title)}" placeholder="Tên tài liệu..." title="Tên tài liệu" />
            <input type="number" class="crm-input-inline f-views" value="${Number(d.views) || 0}" min="0" placeholder="Lượt xem" title="Lượt xem" />
          </div>
          <input type="url" class="crm-input-inline f-link" value="${esc(d.link || '')}" placeholder="Link tài liệu trực tuyến (tuỳ chọn): https://..." />
          <textarea class="crm-textarea-inline f-desc" placeholder="Mô tả ngắn tài liệu...">${esc(d.description || '')}</textarea>
          <div class="crm-row-meta">
            <div class="crm-row-actions">
              <button type="button" class="crm-btn sm" data-act="file">Đổi tệp</button>
              <button type="button" class="crm-btn sm primary" data-act="save">Lưu sửa đổi</button>
            </div>
            <button type="button" class="crm-btn sm danger" data-act="del">Xoá</button>
          </div>
        </div>
      </div>`;
  }

  function initDocForm() {
    const uploadForm = $('admUploadForm');
    if (uploadForm) {
      uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('upTitle').value.trim();
        const desc = $('upDesc').value.trim();
        const fileInput = $('upFile');
        const linkInput = $('upLink');
        const coverInput = $('upCover');
        const viewsVal = $('upViews').value.trim();
        const msg = $('upMsg');
        const prog = $('upProgress');
        const btn = $('upSubmit');

        msg.hidden = true;
        msg.className = 'adm-msg';
        if (!title) return showDocMsg('Vui lòng nhập tên tài liệu.', true);
        const hasFile = fileInput.files && fileInput.files.length > 0;
        const hasLink = !!linkInput.value.trim();
        if (!hasFile && !hasLink) {
          return showDocMsg('Vui lòng chọn file tài liệu hoặc dán link truy cập tài liệu.', true);
        }
        if (!coverInput.files || !coverInput.files.length) {
          return showDocMsg('Vui lòng chọn ảnh bìa.', true);
        }

        btn.disabled = true;
        prog.hidden = false;
        prog.querySelector('i').style.width = '15%';

        try {
          const createRes = await fetch('/api/admin/documents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'erasight-admin' },
            body: JSON.stringify({
              title, description: desc, link: linkInput.value.trim() || undefined,
              views: viewsVal === '' ? undefined : Number(viewsVal)
            })
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            throw new Error(err.error || 'Không tạo được bản ghi tài liệu.');
          }
          const { document: newDoc } = await createRes.json();
          prog.querySelector('i').style.width = '45%';

          if (hasFile) {
            const file = fileInput.files[0];
            const ext = file.name.split('.').pop().toLowerCase();
            if (!DOC_EXT.includes(ext)) throw new Error('Định dạng tệp không được hỗ trợ: ' + ext);
            const putFile = await fetch(`/api/admin/documents/${newDoc.id}/file?ext=${encodeURIComponent(ext)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'erasight-admin' },
              body: file
            });
            if (!putFile.ok) {
              const err = await putFile.json().catch(() => ({}));
              throw new Error(err.error || 'Tải file tài liệu thất bại.');
            }
          }
          prog.querySelector('i').style.width = '80%';

          const cover = coverInput.files[0];
          const cExt = cover.name.split('.').pop().toLowerCase();
          const putCover = await fetch(`/api/admin/documents/${newDoc.id}/cover?ext=${encodeURIComponent(cExt)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'erasight-admin' },
            body: cover
          });
          if (!putCover.ok) {
            const err = await putCover.json().catch(() => ({}));
            throw new Error(err.error || 'Tải ảnh bìa thất bại.');
          }

          prog.querySelector('i').style.width = '100%';
          $('admUploadForm').reset();
          showDocMsg(`Đã tải lên "${title}". Tài liệu đã sẵn sàng trên trang thư viện.`);
          loadDocs();
        } catch (err) {
          showDocMsg(err.message, true);
        } finally {
          btn.disabled = false;
          setTimeout(() => { prog.hidden = true; prog.querySelector('i').style.width = '0'; }, 600);
        }
      });
    }

    const admListEl = $('admList');
    if (admListEl) {
      admListEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const row = btn.closest('.crm-row');
        if (!row) return;
        const id = row.dataset.id;
        const act = btn.dataset.act;

        if (act === 'del') {
          if (!confirm('Bạn có chắc muốn xoá tài liệu này? Thao tác không thể hoàn tác.')) return;
          btn.disabled = true;
          try {
            const r = await fetch(`/api/admin/documents/${id}`, {
              method: 'DELETE',
              headers: { 'X-Requested-With': 'erasight-admin' }
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            loadDocs();
          } catch (err) {
            alert('Không xoá được: ' + err.message);
            btn.disabled = false;
          }
        }

        if (act === 'save') {
          const title = row.querySelector('.f-title').value.trim();
          const link = row.querySelector('.f-link').value.trim();
          const desc = row.querySelector('.f-desc').value.trim();
          const views = row.querySelector('.f-views').value.trim();
          if (!title) return alert('Tên tài liệu không được để trống.');
          btn.disabled = true;
          try {
            const r = await fetch(`/api/admin/documents/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'erasight-admin' },
              body: JSON.stringify({ title, link, description: desc, views: Number(views) || 0 })
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            loadDocs();
          } catch (err) {
            alert('Không lưu được: ' + err.message);
            btn.disabled = false;
          }
        }

        if (act === 'cover' || act === 'file') {
          const input = $('admReplaceInput');
          input.value = '';
          input.accept = act === 'cover' ? 'image/png,image/jpeg,image/webp' : '.pdf,.doc,.docx,.xls,.xlsx,.csv';
          input.onchange = async () => {
            if (!input.files || !input.files.length) return;
            const file = input.files[0];
            const ext = file.name.split('.').pop().toLowerCase();
            btn.disabled = true;
            try {
              const r = await fetch(`/api/admin/documents/${id}/${act}?ext=${encodeURIComponent(ext)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'erasight-admin' },
                body: file
              });
              if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || 'Cập nhật tệp thất bại.');
              }
              loadDocs();
            } catch (err) {
              alert(err.message);
              btn.disabled = false;
            }
          };
          input.click();
        }
      });
    }
  }

  function showDocMsg(text, isErr = false) {
    const el = $('upMsg');
    if (!el) return;
    el.hidden = false;
    el.className = 'adm-msg ' + (isErr ? 'err' : 'ok');
    el.textContent = text;
  }

  // =========================================================================
  // PHÂN HỆ 2: QUẢN LÝ SẢN PHẨM HỌC VIÊN
  // =========================================================================
  async function loadShowcases() {
    const listEl = $('shcList');
    try {
      const res = await fetch('/api/admin/showcases', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showcases = (await res.json()).showcases || [];
      updateKpis();
      renderShowcases();
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="adm-empty">Lỗi tải dữ liệu: ${esc(err.message)}</div>`;
    }
  }

  function renderShowcases() {
    const listEl = $('shcList');
    if (!listEl) return;
    if (showcases.length === 0) {
      listEl.innerHTML = '<div class="adm-empty" style="text-align:center;padding:40px 20px;color:var(--crm-slate);font-size:13.5px;">Chưa có sản phẩm học viên nào. Hãy thêm sản phẩm ở form bên trái.</div>';
      return;
    }
    listEl.innerHTML = showcases.map(showcaseRowHtml).join('');
  }

  function showcaseRowHtml(s) {
    const thumbUrl = s.posterUrl || (s.mediaType === 'image' ? s.mediaUrl : null);
    const thumbImg = thumbUrl
      ? `<img class="crm-row-thumb" src="${esc(thumbUrl)}" alt="" onerror="this.src='assets/images/project_ats_resume.png'" />`
      : '<div class="crm-row-thumb" style="display:grid;place-items:center;color:#8C9FA8;font-size:11px;">Chưa có ảnh</div>';

    const avatarHtml = s.avatarUrl
      ? `<img class="shc-avatar-img" src="${esc(s.avatarUrl)}" alt="${esc(s.studentName)}" />`
      : `<span class="shc-avatar-draft">${esc(s.avatarDraft || 'HV')}</span>`;

    const courseBadge = s.course === 'eng'
      ? '<span class="crm-pill eng">English Track</span>'
      : '<span class="crm-pill mkt">AI Marketing</span>';
    const mediaBadge = s.mediaType === 'video'
      ? '<span class="crm-pill" style="background:#5E7784;">🎬 Video</span>'
      : '<span class="crm-pill" style="background:#0DA096;">🖼️ Hình ảnh</span>';

    return `
      <div class="crm-row" data-id="${esc(s.id)}">
        <div class="shc-thumb-wrap">
          ${thumbImg}
          <span class="shc-thumb-badge">${esc(s.badge || 'Demo')}</span>
        </div>
        <div class="crm-row-content">
          <div class="crm-row-header">
            ${courseBadge}
            ${mediaBadge}
            <span style="font-size:11.5px;color:var(--crm-slate);">${esc(s.category || '')}</span>
          </div>
          <h3 class="crm-row-title">${esc(s.title)}</h3>
          <p class="crm-row-desc">${esc(s.description)}</p>
          <div class="crm-row-meta">
            <div class="shc-author-tag">
              ${avatarHtml}
              <span style="font-size:12px;font-weight:700;color:var(--crm-ink);">${esc(s.studentName)}</span>
              <span style="font-size:11.5px;color:var(--crm-slate);">· ${esc(s.studentRole || 'Học viên')}</span>
            </div>
            <button type="button" class="crm-btn sm danger" data-act="del-shc">Xoá sản phẩm</button>
          </div>
        </div>
      </div>`;
  }

  function initShowcaseForm() {
    const mediaTypeEl = $('shcMediaType');
    if (mediaTypeEl) {
      mediaTypeEl.addEventListener('change', (e) => {
        const type = e.target.value;
        if (type === 'video') {
          $('shcMediaLabel').textContent = 'Tệp Video demo đồ án (.mp4, .webm) *';
          $('shcMediaFile').accept = 'video/mp4,video/webm';
          $('shcMediaHint').textContent = 'Video tối đa 60MB (khuyên dùng .mp4 chuẩn H.264)';
        } else {
          $('shcMediaLabel').textContent = 'Tệp Hình ảnh đồ án (.png, .jpg, .webp) *';
          $('shcMediaFile').accept = 'image/png,image/jpeg,image/webp';
          $('shcMediaHint').textContent = 'Ảnh chụp đồ án, CV, slide (tối đa 15MB)';
        }
      });
    }

    const courseEl = $('shcCourse');
    if (courseEl) {
      courseEl.addEventListener('change', (e) => {
        const course = e.target.value;
        if (course === 'eng') {
          $('shcCategory').placeholder = 'English Track · Kết quả học viên';
          $('shcBadge').placeholder = 'Kết quả thật';
          $('shcStudentRole').placeholder = 'Khoá ENG_002, Business Analyst...';
        } else {
          $('shcCategory').placeholder = 'AI Marketing · Đồ án tốt nghiệp';
          $('shcBadge').placeholder = 'Live Demo';
          $('shcStudentRole').placeholder = 'Khoá MKT_001, Content Executive...';
        }
      });
    }

    const shcForm = $('shcUploadForm');
    if (shcForm) {
      shcForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('shcTitle').value.trim();
        const course = $('shcCourse').value;
        const category = $('shcCategory').value.trim();
        const desc = $('shcDesc').value.trim();
        const studentName = $('shcStudentName').value.trim();
        const studentRole = $('shcStudentRole').value.trim();
        const mediaType = $('shcMediaType').value;
        const badge = $('shcBadge').value.trim();

        const avatarInput = $('shcAvatar');
        const mediaInput = $('shcMediaFile');
        const thumbInput = $('shcThumb');

        const msg = $('shcMsg');
        const prog = $('shcProgress');
        const btn = $('shcSubmit');

        msg.hidden = true;
        msg.className = 'adm-msg';

        if (!title) return showShcMsg('Vui lòng nhập tên đồ án / sản phẩm.', true);
        if (!desc) return showShcMsg('Vui lòng nhập mô tả ngắn đồ án.', true);
        if (!studentName) return showShcMsg('Vui lòng nhập tên học viên.', true);
        if (!mediaInput.files || !mediaInput.files.length) {
          return showShcMsg('Vui lòng chọn tệp Video hoặc Ảnh sản phẩm.', true);
        }

        btn.disabled = true;
        prog.hidden = false;
        prog.querySelector('i').style.width = '15%';

        try {
          // 1. Tạo bản ghi
          const createRes = await fetch('/api/admin/showcases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'erasight-admin' },
            body: JSON.stringify({
              title, course, category, description: desc,
              studentName, studentRole, mediaType, badge
            })
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            throw new Error(err.error || 'Không tạo được bản ghi sản phẩm học viên.');
          }
          const { showcase: newShc } = await createRes.json();
          prog.querySelector('i').style.width = '35%';

          // 2. Upload file Media chính (video hoặc ảnh)
          const mediaFile = mediaInput.files[0];
          const mExt = mediaFile.name.split('.').pop().toLowerCase();
          const putMedia = await fetch(`/api/admin/showcases/${newShc.id}/media?ext=${encodeURIComponent(mExt)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'erasight-admin' },
            body: mediaFile
          });
          if (!putMedia.ok) {
            const err = await putMedia.json().catch(() => ({}));
            throw new Error(err.error || 'Tải tệp media thất bại.');
          }
          prog.querySelector('i').style.width = '65%';

          // 3. Upload ảnh Avatar học viên (nếu có chọn)
          if (avatarInput.files && avatarInput.files.length > 0) {
            const avaFile = avatarInput.files[0];
            const aExt = avaFile.name.split('.').pop().toLowerCase();
            const putAva = await fetch(`/api/admin/showcases/${newShc.id}/avatar?ext=${encodeURIComponent(aExt)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'erasight-admin' },
              body: avaFile
            });
            if (!putAva.ok) {
              const err = await putAva.json().catch(() => ({}));
              throw new Error(err.error || 'Tải ảnh avatar học viên thất bại.');
            }
          }
          prog.querySelector('i').style.width = '85%';

          // 4. Upload ảnh Poster / Thumb (nếu có)
          if (thumbInput.files && thumbInput.files.length > 0) {
            const thFile = thumbInput.files[0];
            const tExt = thFile.name.split('.').pop().toLowerCase();
            const putThumb = await fetch(`/api/admin/showcases/${newShc.id}/thumb?ext=${encodeURIComponent(tExt)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'erasight-admin' },
              body: thFile
            });
            if (!putThumb.ok) {
              const err = await putThumb.json().catch(() => ({}));
              throw new Error(err.error || 'Tải ảnh poster thất bại.');
            }
          }

          prog.querySelector('i').style.width = '100%';
          $('shcUploadForm').reset();
          showShcMsg(`Đã tải lên sản phẩm "${title}" của học viên ${studentName} thành công!`);
          loadShowcases();
        } catch (err) {
          showShcMsg(err.message, true);
        } finally {
          btn.disabled = false;
          setTimeout(() => { prog.hidden = true; prog.querySelector('i').style.width = '0'; }, 600);
        }
      });
    }

    const shcListEl = $('shcList');
    if (shcListEl) {
      shcListEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act="del-shc"]');
        if (!btn) return;
        const row = btn.closest('.crm-row');
        if (!row) return;
        const id = row.dataset.id;
        if (!confirm('Bạn có chắc muốn xoá sản phẩm học viên này?')) return;
        btn.disabled = true;
        try {
          const r = await fetch(`/api/admin/showcases/${id}`, {
            method: 'DELETE',
            headers: { 'X-Requested-With': 'erasight-admin' }
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          loadShowcases();
        } catch (err) {
          alert('Lỗi xoá: ' + err.message);
          btn.disabled = false;
        }
      });
    }
  }

  function showShcMsg(text, isErr = false) {
    const el = $('shcMsg');
    if (!el) return;
    el.hidden = false;
    el.className = 'adm-msg ' + (isErr ? 'err' : 'ok');
    el.textContent = text;
  }

  // =========================================================================
  // KHỞI ĐỘNG
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initLogin();
    initDocForm();
    initShowcaseForm();
    checkSession();
  });
})();
