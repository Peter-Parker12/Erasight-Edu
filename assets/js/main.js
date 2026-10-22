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

  // 12. Điều hướng & Chuyển Tab Lộ Trình (AI Marketing vs Tiếng Anh phỏng vấn)
  window.switchLoTrinh = function (course, updateHash = false) {
    const btnMkt = document.getElementById('tab-btn-mkt');
    const btnEng = document.getElementById('tab-btn-eng');
    const contentMkt = document.getElementById('lotrinh-content-mkt');
    const contentEng = document.getElementById('lotrinh-content-eng');

    if (!btnMkt || !btnEng || !contentMkt || !contentEng) return;

    if (course === 'eng') {
      btnEng.classList.add('active');
      btnEng.style.background = 'var(--dark, #0C2A3A)';
      btnEng.style.color = '#FFFFFF';
      btnMkt.classList.remove('active');
      btnMkt.style.background = 'transparent';
      btnMkt.style.color = 'var(--slate, #4A6572)';
      contentMkt.style.display = 'none';
      contentEng.style.display = 'grid';
    } else {
      btnMkt.classList.add('active');
      btnMkt.style.background = 'var(--dark, #0C2A3A)';
      btnMkt.style.color = '#FFFFFF';
      btnEng.classList.remove('active');
      btnEng.style.background = 'transparent';
      btnEng.style.color = 'var(--slate, #4A6572)';
      contentMkt.style.display = 'grid';
      contentEng.style.display = 'none';
    }

    if (updateHash && history.replaceState) {
      history.replaceState(null, '', window.location.pathname + window.location.search + (course === 'eng' ? '#lo-trinh-eng' : '#lo-trinh-mkt'));
    }
  };

  function syncLoTrinhFromHash() {
    const hash = (window.location.hash || '').toLowerCase();
    if (hash === '#lo-trinh-eng' || hash === '#khoa-eng') {
      window.switchLoTrinh('eng', false);
      const target = document.getElementById(hash.replace('#', '')) || document.getElementById('lo-trinh');
      target?.scrollIntoView({ behavior: 'smooth' });
    } else if (hash === '#lo-trinh-mkt' || hash === '#khoa-mkt') {
      window.switchLoTrinh('mkt', false);
      const target = document.getElementById(hash.replace('#', '')) || document.getElementById('lo-trinh');
      target?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // 13. AI Course Roadmap Pop-up Modal & Phase Interactions
  const ROADMAP_PHASES = [
    {
      step: 1,
      tag: 'CHẶNG 01 · NỀN TẢNG',
      tagClass: 'orange',
      num: '01',
      title: 'Prompting & Media',
      desc: 'Nắm cấu trúc prompt chuẩn quốc tế, dựng workflow nhận diện gương mặt người mẫu ảnh thương hiệu nhất quán 100% và tạo video ngắn AI.',
      bullets: [
        'Cấu trúc Prompting chuyên sâu cho Marketing & E-commerce',
        'Workflow khóa nhận diện khuôn mặt người mẫu nhất quán 100%',
        'Tự động hóa sản xuất video ngắn với giọng đọc AI truyền cảm'
      ],
      output: '5 bộ post chuẩn nhận diện thương hiệu + Workflow video chạy thực tế',
      duration: 'Buổi 1 – 3 · Kèm thực hành 1:1',
      image: 'assets/images/AI1.png',
      alt: 'Chặng 1: Prompting & Media'
    },
    {
      step: 2,
      tag: 'CHẶNG 02 · THỰC CHIẾN',
      tagClass: 'orange',
      num: '02',
      title: 'Automation Flow',
      desc: 'Dựng quy trình tự động hoá đăng bài đa nền tảng kết nối Google Sheets, Gemini API và Webhook mà không cần viết code.',
      bullets: [
        'Dựng pipeline tự động kết nối Google Sheets và Gemini API',
        'Thiết lập Webhook tự động đăng bài lên Fanpage & Instagram',
        'Cơ chế kiểm duyệt nội dung và cảnh báo tự động qua Telegram'
      ],
      output: 'Hệ thống Workflow auto-posting đa kênh chạy live thực tế',
      duration: 'Buổi 4 – 6 · Kèm thực hành 1:1',
      image: 'assets/images/AI2.png',
      alt: 'Chặng 2: Automation Flow'
    },
    {
      step: 3,
      tag: 'CHẶNG 03 · TỐI ƯU',
      tagClass: 'orange',
      num: '03',
      title: 'Seeding & Humanize',
      desc: 'Chiến lược seeding phễu 3 tầng kéo tương tác tự nhiên, lập lịch Content Calendar 30 ngày và xoá sạch dấu vết AI rập khuôn.',
      bullets: [
        'Chiến lược seeding phễu 3 tầng kéo organic traffic & tương tác',
        'Lập lịch Content Calendar 30 ngày chuẩn định vị thương hiệu',
        'Kỹ thuật Humanize làm mềm câu chữ, xoá hoàn toàn dấu vết AI'
      ],
      output: 'Bảng kế hoạch Seeding Calendar 30 ngày tối ưu chuyển đổi',
      duration: 'Buổi 7 – 9 · Kèm thực hành 1:1',
      image: 'assets/images/AI3.png',
      alt: 'Chặng 3: Seeding & Humanize'
    },
    {
      step: 4,
      tag: 'CHẶNG 04 · ĐÓNG GÓI',
      tagClass: 'orange',
      num: '04',
      title: 'Portfolio & Tốt nghiệp',
      desc: 'Tự dựng website portfolio cá nhân tích hợp công cụ đăng bài tự động và bảo vệ đồ án tốt nghiệp trước hội đồng chuyên môn.',
      bullets: [
        'Tự dựng website portfolio cá nhân tích hợp công cụ tự động hoá',
        'Đóng gói toàn bộ sản phẩm thực chiến vào case study ấn tượng',
        'Báo cáo đồ án tốt nghiệp trước hội đồng chuyên gia Erasight'
      ],
      output: 'Website Portfolio cá nhân chạy live + Chứng chỉ tốt nghiệp Erasight',
      duration: 'Buổi 10 – 11 · Hội đồng phản biện',
      image: 'assets/images/AI4.png',
      alt: 'Chặng 4: Portfolio & Tốt nghiệp'
    }
  ];

  let currentRoadmapStep = 1;

  function openRoadmapDetailModal(step = 1) {
    const phase = ROADMAP_PHASES.find(p => p.step === step) || ROADMAP_PHASES[0];
    currentRoadmapStep = phase.step;

    const modal = document.getElementById('aiRoadmapModal');
    const contentCol = document.getElementById('aiRmContentCol');
    const imgElem = document.getElementById('aiRmModalImg');
    const prevBtn = document.getElementById('aiRmPrevBtn');
    const nextBtn = document.getElementById('aiRmNextBtn');

    if (!modal || !contentCol || !imgElem) return;

    // Render left column content
    contentCol.innerHTML = `
      <div>
        <div class="ai-rm-head">
          <span class="ai-rm-tag ${phase.tagClass}">${phase.tag}</span>
          <span class="ai-rm-num">${phase.num}</span>
        </div>
        <h3 class="ai-rm-title" id="aiRmModalTitle">${phase.title}</h3>
        <p class="ai-rm-desc">${phase.desc}</p>
      </div>

      <div>
        <div class="ai-rm-subheading">Nội dung đào tạo trọng tâm:</div>
        <ul class="ai-rm-list">
          ${phase.bullets.map(b => `
            <li>
              <span class="ai-rm-check">✓</span>
              <span>${b}</span>
            </li>
          `).join('')}
        </ul>
      </div>

      <div class="ai-rm-output">
        <div class="ai-rm-out-label">Kết quả đầu ra:</div>
        <div class="ai-rm-out-val">${phase.output}</div>
      </div>

      <div class="ai-rm-footer-row">
        <div class="ai-rm-meta">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          <span>${phase.duration}</span>
        </div>
        <a href="#pricing" class="btn btn-primary btn-sm" onclick="closeRoadmapDetailModal(); selectCoursePackage('mkt');">
          <span>Đăng ký chặng này →</span>
        </a>
      </div>
    `;

    // Render right column image (square)
    imgElem.src = phase.image;
    imgElem.alt = phase.alt;

    // Update active tab button in topbar
    const tabs = document.querySelectorAll('.ai-rm-tab-btn');
    tabs.forEach((tab, idx) => {
      if (idx + 1 === phase.step) {
        tab.classList.add('is-active');
      } else {
        tab.classList.remove('is-active');
      }
    });

    // Update Prev / Next button state
    if (prevBtn) prevBtn.disabled = (phase.step === 1);
    if (nextBtn) nextBtn.disabled = (phase.step === ROADMAP_PHASES.length);

    modal.classList.add('is-active');
    document.body.style.overflow = 'hidden';
  }

  function closeRoadmapDetailModal() {
    const modal = document.getElementById('aiRoadmapModal');
    if (modal) {
      modal.classList.remove('is-active');
      document.body.style.overflow = '';
    }
  }

  function navigateRoadmapModal(direction) {
    const newStep = currentRoadmapStep + direction;
    if (newStep >= 1 && newStep <= ROADMAP_PHASES.length) {
      openRoadmapDetailModal(newStep);
    }
  }

  function handleAiRmBackdropClick(e) {
    if (e.target && e.target.id === 'aiRoadmapModal') {
      closeRoadmapDetailModal();
    }
  }

  window.openRoadmapDetailModal = openRoadmapDetailModal;
  window.closeRoadmapDetailModal = closeRoadmapDetailModal;
  window.navigateRoadmapModal = navigateRoadmapModal;
  window.handleAiRmBackdropClick = handleAiRmBackdropClick;

  // Keyboard navigation for modal
  window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('aiRoadmapModal');
    if (!modal || !modal.classList.contains('is-active')) return;

    if (e.key === 'Escape') {
      closeRoadmapDetailModal();
    } else if (e.key === 'ArrowLeft') {
      navigateRoadmapModal(-1);
    } else if (e.key === 'ArrowRight') {
      navigateRoadmapModal(1);
    }
  });

  // 14. Interactive Link Between Left Phase Milestones & Right Cards
  const phaseItems = document.querySelectorAll('.ai-phase-item');
  phaseItems.forEach((item, index) => {
    const targetId = item.getAttribute('data-target');
    const targetCard = targetId ? document.getElementById(targetId) : null;
    if (!targetCard) return;

    item.addEventListener('mouseenter', () => {
      targetCard.classList.add('phase-highlight');
    });
    item.addEventListener('mouseleave', () => {
      targetCard.classList.remove('phase-highlight');
    });
    item.addEventListener('click', () => {
      openRoadmapDetailModal(index + 1);
    });
  });

  document.querySelectorAll('.tl-step-card[id], .tl-step-flip[id]').forEach((card, index) => {
    const cardId = card.id;
    const matchingPhase = document.querySelector(`.ai-phase-item[data-target="${cardId}"]`);
    if (matchingPhase) {
      card.addEventListener('mouseenter', () => matchingPhase.classList.add('is-hovered'));
      card.addEventListener('mouseleave', () => matchingPhase.classList.remove('is-hovered'));
    }
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openRoadmapDetailModal(index + 1);
      }
    });
  });

  syncLoTrinhFromHash();
  window.addEventListener('hashchange', syncLoTrinhFromHash);
});
