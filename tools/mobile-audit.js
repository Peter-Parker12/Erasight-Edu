#!/usr/bin/env node
/**
 * Mobile layout audit: loads every public page at phone/tablet widths and fails if any page can be
 * scrolled sideways (page wider than the screen). For each failing page it prints the elements
 * responsible, found by hiding each element and checking whether the page gets narrower.
 *
 *   npm i --no-save playwright-core        (one-time; uses the Chromium you already have via Playwright)
 *   node tools/mobile-audit.js             starts server.js on a free port, audits, stops it
 *   BASE=https://academy.erasight.net node tools/mobile-audit.js     audit a running site instead
 *
 * Env: WIDTHS="320,360,375,390,414,768,1024"  PAGES="/Homepage,/blog"  CHROMIUM=/path/to/chrome
 *      WP_API_URL / WP_POST_TAG are passed to the local server so the blog pages have posts.
 */
const { spawn } = require('child_process');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch { console.error('Missing dependency: npm i --no-save playwright-core'); process.exit(2); }

const WIDTHS = (process.env.WIDTHS || '320,360,375,390,414,768,1024').split(',').map(Number);
const PAGES = (process.env.PAGES || '/Homepage,/giang-vien,/san-pham-hoc-vien,/tai-lieu-ai,/hoi-dap,/blog,/demo-page').split(',');
const PORT = 4300 + Math.floor(Math.random() * 500);

async function startServer() {
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/+$/, ''), stop() {} };
  const child = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  return { base: `http://localhost:${PORT}`, stop: () => child.kill() };
}

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  let failures = 0;
  for (const vw of WIDTHS) {
    const mobile = vw < 900;
    const line = [];
    for (const u of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: 800 }, isMobile: mobile, hasTouch: mobile });
      const page = await ctx.newPage();
      await page.goto(srv.base + u, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      // responsive.css clips stray overflow as a last resort; switch that off so real overflow is reported
      await page.addStyleTag({ content: 'html,body{overflow-x:visible !important}' });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 700) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(40); }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      const res = await page.evaluate((vw) => {
        const sw = () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const base = sw(); const culprits = [];
        const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
        const walk = (el, depth) => {
          for (const c of el.children) {
            if (['SCRIPT', 'STYLE'].includes(c.tagName) || getComputedStyle(c).display === 'none') continue;
            const old = c.style.display; c.style.display = 'none'; const after = sw(); c.style.display = old;
            if (after < base && depth < 9) { const n = culprits.length; walk(c, depth + 1); if (culprits.length === n) culprits.push(`${label(c)} (w=${Math.round(c.getBoundingClientRect().width)})`); }
          }
        };
        if (base > vw + 1) walk(document.body, 0);
        if (!culprits.length && base > vw + 1) {
          // several elements overflow by the same amount: list the outermost ones sticking out past the right edge
          const out = [...document.body.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.position !== 'fixed' && r.width > 0 && r.right > vw + 1; });
          const set = new Set(out);
          out.filter((e) => !set.has(e.parentElement)).slice(0, 5).forEach((e) => culprits.push(`${label(e)} (right=${Math.round(e.getBoundingClientRect().right)}, w=${Math.round(e.getBoundingClientRect().width)})`));
        }
        return { base, culprits: culprits.slice(0, 5) };
      }, vw);
      const over = res.base - vw;
      if (over > 1) { failures++; line.push(`  FAIL ${u} +${over}px  <- ${res.culprits.join(' | ')}`); }
      await ctx.close();
    }
    console.log(`${String(vw).padStart(4)}px  ${line.length ? line.length + ' page(s) scroll sideways' : 'ok (' + PAGES.length + ' pages)'}`);
    line.forEach((l) => console.log(l));
  }
  await browser.close(); srv.stop();
  console.log(failures ? `\n${failures} failure(s)` : '\nAll pages fit every width.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
