// Regression checks for the click-through audit (15 Oct 2026): each finding is driven through the real UI and must stay fixed.
// node ui-fixes.js [baseUrl]   (needs the server: node ui-tests/serve.js dist 8772)
const puppeteer = require("puppeteer-core");
const B = process.argv[2] || "http://127.0.0.1:8772/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, info = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (info !== "" ? `  [${info}]` : "")); ok ? pass++ : fail++ };
(async () => {
  const b = await puppeteer.launch({ executablePath: require("./chrome"), headless: "new" });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const errors = []; p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()) });
  const key = async k => { await p.keyboard.press(k); await sleep(150) };
  const pops = () => p.evaluate(() => document.querySelectorAll(".palette").length);
  await p.goto(B + "?e=1", { waitUntil: "networkidle2" }); await sleep(1200);
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "networkidle2" }); await sleep(1200);

  // H2: Token Buy % accepts only 0 .. what the curve sells, and a wallet at 0% keeps its pen
  await p.evaluate(() => { newLaunch(); W_STEP = 3; wRender() }); await sleep(1200);
  const tb = async v => { await p.evaluate(() => { const b = document.querySelectorAll(".fw-table .pen")[1]; b.click() }); await sleep(100);
    await p.evaluate(v => { const i = document.querySelector(".tb-ed input"); i.value = v }, v); await key("Enter"); await sleep(700);
    return p.evaluate(() => JSON.stringify(WCFG.buy_overrides || {})) };
  check("Token Buy %: 200 is refused", (await tb("200")) === "{}");
  await p.evaluate(() => rerenderStage()); await sleep(300);
  check("Token Buy %: text is refused", (await tb("abc")) === "{}");
  await p.evaluate(() => rerenderStage()); await sleep(300);
  check("Token Buy %: 0 is saved and the pen stays", /:0\b/.test(await tb("0")) && await p.evaluate(() => document.querySelectorAll(".fw-table tbody tr")[1].querySelector(".pen") !== null));

  // M1: Rescue locks Distribute and refunds what the wallets hold when it finishes
  const f0 = await p.evaluate(() => PRE.funder);
  await p.evaluate(() => { doRescue(); wDistribute() }); await sleep(1300);
  check("Rescue then Distribute: no SOL lost", await p.evaluate(f0 => Math.abs(PRE.funder - f0) < 1e-6 && preDistributed() === 0, f0), await p.evaluate(() => PRE.funder));

  // M2: two Counter strategies before launch are both kept
  await p.evaluate(() => openAuto("sell")); await sleep(200);
  await p.evaluate(() => { const d = document.querySelector(".pop"), r = d.querySelector('[data-k="rep"]'); r.value = 20; r.dispatchEvent(new Event("input", { bubbles: true })); d.querySelector('[data-act="addstrat"]').click() }); await sleep(200);
  await p.evaluate(() => { const d = document.querySelector(".pop"), r = d.querySelector('[data-k="rep"]'); r.value = 10; r.dispatchEvent(new Event("input", { bubbles: true })) }); await sleep(100);
  await p.evaluate(() => document.querySelector(".pop [data-go]").click()); await sleep(300);
  check("Auto Sell: 2 strategies before launch are both saved", await p.evaluate(() => WCFG.as_counter && (WCFG.as_extra || []).length === 1), await p.evaluate(() => JSON.stringify(WCFG.as_extra || []).slice(0, 80)));
  check("L14: Auto Buy opens without an error showing", await p.evaluate(() => { openAuto("buy"); const ok = !document.querySelector(".pop .note.bad"); document.querySelector(".pop [data-close]").click(); return ok }));

  // M3: ⌘K finds drafts, and Enter on a configuration opens it
  await key("Escape"); await p.keyboard.down("Meta"); await p.keyboard.press("k"); await p.keyboard.up("Meta"); await sleep(200);
  await p.type(".palette input", "block-0 clean"); await key("Enter"); await sleep(500);
  check("Search: Enter on a configuration opens it (no page error)", await p.evaluate(() => ROUTE === "config" && cur && cur.name === "Block-0 Clean Build"));
  await p.evaluate(() => openSearch()); await sleep(150); await p.type(".palette input", "untitled"); await sleep(150);
  check("Search: drafts are listed", await p.evaluate(() => /Draft/.test(document.querySelector(".palette .res").textContent)));
  await key("Escape");

  // M5 / L1: Escape closes only the top pop-up; Enter submits; an edited pop-up survives a stray outside click
  await p.evaluate(() => { window.__go = 0; popup({ title: "A", body: `<input id="pa">`, right: ["Go", () => { window.__go++ }] }); popup({ title: "B", body: `<input id="pb">`, right: ["Go", () => { window.__go += 10 }] }) }); await sleep(200);
  await key("Escape");
  check("Escape closes only the top pop-up", (await pops()) === 1);
  await p.evaluate(() => document.querySelector("#pa").focus()); await key("Enter");
  check("Enter submits the pop-up", await p.evaluate(() => window.__go === 1 && !document.querySelector(".palette")));
  await p.evaluate(() => popup({ title: "C", body: `<input id="pc">`, right: ["Go", () => { }] })); await sleep(150);
  await p.type("#pc", "x"); await p.evaluate(() => document.querySelector(".palette").click()); await sleep(150);
  check("Outside click doesn't discard edits", (await pops()) === 1);
  await p.evaluate(() => document.querySelector(".palette [data-close]").click());

  // M6 / M7: required name, ranges, socials and image kept with the draft
  await p.evaluate(() => { newLaunch(); W_STEP = 1; wRender() }); await sleep(300);
  await p.evaluate(() => { const i = $("w-name"); i.value = ""; i.dispatchEvent(new Event("input")) });
  await p.evaluate(() => wGo(1)); await sleep(200);
  check("Empty Project Name blocks Create with an error", await p.evaluate(() => W_STEP === 1 && /required/.test((document.querySelector(".pf-err") || {}).textContent || "")));
  await p.evaluate(() => { const i = $("w-name"); i.value = "Fix Test"; i.dispatchEvent(new Event("input")); const s = document.querySelector(".socials input"); s.value = "x.com/fix"; s.dispatchEvent(new Event("input")) });
  await p.evaluate(() => wGo(1)); await sleep(300); await p.evaluate(() => wGo(-1)); await sleep(300);
  check("Socials survive switching steps", await p.evaluate(() => document.querySelector(".socials input").value === "x.com/fix"));
  await p.evaluate(() => wGo(1)); await sleep(300);
  await p.evaluate(() => { const i = document.querySelector('[data-rule="wallets"]'); i.value = 500; i.dispatchEvent(new Event("change")) }); await sleep(200);
  check("Holders Count 500 is refused with an error", await p.evaluate(() => WCFG.wallets !== 500 && /between 1 and 200/.test((document.querySelector(".pf-err") || {}).textContent || "")));
  await p.evaluate(() => { const i = document.querySelector('[data-rule="dev_buy_pct"]'); i.value = -3; i.dispatchEvent(new Event("change")) }); await sleep(200);
  check("Developer Buy -3% is refused", await p.evaluate(() => WCFG.dev_buy_pct >= 0));
  check("L6: a new launch starts with no automations", await p.evaluate(() => !WCFG.vb_enabled && !WCFG.as_enabled && !WCFG.exit_enabled && WCFG.launchpad === "pumpfun"));

  // M9: the sidebar collapse button collapses (and stays on the page)
  await p.evaluate(() => show("wallets")); await sleep(200);
  await p.evaluate(() => document.querySelector(".brand .collapse").click()); await sleep(200);
  check("Sidebar collapses without leaving the page", await p.evaluate(() => document.querySelector(".app").classList.contains("mini") && ROUTE === "wallets"));
  await p.evaluate(() => document.querySelector(".burger").click()); await sleep(200);
  check("Top-left button brings the sidebar back", await p.evaluate(() => !document.querySelector(".app").classList.contains("mini")));

  // M13: Marketplace in My Wallets adds wallets there and leaves the draft alone
  const src0 = await p.evaluate(() => WCFG.wallet_source);
  await p.evaluate(() => { document.querySelector(".mk-card").click() }); await sleep(200);
  await p.evaluate(() => document.querySelector(".pop [data-go]").click()); await sleep(300);
  check("Marketplace adds aged wallets to My Wallets", await p.evaluate(src0 => MYW.filter(w => w.aged).length === 20 && WCFG.wallet_source === src0, src0));
  await p.evaluate(() => openColsMenu({ preventDefault() { }, stopPropagation() { }, currentTarget: document.querySelector(".wl-bar .ic.sq2") })); await sleep(150);
  await p.evaluate(() => document.querySelector('.ctx-menu [data-a="4"]').click()); await sleep(200);
  check("L3: Columns gear hides a column", await p.evaluate(() => document.querySelector(".wl-table table").classList.contains("hc4")));

  // live launch: header and clock reachable at 1280; Nuke summary; Sniper Guard re-arm; Funder figure; sidebar Archive asks
  await p.setViewport({ width: 1280, height: 720 });
  await p.evaluate(async () => { await quickStart(); lSpeed(0); await lStep(60) }); await sleep(1200);
  check("H1: clock and header buttons reachable at 1280x720", await p.evaluate(() => [...document.querySelectorAll("#ck button"), document.querySelector(".tw-right .btn.wd"), document.querySelector(".tw-right .ar-btn")].every(el => { const r = el.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t && (t === el || el.contains(t)) })));
  await p.setViewport({ width: 1440, height: 900 }); await sleep(300);
  await p.evaluate(() => document.querySelector("#nk").click()); await sleep(200);
  await p.evaluate(() => { const c = document.querySelector("#nk-dev-only"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })) }); await sleep(100);
  check("M11: Nuke summary follows Dev wallet only", await p.evaluate(() => /in 1 wallet /.test($("nk-sum").textContent)), await p.evaluate(() => $("nk-sum").textContent.slice(0, 60)));
  await key("Escape");
  await p.evaluate(() => openSniperGuard()); await sleep(200);
  await p.evaluate(() => { document.querySelector("#sg-th").value = 3; document.querySelector(".pop [data-go]").click() }); await sleep(400);
  await p.evaluate(() => openSniperGuard()); await sleep(200);
  check("M10: reopening Sniper Guard shows the armed guard", await p.evaluate(() => /Armed now/.test(document.querySelector(".pop").textContent) && document.querySelector("#sg-th").value === "3"));
  await p.evaluate(() => document.querySelector(".pop [data-go]").click()); await sleep(400);
  check("M10: arming again replaces it (one guard)", await p.evaluate(() => LST.autos.filter(a => /^Sniper Guard/.test(a.title) && ["armed", "running"].includes(a.status)).length === 1));
  await p.evaluate(() => { newLaunch(); W_STEP = 3; wRender() }); await sleep(900);
  check("M12: on a draft the sidebar shows that draft's Funder", await p.evaluate(() => /draft/.test(document.querySelector(".funder").textContent) && $("simbal").textContent === f2(PRE.funder, 2)));
  await p.evaluate(() => show("live")); await sleep(300);
  await p.evaluate(() => { const r = document.querySelector("#launch-list [oncontextmenu]") || document.querySelector(".launch-list [oncontextmenu]"); launchMenu({ preventDefault() { }, stopPropagation() { }, clientX: 100, clientY: 200 }, "live") }); await sleep(150);
  await p.evaluate(() => document.querySelector('.ctx-menu [data-a="archive"]').click()); await sleep(200);
  check("M4: sidebar Archive on the live launch asks first", await p.evaluate(() => !!LST && /Archive the live launch/.test(document.querySelector(".pop").textContent)));
  await p.evaluate(() => document.querySelector(".pop [data-copy]").click()); await sleep(300);
  check("M4: Save a copy keeps it running", await p.evaluate(() => !!LST && ARCH.some(a => a.kind === "launch")));

  // L2 / L13: Activity time range, P&L Calendar months
  await p.evaluate(() => show("activity")); await sleep(200);
  await p.evaluate(() => document.querySelector(".act-time").click()); await sleep(100);
  check("L2: Activity time button changes the range", await p.evaluate(() => /Last 10 min/.test(document.querySelector(".act-time").textContent)));
  await p.evaluate(() => dashCalendar()); await sleep(150);
  const m0 = await p.evaluate(() => document.querySelector(".cal-nav b").textContent);
  await p.evaluate(() => document.querySelector('.cal-nav [data-m="-1"]').click()); await sleep(100);
  check("L13: P&L Calendar goes to the previous month", await p.evaluate(m0 => document.querySelector(".cal-nav b").textContent !== m0, m0));

  // fresh launches (17 Oct): nothing pre-planned, a planned Volume Bot starts at launch, copying a configuration copies no automations
  await p.evaluate(() => { localStorage.removeItem("lc-drafts"); draftsBoot() });
  check("Starter draft is a clean launch (no Volume Bot, Auto Sell or dump)", await p.evaluate(() => { const c = DRAFTS[DRAFTS.length - 1].config; return !c.vb_enabled && !c.as_enabled && !c.exit_enabled && !c.ab_enabled && !c.cl_enabled }));
  await p.evaluate(() => { newLaunch(); wFrom("SHARDS reconstruction") }); await sleep(200);
  check("Start from a configuration copies launch settings but no automations", await p.evaluate(() => WCFG.front_count === 4 && WCFG.launchpad === "meteora" && !WCFG.vb_enabled && !WCFG.as_enabled && !WCFG.exit_enabled));
  await p.evaluate(() => { newLaunch(); W_STEP = 3; wRender() }); await sleep(900);
  await p.evaluate(() => openVolumeBotPlan()); await sleep(300);
  await p.evaluate(() => { const d = [...document.querySelectorAll(".pop")].pop(); d.querySelector("[data-go]").click() }); await sleep(400);
  check("A planned Volume Bot starts at launch, not at 2:48", await p.evaluate(() => WCFG.vb_enabled && WCFG.vb_planned && WCFG.vb_start_s === 0), await p.evaluate(() => WCFG.vb_start_s));
  await p.evaluate(async () => { await wLaunch(); lSpeed(0); await lStep(20) }); await sleep(800);
  check("…and its trades begin in the first seconds", await p.evaluate(() => { const v = TRADES.filter(t => t[5] === "volume_bot"); return v.length > 0 && v[0][0] < 15 }), await p.evaluate(() => { const v = TRADES.filter(t => t[5] === "volume_bot"); return v.length ? v[0][0] + "s" : "none" }));
  await p.evaluate(() => { endLive(); show("config"); loadCfg("SHARDS (fitted to the real chart)") }); await sleep(400);
  await p.evaluate(() => openCfgInCreate()); await sleep(400);
  check("Lab → Open in Create launch keeps the configuration's own automations", await p.evaluate(() => ROUTE === "create" && WCFG.cl_enabled && WCFG.exit_enabled && WCFG.exit_start_s === 405));
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
