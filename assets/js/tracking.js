/**
 * ERASIGHT — CAMPAIGN TRACKING + COOKIE CONSENT
 * Remembers where a visitor came from (utm_source / utm_medium / utm_campaign / utm_content, or the
 * referring site) so lead forms can send it to the CRM. First-party only: nothing is sent to third parties.
 *
 * Nothing is stored until the visitor accepts "Đo lường nguồn truy cập" in the cookie banner.
 * The choice and the tags live in this browser's localStorage (consent kept 12 months, tags 90 days).
 *
 *   ErasightTracking.utm()          -> {source, medium, campaign, content} or null  (null without consent)
 *   ErasightTracking.openSettings() -> opens the cookie options panel (also any [data-cookie-settings] link)
 */
(function () {
  'use strict';
  if (window.ErasightTracking) return;

  const CONSENT_KEY = 'erasight_consent';
  const UTM_KEY = 'erasight_utm';
  const CONSENT_MS = 365 * 864e5;
  const UTM_MS = 90 * 864e5;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: tracking just stays off */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().toLowerCase().slice(0, 100);

  // ---- Where did this visit come from? -------------------------------------
  const SOCIAL = [['facebook.com', 'facebook'], ['fb.com', 'facebook'], ['zalo.me', 'zalo'], ['tiktok.com', 'tiktok'],
    ['instagram.com', 'instagram'], ['youtube.com', 'youtube'], ['linkedin.com', 'linkedin'], ['t.co', 'x'], ['twitter.com', 'x'], ['x.com', 'x']];
  const SEARCH = [['google.', 'google'], ['bing.com', 'bing'], ['coccoc.com', 'coccoc'], ['duckduckgo.com', 'duckduckgo'], ['yahoo.com', 'yahoo']];

  function fromReferrer() {
    let host = '';
    try { host = new URL(document.referrer).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return null; }
    if (!host || host === location.hostname.replace(/^www\./, '')) return null;
    const hit = (list) => list.find(([d]) => host === d || host.endsWith('.' + d) || host.includes(d));
    const soc = hit(SOCIAL); if (soc) return { source: soc[1], medium: 'social' };
    const sea = hit(SEARCH); if (sea) return { source: sea[1], medium: 'organic' };
    return { source: host.slice(0, 100), medium: 'referral' };
  }

  function fromUrl() {
    const q = new URLSearchParams(location.search);
    const t = { source: clean(q.get('utm_source')), medium: clean(q.get('utm_medium')), campaign: clean(q.get('utm_campaign')), content: clean(q.get('utm_content')) };
    return (t.source || t.medium || t.campaign || t.content) ? t : null;
  }

  const captured = fromUrl() || fromReferrer(); // read once per page load; kept in memory until consent exists
  const explicit = !!fromUrl();                 // a tagged link always replaces the stored campaign

  // ---- Consent -------------------------------------------------------------
  function consent() {
    const c = store.get(CONSENT_KEY);
    return c && typeof c.measure === 'boolean' && Date.now() - (c.at || 0) < CONSENT_MS ? c : null;
  }

  function persist() {
    const c = consent();
    if (!c || !c.measure || !captured) return;
    const old = store.get(UTM_KEY);
    const fresh = old && Date.now() - (old.at || 0) < UTM_MS;
    if (explicit || !fresh) store.set(UTM_KEY, Object.assign({ at: Date.now() }, captured));
  }

  function choose(measure) {
    store.set(CONSENT_KEY, { v: 1, measure: !!measure, at: Date.now() });
    if (measure) persist(); else store.del(UTM_KEY);
  }

  function utm() {
    const c = consent();
    if (!c || !c.measure) return null;
    const u = store.get(UTM_KEY);
    if (!u || Date.now() - (u.at || 0) > UTM_MS) return null;
    const out = { source: u.source, medium: u.medium, campaign: u.campaign, content: u.content };
    return out.source || out.medium || out.campaign || out.content ? out : null;
  }

  persist(); // returning visitor who already accepted

  // ---- UI: banner + options panel ------------------------------------------
  const CSS = `
  .ck-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:9998;max-width:780px;margin:0 auto;background:#fff;border:1px solid #DDE7E7;border-radius:18px;box-shadow:0 18px 50px rgba(12,42,58,.22);padding:16px 20px;display:flex;gap:14px 18px;align-items:center;flex-wrap:wrap;font-family:'Be Vietnam Pro',system-ui,sans-serif;color:#0C2A3A}
  .ck-banner[hidden],.ck-modal[hidden]{display:none!important}
  .ck-txt{flex:1 1 280px;min-width:0}.ck-txt b{font-size:14.5px}
  .ck-txt p{margin:4px 0 0;font-size:13px;line-height:1.55;color:#4A6572}.ck-txt a,.ck-row a{color:#07736C;text-decoration:underline}
  .ck-actions{display:flex;gap:8px;flex-wrap:wrap}
  .ck-btn{border:1px solid #DDE7E7;background:#fff;color:#0C2A3A;border-radius:10px;padding:10px 16px;font:700 13px 'Be Vietnam Pro',system-ui,sans-serif;cursor:pointer}
  .ck-btn:hover{border-color:#0DA096}.ck-btn--pri{background:#E85D04;border-color:#E85D04;color:#fff}.ck-btn--pri:hover{background:#cf5003;border-color:#cf5003}
  .ck-modal{position:fixed;inset:0;z-index:9999;background:rgba(12,42,58,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Be Vietnam Pro',system-ui,sans-serif;color:#0C2A3A}
  .ck-box{background:#fff;border-radius:20px;max-width:500px;width:100%;max-height:92vh;overflow:auto;padding:26px;position:relative}
  .ck-box h3{font:800 20px 'Bricolage Grotesque','Be Vietnam Pro',sans-serif;margin:0 0 4px}.ck-box>p{margin:0 0 14px;font-size:13px;color:#4A6572}
  .ck-x{position:absolute;right:16px;top:10px;border:0;background:none;font-size:28px;line-height:1;cursor:pointer;color:#6b8590}
  .ck-row{border:1px solid #DDE7E7;border-radius:12px;padding:14px;margin-bottom:10px;display:flex;gap:12px;justify-content:space-between;align-items:flex-start}
  .ck-row b{font-size:14px}.ck-row p{margin:3px 0 0;font-size:12.5px;color:#4A6572;line-height:1.5}
  .ck-sw{position:relative;flex:none;width:44px;height:24px}.ck-sw input{position:absolute;inset:0;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:1}
  .ck-sw i{position:absolute;inset:0;border-radius:99px;background:#b9c9cc;transition:.15s}.ck-sw i:after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s}
  .ck-sw input:checked+i{background:#0DA096}.ck-sw input:checked+i:after{left:23px}.ck-sw input:disabled{cursor:not-allowed}.ck-sw input:disabled+i{opacity:.55}
  .ck-sw input:focus-visible+i{outline:2px solid #0C2A3A;outline-offset:2px}
  .ck-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}
  @media(max-width:520px){.ck-banner{left:10px;right:10px;bottom:10px;padding:14px}.ck-actions{width:100%}.ck-actions .ck-btn{flex:1 1 0;padding:10px 8px}}`;

  let banner, modal, toggle;

  function build() {
    if (banner) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const policy = '/chinh-sach-quyen-rieng-tu';
    banner = document.createElement('div');
    banner.className = 'ck-banner'; banner.setAttribute('role', 'region'); banner.setAttribute('aria-label', 'Cookie'); banner.hidden = true;
    banner.innerHTML = `<div class="ck-txt"><b>🍪 Erasight dùng cookie</b><p>Cookie thiết yếu giúp trang hoạt động. Với sự đồng ý của bạn, chúng tôi còn lưu <b>nguồn truy cập</b> (UTM) trên trình duyệt để biết bạn biết đến Erasight từ đâu. Xem <a href="${policy}">Chính sách quyền riêng tư</a>.</p></div>
      <div class="ck-actions"><button type="button" class="ck-btn" data-ck="reject">Từ chối</button><button type="button" class="ck-btn" data-ck="options">Tuỳ chọn</button><button type="button" class="ck-btn ck-btn--pri" data-ck="accept">Chấp nhận</button></div>`;
    modal = document.createElement('div');
    modal.className = 'ck-modal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'ckTitle');
    modal.innerHTML = `<div class="ck-box"><button type="button" class="ck-x" data-ck="close" aria-label="Đóng">×</button>
      <h3 id="ckTitle">Tuỳ chọn cookie</h3><p>Bạn có thể thay đổi bất cứ lúc nào qua liên kết “Cài đặt cookie” ở chân trang.</p>
      <div class="ck-row"><div><b>Thiết yếu</b><p>Quyền tải tài liệu trong 7 ngày và phiên quản trị. Luôn bật.</p></div><label class="ck-sw"><input type="checkbox" checked disabled aria-label="Cookie thiết yếu (luôn bật)"><i></i></label></div>
      <div class="ck-row"><div><b>Đo lường nguồn truy cập</b><p>Lưu tham số chiến dịch (utm_source, utm_campaign…) hoặc trang giới thiệu trong trình duyệt, gắn kèm khi bạn gửi form để biết kênh nào hiệu quả. Lưu 90 ngày. Không chia sẻ cho bên thứ ba.</p></div><label class="ck-sw"><input type="checkbox" id="ckMeasure" aria-label="Đo lường nguồn truy cập"><i></i></label></div>
      <div class="ck-foot"><button type="button" class="ck-btn" data-ck="rejectAll">Từ chối tất cả</button><button type="button" class="ck-btn ck-btn--pri" data-ck="save">Lưu lựa chọn</button></div></div>`;
    document.body.appendChild(banner); document.body.appendChild(modal);
    toggle = modal.querySelector('#ckMeasure');

    const done = (measure) => { choose(measure); banner.hidden = true; modal.hidden = true; };
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (a) { e.preventDefault(); openSettings(); return; }
      const b = e.target.closest && e.target.closest('[data-ck]');
      if (!b || !(banner.contains(b) || modal.contains(b))) return;
      const k = b.dataset.ck;
      if (k === 'accept') done(true);
      else if (k === 'reject' || k === 'rejectAll') done(false);
      else if (k === 'options') openSettings();
      else if (k === 'save') done(toggle.checked);
      else if (k === 'close') { modal.hidden = true; }
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) modal.hidden = true; });
  }

  function openSettings() {
    build();
    const c = consent();
    toggle.checked = !!(c && c.measure);
    modal.hidden = false;
    toggle.focus();
  }

  function init() {
    build(); // also wires the footer "Cài đặt cookie" link
    if (!consent()) banner.hidden = false;
  }

  window.ErasightTracking = { utm, openSettings, consent };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
