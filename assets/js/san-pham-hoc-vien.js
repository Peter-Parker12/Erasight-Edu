/**
 * ERASIGHT — TRANG SẢN PHẨM HỌC VIÊN
 * - Danh sách đồ án lấy động từ API (/api/showcases), quản trị tại /admin
 * - Lọc đồ án theo khoá học (Tab Tất cả ẩn thẻ soon, tab con hiện thẻ soon)
 * - Modal phóng to video đồ án
 */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Dữ liệu video cho modal phóng to
  const VIDEO_DATA = {
    a1: {
      src: 'assets/videos/A1.mp4',
      poster: 'assets/images/A1_frame.jpg',
      title: 'Auto-Publishing không bị chặn cache Facebook cho dân Marketing',
      meta: 'Học viên: <strong>Phương Thanh</strong> · Khoá <strong>MKT_001</strong> · Kỹ thuật: <strong>Automation Script (Facebook Login &amp; Scheduled Upload qua CSV)</strong>',
      pills: ['✦ Đọc CSV cứng', '✦ Vượt cache Facebook', '✦ Không tốn Token AI', '✦ Đăng bài chuẩn giờ'],
      previewId: 'previewVideo'
    },
    q1: {
      src: 'assets/videos/Q1.mp4',
      poster: 'assets/images/Q1_poster.jpg',
      title: 'Xây dựng Video Motion Graphic dài không tốn token qua Remotion Skills',
      meta: 'Học viên: <strong>Lương Thị Thủy Tiên</strong> · Khoá <strong>MKT_001</strong> · Kỹ thuật: <strong>Remotion Skills + Google Gemini Spark Branding &amp; AI Agent</strong>',
      pills: ['✦ Remotion Motion Graphic', '✦ Google Gemini Spark', '✦ Không tốn Token AI', '✦ Gemini Agent Branding'],
      previewId: 'previewVideoQ1'
    }
  };

  let activeFilter = 'all';

  async function loadShowcases() {
    try {
      const res = await fetch('/api/showcases', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && Array.isArray(data.showcases) && data.showcases.length > 0) {
        renderShowcases(data.showcases);
      }
    } catch (e) {
      console.warn('Dùng danh sách đồ án sẵn có:', e.message);
    }
    initFilter();
    initVideoModal();
  }

  function renderShowcases(list) {
    const grid = document.getElementById('showcaseGrid');
    if (!grid) return;

    // Cập nhật VIDEO_DATA cho modal
    list.forEach((item) => {
      if (item.mediaType === 'video') {
        const vKey = item.videoKey || item.id;
        VIDEO_DATA[vKey] = {
          src: item.mediaUrl || item.videoStaticSrc || 'assets/videos/A1.mp4',
          poster: item.posterUrl || 'assets/images/A1_frame.jpg',
          title: item.title,
          meta: `Học viên: <strong>${esc(item.studentName)}</strong> · <strong>${esc(item.studentRole || '')}</strong>`,
          pills: ['✦ Đồ án thực chiến', '✦ Trực quan & Sáng tạo', '✦ Mentor review 1:1'],
          previewId: 'previewVideo_' + item.id
        };
      }
    });

    const itemsHtml = list.map((item) => {
      const isVideo = item.mediaType === 'video';
      const vKey = item.videoKey || item.id;
      const thumbUrl = item.posterUrl || (item.mediaType === 'image' ? item.mediaUrl : 'assets/images/project_ats_resume.png');
      const badgeText = item.badge || (isVideo ? 'Live Demo' : 'Kết quả thật');

      // Avatar: Nếu có ảnh thật (avatarUrl) thì hiển thị ảnh tròn, nếu không có thì draft chữ cái
      const avatarHtml = item.avatarUrl
        ? `<img class="avatar" src="${esc(item.avatarUrl)}" alt="${esc(item.studentName)}" />`
        : `<span class="avatar is-${esc(item.avatarColor || 'orange')}" aria-hidden="true">${esc(item.avatarDraft || 'HV')}</span>`;

      const videoThumbHtml = isVideo ? `
        <div class="asset-thumb asset-thumb--video" data-video="${esc(vKey)}" role="button" tabindex="0" aria-label="Phóng to video đồ án của ${esc(item.studentName)}" title="Nhấn để phóng to xem chi tiết video">
          <video id="previewVideo_${esc(item.id)}" poster="${esc(thumbUrl)}" autoplay muted loop playsinline preload="metadata" title="${esc(item.title)}">
            <source src="${esc(item.mediaUrl || item.videoStaticSrc)}" type="video/mp4" />
            ${item.videoWebmSrc ? `<source src="${esc(item.videoWebmSrc)}" type="video/webm" />` : ''}
          </video>
          <span class="asset-badge-live">${esc(badgeText)}</span>
          <div class="asset-zoom-overlay">
            <span class="asset-zoom-btn">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
              <span>Phóng to xem chi tiết</span>
            </span>
          </div>
        </div>` : `
        <div class="asset-thumb">
          <img src="${esc(thumbUrl)}" alt="${esc(item.title)}" loading="lazy" />
          <span class="asset-badge-live">${esc(badgeText)}</span>
        </div>`;

      const courseCategory = item.category || (item.course === 'eng' ? 'English Track · Kết quả học viên' : 'AI Marketing · Đồ án tốt nghiệp');
      const categoryColorStyle = item.course === 'eng' ? 'style="color:var(--blue);"' : '';

      const zoomBtnHtml = isVideo ? `
        <button type="button" class="btn-text-zoom" data-video="${esc(vKey)}" aria-label="Phóng to video đồ án">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
          Xem video
        </button>` : '';

      return `
        <article class="asset-card" data-course="${esc(item.course)}">
          ${videoThumbHtml}
          <div class="asset-body">
            <span class="asset-k" ${categoryColorStyle}>${esc(courseCategory)}</span>
            <h3>${esc(item.title)}</h3>
            <p>${esc(item.description)}</p>
            <div class="asset-foot asset-foot-row">
              <span class="asset-author">
                ${avatarHtml}
                <span><span class="name">${esc(item.studentName)}</span><span class="role">${esc(item.studentRole || '')}</span></span>
              </span>
              ${zoomBtnHtml}
            </div>
          </div>
        </article>`;
    }).join('');

    const placeholderHtml = `
      <article class="asset-card asset-card--soon is-hidden" data-course="all">
        <div class="soon-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </div>
        <h3>Đồ án tiếp theo có thể là của bạn</h3>
        <p>Đồ án của các khoá mới sẽ được cập nhật liên tục tại đây sau mỗi buổi bảo vệ cuối khoá.</p>
      </article>`;

    grid.innerHTML = itemsHtml + placeholderHtml;
  }

  // ---- Bộ lọc khoá học ----
  function initFilter() {
    const buttons = document.querySelectorAll('.res-filter-btn[data-filter]');
    const cards = document.querySelectorAll('#showcaseGrid .asset-card');

    // Tự đếm số đồ án theo từng khoá
    const counts = { all: 0 };
    cards.forEach((c) => {
      const course = c.dataset.course;
      if (course === 'all') return; // card giữ chỗ không tính
      counts.all += 1;
      counts[course] = (counts[course] || 0) + 1;
    });
    document.querySelectorAll('[data-filter-count]').forEach((el) => {
      el.textContent = counts[el.dataset.filterCount] || 0;
    });

    function apply(filter) {
      activeFilter = filter;
      buttons.forEach((b) => {
        const active = b.dataset.filter === filter;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      cards.forEach((c) => {
        const course = c.dataset.course;
        const isSoon = c.classList.contains('asset-card--soon') || course === 'all';
        let show;
        if (isSoon) {
          // Tab "Tất cả": không hiển thị card giữ chỗ; các tab con ("AI Marketing", "Tiếng Anh"...): hiển thị
          show = filter !== 'all';
        } else {
          show = filter === 'all' || course === filter;
        }
        c.classList.toggle('is-hidden', !show);
      });
    }

    buttons.forEach((b) => b.addEventListener('click', () => {
      apply(b.dataset.filter);
      if (history.replaceState) {
        history.replaceState(null, '', b.dataset.filter === 'all' ? location.pathname : '#' + b.dataset.filter);
      }
    }));

    const hash = location.hash.replace('#', '');
    if (hash === 'mkt' || hash === 'eng') apply(hash);
    else apply('all');
  }

  // ---- Modal video ----
  function initVideoModal() {
    const modal = document.getElementById('videoDetailModal');
    const vid = document.getElementById('modalFullVideo');
    const titleEl = document.getElementById('videoModalTitle');
    const metaEl = document.getElementById('videoModalMeta');
    const pillsEl = document.getElementById('videoModalPills');
    if (!modal || !vid) return;

    function open(key) {
      const data = VIDEO_DATA[key];
      if (!data) return;
      titleEl.textContent = data.title;
      metaEl.innerHTML = data.meta;
      pillsEl.innerHTML = data.pills.map((p) => '<span class="tech-pill">' + p + '</span>').join('');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      if (vid.dataset.currentKey !== key) {
        vid.dataset.currentKey = key;
        vid.src = data.src;
        vid.poster = data.poster;
        vid.load();
      }
      const prev = data.previewId && document.getElementById(data.previewId);
      if (prev && prev.currentTime) vid.currentTime = prev.currentTime;
      vid.play().catch(() => {});
    }

    function close() {
      modal.style.display = 'none';
      document.body.style.overflow = '';
      vid.pause();
    }

    // Gắn sự kiện click
    document.querySelectorAll('[data-video]').forEach((el) => {
      el.onclick = () => open(el.dataset.video);
      if (el.getAttribute('role') === 'button') {
        el.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el.dataset.video); }
        };
      }
    });

    const closeBtn = document.getElementById('closeVideoModalBtn');
    if (closeBtn) closeBtn.onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    const modalPriBtn = modal.querySelector('.btn-primary');
    if (modalPriBtn) modalPriBtn.onclick = close;
    document.onkeydown = (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') close(); };
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadShowcases();
  });
})();
