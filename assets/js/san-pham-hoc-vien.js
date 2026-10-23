/**
 * ERASIGHT — TRANG SẢN PHẨM HỌC VIÊN
 * - Lọc đồ án theo khoá học
 * - Modal phóng to video đồ án (cùng dữ liệu với trang chủ)
 */
(function () {
  'use strict';

  // ---- Dữ liệu video đồ án (thêm đồ án mới: thêm 1 key + gắn data-video="<key>" vào card) ----
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
    const statEl = document.querySelector('[data-count="showcase"]');
    if (statEl) statEl.textContent = String(counts.all).padStart(2, '0');

    function apply(filter) {
      buttons.forEach((b) => {
        const active = b.dataset.filter === filter;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      cards.forEach((c) => {
        const course = c.dataset.course;
        const show = filter === 'all' || course === filter || course === 'all';
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

    document.querySelectorAll('[data-video]').forEach((el) => {
      el.addEventListener('click', () => open(el.dataset.video));
      if (el.getAttribute('role') === 'button') {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el.dataset.video); }
        });
      }
    });

    document.getElementById('closeVideoModalBtn')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.btn-primary')?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') close(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initFilter();
    initVideoModal();
  });
})();
