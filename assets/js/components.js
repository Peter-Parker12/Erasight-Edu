/**
 * ERASIGHT ACADEMY — REUSABLE COMPONENTS LOADER & CONTROLLER
 * Tự động render và điều khiển tương tác cho Header & Footer trên mọi trang web.
 */

(function () {
  'use strict';

  // Xác định đường dẫn gốc để xử lý đúng tài nguyên ảnh/css khi trang nằm trong thư mục con
  const rootPath = (function () {
    const metaRoot = document.querySelector('meta[name="base-path"]');
    if (metaRoot) return metaRoot.getAttribute('content');
    return '';
  })();

  // 1. TEMPLATE HEADER CHUẨN
  const HEADER_TEMPLATE = `
    <header class="site-header" id="siteHeader">
      <div class="site-header-inner">
        <!-- Brand / Logo -->
        <a href="${rootPath}index.html#top" class="site-brand" aria-label="Erasight Academy - Skills for what's next">
          <img src="${rootPath}assets/logos/erasight-logo-slogan-mau-2000w.png" alt="Erasight — Skills for what's next." />
        </a>

        <!-- Center Navigation -->
        <nav class="site-nav" aria-label="Điều hướng chính">
          <!-- Dropdown Khoá học -->
          <div class="nav-dropdown" id="navCoursesDropdown">
            <a href="${rootPath}index.html#khoa-hoc" class="nav-link dropdown-trigger" aria-haspopup="true" aria-expanded="false">
              <span>Khoá học</span>
              <svg class="nav-link-caret" viewBox="0 0 10 6" fill="currentColor">
                <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
            </a>

            <!-- Dropdown Content Panel -->
            <div class="dropdown-panel" role="menu">
              <a href="${rootPath}index.html#khoa-hoc" class="dropdown-item" role="menuitem">
                <span class="dropdown-badge badge-orange">MKT_001</span>
                <div class="dropdown-info">
                  <span class="dropdown-title">AI Marketing thực chiến</span>
                  <span class="dropdown-desc">Tự động hoá quy trình đăng bài đa kênh không cần biết code</span>
                </div>
              </a>

              <a href="${rootPath}index.html#khoa-hoc" class="dropdown-item" role="menuitem">
                <span class="dropdown-badge badge-blue">ENG_002</span>
                <div class="dropdown-info">
                  <span class="dropdown-title">Tiếng Anh phỏng vấn &amp; đi làm</span>
                  <span class="dropdown-desc">CV chuẩn ATS, phản xạ STAR và tự tin đàm phán trước HR</span>
                </div>
              </a>

              <div class="dropdown-footer">
                <a href="${rootPath}index.html#khoa-hoc" class="dropdown-footer-link">
                  <span>Xem chi tiết lộ trình 2 khoá học</span>
                  <span>&rarr;</span>
                </a>
              </div>
            </div>
          </div>

          <a href="${rootPath}giang-vien.html" class="nav-link" data-nav="giang-vien">Giảng viên</a>
          <a href="${rootPath}index.html#san-pham" class="nav-link">Sản phẩm học viên</a>
          <a href="${rootPath}index.html#faq" class="nav-link">Hỏi đáp</a>
        </nav>

        <!-- Right Actions -->
        <div class="site-actions">
          <a href="#dang-nhap" class="btn-login" id="loginBtnTrigger">Đăng nhập</a>
          <a href="${rootPath}index.html#pricing" class="btn-enroll">Ghi danh ngay</a>
        </div>

        <!-- Mobile Menu Burger Button -->
        <button class="mobile-toggle" id="mobileToggleBtn" aria-label="Mở menu điều hướng" aria-expanded="false">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      <!-- Mobile Drawer -->
      <div class="mobile-drawer-overlay" id="mobileDrawerOverlay"></div>
      <div class="mobile-drawer" id="mobileDrawer">
        <div class="mobile-nav-list">
          <div>
            <a href="${rootPath}index.html#khoa-hoc" class="mobile-nav-item">
              <span>Khoá học</span>
              <span style="font-size:12px; color:var(--hf-teal); font-weight:700;">2 khoá</span>
            </a>
            <div class="mobile-nav-sublist">
              <a href="${rootPath}index.html#khoa-hoc" class="mobile-nav-sublink">✦ AI Marketing thực chiến</a>
              <a href="${rootPath}index.html#khoa-hoc" class="mobile-nav-sublink">✦ Tiếng Anh phỏng vấn &amp; đi làm</a>
            </div>
          </div>
          <a href="${rootPath}giang-vien.html" class="mobile-nav-item" data-nav="giang-vien">Giảng viên</a>
          <a href="${rootPath}index.html#san-pham" class="mobile-nav-item">Sản phẩm học viên</a>
          <a href="${rootPath}index.html#faq" class="mobile-nav-item">Hỏi đáp</a>
        </div>

        <div class="mobile-actions">
          <a href="#dang-nhap" class="btn-login mobile-login-btn">Đăng nhập</a>
          <a href="${rootPath}index.html#pricing" class="btn-enroll">Ghi danh ngay</a>
        </div>
      </div>
    </header>
  `;

  // 2. TEMPLATE FOOTER CHUẨN
  const FOOTER_TEMPLATE = `
    <footer class="site-footer" id="siteFooter">
      <div class="footer-container">
        <div class="footer-main-row">
          <!-- Cột nhận diện thương hiệu -->
          <div class="footer-brand-col">
            <a href="${rootPath}index.html#top" class="footer-brand-logo" aria-label="Erasight Academy">
              <img src="${rootPath}assets/logos/erasight-logo-ngang-mono-trang-1600w.png" alt="Erasight Edu" width="140" height="28" />
            </a>
            <div class="footer-slogan">Skills for what's next.</div>
            <p class="footer-brand-desc">
              Học viện đào tạo kỹ năng thực chiến cho người trẻ đi làm. Tự động hoá marketing bằng AI và Tiếng Anh phỏng vấn xin việc.
            </p>
          </div>

          <!-- Nhóm cột liên kết -->
          <div class="footer-links-group">
            <div class="footer-col">
              <h4>Khoá học</h4>
              <ul>
                <li><a href="${rootPath}index.html#khoa-hoc">01. AI Marketing thực chiến</a></li>
                <li><a href="${rootPath}index.html#khoa-hoc">02. Tiếng Anh phỏng vấn &amp; đi làm</a></li>
                <li><a href="${rootPath}index.html#lo-trinh">Lộ trình 4 chặng</a></li>
                <li><a href="${rootPath}index.html#san-pham">Sản phẩm học viên</a></li>
              </ul>
            </div>

            <div class="footer-col">
              <h4>Thông tin &amp; Hỗ trợ</h4>
              <ul>
                <li><a href="${rootPath}giang-vien.html">Đội ngũ giảng viên</a></li>
                <li><a href="${rootPath}index.html#difference">Điểm khác biệt</a></li>
                <li><a href="${rootPath}index.html#pricing">Chính sách học phí</a></li>
                <li><a href="${rootPath}index.html#faq">Câu hỏi thường gặp</a></li>
              </ul>
            </div>

            <div class="footer-col">
              <h4>Liên hệ ghi danh</h4>
              <ul>
                <li>Hotline / Zalo: <strong>0912 345 678</strong></li>
                <li>Email: <strong>edu@erasight.vn</strong></li>
                <li>Hình thức: Live Zoom &amp; Kèm 1:1</li>
                <li>Quy mô: Tối đa 12 người / lớp</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Hàng bản quyền dưới cùng -->
        <div class="footer-bottom-row">
          <div>© 2026 Erasight Academy. Tuân thủ Brand Guideline v2.0.</div>
          <div class="footer-mono-badge">Skills for what's next.</div>
        </div>
      </div>
    </footer>
  `;

  // 3. DIALOG MODAL ĐĂNG NHẬP (Tiện ích thông minh)
  const LOGIN_MODAL_TEMPLATE = `
    <div id="loginModal" style="display:none; position:fixed; inset:0; background:rgba(12,42,58,0.6); backdrop-filter:blur(6px); z-index:2000; align-items:center; justify-content:center; padding:20px;">
      <div style="background:#FFFFFF; border-radius:16px; max-width:400px; width:100%; padding:32px 28px; box-shadow:0 24px 60px rgba(0,0,0,0.25); position:relative; font-family:var(--hf-font-main);">
        <button id="closeLoginModalBtn" aria-label="Đóng" style="position:absolute; top:16px; right:16px; background:none; border:none; font-size:24px; color:#888; cursor:pointer; line-height:1;">&times;</button>
        <div style="text-align:center; margin-bottom:20px;">
          <img src="${rootPath}assets/logos/erasight-bieutuong-mau-1024w.png" alt="Erasight" style="height:44px; margin:0 auto 12px; display:block;" />
          <h3 style="font-size:20px; font-weight:700; color:var(--hf-ink); margin-bottom:6px;">Cổng học viên Erasight</h3>
          <p style="font-size:13.5px; color:var(--hf-slate);">Đăng nhập để vào hệ thống LMS và nhận học liệu thực hành</p>
        </div>
        <form onsubmit="event.preventDefault(); alert('Hệ thống học tập LMS sẽ mở đăng nhập theo lịch khoá học của bạn. Vui lòng kiểm tra email xác nhận ghi danh!'); document.getElementById('loginModal').style.display='none';">
          <div style="margin-bottom:14px;">
            <label style="display:block; font-size:13px; font-weight:600; color:var(--hf-ink); margin-bottom:6px;">Email hoặc Số điện thoại</label>
            <input type="text" placeholder="vidu@erasight.vn" required style="width:100%; padding:11px 14px; border:1px solid #DDE7E7; border-radius:8px; font-size:14px; outline:none; transition:border .2s;" />
          </div>
          <div style="margin-bottom:20px;">
            <label style="display:block; font-size:13px; font-weight:600; color:var(--hf-ink); margin-bottom:6px;">Mật khẩu</label>
            <input type="password" placeholder="••••••••" required style="width:100%; padding:11px 14px; border:1px solid #DDE7E7; border-radius:8px; font-size:14px; outline:none; transition:border .2s;" />
          </div>
          <button type="submit" class="btn-enroll" style="width:100%; padding:12px; font-size:15px; border-radius:8px; cursor:pointer;">Đăng nhập ngay</button>
        </form>
        <div style="text-align:center; margin-top:16px; font-size:12.5px; color:var(--hf-slate);">
          Chưa có tài khoản? <a href="${rootPath}index.html#pricing" style="color:var(--hf-orange); font-weight:600;" onclick="document.getElementById('loginModal').style.display='none';">Ghi danh giữ chỗ</a>
        </div>
      </div>
    </div>
  `;

  // 4. HÀM KHỞI TẠO TƯƠNG TÁC
  function initHeaderFooterEvents() {
    // A. Xử lý mở / đóng Mobile Drawer
    const toggleBtn = document.getElementById('mobileToggleBtn');
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('mobileDrawerOverlay');

    function openMobileMenu() {
      if (!drawer || !overlay || !toggleBtn) return;
      toggleBtn.classList.add('is-active');
      toggleBtn.setAttribute('aria-expanded', 'true');
      overlay.style.display = 'block';
      drawer.style.display = 'block';
      setTimeout(() => {
        overlay.style.opacity = '1';
        drawer.classList.add('is-open');
      }, 10);
    }

    function closeMobileMenu() {
      if (!drawer || !overlay || !toggleBtn) return;
      toggleBtn.classList.remove('is-active');
      toggleBtn.setAttribute('aria-expanded', 'false');
      overlay.style.opacity = '0';
      drawer.classList.remove('is-open');
      setTimeout(() => {
        overlay.style.display = 'none';
        drawer.style.display = 'none';
      }, 250);
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = toggleBtn.classList.contains('is-active');
        if (isOpen) {
          closeMobileMenu();
        } else {
          openMobileMenu();
        }
      });
    }

    if (overlay) {
      overlay.addEventListener('click', closeMobileMenu);
    }

    // Đóng drawer khi click vào liên kết bên trong
    const drawerLinks = drawer ? drawer.querySelectorAll('a') : [];
    drawerLinks.forEach((link) => {
      link.addEventListener('click', () => {
        closeMobileMenu();
      });
    });

    // B. Xử lý Modal Đăng nhập
    const modal = document.getElementById('loginModal');
    const closeBtn = document.getElementById('closeLoginModalBtn');
    const openBtns = document.querySelectorAll('#loginBtnTrigger, .mobile-login-btn, [href="#dang-nhap"]');

    openBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        closeMobileMenu();
        if (modal) {
          modal.style.display = 'flex';
        }
      });
    });

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      });
    }

    // C. Xử lý Dropdown Click trên thiết bị cảm ứng
    const dropdown = document.getElementById('navCoursesDropdown');
    const trigger = dropdown ? dropdown.querySelector('.dropdown-trigger') : null;

    if (dropdown && trigger) {
      trigger.addEventListener('click', (e) => {
        // Nếu ở màn hình desktop có hover, chỉ điều hướng bình thường khi nhấp đôi hoặc giữ hover
        if (window.innerWidth > 960 && ('ontouchstart' in window)) {
          e.preventDefault();
          dropdown.classList.toggle('is-open');
        }
      });
    }

    // D. Tự động đánh dấu active theo trang hiện tại
    const currentPath = window.location.pathname.toLowerCase();
    if (currentPath.includes('giang-vien')) {
      const gvLinks = document.querySelectorAll('[data-nav="giang-vien"]');
      gvLinks.forEach(l => l.classList.add('active'));
    }
  }

  // 5. TỰ ĐỘNG RENDER KHI TRANG TẢI
  function renderComponents() {
    // Header render nếu có container hoặc thẻ tùy biến
    const headerContainer = document.getElementById('site-header') || document.querySelector('erasight-header');
    if (headerContainer && !headerContainer.querySelector('.site-header')) {
      headerContainer.innerHTML = HEADER_TEMPLATE;
    }

    // Footer render nếu có container hoặc thẻ tùy biến
    const footerContainer = document.getElementById('site-footer') || document.querySelector('erasight-footer');
    if (footerContainer && !footerContainer.querySelector('.site-footer')) {
      footerContainer.innerHTML = FOOTER_TEMPLATE;
    }

    // Chèn Login Modal nếu chưa có
    if (!document.getElementById('loginModal')) {
      document.body.insertAdjacentHTML('beforeend', LOGIN_MODAL_TEMPLATE);
    }

    // Khởi tạo toàn bộ sự kiện
    initHeaderFooterEvents();
  }

  // Khởi động khi DOM đã sẵn sàng
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderComponents);
  } else {
    renderComponents();
  }

  // Expose API để các trang khác có thể gọi lại nếu cần
  window.ErasightComponents = {
    render: renderComponents,
    openMobileMenu: function () {
      const btn = document.getElementById('mobileToggleBtn');
      if (btn && !btn.classList.contains('is-active')) btn.click();
    },
    closeMobileMenu: function () {
      const btn = document.getElementById('mobileToggleBtn');
      if (btn && btn.classList.contains('is-active')) btn.click();
    }
  };
})();
