// Every pop-up fits the window on common desktop sizes: box inside the viewport, every footer button clickable at its centre.
// node fit-popups.js [baseUrl]
const puppeteer = require("puppeteer-core");
const B = process.argv[2] || "http://127.0.0.1:8772/", W = ms => new Promise(r => setTimeout(r, ms));
const SIZES = [[1280, 600], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]];
const expand = `d => { d.querySelectorAll("[data-adv]").forEach(a => { if (!a.classList.contains("open")) a.click() }); const c = d.querySelector("#vb-cust"); if (c && !c.checked) c.click() }`;
const PRE = [["Volume Bot (plan)", "openVolumeBot(true)"], ["Auto Sell", "openAuto('sell')"], ["Auto Buy", "openAuto('buy')"], ["Sniper Guard", "openSniperGuard()"], ["Deposit", "openDeposit()"], ["Withdraw", "openWithdraw()"],
  ["Add Wallets", "openAddWallets('create')"], ["Import Wallets", "openImportWallets()"], ["Delete Plan", "openDeletePlan()"], ["Simulation settings", "openSimSettings()"], ["Archive", "openArchive()"]];
const LIVE = [["Volume Bot (live)", "openVolumeBot()"], ["Cleanup", "openCleanup()"], ["Withdraw (live)", "openWithdraw()"], ["Fund Wallets", "openFundWallets()"], ["Fees", "openFees()"], ["Nuke confirm", "nukeArm()"], ["SOL price", "solPriceDialog()"]];
const WALLETS = [["Create Wallets", "openCreateLib()"], ["Create New Folder", "openNewFolder()"]];
(async () => {
  const b = await puppeteer.launch({ executablePath: require("./chrome"), headless: "new" }), p = await b.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
  let pass = 0, fail = 0; const bad = [];
  const test = async (label, f) => {
    await p.evaluate(() => document.querySelectorAll(".palette").forEach(x => x.remove()));
    const opened = await p.evaluate(f => { try { (0, eval)(f); return true } catch (e) { return String(e) } }, f); await W(250);
    await p.evaluate(new Function("return " + expand)(), await p.$(".palette .box") ? undefined : undefined).catch(() => { });
    await p.evaluate(ex => { const d = document.querySelector(".palette .box"); if (d) (0, eval)("(" + ex + ")")(d) }, expand); await W(200);
    // Auto Sell / Buy at their tallest: three strategies
    if (/Auto/.test(label)) { for (let i = 0; i < 2; i++) { await p.evaluate(() => { const b = [...document.querySelectorAll(".palette .box button")].find(x => /Add Strategy/.test(x.textContent)); b && b.click() }); await W(120) } }
    const r = await p.evaluate(() => {
      const box = document.querySelector(".palette .box"); if (!box) return { none: true };
      const R = box.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const btns = [...box.querySelectorAll(".m-f button, .m-h button")].filter(x => x.offsetParent);
      const blocked = btns.filter(x => { const q = x.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2; if (cy < 0 || cy > vh || cx < 0 || cx > vw) return true; const hit = document.elementFromPoint(cx, cy); return !(hit === x || x.contains(hit)) }).map(x => x.textContent.trim() || x.getAttribute("aria-label"));
      const body = box.querySelector(".m-b");
      return { inside: R.top >= -0.5 && R.left >= -0.5 && R.bottom <= vh + 0.5 && R.right <= vw + 0.5, blocked, h: Math.round(R.height), vh, scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false, n: btns.length };
    });
    const ok = opened === true && !r.none && r.inside && !r.blocked.length && r.n > 0;
    ok ? pass++ : (fail++, bad.push(`${label}: ${opened !== true ? opened : r.none ? "did not open" : `${r.inside ? "" : "box outside window (" + r.h + "px in " + r.vh + "px) "}${r.blocked.length ? "unclickable: " + r.blocked.join(", ") : ""}`}`));
  };
  for (const [w, h] of SIZES) {
    await p.setViewport({ width: w, height: h }); await p.goto(B + "?fit=1", { waitUntil: "networkidle2" }); await W(900);
    await p.evaluate(async () => { localStorage.clear(); newLaunch(); await new Promise(r => setTimeout(r, 300)); W_STEP = 3; wRender() }); await W(900);
    for (const [n, f] of PRE) await test(`${w}x${h} ${n}`, f);
    await p.evaluate(async () => { await quickStart(); lSpeed(0); await lStep(120) }); await W(800);
    for (const [n, f] of LIVE) await test(`${w}x${h} ${n}`, f);
    await p.evaluate(() => { document.querySelectorAll(".palette").forEach(x => x.remove()); show("wallets") }); await W(300);
    for (const [n, f] of WALLETS) await test(`${w}x${h} ${n}`, f);
  }
  bad.forEach(x => console.log("FAIL " + x)); console.log(`${pass} pop-ups fit, ${fail} don't${errs.length ? " · page errors: " + errs.slice(0, 3).join(" | ") : ""}`);
  await b.close(); process.exit(fail || errs.length ? 1 : 0);
})();
