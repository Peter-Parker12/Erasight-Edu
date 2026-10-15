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
  const errorMsg = document.getElementById('enrollError');

  enrollForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = enrollForm.querySelector('button[type="submit"]');
    const originalText = btn ? btn.textContent : 'Ghi danh giữ chỗ';

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang ghi nhận thông tin...';
    }
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    // Select value is a comma-separated list of Moodle course ids (e.g. "2,3" = combo)
    const payload = {
      name: document.getElementById('name').value,
      phone: document.getElementById('phone').value,
      email: document.getElementById('email').value,
      courses: document.getElementById('enrollCourse').value.split(',').map(Number),
      website: document.getElementById('website').value,
    };

    try {
      const res = await fetch('/api/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      enrollForm.reset();
      if (successMsg) {
        successMsg.style.display = 'block';
        successMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (err) {
      if (errorMsg) {
        errorMsg.style.display = 'block';
        errorMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
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

  // 4. B6 Workflow Slide Trigger & Popup Frame ("Kéo qua / Bấm xem Ảnh B6")
  const answerLayout = document.getElementById('answerLayout');
  const b6Trigger = document.getElementById('b6SlideTrigger');
  const b6Popup = document.getElementById('answerB6Popup');
  const b6Lightbox = document.getElementById('b6LightboxModal');

  function toggleB6Popup(forceState) {
    if (!answerLayout) return;
    const isCurrentlyOpen = answerLayout.classList.contains('is-b6-open');
    const newState = (forceState !== undefined) ? forceState : !isCurrentlyOpen;

    if (newState) {
      answerLayout.classList.add('is-b6-open');
      if (b6Trigger) {
        b6Trigger.setAttribute('aria-expanded', 'true');
        const label = b6Trigger.querySelector('.b6-trigger-label');
        if (label) label.textContent = '‹ Đóng Ảnh B6';
      }
    } else {
      answerLayout.classList.remove('is-b6-open');
      if (b6Trigger) {
        b6Trigger.setAttribute('aria-expanded', 'false');
        const label = b6Trigger.querySelector('.b6-trigger-label');
        if (label) label.textContent = 'Kéo / Bấm xem B6';
      }
    }
  }

  function openB6Lightbox() {
    if (b6Lightbox) {
      b6Lightbox.classList.add('is-active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeB6Lightbox(e) {
    if (e && e.target && e.target.classList.contains('b6-lightbox-img')) {
      return; // click on image itself does not close
    }
    if (b6Lightbox) {
      b6Lightbox.classList.remove('is-active');
      document.body.style.overflow = '';
    }
  }

  window.toggleB6Popup = toggleB6Popup;
  window.openB6Lightbox = openB6Lightbox;
  window.closeB6Lightbox = closeB6Lightbox;

  // Click & Drag ("Kéo qua") interaction for b6Trigger
  if (b6Trigger) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    const dragThreshold = 25;

    b6Trigger.addEventListener('click', (e) => {
      // If was dragging across, do not re-toggle on click
      if (Math.abs(currentX - startX) > 8) return;
      toggleB6Popup();
    });

    b6Trigger.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      currentX = e.clientX;
      isDragging = true;
      b6Trigger.style.cursor = 'grabbing';
      b6Trigger.setPointerCapture(e.pointerId);
    });

    b6Trigger.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      currentX = e.clientX;
      const diffX = currentX - startX;
      b6Trigger.style.transform = `translateY(-50%) translateX(${diffX * 0.4}px)`;
    });

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      b6Trigger.style.cursor = 'grab';
      b6Trigger.style.transform = '';
      const diffX = currentX - startX;
      if (Math.abs(diffX) >= dragThreshold) {
        toggleB6Popup();
      }
    };

    b6Trigger.addEventListener('pointerup', endDrag);
    b6Trigger.addEventListener('pointercancel', endDrag);
  }

  // Escape key closes lightbox and popup
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (b6Lightbox?.classList.contains('is-active')) {
        closeB6Lightbox();
      } else if (answerLayout?.classList.contains('is-b6-open')) {
        toggleB6Popup(false);
      }
    }
  });

  // 5. GSAP Typewriter Animation for Statement Section
  // "học xong phải mang về sản phẩm dùng được ngay vào sáng thứ Hai."
  const statementSec = document.querySelector('.statement');
  const typingContainer = document.getElementById('statementTypewriter');
  const typingTextEl = document.getElementById('statementTypingText');
  const cursorEl = document.getElementById('statementCursor');
  const fullText = "học xong phải mang về sản phẩm dùng được ngay vào sáng thứ Hai.";

  if (statementSec && typingContainer && typingTextEl) {
    // Clear initial text for clean typing effect on scroll
    typingTextEl.textContent = "";

    const runTypewriter = () => {
      if (typingContainer.dataset.typed === "true") return;
      typingContainer.dataset.typed = "true";

      const state = { count: 0 };
      if (window.gsap) {
        gsap.to(state, {
          count: fullText.length,
          duration: 3,
          ease: "none",
          onUpdate: () => {
            const currentCount = Math.round(state.count);
            typingTextEl.textContent = fullText.slice(0, currentCount);
          },
          onComplete: () => {
            typingTextEl.textContent = fullText;
            setTimeout(() => {
              cursorEl?.classList.add('is-done');
            }, 1200);
          }
        });
      } else {
        // Fallback smooth typewriter
        let idx = 0;
        const interval = 3000 / fullText.length;
        const timer = setInterval(() => {
          idx++;
          typingTextEl.textContent = fullText.slice(0, idx);
          if (idx >= fullText.length) {
            clearInterval(timer);
            setTimeout(() => {
              cursorEl?.classList.add('is-done');
            }, 1200);
          }
        }, interval);
      }
    };

    if (window.gsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      ScrollTrigger.create({
        trigger: statementSec,
        start: "top 78%",
        once: true,
        onEnter: runTypewriter
      });
    } else {
      // IntersectionObserver fallback
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            runTypewriter();
            observer.disconnect();
          }
        });
      }, { threshold: 0.25 });
      observer.observe(statementSec);
    }
  }
});
