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
      <!-- 1. Top Newsletter Section -->
      <div class="footer-newsletter-wrap">
        <div class="footer-newsletter-inner">
          <h3 class="footer-newsletter-title">
            Tổng hợp kiến thức AI<br />
            vào hộp thư của bạn
          </h3>
          <p class="footer-newsletter-desc">
            Erasight Academy chọn lọc những cập nhật đáng chú ý và gửi đến bạn những kiến thức thực sự hữu ích cho công việc.
          </p>
          <form class="footer-newsletter-form" id="newsletterForm" onsubmit="event.preventDefault(); alert('✓ Cảm ơn bạn! Erasight sẽ gửi cẩm nang cập nhật AI mới nhất vào email của bạn hàng tuần.'); this.reset();">
            <input type="email" class="footer-newsletter-input" placeholder="Email của bạn" required aria-label="Email của bạn" />
            <button type="submit" class="footer-nl-btn footer-newsletter-btn">Đăng ký</button>
          </form>
        </div>
      </div>

      <!-- 2. Geometric Cutout Notch Ribbon -->
      <div class="footer-notch-wrap">
        <div class="footer-notch-bar">
          <!-- Brand Logo on Left (Black Wing) -->
          <div class="footer-notch-brand">
            <a href="${rootPath}index.html#top" aria-label="Erasight Academy Homepage">
              <img src="${rootPath}assets/logos/erasight-logo-ngang-mono-trang-1600w.png" alt="Erasight Academy" width="138" height="28" />
            </a>
          </div>

          <!-- Center Geometric Notch with Glowing Cyan Line -->
          <div class="footer-notch-center">
            <svg class="footer-notch-svg" viewBox="0 0 800 54" preserveAspectRatio="none">
              <defs>
                <linearGradient id="footerCyanNeon" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#00E5D4" />
                  <stop offset="50%" stop-color="#0DA096" />
                  <stop offset="100%" stop-color="#00E5D4" />
                </linearGradient>
                <filter id="neonGlowFilter" x="-10%" y="-30%" width="120%" height="160%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path d="M 0,0 L 45,46 L 755,46 L 800,0 Z" fill="#063732" />
              <path d="M 0,2 L 45,46 L 755,46 L 800,2" stroke="url(#footerCyanNeon)" stroke-width="2.5" fill="none" filter="url(#neonGlowFilter)" stroke-linecap="round" />
            </svg>
          </div>

          <!-- Social Media on Right (Black Wing) -->
          <div class="footer-notch-social">
            <span class="footer-notch-social-title">Theo dõi Erasight:</span>
            <div class="footer-notch-social-icons">
              <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" class="social-icon-btn" aria-label="Facebook">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
                </svg>
              </a>
              <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" class="social-icon-btn" aria-label="YouTube">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" class="social-icon-btn" aria-label="TikTok">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                </svg>
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" class="social-icon-btn" aria-label="LinkedIn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Main Footer Body with 5 Columns Grid -->
      <div class="footer-body">
        <div class="footer-container">
          <div class="footer-grid-5col">
            <!-- Cột 1: Thông tin pháp nhân công ty -->
            <div class="footer-col">
              <div class="footer-company-info">
                <h4 style="font-size:14px; margin-bottom:12px; color:#FFFFFF;">CÔNG TY TNHH ERASIGHT ACADEMY</h4>
                <p>Ngày cấp GCNĐKDN: 26/07/2022</p>
                <p>Nơi cấp: Sở KH&amp;ĐT TP. HCM (nay là Sở Tài chính TP. HCM)</p>
                <p>MST: 0317402205</p>
                <p>Địa chỉ: Tầng lửng, Toà nhà Fideco Riverview, Số 14 Đường Thảo Điền, Phường An Khánh, TP. Thủ Đức, TP. Hồ Chí Minh</p>
              </div>
            </div>

            <!-- Cột 2: Nội dung -->
            <div class="footer-col">
              <h4>Nội dung</h4>
              <ul>
                <li><a href="${rootPath}index.html#khoa-hoc">Bài viết &amp; Cẩm nang AI</a></li>
                <li><a href="${rootPath}index.html#khoa-hoc">Khoá học AI Marketing</a></li>
                <li><a href="${rootPath}index.html#khoa-hoc">Khoá Tiếng Anh phỏng vấn</a></li>
                <li><a href="${rootPath}index.html#lo-trinh">Hướng dẫn thực hành</a></li>
                <li><a href="${rootPath}index.html#san-pham">Sản phẩm học viên</a></li>
              </ul>
            </div>

            <!-- Cột 3: Học tập -->
            <div class="footer-col">
              <h4>Học tập</h4>
              <ul>
                <li><a href="${rootPath}index.html#khoa-hoc">Khoá học đang mở</a></li>
                <li><a href="${rootPath}index.html#lo-trinh">Bộ công cụ No-code &amp; AI</a></li>
                <li><a href="${rootPath}index.html#pricing">Đào tạo doanh nghiệp</a></li>
                <li><a href="#dang-nhap" class="login-trigger-link">Đăng nhập khoá học</a></li>
              </ul>
            </div>

            <!-- Cột 4: Điều khoản và Chính sách -->
            <div class="footer-col">
              <h4>Điều khoản và Chính sách</h4>
              <ul>
                <li><a href="${rootPath}index.html#faq">Điều khoản sử dụng và Điều kiện chung</a></li>
                <li><a href="${rootPath}index.html#pricing">Chính sách thanh toán</a></li>
                <li><a href="${rootPath}index.html#faq">Chính sách học lại "Yêu lại từ đầu"</a></li>
                <li><a href="${rootPath}index.html#faq">Chính sách bảo chứng hoàn tiền</a></li>
                <li><a href="${rootPath}index.html#faq">Chính sách quyền riêng tư</a></li>
                <li><a href="${rootPath}index.html#pricing">Quy định xuất VAT</a></li>
              </ul>
            </div>

            <!-- Cột 5: Erasight Academy -->
            <div class="footer-col">
              <h4>Erasight Academy</h4>
              <ul>
                <li><a href="${rootPath}index.html#top">Về chúng tôi</a></li>
                <li><a href="${rootPath}giang-vien.html">Đội ngũ giảng viên</a></li>
                <li><a href="${rootPath}index.html#pricing">Liên hệ ghi danh</a></li>
              </ul>
            </div>
          </div>

          <!-- 4. Hàng bản quyền dưới cùng -->
          <div class="footer-bottom-bar">
            <div>© 2026 Erasight Academy. All rights reserved. Tuân thủ Brand Guideline v2.0.</div>
            <div class="footer-mono-badge">Skills for what's next.</div>
          </div>
        </div>
      </div>

      <!-- 5. Floating Zalo Consultation Widget (Góc trái) -->
      <a href="https://zalo.me" target="_blank" rel="noopener noreferrer" class="floating-zalo-btn" aria-label="Tư vấn trực tiếp qua Zalo" title="Chat Zalo cùng ban giáo vụ Erasight">
        <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
          <path d="M24 4C13.5 4 5 12.1 5 22.1C5 25.8 6.3 29.2 8.5 32L6 41.5L16 38.8C18.4 40 21.1 40.7 24 40.7C34.5 40.7 43 32.6 43 22.6C43 12.6 34.5 4 24 4Z" fill="#FFFFFF"/>
          <g transform="translate(12, 10.5)">
            <path d="M12.49 10.2722v-.4496h1.3467v6.3218h-.7704a.576.576 0 01-.5763-.5729l-.0006.0005a3.273 3.273 0 01-1.9372.6321c-1.8138 0-3.2844-1.4697-3.2844-3.2823 0-1.8125 1.4706-3.2822 3.2844-3.2822a3.273 3.273 0 011.9372.6321l.0006.0005zM6.9188 7.7896v.205c0 .3823-.051.6944-.2995 1.0605l-.03.0343c-.0542.0615-.1815.206-.2421.2843L2.024 14.8h4.8948v.7682a.5764.5764 0 01-.5767.5761H0v-.3622c0-.4436.1102-.6414.2495-.8476L4.8582 9.23H.1922V7.7896h6.7266zm8.5513 8.3548a.4805.4805 0 01-.4803-.4798v-7.875h1.4416v8.3548H15.47zM20.6934 9.6C22.52 9.6 24 11.0807 24 12.9044c0 1.8252-1.4801 3.306-3.3066 3.306-1.8264 0-3.3066-1.4808-3.3066-3.306 0-1.8237 1.4802-3.3044 3.3066-3.3044zm-10.1412 5.253c1.0675 0 1.9324-.8645 1.9324-1.9312 0-1.065-.865-1.9295-1.9324-1.9295s-1.9324.8644-1.9324 1.9295c0 1.0667.865 1.9312 1.9324 1.9312zm10.1412-.0033c1.0737 0 1.945-.8707 1.945-1.9453 0-1.073-.8713-1.9436-1.945-1.9436-1.0753 0-1.945.8706-1.945 1.9436 0 1.0746.8697 1.9453 1.945 1.9453z" fill="#0068FF"/>
          </g>
        </svg>
        <span class="floating-zalo-badge">3</span>
      </a>
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
