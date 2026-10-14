/**
 * ERASIGHT ACADEMY — MINIMAL INTERACTIVE SCRIPT
 * Tinh gọn, mượt mà, đồng bộ với kiến trúc Erasight Remote
 */

// Hàm chọn khoá học từ bảng học phí
function selectCourse(courseName) {
  const select = document.getElementById('enrollCourse');
  if (select) {
    select.value = courseName;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 1. Form Ghi Danh Giữ Chỗ (Xử lý submit & thông báo)

  // 2. Form Ghi Danh Giữ Chỗ
  const enrollForm = document.getElementById('enrollFormClean');
  const successMsg = document.getElementById('enrollSuccess');

  enrollForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = enrollForm.querySelector('button[type="submit"]');
    const originalText = btn ? btn.textContent : 'Ghi danh giữ chỗ';

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang ghi nhận thông tin...';
    }

    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      enrollForm.reset();
      if (successMsg) {
        successMsg.style.display = 'block';
        successMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 600);
  });

  // 3. Hero Visual 3D Card Flip (Lật xem hình ảnh lớp học thực tế A1.jpg)
  const flipBtn = document.getElementById('heroFlipBtn');
  const flipInner = document.getElementById('heroFlipInner');
  const flipTooltip = document.getElementById('heroFlipTooltip');
  const flipBackTextBtn = document.getElementById('heroFlipBackTextBtn');
  const photoCanvas = document.querySelector('.hero-deck-photo-canvas');

  let isFlipping = false;
  function toggleHeroFlip() {
    if (!flipInner || isFlipping) return;
    isFlipping = true;
    setTimeout(() => {
      isFlipping = false;
    }, 450);

    const isFlipped = flipInner.classList.toggle('is-flipped');
    if (flipBtn) {
      flipBtn.classList.toggle('is-flipped', isFlipped);
      flipBtn.setAttribute('aria-expanded', isFlipped ? 'true' : 'false');
      flipBtn.setAttribute('title', isFlipped ? 'Quay lại thông tin lộ trình' : 'Xem hình ảnh lớp học thực tế');
    }
    if (flipTooltip) {
      flipTooltip.textContent = isFlipped ? 'Quay lại lộ trình' : 'Xem ảnh lớp học';
    }
  }

  // Expose globally for convenience
  window.toggleHeroFlip = toggleHeroFlip;

  flipBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHeroFlip();
  });

  flipBackTextBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHeroFlip();
  });

  // Click vào card mặt sau (ảnh A1) cũng có thể lật lại lộ trình
  photoCanvas?.addEventListener('click', (e) => {
    if (!e.target.closest('button') && !e.target.closest('a')) {
      toggleHeroFlip();
    }
  });
});
