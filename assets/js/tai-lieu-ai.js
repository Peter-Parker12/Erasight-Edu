/**
 * ERASIGHT ACADEMY — THƯ VIỆN TÀI LIỆU AI (AI RESOURCE LIBRARY)
 * Controller giao diện: tìm kiếm, lọc theo danh mục / định dạng / quyền truy cập,
 * sắp xếp, chuyển đổi lưới / danh sách, xem trước tài liệu và thông báo tải.
 * 
 * Lưu ý kiến trúc: Dữ liệu hiện được cấu trúc dạng mảng chuẩn hóa (DOCUMENTS_DATA).
 * Về sau khi tích hợp tài khoản Admin / API upload, chỉ cần thay đổi nguồn fetch
 * từ backend API mà không cần sửa lại logic render giao diện.
 */

(function () {
  'use strict';

  // 1. DANH MỤC TÀI LIỆU
  const CATEGORIES = [
    { id: 'all', name: 'Tất cả tài liệu', icon: '⚡' },
    { id: 'prompt', name: 'Kỹ nghệ Prompt', icon: '💬' },
    { id: 'automation', name: 'Workflow Automation', icon: '⚙️' },
    { id: 'content', name: 'Content & Copywriting', icon: '✍️' },
    { id: 'career', name: 'CV & Phỏng vấn', icon: '🎯' },
    { id: 'slide', name: 'Slide & Cẩm nang', icon: '📘' }
  ];

  // 2. DANH SÁCH ĐỊNH DẠNG HỖ TRỢ
  const FILE_TYPES = [
    { id: 'pdf', label: 'PDF', class: 'doc-type--pdf' },
    { id: 'docx', label: 'DOCX', class: 'doc-type--docx' },
    { id: 'xlsx', label: 'XLSX / CSV', class: 'doc-type--xlsx' },
    { id: 'pptx', label: 'PPTX', class: 'doc-type--pptx' },
    { id: 'zip', label: 'ZIP Workflow', class: 'doc-type--zip' },
    { id: 'link', label: 'NOTION / LINK', class: 'doc-type--link' }
  ];

  // 3. DỮ LIỆU TÀI LIỆU MẪU CHUẨN HOÁ
  const DOCUMENTS_DATA = [
    {
      id: 'doc-001',
      title: 'Bộ 50+ Master Prompt Đa Kênh Cho Dân Marketing Thực Chiến',
      category: 'prompt',
      categoryName: 'Kỹ nghệ Prompt',
      type: 'pdf',
      typeName: 'PDF',
      size: '4.8 MB',
      pages: '42 trang',
      downloads: 1420,
      updatedAt: '2026-03-15',
      access: 'free',
      isFeatured: true,
      description: 'Tổng hợp các master prompt chuẩn cấu trúc: Role - Context - Task - Constraints - Output Format. Tối ưu riêng cho ChatGPT, Claude 3.5 Sonnet và Google Gemini.',
      tags: ['ChatGPT', 'Prompt', 'Marketing', 'Claude'],
      author: 'Hồ Hoàng Tiến — Erasight',
      downloadUrl: '#'
    },
    {
      id: 'doc-002',
      title: 'Workflow n8n Tự Động Lên Lịch Đăng Bài Fanpage & Instagram từ Google Sheets',
      category: 'automation',
      categoryName: 'Workflow Automation',
      type: 'zip',
      typeName: 'ZIP',
      size: '1.2 MB',
      pages: 'JSON + Hướng dẫn',
      downloads: 980,
      updatedAt: '2026-03-20',
      access: 'free',
      isFeatured: false,
      description: 'Bộ file JSON workflow n8n dựng sẵn: đọc hàng từ Sheets, kiểm duyệt trạng thái bài viết, tải ảnh lên Graph API và tự kích hoạt thông báo Telegram khi đăng thành công.',
      tags: ['n8n', 'Automation', 'Social', 'Facebook API'],
      author: 'Erasight Tech Team',
      downloadUrl: '#'
    },
    {
      id: 'doc-003',
      title: 'Mẫu CV Tiếng Anh Chuẩn ATS Tối Ưu Cho Ứng Viên Khối Công Nghệ & Doanh Nghiệp',
      category: 'career',
      categoryName: 'CV & Phỏng vấn',
      type: 'docx',
      typeName: 'DOCX',
      size: '680 KB',
      pages: '02 trang',
      downloads: 1250,
      updatedAt: '2026-03-10',
      access: 'free',
      isFeatured: false,
      description: 'Template CV định dạng chuẩn ATS (Applicant Tracking System), loại bỏ các lỗi formatting phổ biến khiến hệ thống lọc tự động đánh rớt ứng viên.',
      tags: ['CV ATS', 'Career', 'Tiếng Anh', 'HR'],
      author: 'Nguyễn Mai Trâm — Erasight',
      downloadUrl: '#'
    },
    {
      id: 'doc-004',
      title: 'Bảng Kế Hoạch Nội Dung Tự Động Hoá (Content Matrix & Automation Calendar)',
      category: 'content',
      categoryName: 'Content & Copywriting',
      type: 'xlsx',
      typeName: 'XLSX',
      size: '850 KB',
      pages: '6 Sheets',
      downloads: 870,
      updatedAt: '2026-03-05',
      access: 'free',
      isFeatured: false,
      description: 'Template Excel phân chia 4 nhóm nội dung (Hero - Hub - Help - Sales), tích hợp sẵn công thức tính điểm tương tác và cột dữ liệu để nạp trực tiếp vào workflow auto-post.',
      tags: ['Content Calendar', 'Excel', 'Matrix', 'KPI'],
      author: 'Erasight Academy',
      downloadUrl: '#'
    },
    {
      id: 'doc-005',
      title: 'Slide Bài Giảng: Kỹ Thuật Đàm Phán Lương & Xử Lý Câu Hỏi Khó Theo STAR Framework',
      category: 'career',
      categoryName: 'CV & Phỏng vấn',
      type: 'pptx',
      typeName: 'PPTX',
      size: '12.4 MB',
      pages: '38 Slides',
      downloads: 640,
      updatedAt: '2026-02-28',
      access: 'member',
      isFeatured: false,
      description: 'Tài liệu hướng dẫn chuyên sâu: cách phân rã thành tích quá khứ thành Situation - Task - Action - Result với số liệu định lượng, kèm kịch bản đàm phán đãi ngộ thực tế.',
      tags: ['STAR', 'Phỏng vấn', 'Salary Negotiation'],
      author: 'Cô Nguyễn Mai Trâm',
      downloadUrl: '#'
    },
    {
      id: 'doc-006',
      title: 'Cẩm Nang Tối Ưu Hoá SEO & GEO (Generative Engine Optimization) Cho Bài Viết AI',
      category: 'content',
      categoryName: 'Content & Copywriting',
      type: 'pdf',
      typeName: 'PDF',
      size: '3.6 MB',
      pages: '28 trang',
      downloads: 730,
      updatedAt: '2026-03-18',
      access: 'free',
      isFeatured: false,
      description: 'Phương pháp viết và định dạng bài viết để được các công cụ tìm kiếm AI (SearchGPT, Perplexity, Gemini) trích nguồn tự nhiên, chống phạt duplicate content.',
      tags: ['GEO', 'SearchGPT', 'Perplexity', 'SEO AI'],
      author: 'Thầy Hồ Hoàng Tiến',
      downloadUrl: '#'
    },
    {
      id: 'doc-007',
      title: 'Kho Lưu Trữ 100+ Template & Prompts Chuyên Biệt Cho Gemini Spark Branding Agent',
      category: 'prompt',
      categoryName: 'Kỹ nghệ Prompt',
      type: 'link',
      typeName: 'NOTION',
      size: 'Trực tuyến',
      pages: '100+ Items',
      downloads: 1110,
      updatedAt: '2026-03-22',
      access: 'member',
      isFeatured: false,
      description: 'Không gian Notion tương tác chứa toàn bộ kịch bản tạo tone-of-voice, visual guidelines và bộ quy tắc sáng tạo nội dung đồng bộ nhận diện thương hiệu.',
      tags: ['Gemini', 'Notion', 'Branding', 'Prompt'],
      author: 'Erasight Academy',
      downloadUrl: '#'
    },
    {
      id: 'doc-008',
      title: 'Bộ Mã Nguồn Mẫu: Tích Hợp Webhook Phân Phối Bài Viết Bằng Node.js & Meta API',
      category: 'automation',
      categoryName: 'Workflow Automation',
      type: 'zip',
      typeName: 'ZIP',
      size: '2.1 MB',
      pages: 'Full Source Code',
      downloads: 520,
      updatedAt: '2026-02-15',
      access: 'member',
      isFeatured: false,
      description: 'Source code module server Node.js nhỏ gọn, hỗ trợ xác thực OAuth 2.0 với Meta for Developers, kèm xử lý queue hạn chế tỷ lệ rate limit khi đăng nhiều tài khoản.',
      tags: ['Node.js', 'Webhook', 'Meta API', 'Dev'],
      author: 'Erasight Tech Lab',
      downloadUrl: '#'
    }
  ];

  // 4. TRẠNG THÁI HIỆN TẠI CỦA ỨNG DỤNG
  const state = {
    search: '',
    category: 'all',
    types: new Set(),
    access: 'all',
    sort: 'newest',
    view: 'grid',
    visibleCount: 8
  };

  // Toast thông báo nhỏ
  function showToast(message) {
    const toast = document.getElementById('resToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('is-show');
    }, 2800);
  }

  // Khởi tạo các bộ lọc ở Sidebar
  function renderSidebarFilters() {
    // A. Render Categories
    const catsContainer = document.getElementById('libCats');
    if (catsContainer) {
      catsContainer.innerHTML = CATEGORIES.map((cat) => {
        const count = cat.id === 'all'
          ? DOCUMENTS_DATA.length
          : DOCUMENTS_DATA.filter((d) => d.category === cat.id).length;
        const isActive = state.category === cat.id ? 'is-active' : '';
        return `
          <button type="button" class="lib-cat ${isActive}" data-cat="${cat.id}">
            <span class="ico"><i>${cat.icon}</i><span>${cat.name}</span></span>
            <span class="n">${count}</span>
          </button>
        `;
      }).join('');

      catsContainer.querySelectorAll('.lib-cat').forEach((btn) => {
        btn.addEventListener('click', () => {
          catsContainer.querySelectorAll('.lib-cat').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          state.category = btn.dataset.cat;
          applyFiltersAndRender();
        });
      });
    }

    // B. Render File Types
    const typesContainer = document.getElementById('libTypes');
    if (typesContainer) {
      typesContainer.innerHTML = FILE_TYPES.map((t) => {
        return `
          <label class="lib-type-chip">
            <input type="checkbox" value="${t.id}" />
            <span class="dot"></span>
            <span>${t.label}</span>
          </label>
        `;
      }).join('');

      typesContainer.querySelectorAll('input').forEach((chk) => {
        chk.addEventListener('change', () => {
          if (chk.checked) {
            state.types.add(chk.value);
          } else {
            state.types.delete(chk.value);
          }
          applyFiltersAndRender();
        });
      });
    }

    // C. Quyền truy cập
    document.querySelectorAll('input[name="libAccess"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        state.access = radio.value;
        applyFiltersAndRender();
      });
    });

    // D. Sắp xếp
    const sortSelect = document.getElementById('libSort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        state.sort = e.target.value;
        applyFiltersAndRender();
      });
    }

    // E. Chuyển đổi Grid / List
    const gridBtn = document.getElementById('viewGridBtn');
    const listBtn = document.getElementById('viewListBtn');
    const gridContainer = document.getElementById('libGrid');

    if (gridBtn && listBtn && gridContainer) {
      gridBtn.addEventListener('click', () => {
        gridBtn.classList.add('is-active');
        listBtn.classList.remove('is-active');
        gridContainer.classList.remove('is-list');
        state.view = 'grid';
      });

      listBtn.addEventListener('click', () => {
        listBtn.classList.add('is-active');
        gridBtn.classList.remove('is-active');
        gridContainer.classList.add('is-list');
        state.view = 'list';
      });
    }
  }

  // Khởi tạo thanh tìm kiếm
  function initSearch() {
    const input = document.getElementById('libSearchInput');
    const form = document.getElementById('libSearchForm');

    if (input) {
      input.addEventListener('input', (e) => {
        state.search = e.target.value.trim().toLowerCase();
        applyFiltersAndRender();
      });

      // Phím tắt "/" để focus nhanh vào ô tìm kiếm
      document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== input) {
          e.preventDefault();
          input.focus();
        }
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        applyFiltersAndRender();
      });
    }

    // Thẻ tìm kiếm nhanh (Popular tags)
    document.querySelectorAll('#libPopular .lib-tag').forEach((tag) => {
      tag.addEventListener('click', () => {
        const query = tag.dataset.q;
        if (input) {
          input.value = query;
          state.search = query.toLowerCase();
          applyFiltersAndRender();
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }

  // Lọc và sắp xếp dữ liệu
  function getFilteredDocuments() {
    return DOCUMENTS_DATA.filter((doc) => {
      // 1. Lọc theo Danh mục
      if (state.category !== 'all' && doc.category !== state.category) {
        return false;
      }
      // 2. Lọc theo Định dạng
      if (state.types.size > 0 && !state.types.has(doc.type)) {
        return false;
      }
      // 3. Lọc theo Quyền truy cập
      if (state.access !== 'all' && doc.access !== state.access) {
        return false;
      }
      // 4. Lọc theo Từ khóa tìm kiếm
      if (state.search) {
        const haystack = [
          doc.title,
          doc.description,
          doc.categoryName,
          doc.typeName,
          doc.author,
          ...(doc.tags || [])
        ].join(' ').toLowerCase();
        if (!haystack.includes(state.search)) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => {
      if (state.sort === 'newest') {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      }
      if (state.sort === 'popular') {
        return b.downloads - a.downloads;
      }
      if (state.sort === 'az') {
        return a.title.localeCompare(b.title, 'vi');
      }
      return 0;
    });
  }

  // Render tài liệu nổi bật (Ghim)
  function renderFeaturedDoc() {
    const container = document.getElementById('libFeatured');
    if (!container) return;

    // Chỉ hiển thị featured khi ở danh mục Tất cả và không đang tìm kiếm
    if (state.category !== 'all' || state.search || state.types.size > 0) {
      container.innerHTML = '';
      return;
    }

    const featured = DOCUMENTS_DATA.find((d) => d.isFeatured);
    if (!featured) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <article class="lib-featured">
        <div class="doc-cover doc-type--${featured.type}">
          <span class="sheet"></span>
          <span class="ext">${featured.typeName}</span>
        </div>
        <div class="lib-featured-body">
          <div class="pin-badge">✦ TÀI LIỆU TIÊU BIỂU TRONG THÁNG</div>
          <h3>${featured.title}</h3>
          <p>${featured.description}</p>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:auto;">
            <button type="button" class="btn btn-primary btn-sm" onclick="ErasightLibrary.handleDownload('${featured.id}')">
              <span>Tải tài liệu ngay</span>
              <span>↓</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="ErasightLibrary.openPreview('${featured.id}')">
              <span>Xem chi tiết</span>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  // Render danh sách tài liệu
  function applyFiltersAndRender() {
    const list = getFilteredDocuments();
    const grid = document.getElementById('libGrid');
    const resultEl = document.getElementById('libResult');
    const moreBtn = document.getElementById('libMoreBtn');

    renderFeaturedDoc();

    if (resultEl) {
      resultEl.innerHTML = `Tìm thấy <b>${list.length}</b> tài liệu phù hợp`;
    }

    if (!grid) return;

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="lib-empty">
          <div class="big">🔍</div>
          <h3>Không tìm thấy tài liệu phù hợp</h3>
          <p>Thử tìm kiếm với từ khóa khác hoặc bỏ bớt các bộ lọc đang chọn.</p>
          <button type="button" class="btn btn-ghost btn-sm" onclick="ErasightLibrary.resetFilters()">
            Đặt lại bộ lọc
          </button>
        </div>
      `;
      if (moreBtn) moreBtn.hidden = true;
      return;
    }

    const visibleDocs = list.slice(0, state.visibleCount);

    grid.innerHTML = visibleDocs.map((doc) => {
      const isMemberOnly = doc.access === 'member';
      const actionBtn = isMemberOnly
        ? `
          <button type="button" class="doc-btn doc-btn--locked" onclick="ErasightLibrary.handleMemberAccess('${doc.id}')">
            <span>Mở khoá</span>
          </button>
        `
        : `
          <button type="button" class="doc-btn doc-btn--primary" onclick="ErasightLibrary.handleDownload('${doc.id}')">
            <span>Tải về</span>
            <span>↓</span>
          </button>
        `;

      const tagsHtml = (doc.tags || [])
        .map((t) => `<span>#${t}</span>`)
        .join('');

      return `
        <article class="doc-card" id="${doc.id}">
          <div class="doc-cover doc-type--${doc.type}">
            <span class="sheet"></span>
            <span class="ext">${doc.typeName}</span>
          </div>
          <div class="doc-body">
            <span class="doc-cat">${doc.categoryName}</span>
            <h3>${doc.title}</h3>
            <p>${doc.description}</p>
            <div class="doc-tags">${tagsHtml}</div>
            <div class="doc-actions">
              <button type="button" class="doc-btn doc-btn--ghost" onclick="ErasightLibrary.openPreview('${doc.id}')">
                Chi tiết
              </button>
              ${actionBtn}
            </div>
          </div>
        </article>
      `;
    }).join('');

    if (moreBtn) {
      moreBtn.hidden = list.length <= state.visibleCount;
      moreBtn.onclick = () => {
        state.visibleCount += 8;
        applyFiltersAndRender();
      };
    }
  }

  // Modal Xem Trước Tài Liệu
  function initPreviewModal() {
    const modal = document.getElementById('docModal');
    const closeBtn = document.getElementById('docModalClose');
    if (!modal) return;

    function close() {
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    });
  }

  function openPreview(docId) {
    const doc = DOCUMENTS_DATA.find((d) => d.id === docId);
    const modal = document.getElementById('docModal');
    const coverEl = document.getElementById('docModalCover');
    const bodyEl = document.getElementById('docModalBody');

    if (!doc || !modal || !coverEl || !bodyEl) return;

    coverEl.innerHTML = `
      <div class="doc-cover doc-type--${doc.type}" style="border-radius:20px 0 0 20px;">
        <span class="sheet"></span>
        <span class="ext">${doc.typeName}</span>
      </div>
    `;

    const isMemberOnly = doc.access === 'member';
    const mainActionBtn = isMemberOnly
      ? `
        <button type="button" class="btn btn-primary" onclick="ErasightLibrary.handleMemberAccess('${doc.id}')">
          Đăng nhập học viên để mở khoá →
        </button>
      `
      : `
        <button type="button" class="btn btn-primary" onclick="ErasightLibrary.handleDownload('${doc.id}')">
          Tải tài liệu ngay (${doc.size}) ↓
        </button>
      `;

    bodyEl.innerHTML = `
      <div class="doc-cat">${doc.categoryName}</div>
      <h3 id="docModalTitle">${doc.title}</h3>
      <p>${doc.description}</p>
      
      <dl class="doc-spec">
        <div><dt>Định dạng</dt><dd>${doc.typeName}</dd></div>
        <div><dt>Dung lượng</dt><dd>${doc.size}</dd></div>
        <div><dt>Quy mô</dt><dd>${doc.pages}</dd></div>
        <div><dt>Tác giả</dt><dd>${doc.author}</dd></div>
        <div><dt>Lượt tải</dt><dd>${doc.downloads.toLocaleString()}</dd></div>
        <div><dt>Cập nhật</dt><dd>${doc.updatedAt}</dd></div>
      </dl>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:20px;">
        ${mainActionBtn}
        <a href="/Homepage" class="btn btn-ghost">Xem khoá học liên quan</a>
      </div>
    `;

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  // Tải file mô phỏng (sẽ liên kết file thực hoặc backend upload về sau)
  function handleDownload(docId) {
    const doc = DOCUMENTS_DATA.find((d) => d.id === docId);
    if (!doc) return;
    doc.downloads += 1;
    showToast(`✓ Đang chuẩn bị tải: "${doc.title}" (${doc.size})`);
    applyFiltersAndRender();
  }

  function handleMemberAccess(docId) {
    const doc = DOCUMENTS_DATA.find((d) => d.id === docId);
    showToast(`🔒 Tài liệu "${doc ? doc.title : ''}" yêu cầu tài khoản học viên.`);
    // Tự động mở modal đăng nhập dùng chung nếu có
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
      loginModal.style.display = 'flex';
    }
  }

  function resetFilters() {
    state.search = '';
    state.category = 'all';
    state.types.clear();
    state.access = 'all';
    state.sort = 'newest';

    const input = document.getElementById('libSearchInput');
    if (input) input.value = '';

    const allCatBtn = document.querySelector('.lib-cat[data-cat="all"]');
    if (allCatBtn) allCatBtn.click();

    document.querySelectorAll('#libTypes input').forEach((c) => { c.checked = false; });
    const allRadio = document.querySelector('input[name="libAccess"][value="all"]');
    if (allRadio) allRadio.checked = true;

    applyFiltersAndRender();
  }

  // Khởi chạy khi DOM sẵn sàng
  document.addEventListener('DOMContentLoaded', () => {
    renderSidebarFilters();
    initSearch();
    initPreviewModal();
    applyFiltersAndRender();
  });

  // Public API
  window.ErasightLibrary = {
    openPreview: openPreview,
    handleDownload: handleDownload,
    handleMemberAccess: handleMemberAccess,
    resetFilters: resetFilters,
    DOCUMENTS_DATA: DOCUMENTS_DATA
  };
})();
