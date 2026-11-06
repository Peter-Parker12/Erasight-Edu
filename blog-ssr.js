// Server-side rendering for the blog: crawlers and AI bots get the full article text, headings, links,
// meta tags and structured data in the HTML itself, with no JavaScript needed.
//
//   /blog              list (also /blog?cat=<category-slug>&page=<n>)  <- templates/blog.html
//   /blog-<post-slug>  one post                                        <- templates/blog-post.html
//   /sitemap.xml, /robots.txt
//
// Data comes from the WordPress REST API (WP_API_URL), limited to posts carrying the WP_POST_TAG tag,
// with a small in-memory cache that falls back to stale data if WordPress is briefly unreachable.
const fs = require('fs');
const path = require('path');

module.exports = function init({ ROOT, WP_API_URL, WP_POST_TAG, SITE_URL, finalize, respond }) {
  const SITE = (SITE_URL || 'https://academy.erasight.net').replace(/\/+$/, '');
  const ORG = 'Erasight Academy';
  const LOGO = `${SITE}/assets/logos/erasight-bieutuong-mau-1024w.png`;
  const PER_PAGE = 6;
  const FRESH_MS = 2 * 60 * 1000;     // reuse WordPress data for 2 minutes
  const TAG_FRESH_MS = 5 * 60 * 1000;
  const STATIC_PAGES = ['/Homepage', '/giang-vien', '/san-pham-hoc-vien', '/tai-lieu-ai', '/hoi-dap', '/blog',
    '/dieu-khoan-su-dung', '/chinh-sach-thanh-toan', '/chinh-sach-hoc-lai', '/chinh-sach-quyen-rieng-tu'];

  // ---- Text helpers ----------------------------------------------------------
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»' };
  const decode = (s) => String(s == null ? '' : s)
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return m; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } })
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] !== undefined ? NAMED[n.toLowerCase()] : m));
  const text = (html) => decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // WordPress dates have no timezone; format them as written so the day never shifts.
  const fmtDate = (d) => new Date(String(d).replace(/Z$/, '') + 'Z').toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const isoDate = (d) => (d ? String(d).replace(/Z$/, '') + (/[+-]\d\d:\d\d$/.test(d) ? '' : '+07:00') : '');
  const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

  function resolveCategory(title) {
    const t = title.toLowerCase();
    if (t.includes('ai') || t.includes('automation') || t.includes('tự động')) return 'AI & Automation';
    if (t.includes('marketing') || t.includes('mkt') || t.includes('content')) return 'Marketing';
    if (t.includes('tiếng anh') || t.includes('english') || t.includes('phỏng vấn')) return 'Tiếng Anh';
    if (t.includes('career') || t.includes('nghề') || t.includes('việc làm')) return 'Career';
    return 'Kiến thức';
  }

  // ---- WordPress access + cache ----------------------------------------------
  const cache = new Map();    // key -> { at, data }
  const inflight = new Map(); // key -> Promise

  async function wp(pathAndQuery, attempt = 1) {
    if (!WP_API_URL) throw Object.assign(new Error('WP_API_URL not configured'), { config: true });
    try {
      const res = await fetch(WP_API_URL + pathAndQuery, {
        headers: { Accept: 'application/json', 'User-Agent': 'ErasightSSR/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`WordPress ${res.status} for ${pathAndQuery}`);
      return await res.json();
    } catch (e) {
      if (attempt < 2) return wp(pathAndQuery, attempt + 1); // one retry covers a stalled connection
      throw e;
    }
  }

  // Fresh cache -> return it. Stale cache -> return it immediately and refresh in the background
  // (visitors and bots never wait on WordPress after the first load). No cache -> wait for WordPress.
  function cached(key, ttl, loader) {
    const hit = cache.get(key);
    const fresh = hit && Date.now() - hit.at < ttl;
    if (fresh) return Promise.resolve(hit.data);
    if (!inflight.has(key)) {
      const p = loader().then((data) => { cache.set(key, { at: Date.now(), data }); return data; })
        .finally(() => inflight.delete(key));
      p.catch((e) => { if (hit) console.error('WP refresh failed, keeping stale data:', e.message); });
      inflight.set(key, p);
    }
    return hit ? Promise.resolve(hit.data) : inflight.get(key);
  }

  async function tagId() {
    return cached('tag', TAG_FRESH_MS, async () => {
      const tags = await wp(`/tags?slug=${encodeURIComponent(WP_POST_TAG)}&per_page=1`);
      if (!tags.length) throw Object.assign(new Error(`WordPress tag "${WP_POST_TAG}" not found`), { config: true });
      return { id: tags[0].id, name: tags[0].name };
    });
  }

  function normalize(raw) {
    const terms = raw._embedded?.['wp:term'] || [];
    const cats = (terms[0] || []).filter((t) => t.taxonomy === 'category' && t.slug !== 'uncategorized' && String(t.name).toLowerCase() !== 'uncategorized')
      .map((t) => ({ id: t.id, name: decode(t.name), slug: t.slug }));
    const title = text(raw.title?.rendered);
    if (!cats.length) { const n = resolveCategory(title); cats.push({ id: null, name: n, slug: slugify(n) }); }
    const content = raw.content?.rendered || '';
    const words = text(content).split(/\s+/).filter(Boolean).length;
    const media = raw._embedded?.['wp:featuredmedia']?.[0];
    return {
      id: raw.id, slug: raw.slug, date: raw.date, modified: raw.modified || raw.date,
      title, excerpt: text(raw.excerpt?.rendered), content,
      imageUrl: media?.source_url || null, imageAlt: text(media?.alt_text) || title,
      categories: cats, category: cats[0],
      keywords: (terms[1] || []).filter((t) => t.taxonomy === 'post_tag' && t.slug !== WP_POST_TAG).map((t) => decode(t.name)),
      author: decode(raw._embedded?.author?.[0]?.name || ORG),
      readMinutes: Math.max(1, Math.ceil(words / 200)), words,
    };
  }

  async function posts() {
    const tag = await tagId();
    const list = await cached('posts', FRESH_MS, async () => (await wp(`/posts?per_page=100&tags=${tag.id}&_embed`)).map(normalize));
    return list;
  }

  async function postBySlug(slug) {
    const list = await posts();
    const hit = list.find((p) => p.slug === slug);
    if (hit) return hit;
    if (list.length < 100) return null; // the list is complete, so the post is not tagged / not published
    const tag = await tagId();
    const found = await wp(`/posts?slug=${encodeURIComponent(slug)}&tags=${tag.id}&_embed`);
    return found[0] ? normalize(found[0]) : null;
  }

  if (WP_API_URL) setTimeout(() => posts().catch((e) => console.error('blog warm-up failed:', e.message)), 500).unref();

  // ---- Templates -------------------------------------------------------------
  const tpl = new Map(); // file -> { mtimeMs, html }
  function template(name) {
    const file = path.join(ROOT, name);
    const { mtimeMs } = fs.statSync(file);
    const hit = tpl.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.html;
    const html = fs.readFileSync(file, 'utf8');
    tpl.set(file, { mtimeMs, html });
    return html;
  }
  const fill = (html, head, main) => html.replace('<!--SSR:HEAD-->', () => head).replace('<!--SSR:MAIN-->', () => main);

  function headTags({ title, description, canonical, image, type = 'website', robots = 'index,follow,max-image-preview:large', ld = [], extra = '' }) {
    return [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}" />`,
      `<meta name="robots" content="${robots}" />`,
      `<link rel="canonical" href="${esc(canonical)}" />`,
      `<meta property="og:site_name" content="${ORG}" />`,
      `<meta property="og:locale" content="vi_VN" />`,
      `<meta property="og:type" content="${type}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${esc(canonical)}" />`,
      `<meta property="og:image" content="${esc(image || LOGO)}" />`,
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
      `<meta name="twitter:title" content="${esc(title)}" />`,
      `<meta name="twitter:description" content="${esc(description)}" />`,
      `<meta name="twitter:image" content="${esc(image || LOGO)}" />`,
      extra,
      ...ld.map(jsonLd),
    ].filter(Boolean).join('\n  ');
  }
  const crumbs = (items) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })),
  });
  const publisher = { '@type': 'Organization', name: ORG, url: SITE, logo: { '@type': 'ImageObject', url: LOGO } };

  // ---- Rendering: shared bits ------------------------------------------------
  const url = (slug) => `/blog-${slug}`;
  const catUrl = (slug, page) => `/blog?cat=${encodeURIComponent(slug)}${page > 1 ? `&page=${page}` : ''}`;
  const listUrl = (cat, page) => (cat === 'all' ? (page > 1 ? `/blog?page=${page}` : '/blog') : catUrl(cat, page));
  const metaLine = (p) => `<p class="blog-post__meta"><span class="blog-post__meta-cat">${esc(p.category.name)}</span> • ${p.readMinutes} phút đọc</p>`;
  const noImg = '<div style="width:100%;height:100%;background:var(--line,#DDE7E7);display:grid;place-items:center;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--slate,#4A6572)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>';
  const img = (p, style = 'width:100%;height:100%;object-fit:cover;') => (p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt)}" loading="lazy" style="${style}" onerror="this.style.display='none'" />` : noImg);

  function categoryCounts(list) {
    const m = new Map();
    for (const p of list) for (const c of p.categories) {
      if (!m.has(c.slug)) m.set(c.slug, { name: c.name, slug: c.slug, count: 0 });
      m.get(c.slug).count += 1;
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }

  // ---- Rendering: list -------------------------------------------------------
  function renderList(all, cat, pageWanted) {
    const cats = categoryCounts(all);
    const isAll = cat === 'all';
    const shown = isAll ? all : all.filter((p) => p.categories.some((c) => c.slug === cat));
    const catName = cats.find((c) => c.slug === cat)?.name || cat;
    const featured = shown[0];
    const spotlight = shown.slice(1, 5);
    const feedSource = isAll ? (all.length > 5 ? all.slice(5) : all.slice(1)) : (shown.length > 1 ? shown.slice(1) : shown);
    const totalPages = Math.max(1, Math.ceil(feedSource.length / PER_PAGE));
    const page = Math.min(Math.max(1, pageWanted), totalPages);
    const pagePosts = feedSource.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const chip = (cls, href, label, n, active) => `<a href="${href}" class="${cls}${active ? ` ${cls}--active` : ''}">${esc(label)} <strong>${n}</strong></a>`;

    const ribbon = `
        <nav class="blog-ribbon" id="blogRibbon" aria-label="Chủ đề bài viết">
          ${chip('blog-ribbon__item', '/blog', 'Tất cả', all.length, isAll)}
          ${cats.map((c) => chip('blog-ribbon__item', catUrl(c.slug), c.name, c.count, cat === c.slug)).join('')}
        </nav>`;

    const videos = `
        <section class="blog-videos">
          <div class="blog-videos__head">
            <h2>Video &amp; Highlight</h2>
            <p>Nội dung nổi bật từ đội ngũ giảng viên Erasight Academy</p>
          </div>
          <div class="blog-videos__grid">
            ${all.slice(0, 3).map((p) => `
              <a href="${url(p.slug)}" class="blog-video-card">
                <div class="blog-video-card__image">${img(p)}<span class="blog-video-card__play">▶</span></div>
                <h3>${esc(p.title)}</h3>
              </a>`).join('')}
          </div>
        </section>`;

    const hero = featured ? `
        <section class="blog-hero">
          <a href="${url(featured.slug)}" class="blog-hero__feature">
            <div class="blog-hero__image-wrap">${img(featured)}</div>
            <div class="blog-hero__feature-content">
              ${metaLine(featured)}
              <h2>${esc(featured.title)}</h2>
              <p>${esc(cut(featured.excerpt, 200))}</p>
            </div>
          </a>
          <div class="blog-hero__side">
            <p class="blog-hero__side-title">Bài viết được quan tâm</p>
            ${spotlight.length ? spotlight.map((p) => `
              <a href="${url(p.slug)}" class="blog-hero__side-item">
                <div class="blog-hero__side-thumb">${img(p)}</div>
                <div>${metaLine(p)}<h3>${esc(p.title)}</h3></div>
              </a>`).join('') : '<p style="color:var(--slate);font-size:0.9rem;padding:12px 0;">Không có bài viết phụ.</p>'}
          </div>
        </section>` : '';

    const pager = totalPages > 1 ? `
              <nav class="blog-pagination" aria-label="Phân trang">
                ${page > 1 ? `<a class="blog-pagination__btn" rel="prev" href="${listUrl(cat, page - 1)}">← Trước</a>` : '<span class="blog-pagination__btn" aria-disabled="true" style="opacity:.35">← Trước</span>'}
                ${Array.from({ length: totalPages }, (_, i) => i + 1).map((i) => `<a class="blog-pagination__btn${i === page ? ' blog-pagination__btn--active' : ''}" href="${listUrl(cat, i)}"${i === page ? ' aria-current="page"' : ''}>${i}</a>`).join('')}
                ${page < totalPages ? `<a class="blog-pagination__btn" rel="next" href="${listUrl(cat, page + 1)}">Sau →</a>` : '<span class="blog-pagination__btn" aria-disabled="true" style="opacity:.35">Sau →</span>'}
              </nav>` : '';

    const feedTitle = isAll ? 'Bài viết mới nhất' : `Chủ đề: ${esc(catName)} (${shown.length})`;
    const feed = `
        <section class="blog-content">
          <div class="blog-feed">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
              <h2 class="blog-section-title" style="margin-bottom:0;">${feedTitle}</h2>
              ${!isAll ? '<a href="/blog" style="color:var(--p,#0DA096);font-size:0.88rem;font-weight:600;padding:4px 8px;text-decoration:none;">✕ Xem tất cả bài viết</a>' : ''}
            </div>
            ${pagePosts.length ? `
              <div class="blog-grid" id="blogGrid">
                ${pagePosts.map((p) => `
                  <a href="${url(p.slug)}" class="blog-card">
                    <div class="blog-card__image-wrapper">${img(p)}</div>
                    <div class="blog-card__content">
                      ${metaLine(p)}
                      <h3 class="blog-card__title">${esc(p.title)}</h3>
                      <p class="blog-card__excerpt">${esc(cut(p.excerpt, 140))}</p>
                    </div>
                  </a>`).join('')}
              </div>${pager}` : `
              <div style="padding:48px 20px;text-align:center;background:var(--pxl,#F6FAFA);border-radius:12px;border:1px dashed var(--line,#DDE7E7);">
                <p style="color:var(--slate,#4A6572);margin-bottom:12px;">Chưa có thêm bài viết trong chủ đề này.</p>
                <a href="/blog" style="display:inline-block;padding:8px 18px;border-radius:999px;background:var(--p,#0DA096);color:white;font-weight:600;text-decoration:none;">Quay lại xem tất cả</a>
              </div>`}
          </div>
          <aside class="blog-sidebar">
            <div class="blog-widget">
              <h3>Xem nhiều nhất</h3>
              <div class="blog-most-read">
                ${all.slice(0, 6).map((p, i) => `
                  <a href="${url(p.slug)}" class="blog-most-read__item">
                    <span class="blog-most-read__index">${String(i + 1).padStart(2, '0')}</span>
                    <span>${esc(p.title)}</span>
                  </a>`).join('')}
              </div>
            </div>
            <div class="blog-widget">
              <h3>Chủ đề bài viết</h3>
              <div class="blog-category-list">
                ${chip('blog-category-chip', '/blog', 'Tất cả', all.length, isAll)}
                ${cats.map((c) => chip('blog-category-chip', catUrl(c.slug), c.name, c.count, cat === c.slug)).join('')}
              </div>
            </div>
            <div class="blog-widget blog-widget--accent">
              <h3>Sẵn sàng học thực chiến?</h3>
              <p>Khám phá 2 khoá học AI Marketing và Tiếng Anh phỏng vấn — ra lớp là làm được ngay.</p>
              <a href="/Homepage#pricing" class="blog-widget__cta">Xem khoá học →</a>
            </div>
          </aside>
        </section>`;

    const canonical = SITE + listUrl(cat, page);
    const title = isAll ? `Blog — ${ORG} | Kiến thức thực chiến cho người đi làm` : `${catName} — Blog ${ORG}`;
    const description = 'Đọc các bài viết chuyên sâu về AI Marketing, kỹ năng tiếng Anh đi làm, lộ trình học tập thực chiến và xu hướng nghề nghiệp từ đội ngũ giảng viên Erasight Academy.';
    const rel = [page > 1 ? `<link rel="prev" href="${SITE + listUrl(cat, page - 1)}" />` : '', page < totalPages ? `<link rel="next" href="${SITE + listUrl(cat, page + 1)}" />` : ''].filter(Boolean).join('\n  ');
    const head = headTags({
      title: page > 1 ? `${title} (Trang ${page})` : title, description, canonical, image: all[0]?.imageUrl, extra: rel,
      robots: !isAll && !shown.length ? 'noindex,follow' : undefined,
      ld: [
        { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url: canonical, inLanguage: 'vi', isPartOf: { '@type': 'WebSite', name: ORG, url: SITE }, publisher,
          mainEntity: { '@type': 'ItemList', itemListElement: pagePosts.concat(page === 1 ? [featured, ...spotlight].filter(Boolean) : []).filter((p, i, a) => a.indexOf(p) === i).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + url(p.slug), name: p.title })) } },
        crumbs([[ORG, SITE + '/Homepage'], ['Blog', SITE + '/blog']].concat(isAll ? [] : [[catName, canonical]])),
      ],
    });
    return { head, main: ribbon + videos + hero + feed };
  }

  const emptyBlog = '<div class="blog-empty"><div class="blog-empty__icon">📝</div><h2>Chưa có bài viết nào</h2><p>Blog đang được chuẩn bị. Quay lại sớm nhé!</p></div>';

  // ---- Rendering: post -------------------------------------------------------
  function renderPost(p, all) {
    const related = [...all.filter((x) => x.id !== p.id && x.categories.some((c) => p.categories.some((pc) => pc.slug === c.slug))),
      ...all.filter((x) => x.id !== p.id && !x.categories.some((c) => p.categories.some((pc) => pc.slug === c.slug)))].slice(0, 3);
    const relatedHtml = related.length ? `
          <section style="margin-top:48px;padding-top:36px;border-top:1.5px solid var(--line,#DDE7E7);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
              <h2 style="font-family:var(--font-display,'Bricolage Grotesque',sans-serif);font-size:1.35rem;font-weight:700;color:var(--dark,#0C2A3A);">Bài viết cùng chủ đề</h2>
              <a href="${catUrl(p.category.slug)}" style="color:var(--p,#0DA096);font-size:0.88rem;font-weight:600;text-decoration:none;">Xem thêm →</a>
            </div>
            <div class="blog-related-grid">
              ${related.map((r) => `
                <a href="${url(r.slug)}" class="blog-card" style="text-decoration:none;border-radius:12px;overflow:hidden;border:1px solid var(--line,#DDE7E7);background:white;display:flex;flex-direction:column;">
                  <div style="width:100%;aspect-ratio:16/10;background:var(--line,#DDE7E7);overflow:hidden;">
                    ${r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="${esc(r.imageAlt)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />` : '<div style="width:100%;height:100%;display:grid;place-items:center;color:var(--slate);">📝</div>'}
                  </div>
                  <div style="padding:14px;display:flex;flex-direction:column;flex:1;">
                    <h3 style="font-size:0.95rem;font-weight:700;color:var(--dark,#0C2A3A);line-height:1.4;margin-bottom:8px;">${esc(r.title)}</h3>
                    <p style="font-size:0.78rem;color:var(--slate,#4A6572);margin-top:auto;">${fmtDate(r.date)}</p>
                  </div>
                </a>`).join('')}
            </div>
          </section>` : '';

    const main = `
          ${p.imageUrl ? `<div class="blog-detail__image-section"><div class="blog-detail__image-wrapper"><img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt)}" /></div></div>` : ''}
          <div class="blog-detail__container">
            <a href="/blog" class="blog-detail__back">← Về trang Blog</a>
            <article>
              <header class="blog-detail__header">
                <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
                  ${p.categories.map((c) => `<a href="${catUrl(c.slug)}" class="blog-detail__category-badge">${esc(c.name)}</a>`).join('')}
                </div>
                <h1 class="blog-detail__title">${esc(p.title)}</h1>
                <p class="blog-detail__date"><time datetime="${esc(isoDate(p.date))}">${fmtDate(p.date)}</time> • ${esc(p.author)} • ${p.readMinutes} phút đọc</p>
              </header>
              <div class="blog-detail__content">${p.content}</div>
            </article>
            ${relatedHtml}
            <div style="padding-top:32px;margin-top:36px;border-top:1.5px solid var(--line,#DDE7E7);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
              <a href="/blog" class="blog-detail__back">← Tất cả bài viết</a>
              <a href="/Homepage#pricing" style="display:inline-block;padding:10px 22px;border-radius:999px;background:var(--orange,#E85D04);color:white;font-weight:700;font-size:0.9rem;text-decoration:none;">Ghi danh khoá học →</a>
            </div>
          </div>`;

    const canonical = SITE + url(p.slug);
    const description = cut(p.excerpt || text(p.content), 160);
    const head = headTags({
      title: `${p.title} — ${ORG}`, description, canonical, image: p.imageUrl, type: 'article',
      extra: [`<meta property="article:published_time" content="${esc(isoDate(p.date))}" />`, `<meta property="article:modified_time" content="${esc(isoDate(p.modified))}" />`,
        `<meta property="article:section" content="${esc(p.category.name)}" />`, p.keywords.length ? `<meta name="keywords" content="${esc(p.keywords.join(', '))}" />` : '',
        `<meta name="author" content="${esc(p.author)}" />`].filter(Boolean).join('\n  '),
      ld: [
        { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: cut(p.title, 110), description, url: canonical, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          image: p.imageUrl ? [p.imageUrl] : [LOGO], datePublished: isoDate(p.date), dateModified: isoDate(p.modified), inLanguage: 'vi',
          author: { '@type': p.author === ORG ? 'Organization' : 'Person', name: p.author }, publisher,
          articleSection: p.categories.map((c) => c.name), keywords: p.keywords.length ? p.keywords.join(', ') : undefined, wordCount: p.words },
        crumbs([[ORG, SITE + '/Homepage'], ['Blog', SITE + '/blog'], [p.title, canonical]]),
      ],
    });
    return { head, main };
  }

  const notFoundMain = `
          <div class="blog-detail__container" style="text-align:center;padding-top:60px;">
            <a href="/blog" class="blog-detail__back">← Về trang Blog</a>
            <div style="margin-top:40px;">
              <div style="font-size:4rem;margin-bottom:16px;">🔍</div>
              <h1 style="font-family:var(--font-display);font-size:1.8rem;color:var(--dark);">Không tìm thấy bài viết</h1>
              <p style="color:var(--slate);margin-top:8px;">Bài viết có thể đã bị xoá hoặc đường dẫn không đúng.</p>
            </div>
          </div>`;

  // ---- HTTP handlers ---------------------------------------------------------
  function page(req, res, status, tplName, { head, main }, extraHeaders) {
    const html = finalize(fill(template(tplName), head, main));
    respond(req, res, { status, buf: Buffer.from(html), contentType: 'text/html; charset=utf-8', cacheControl: status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store', isText: true, extraHeaders });
  }
  const blocked = (e) => (e.config ? 'Blog chưa được cấu hình.' : 'Không tải được bài viết. Vui lòng thử lại sau ít phút.');
  const robotsNo = 'noindex,nofollow';

  return {
    async list(req, res) {
      const q = new URL(req.url, 'http://x').searchParams;
      const cat = /^[a-z0-9-]{1,80}$/.test(q.get('cat') || '') ? q.get('cat') : 'all';
      const pg = /^\d{1,4}$/.test(q.get('page') || '') ? Number(q.get('page')) : 1;
      try {
        const all = await posts();
        if (!all.length) return page(req, res, 200, 'blog.html', { head: headTags({ title: `Blog — ${ORG}`, description: 'Blog Erasight Academy', canonical: SITE + '/blog' }), main: emptyBlog });
        page(req, res, 200, 'blog.html', renderList(all, cat, pg));
      } catch (e) {
        console.error('blog list failed:', e.message);
        page(req, res, 503, 'blog.html', { head: headTags({ title: `Blog — ${ORG}`, description: 'Blog Erasight Academy', canonical: SITE + '/blog', robots: robotsNo }), main: `<div class="blog-empty"><div class="blog-empty__icon">⚠️</div><h2>${esc(blocked(e))}</h2></div>` }, { 'Retry-After': '60' });
      }
    },

    // slug: from /blog-<slug>; legacy ?id=<n> / ?slug=<s> on /blog-post.html are redirected to the slug URL
    async post(req, res, slugFromPath) {
      const q = new URL(req.url, 'http://x').searchParams;
      let slug = slugFromPath && slugFromPath !== 'post' ? slugFromPath : (q.get('slug') || null);
      try {
        const all = await posts();
        if (!slug && /^\d+$/.test(q.get('id') || '')) {
          const byId = all.find((p) => String(p.id) === q.get('id'));
          if (byId) { res.writeHead(301, { Location: url(byId.slug) }); return res.end(); }
        }
        if (slug && !/^[A-Za-z0-9%_-]+$/.test(slug)) slug = null;
        const p = slug ? (all.find((x) => x.slug === slug) || await postBySlug(slug)) : null;
        if (!p) return page(req, res, 404, 'blog-post.html', { head: headTags({ title: `Không tìm thấy bài viết — ${ORG}`, description: 'Bài viết không tồn tại.', canonical: SITE + '/blog', robots: robotsNo }), main: notFoundMain });
        if (slugFromPath && slugFromPath !== p.slug) { res.writeHead(301, { Location: url(p.slug) }); return res.end(); } // normalise percent-encoding/case
        page(req, res, 200, 'blog-post.html', renderPost(p, all));
      } catch (e) {
        console.error('blog post failed:', e.message);
        page(req, res, 503, 'blog-post.html', { head: headTags({ title: `Blog — ${ORG}`, description: 'Blog Erasight Academy', canonical: SITE + '/blog', robots: robotsNo }), main: `<div class="blog-detail__container" style="text-align:center;padding-top:60px;"><h1 style="font-family:var(--font-display);font-size:1.6rem;">${esc(blocked(e))}</h1><p><a href="/blog" class="blog-detail__back">← Về trang Blog</a></p></div>` }, { 'Retry-After': '60' });
      }
    },

    async sitemap(req, res) {
      let list = [];
      try { list = await posts(); } catch (e) { console.error('sitemap: posts unavailable:', e.message); }
      const entry = (loc, lastmod) => `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
        [...STATIC_PAGES.map((p) => entry(SITE + p)), ...list.map((p) => entry(SITE + url(p.slug), String(p.modified).slice(0, 10)))].join('\n')}\n</urlset>\n`;
      respond(req, res, { buf: Buffer.from(xml), contentType: 'application/xml; charset=utf-8', cacheControl: 'public, max-age=300', isText: true });
    },

    robots(req, res) {
      const body = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /tai-lieu-ai-admin\n\nSitemap: ${SITE}/sitemap.xml\n`;
      respond(req, res, { buf: Buffer.from(body), contentType: 'text/plain; charset=utf-8', cacheControl: 'public, max-age=3600', isText: true });
    },
  };
};
