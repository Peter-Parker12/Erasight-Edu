/**
 * ERASIGHT — survey page for participants (/khao-sat/<event>/<token>).
 * Loads the questions for the personal link, shows previous answers when the person already answered (they can change them),
 * and posts the answers. Everything from the server is written with textContent (no HTML from the server is inserted).
 */
(function () {
  'use strict';
  const root = document.getElementById('ksApp');
  const holder = document.querySelector('[data-event]');
  if (!root || !holder) return;
  const id = holder.dataset.event;
  const token = holder.dataset.token;
  const preview = holder.dataset.preview === '1'; // admin preview: the saved survey, nothing is stored
  const api = preview ? `/api/admin/events/${encodeURIComponent(id)}/survey` : `/api/survey/${encodeURIComponent(id)}/${encodeURIComponent(token)}`;

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function field(q, prev) {
    const box = el('div', 'ks-q'); box.dataset.qid = q.id; box.dataset.type = q.type;
    const label = el('div', 'ks-q__text', q.text + (q.required ? ' *' : ''));
    label.id = 'q_label_' + q.id;
    box.append(label);
    const group = el('div', 'ks-opts'); group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', label.id);
    const name = 'q_' + q.id;
    if (q.type === 'rating' || q.type === 'nps') {
      const min = q.type === 'rating' ? 1 : 0; const max = q.type === 'rating' ? 5 : 10;
      group.classList.add(q.type === 'rating' ? 'ks-opts--rating' : 'ks-opts--nps');
      for (let v = min; v <= max; v++) {
        const lab = el('label', 'ks-opt');
        const input = el('input'); input.type = 'radio'; input.name = name; input.value = String(v);
        if (prev === v) input.checked = true;
        lab.append(input, el('span', null, String(v))); group.append(lab);
      }
      if (q.type === 'nps') group.append(el('div', 'ks-scale', '0 = chắc chắn không · 10 = chắc chắn có'));
    } else if (q.type === 'choice' || q.type === 'multi') {
      for (const o of q.options) {
        const lab = el('label', 'ks-opt ks-opt--wide');
        const input = el('input'); input.type = q.type === 'choice' ? 'radio' : 'checkbox'; input.name = name; input.value = o;
        if (q.type === 'choice' ? prev === o : Array.isArray(prev) && prev.includes(o)) input.checked = true;
        lab.append(input, el('span', null, o)); group.append(lab);
      }
    } else {
      const ta = el('textarea', 'ks-text'); ta.name = name; ta.maxLength = 1000; ta.rows = 4; ta.placeholder = 'Viết ý kiến của bạn (không bắt buộc)';
      if (typeof prev === 'string') ta.value = prev;
      group.append(ta);
    }
    box.append(group);
    return box;
  }

  function draw(d) {
    root.replaceChildren();
    if (preview) root.append(el('div', 'ks-note', 'Xem thử: đây là trang người tham dự sẽ thấy. Câu trả lời không được lưu.'));
    root.append(el('p', 'ks-kicker', d.eventTitle));
    root.append(el('h1', 'ks-title', d.title));
    if (d.intro) root.append(el('p', 'ks-intro', d.intro));
    if (!d.open) { root.append(el('div', 'ks-note', 'Khảo sát này đã đóng. Cảm ơn bạn đã tham gia!')); return; }
    if (d.answered) root.append(el('div', 'ks-note ks-note--ok', 'Bạn đã trả lời khảo sát này. Bạn có thể sửa câu trả lời bên dưới.'));
    const form = el('form', 'ks-form'); form.noValidate = true;
    for (const q of d.questions) form.append(field(q, d.answers ? d.answers[q.id] : undefined));
    const hp = el('input'); hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true'); hp.className = 'ks-hp';
    const err = el('div', 'ks-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const btn = el('button', 'ks-submit', d.answered ? 'Lưu thay đổi' : 'Gửi khảo sát'); btn.type = 'submit';
    form.append(hp, err, btn);
    form.addEventListener('submit', (e) => submit(e, form, err, btn, d));
    root.append(form);
  }

  function collect(form, d) {
    const answers = {}; const missing = [];
    for (const q of d.questions) {
      const box = form.querySelector(`[data-qid="${q.id}"]`);
      let v;
      if (q.type === 'rating' || q.type === 'nps') { const c = box.querySelector('input:checked'); v = c ? Number(c.value) : undefined; }
      else if (q.type === 'choice') { const c = box.querySelector('input:checked'); v = c ? c.value : undefined; }
      else if (q.type === 'multi') { v = [...box.querySelectorAll('input:checked')].map((c) => c.value); if (!v.length) v = undefined; }
      else { const t = box.querySelector('textarea').value.trim(); v = t || undefined; }
      if (v === undefined) { if (q.required) missing.push(q.text); }
      else answers[q.id] = v;
    }
    return { answers, missing };
  }

  async function submit(e, form, err, btn, d) {
    e.preventDefault();
    if (preview) { err.textContent = 'Xem thử: câu trả lời không được lưu.'; err.hidden = false; return; }
    const { answers, missing } = collect(form, d);
    if (missing.length) { err.textContent = 'Vui lòng trả lời: ' + missing.slice(0, 3).join(' · '); err.hidden = false; err.scrollIntoView({ block: 'center' }); return; }
    err.hidden = true; btn.disabled = true; const label = btn.textContent; btn.textContent = 'Đang gửi…';
    try {
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers, website: form.querySelector('input[name="website"]').value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Có lỗi, vui lòng thử lại.');
      root.replaceChildren(el('h1', 'ks-title', 'Cảm ơn bạn!'), el('p', 'ks-intro', data.thanks || d.thanks || 'Phản hồi của bạn đã được ghi nhận.'));
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = label;
    }
  }

  fetch(api, { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) { root.replaceChildren(el('p', 'ks-note', preview ? 'Đăng nhập quản trị để xem thử.' : 'Liên kết khảo sát không hợp lệ hoặc đã hết hạn.')); return; }
    const data = await res.json();
    if (!preview) { draw(data); return; }
    const s = data.survey || {};
    draw({ eventTitle: s.eventTitle || '', title: s.title, intro: s.intro, thanks: s.thanks, open: s.open, questions: s.questions || [], answered: false, answers: null });
  }).catch(() => root.replaceChildren(el('p', 'ks-note', 'Không tải được khảo sát. Vui lòng thử lại sau.')));
})();
