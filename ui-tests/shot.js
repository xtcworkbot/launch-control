// Screenshot + layout checker using the installed Google Chrome (puppeteer-core, no extra browser download).
// node shot.js <url> <outPrefix> [--widths 1440,390] [--wait ms] [--script steps.js]
// steps.js exports async (page, snap) => { ...; await snap("name"); } for multi-step captures.
// For every capture it also reports: console errors, horizontal overflow, and overlapping visible controls.
const puppeteer = require("puppeteer-core");
const path = require("path");
const CHROME = require("./chrome");

const args = process.argv.slice(2);
const url = args[0], prefix = args[1] || "shot";
const opt = k => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : null; };
const widths = (opt("widths") || "1440,390").split(",").map(Number);
const wait = +(opt("wait") || 1500);
const script = opt("script");

async function audit(page) {
  return page.evaluate(() => {
    const out = { overflowX: document.documentElement.scrollWidth - window.innerWidth, overlaps: [] };
    const els = [...document.querySelectorAll("button, a, input, select, label, .stat, h1, h2, h3")].filter(e => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      const closed = e.closest("details:not([open])"); if (closed && !e.closest("summary")) return false;
      return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && e.offsetParent !== null;
    });
    // clip each control to its scrolling ancestors: rows scrolled out of a table or dialog body aren't on screen
    const clipRect = e => { let r = e.getBoundingClientRect(), L = r.left, T = r.top, R = r.right, B = r.bottom;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === "auto" || o === "scroll" || o === "hidden") { const q = p.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom) } }
      return R - L > 2 && B - T > 2 ? { left: L, top: T, right: R, bottom: B } : null };
    const rects = els.map(e => [e, clipRect(e)]).filter(x => x[1]);
    for (let i = 0; i < rects.length && out.overlaps.length < 15; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, ra] = rects[i], [b, rb] = rects[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (a.closest(".status, .topbar") !== b.closest(".status, .topbar")) continue;   // content scrolls under the sticky bars by design
        if (!!a.closest(".palette") !== !!b.closest(".palette")) continue;   // dialogs sit over the page by design
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 3 && iy > 3) out.overlaps.push(`${a.tagName}.${a.className || ""}("${(a.textContent || a.value || "").trim().slice(0, 20)}") x ${b.tagName}.${b.className || ""}("${(b.textContent || b.value || "").trim().slice(0, 20)}")`);
      }
    const clipped = [...document.querySelectorAll("button, .stat span, label, td, th")].filter(e => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === "hidden");
    out.clipped = clipped.slice(0, 10).map(e => e.textContent.trim().slice(0, 30));
    return out;
  });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--hide-scrollbars"] });
  const report = [];
  for (const w of widths) {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push(String(e)));
    await page.setViewport({ width: w, height: w < 600 ? 844 : 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise(r => setTimeout(r, wait));
    const snap = async name => {
      const file = path.resolve(`${prefix}-${name}-${w}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const a = await audit(page);
      report.push({ file, width: w, errors: errors.splice(0), ...a });
    };
    if (script) await require(path.resolve(script))(page, snap, w); else await snap("page");
    await page.close();
  }
  await browser.close();
  for (const r of report) {
    console.log(`${path.basename(r.file)}  overflowX=${r.overflowX}  errors=${r.errors.length}  overlaps=${r.overlaps.length}  clipped=${r.clipped.length}`);
    for (const e of r.errors) console.log("   ERR " + e.slice(0, 200));
    for (const o of r.overlaps) console.log("   OVERLAP " + o);
    for (const c of r.clipped) console.log("   CLIPPED " + c);
  }
})().catch(e => { console.error(e); process.exit(1); });
