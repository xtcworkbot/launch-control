// End-to-end click test for Launch Control: drives the real UI in Chrome and asserts results.
// node e2e-lc.js [baseUrl]
const puppeteer = require("puppeteer-core");
const B = process.argv[2] || "http://127.0.0.1:8772/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, info = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (info !== "" ? `  [${info}]` : "")); ok ? pass++ : fail++ };
(async () => {
  const b = await puppeteer.launch({ executablePath: require("./chrome"), headless: "new" });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 1000 });
  const errors = []; p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()) });
  const click = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; e.click(); return true }, sel);
  const clickText = (sel, re) => p.evaluate((s, r) => { const e = [...document.querySelectorAll(s)].find(x => new RegExp(r).test(x.textContent)); if (!e) return false; e.click(); return true }, sel, re);
  const st = () => p.evaluate(() => ({ t: LST && LST.t, trades: TRADES.length, autos: LST ? LST.autos.map(a => [a.title, a.status]) : [], sel: LSEL.size, route: ROUTE, tf: CH && CH.tf, follow: CH && CH.followMode }));
  const tools = () => p.evaluate(() => TRADES.reduce((m, t) => (m[t[5]] = (m[t[5]] || 0) + 1, m), {}));

  // 1. Create launch through the wizard UI
  await p.goto(B + "?e=1", { waitUntil: "networkidle2" }); await sleep(1200);
  await p.evaluate(() => { localStorage.clear() });
  await clickText(".foot-btns .btn", "Create Launch"); await sleep(500);
  check("sidebar Create Launch opens the create flow", (await st()).route === "create");
  check("create flow shows the 3 top tabs", await p.evaluate(() => [...document.querySelectorAll("#stepper a")].map(b => b.textContent).join("|") === "CHAIN & LAUNCHPAD|TOKEN DETAILS|LAUNCH SETTINGS"));
  check("only Solana, PumpFun / Meteora DBC and SOL are selectable", await p.evaluate(() => document.querySelectorAll(".tile:not(.nm):not(:disabled)").length === 4));
  await p.evaluate(() => [...document.querySelectorAll(".pad-grid .tile")].find(b => /Meteora DBC/.test(b.textContent)).click()); await sleep(300);
  check("choosing Meteora DBC sets the launchpad", await p.evaluate(() => WCFG.launchpad === "meteora"));
  await p.evaluate(() => [...document.querySelectorAll(".pad-grid .tile")].find(b => /PumpFun/.test(b.textContent)).click()); await sleep(300);
  await clickText("#step .cr-actions .btn", "^Configure Token$"); await sleep(600); await clickText("#step .cr-actions .btn", "^Create$"); await sleep(600);
  check("Token Details Create opens Launch Settings", await p.evaluate(() => W_STEP === 2 && !$("summary").hidden));
  check("preset role counts fill in without Custom", await p.evaluate(() => /Front MEV/.test($("w-roles").textContent) && !/…/.test($("w-roles").textContent)), await p.evaluate(() => $("w-roles").textContent.replace(/\s+/g, " ").slice(0, 120)));
  check("organic traders are off by default", await p.evaluate(() => WCFG.org_enabled === false));
  check("Launch Settings has no sandbox-only section", await p.evaluate(() => !/SIMULATION SETTINGS/.test($("step").textContent)));
  await clickText("#step .cr-actions .btn", "^Create$"); await sleep(600);
  check("Create opens the Funding page", await p.evaluate(() => !!document.querySelector(".fund-pg") && $("stepper").hidden));
  check("Funding page shows Volume Bot / Auto Buy / Simulation icons", await p.evaluate(() => ["Volume Bot", "Auto Buy", "Simulation settings"].every(l => !!document.querySelector(`.fp-strip [aria-label="${l}"]`))));
  check("wallet rows show their role on hover", await p.evaluate(() => /Front MEV/.test(document.querySelectorAll(".fw-table td.w")[1].dataset.tip) && /Deployer/.test(document.querySelector(".fw-table td.w").dataset.tip)));
  await click('.fp-strip [aria-label="Simulation settings"]'); await sleep(200);
  await clickText(".pop .opt", "Mid organic"); await sleep(300);   // AutoSell's counter-trading below needs outside buyers
  check("Simulation settings: organic market switched to Mid", await p.evaluate(() => WCFG.org_enabled === true && WCFG.org_level === "mid" && [...document.querySelectorAll(".pop .opt.on")].some(x => x.textContent.includes("Mid organic"))));
  await click(".pop [data-go]"); await sleep(500);
  await click('.fp-strip [aria-label="Volume Bot"]'); await sleep(200);
  check("Volume Bot pop-up opens before launch, same layout as live (Solana/USD, Duration/Delay, Plan)", await p.evaluate(() => /Volume Bot/.test(document.querySelector(".pop .m-h").textContent) && !!document.querySelector('.pop #vb-t') && !!document.querySelector('.pop [data-seg="unit"] [data-v="usd"]') && !!document.querySelector('.pop [data-seg="tmode"]') && document.querySelector(".pop [data-go]").textContent.trim() === "Plan"));
  check("Volume Bot opens like the tool's: Duration, USD $100", await p.evaluate(() => document.querySelector('.pop [data-seg="tmode"] .on').dataset.v === "duration" && document.querySelector('.pop [data-seg="unit"] .on').dataset.v === "usd" && document.querySelector("#vb-t").value === "100"));
  await p.evaluate(() => document.querySelector(".pop [data-adv]").click()); await sleep(150);
  await p.evaluate(() => document.querySelector("#vb-cust").click()); await sleep(200);
  await p.evaluate(() => document.querySelector('.vbc [data-seg="amode"] [data-v="random"]').click()); await sleep(200);
  check("Custom Trade Amounts opens Amount per trade (Fixed / Random, Min / Max)", await p.evaluate(() => document.querySelector("#vb-cust").checked && !!document.querySelector(".vbc #vb-smin") && !!document.querySelector(".vbc #vb-smax") && !!document.querySelector(".pop .adv-line.open")));
  await p.evaluate(() => { const d = document.querySelector(".pop"); d.querySelector('[data-seg="tmode"] [data-v="delay"]').click() }); await sleep(150);
  await p.evaluate(() => { const d = document.querySelector(".pop"); if (!d.querySelector(".adv-line.open")) d.querySelector("[data-adv]").click(); d.querySelector('[data-exec="organic"]').click() }); await sleep(200);
  check("Delay mode shows Min/Max Delay and a required Amount per trade", await p.evaluate(() => !!document.querySelector('.pop [data-hms="vbdmin"]') && !!document.querySelector('.pop [data-hms="vbdmax"]') && !!document.querySelector('.pop [data-seg="amode"]')));
  const wv0 = await p.evaluate(() => document.querySelector("#vb-wtxt").textContent);
  await p.evaluate(() => { const r = document.querySelector("#vb-wave"); r.value = 0.9; r.dispatchEvent(new Event("input", { bubbles: true })) }); await sleep(200);
  check("Wave Intensity has a live looping preview that changes with the slider", await p.evaluate(w0 => { const c = document.querySelector("#vb-wcv"); return !!c && c.width > 0 && document.querySelector(".pop .wv").textContent === "0.9" && document.querySelector("#vb-wtxt").textContent !== w0 }, wv0), wv0);
  await click(".pop [data-go]"); await sleep(400);
  check("Volume Bot Plan saves to the launch", await p.evaluate(() => WCFG.vb_enabled === true && WCFG.vb_mode === "delay" && WCFG.vb_wave === 0.9 && !document.querySelector(".pop")));
  // Funding page controls as in the tool: row ⋯ menu, folders, footer ⋯, inline Token Buy %, funder ▾, Rescue, Import from My Wallets
  await p.evaluate(() => document.querySelector(".fw-table tbody tr .ic.more").click()); await sleep(200);
  check("wallet row ⋯ menu: Replace by Fresh / Import Wallet / Export Private Key / Add to Folder", await p.evaluate(() => [...document.querySelectorAll(".ctx-menu button")].map(b => b.textContent.replace("›", "").trim()).join("|") === "Replace by Fresh|Import Wallet|Export Private Key|Add to Folder"));
  await clickText(".ctx-menu button", "Add to Folder"); await sleep(150);
  const fid = await p.evaluate(() => WPLAN.wallets[0].id);
  await clickText(".ctx-menu.fmenu button", "NOT READY"); await sleep(200);
  check("Add to Folder files the wallet (folder colour on the row)", await p.evaluate(id => WFOLDER[id] === "notready", fid));
  await p.evaluate(() => document.querySelector(".fw-table tbody tr .ic.more").click()); await sleep(150); await clickText(".ctx-menu button", "Replace by Fresh"); await sleep(250);
  check("Replace by Fresh gives the row a new address", await p.evaluate(id => !!(WCFG.w_swap && WCFG.w_swap[id]) && WCFG.w_swap[id].addr !== id, fid));
  await p.evaluate(() => document.querySelector(".fw-foot .ic.more").click()); await sleep(150);
  check("footer ⋯: Assign all to folder + Axiom / GMGN / BullX / RayBot Tracker Export", await p.evaluate(() => { const t = [...document.querySelectorAll(".ctx-menu button")].map(b => b.textContent.replace("›", "").trim()); return t[0] === "Assign all to folder" && ["Axiom", "GMGN", "BullX", "RayBot"].every(x => t.includes(x + " Tracker Export")) }));
  await p.keyboard.press("Escape"); await sleep(150);
  await p.evaluate(() => document.querySelector(".fw-table tbody tr .ic.pen").click()); await sleep(150);
  await p.evaluate(() => { const i = document.querySelector(".tb-ed input"); i.value = "2"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) }); await sleep(700);
  check("Token Buy % edits in the cell and saves", await p.evaluate(() => Object.values(WCFG.buy_overrides || {}).includes(2)));
  await p.evaluate(() => document.querySelector(".fw-pill").click()); await sleep(150);
  check("Funding wallet ▾ lists funders + New Funder + Fresh Funder", await p.evaluate(() => { const t = [...document.querySelectorAll(".ctx-menu button")].map(b => b.textContent.trim()); return t.includes("New Funder") && t.includes("Fresh Funder") }));
  await p.keyboard.press("Escape"); await sleep(150);
  await p.evaluate(() => { MYW.push({ id: fakeAddr("t-lib"), at: Date.now(), bal: 0.5, src: "Wallet", launches: 0, acts: 3 }); saveLib() });
  await clickText(".fw-bar .btn", "Import Wallets"); await sleep(250);
  check("+ Import Wallets opens the wide Import Wallets picker", await p.evaluate(() => /Import Wallets/.test(document.querySelector(".pop .m-h").textContent) && !!document.querySelector(".pop .iw-table") && /Recommended Wallets/.test(document.querySelector(".pop").textContent)));
  await p.evaluate(() => document.querySelector(".pop [data-rec]").click()); await sleep(150); await click(".pop [data-go]"); await sleep(300);
  check("importing a My Wallets wallet marks a launch row Imported", await p.evaluate(() => Object.values(WCFG.w_swap || {}).some(x => x.imported) && !!document.querySelector(".fw-table .imp-b")));
  await clickText(".stage-foot .btn", "^Rescue$"); await sleep(1200);
  check("Rescue runs straight away (nothing distributed yet)", await p.evaluate(() => !document.querySelector(".pop") && preDistributed() === 0));
  check("Launch is locked until Distribute", await p.evaluate(() => $("pre-launch").disabled));
  await clickText(".fw-btns .btn", "Deposit"); await sleep(200); await click("#dep-go"); await sleep(300);
  check("Deposit pop-up fills the Funder", await p.evaluate(() => PRE.funder > 0 && preRequired() < 0.01), await p.evaluate(() => PRE.funder));
  await click("#pre-dist"); await sleep(3000);
  check("Distribute fills every wallet", await p.evaluate(() => PRE.phase === "ready" && !$("pre-launch").disabled));
  await click("#pre-launch"); await sleep(300); await clickText(".modal .m-f .btn", "^Launch$"); await sleep(2500);
  let s = await st();
  check("launch from wizard opens live workspace", s.route === "live" && s.t > 0, `t=${s.t}`);
  check("Funder started at 100 sandbox SOL and paid for the plan", await p.evaluate(() => LST.fees.funder_start >= 100 && LST.funder_sol < LST.fees.funder_start), await p.evaluate(() => `${LST.funder_sol.toFixed(2)} / ${LST.fees.funder_start}`));
  check("live fee line and status-bar fees show", await p.evaluate(() => /Fees paid/.test($("r-fees").textContent) && /Fees −/.test($("st-fees").textContent)));
  await click("#r-fees"); await sleep(200);
  check("Fees pop-up lists every cost with min / avg / max", await p.evaluate(() => document.querySelectorAll(".pop .fee-t tbody tr").length >= 4));
  await click(".pop [data-close]"); await sleep(150);
  await click('#r-org [data-v="mid"]'); await sleep(400);
  check("organic market switches live to Mid", await p.evaluate(() => LST.organic.level === "mid" && document.querySelector("#r-org .on").dataset.v === "mid"));
  check("P&L shows real exit value next to paper value", await p.evaluate(() => /Your coins if you sold all now/.test($("r-pnl").textContent) && /Result if you sold everything now/.test($("r-pnl").textContent) && /at today.s price/.test($("r-pnl").textContent)));
  await click(".clock .seg button[aria-label='Pause']"); await sleep(300);
  // 2. chart + time controls
  await clickText(".clock .btn", "10s"); await sleep(800);
  const t1 = (await st()).t; check("+10s advances the clock", t1 >= 10, t1);
  await clickText("#tf button", "^5s$"); await sleep(300); check("timeframe switch to 5s", (await st()).tf === 5);
  await clickText("#tf button", "^1s$");
  const box = await (await p.$("#chart")).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.wheel({ deltaY: -400 }); await sleep(200);
  await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 6 }); await p.mouse.up(); await sleep(200);
  s = await st(); check("drag pans the chart and leaves live mode", s.follow === false);
  check("Go live button appears", await p.evaluate(() => !$("golive").hidden));
  await click("#golive"); await sleep(200); check("Go live resumes following", (await st()).follow === true);
  await clickText("#b-bubbles", "bubbles"); await sleep(100); check("bubbles toggle", await p.evaluate(() => CH.bubbles === false)); await clickText("#b-bubbles", "bubbles");
  // 3. buy / sell via rail
  await p.select("#r-group", "holders"); await sleep(200);
  await clickText("#rail .btn.buy", "Buy"); await sleep(300); await clickText(".clock .btn", "10s"); await sleep(800);
  check("rail Buy executes manual buys", ((await tools()).manual_buy || 0) >= 5, (await tools()).manual_buy);
  await click("#sb-sell"); await clickText("#r-sell .chip-btn", "^50%$"); await clickText("#rail .btn.sell", "Sell"); await sleep(300); await clickText(".clock .btn", "10s"); await sleep(800);
  check("rail Sell executes manual sells", ((await tools()).manual_sell || 0) >= 5, (await tools()).manual_sell);
  // 4. quick trade row button + selection
  await clickText("#bottom .btabs button", "My Wallets"); await sleep(300);
  await p.evaluate(() => [...document.querySelectorAll("#bottom tbody tr")].find(r => /Holder 1(?!\d)/.test(r.textContent)).querySelector(".qb").click()); await sleep(300);
  check("row quick-buy trades", ((await tools()).manual_buy || 0) >= 6);
  await click("#bottom .grp-row"); await sleep(200);
  await p.evaluate(() => [...document.querySelectorAll("#bottom tbody tr")].filter(r => /front MEV/.test(r.textContent)).forEach(r => r.querySelector("input").click())); await sleep(200);
  { const nf = await p.evaluate(() => [...document.querySelectorAll("#bottom tbody tr")].filter(r => /front MEV/.test(r.textContent)).length);
    check("MEV group expands and rows select", nf > 0 && (await st()).sel === nf, `${(await st()).sel} of ${nf}`); }
  // 5. fund + volume bot on the selected wallets
  await p.select("#r-group", "selected");
  await p.evaluate(() => openDeposit()); await sleep(200); await p.evaluate(() => { document.querySelector("#dep-amt").value = 50 }); await click("#dep-go"); await sleep(400);
  await click('#rail .iconrow .btn[aria-label="Fund wallets"]'); await sleep(200);
  check("Fund Wallets opens a pop-up", await p.evaluate(() => /Fund Wallets/.test(document.querySelector(".pop .m-h").textContent)));
  await p.select("#fw-g", "selected"); await p.evaluate(() => { document.querySelector("#fw-amt").value = 2 }); await click(".pop [data-go]"); await sleep(400);
  await click("#a-vb"); await sleep(200);
  check("Volume Bot opens a pop-up", await p.evaluate(() => /Volume Bot/.test(document.querySelector(".pop .m-h").textContent)));
  await p.evaluate(() => { const d = document.querySelector(".pop"); d.querySelector('[data-seg="unit"] [data-v="sol"]').click(); d.querySelector('[data-seg="tmode"] [data-v="delay"]').click() }); await sleep(100);
  await p.evaluate(() => { const d = document.querySelector(".pop"); d.querySelector("#vb-t").value = 6; d.querySelector('[data-hms="vbdmin"] [data-p="s"]').value = 1; d.querySelector('[data-hms="vbdmax"] [data-p="s"]').value = 3; d.querySelector("[data-adv]").click() }); await sleep(100);
  await p.evaluate(() => document.querySelector(".pop [data-wpick]").click()); await sleep(200);
  await p.evaluate(() => { const pk = [...document.querySelectorAll(".pop")].pop(); pk.querySelectorAll(".pick-list input").forEach(i => { i.checked = LSEL.has(i.value) }); pk.querySelector("[data-go]").click() }); await sleep(200);
  check("Select Wallets picks the Volume Bot wallets", await p.evaluate(() => new RegExp(`Select Wallets \\(${LSEL.size}\\)`).test(document.querySelector(".pop [data-wpick]").textContent)), await p.evaluate(() => document.querySelector(".pop [data-wpick]").textContent));
  await click(".pop [data-go]"); await sleep(200);
  check("Volume Bot Estimate shows the plan", await p.evaluate(() => !!document.querySelector(".pop .est-list")));
  await click(".pop [data-go]"); await sleep(300);
  for (let i = 0; i < 4; i++) { await clickText(".clock .btn", "10s"); await sleep(600) }
  check("Volume Bot trades after funding", ((await tools()).volume_bot || 0) >= 4, (await tools()).volume_bot);
  check("Volume Bot trades are on the chart (legend + bubbles)", await p.evaluate(() => TRADES.some(t => t[5] === "volume_bot") && /Volume Bot/.test($("tool-legend").textContent)), await p.evaluate(() => $("tool-legend").textContent));
  // Volume Bot on the 4 poorest wallets with 1 SOL trades: Estimate warns and funds them first, then it trades
  const vb0 = await p.evaluate(() => TRADES.filter(t => t[5] === "volume_bot").length);
  await click("#a-vb"); await sleep(200);
  await p.evaluate(() => { const d = document.querySelector(".pop"); d.querySelector('[data-seg="unit"] [data-v="sol"]').click(); d.querySelector('[data-seg="tmode"] [data-v="delay"]').click() }); await sleep(100);
  await p.evaluate(() => { const d = document.querySelector(".pop"); d.querySelector("#vb-t").value = 6; d.querySelector('[data-hms="vbdmin"] [data-p="s"]').value = 1; d.querySelector('[data-hms="vbdmax"] [data-p="s"]').value = 2; if (d.querySelector("#vb-size")) d.querySelector("#vb-size").value = 1; d.querySelector("[data-adv]").click() }); await sleep(100);
  await p.evaluate(() => document.querySelector(".pop [data-wpick]").click()); await sleep(200);
  await p.evaluate(() => { const pk = [...document.querySelectorAll(".pop")].pop(); const poor = new Set(LST.wallets.filter(w => w.role !== "op_relay").sort((a, b) => a.sol - b.sol).slice(0, 4).map(w => w.id)); pk.querySelectorAll(".pick-list input").forEach(i => { i.checked = poor.has(i.value) }); pk.querySelector("[data-go]").click() }); await sleep(200);
  await click(".pop [data-go]"); await sleep(250);
  check("Volume Bot Estimate warns when its wallets lack SOL and offers to fund them", await p.evaluate(() => /lack|under/.test(document.querySelector(".pop .note.warn") ? document.querySelector(".pop .note.warn").textContent : "") && document.querySelector("#vb-fund").checked),
    await p.evaluate(() => (document.querySelector(".pop .est-list") || { textContent: "no estimate" }).textContent.replace(/\s+/g, " ").slice(0, 200) + " | poorest: " + LST.wallets.filter(w => w.role !== "op_relay").map(w => w.sol).sort((a, b) => a - b).slice(0, 4).map(x => x.toFixed(3)).join(",")));
  await click(".pop [data-go]"); await sleep(300); for (let i = 0; i < 3; i++) { await clickText(".clock .btn", "10s"); await sleep(600) }
  check("…and after funding them it trades on the chart", await p.evaluate(n => TRADES.filter(t => t[5] === "volume_bot").length > n + 2, vb0), await p.evaluate(n => TRADES.filter(t => t[5] === "volume_bot").length - n, vb0));
  check("every tool with trades is named in the chart legend (no unlabelled tools)", await p.evaluate(() => { const tools = [...new Set(TRADES.map(t => t[5]))]; return tools.every(k => TOOL_NAMES[k] && TOOL_COLORS[k] && $("tool-legend").textContent.includes(TOOL_NAMES[k])) }), await p.evaluate(() => [...new Set(TRADES.map(t => t[5]))].filter(k => !TOOL_NAMES[k] || !$("tool-legend").textContent.includes(TOOL_NAMES[k] || k)).join(",")));
  check("Volume Bot status pill updates", await p.evaluate(() => /Running|done/i.test($("a-vb-st").textContent)), await p.evaluate(() => $("a-vb-st").textContent));
  // 6. AutoSell start + cancel
  await click("#a-sell"); await sleep(200);
  await p.evaluate(() => { const d = document.querySelector(".pop"), r = d.querySelector('[data-k="rep"]'); r.value = 20; r.dispatchEvent(new Event("input", { bubbles: true })); const t = d.querySelector('[data-k="trigv"]'); t.value = 90; t.dispatchEvent(new Event("input", { bubbles: true })) });
  check("AutoSell Run enables once the strategy is valid", await p.evaluate(() => !document.querySelector(".pop [data-go]").disabled));
  await click(".pop [data-go]"); await sleep(300);
  for (let i = 0; i < 3; i++) { await clickText(".clock .btn", "10s"); await sleep(600) }
  check("AutoSell responds to buys", ((await tools()).autosell || 0) >= 1, (await tools()).autosell);
  await clickText("#r-run .btn", "Cancel"); await sleep(400);
  check("Cancel stops an automation", (await st()).autos.some(a => a[1] === "cancelled"));
  // 7. tape tabs, bottom tabs, detector, map
  await clickText("#tape-tabs button", "MY WALLETS"); await sleep(300);
  check("tape 'My wallets' filters to own trades", await p.evaluate(() => [...$("tape").children].every(r => r.querySelector(".who.own"))));
  await clickText("#tape-tabs button", "^ALL$");
  await clickText("#bottom .btabs button", "Latest Trades"); await sleep(300);
  check("Latest Trades lists trades", await p.evaluate(() => document.querySelectorAll("#bottom tbody tr").length >= 20));
  await clickText("#tape-tabs button", "^DEV$"); await sleep(300);
  check("tape 'Dev' shows only dev trades", await p.evaluate(() => [...$("tape").children].every(r => /^Dev/.test(r.querySelector(".who").textContent))));
  await clickText("#tape-tabs button", "^ALL$");
  check("header shows market-wide buys and sells", await p.evaluate(() => /Buys \d+/.test($("hdr").textContent) && /Sells \d+/.test($("hdr").textContent)));
  for (const tab of ["Holders", "History", "Warning signs", "Bubble Maps"]) { await clickText("#bottom .btabs button", tab); await sleep(tab === "Bubble Maps" ? 2500 : 300) }
  check("bubble map draws", await p.evaluate(() => !!G && G.nodes.length > 10), await p.evaluate(() => G && G.nodes.length));
  // 8. nuke flow + withdraw + claim
  await clickText("#rail .btn", "Claim Rewards"); await sleep(300);
  await click("#nk"); await sleep(200);
  check("Nuke opens a confirm dialog", await p.evaluate(() => !!document.querySelector(".modal #nk-dev")));
  // a manual Nuke only sells (as in the tool): tools still running, like the Volume Bot, can buy again afterwards
  await p.evaluate(() => { window.__held = LST.wallets.filter(w => w.tok > 1 && w.role !== "op_relay").map(w => w.id); window.__n0 = TRADES.length });
  await clickText(".modal .m-f .btn", "Confirm nuke"); await sleep(300); await clickText(".clock .btn", "10s"); await sleep(600);
  check("Nuke sells every wallet that held coins", await p.evaluate(() => { const sold = new Set(TRADES.slice(window.__n0).filter(t => t[5] === "nuke" && !t[2]).map(t => t[8])); return window.__held.length > 0 && window.__held.every(id => sold.has(id)) }),
    await p.evaluate(() => { const sold = new Set(TRADES.slice(window.__n0).filter(t => t[5] === "nuke" && !t[2]).map(t => t[8])); return `${window.__held.filter(id => sold.has(id)).length}/${window.__held.length}` }));
  await clickText(".clock .btn", "Withdraw"); await sleep(200);
  await p.evaluate(() => { const c = document.querySelector("#wd-dust"); c.checked = true; c.dispatchEvent(new Event("change")) });
  await p.evaluate(() => document.querySelector(".pop [data-book]").click()); await sleep(150);
  await clickText(".ctx-menu button", "Fresh payout wallet"); await sleep(150);
  check("Withdraw address book fills the recipient", await p.evaluate(() => document.querySelector("#wd-addr").value.length >= 32));
  await clickText(".pop .m-f .btn", "^Withdraw$"); await sleep(200);
  check("Withdraw shows the review step", await p.evaluate(() => !!document.querySelector(".pop .wd-rev") && document.querySelector(".pop [data-go]").disabled));
  await click("#wd-ok"); await sleep(100); await clickText(".pop .m-f .btn", "^Withdraw "); await sleep(400);
  check("Withdraw with dust leaves ~0.1 SOL in holders", await p.evaluate(() => LST.wallets.filter(w => w.role === "op_holder").every(w => w.sol > 0.09 && w.sol < 0.11)), await p.evaluate(() => LST.wallets.filter(w => w.role === "op_holder").slice(0, 3).map(w => w.sol.toFixed(3)).join(",")));
  check("Withdraw via hop shows progress", await p.evaluate(() => !!document.querySelector("#wd-steps") && LST.withdraw.phase === "hop"));
  for (let i = 0; i < 8 && await p.evaluate(() => LST.withdraw.phase !== "done"); i++) { await clickText(".clock .btn", "10s"); await sleep(700) }
  await sleep(400);
  check("hop pays out: Completed", await p.evaluate(() => LST.withdraw.phase === "done" && document.querySelectorAll("#wd-steps .on").length === 3));
  await clickText(".modal .m-f .btn", "^Done$"); await sleep(200);
  check("Withdraw fills the Funder", await p.evaluate(() => LST.funder_sol > 1), await p.evaluate(() => LST.funder_sol));
  // archive the launch, then open it from Archived
  await p.evaluate(() => { localStorage.removeItem("lc-archive"); ARCH = [] }); await click(".tw-right .ar-btn"); await sleep(300);
  check("Archive saves the live launch with its chart", await p.evaluate(() => ARCH.length === 1 && ARCH[0].trades.length > 20 && !!ARCH[0].pnl));
  await clickText(".nav a", "Archived"); await sleep(300); await clickText(".ar-card .link", "See Launch"); await sleep(600);
  check("archived launch re-opens with chart and read", await p.evaluate(() => !!document.querySelector("#a-chart") && !!window.ACH && ACH.trades.length > 20 && !!ACH.read));
  await clickText(".ar-top .btn", "Archived"); await sleep(200);
  // Dashboard (the tool's account page) + drafts in the left column with the tool's right-click menu (+ Delete)
  await clickText(".nav a", "Dashboard"); await sleep(400);
  check("Dashboard shows P&L, chart, stats and the archived launch", await p.evaluate(() => !!document.querySelector(".dash .big") && !!$("dash-cv") && document.querySelectorAll(".dash-table tbody tr").length >= 2 && /Total launches/.test(document.querySelector(".dash-stats").textContent)), await p.evaluate(() => document.querySelectorAll(".dash-table tbody tr").length));
  await p.evaluate(() => document.querySelector('.dc-modes button[aria-label="P&L per launch"]').click()); await sleep(200);
  check("Dashboard chart switches to P&L per launch", await p.evaluate(() => DASH_MODE === "bar" && !!$("dash-cv")));
  await p.evaluate(() => [...document.querySelectorAll(".dash-table tbody tr")].find(r => !/Live/.test(r.textContent)).click()); await sleep(600);
  check("a Dashboard row opens that run in Archived", await p.evaluate(() => ROUTE === "archived" && !!document.querySelector("#a-chart")));
  await clickText(".nav a", "Dashboard"); await sleep(300);
  await clickText(".dash-id .btn", "Create launch"); await sleep(400);
  const nd = await p.evaluate(() => DRAFTS.length);
  check("Create launch adds a draft to the left column", await p.evaluate(() => ROUTE === "create" && DRAFTS.length >= 1 && document.querySelectorAll("#launch-list [data-draft]").length === DRAFTS.length));
  await p.evaluate(() => { const li = document.querySelector("#launch-list [data-draft]"); li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 130 })) }); await sleep(200);
  check("right-click on a draft shows Archive / Clone / Delete", await p.evaluate(() => [...document.querySelectorAll(".ctx-menu button")].map(b => b.textContent.trim()).join("|") === "Archive|Clone|Delete"));
  await clickText(".ctx-menu button", "Clone"); await sleep(400);
  check("Clone makes a new draft and opens it", await p.evaluate(n => DRAFTS.length === n + 1 && ROUTE === "create" && / copy$/.test(WCFG.name), nd));
  await p.evaluate(() => document.querySelector("#launch-list [data-draft] .li-more").click()); await sleep(200);
  await clickText(".ctx-menu button", "Delete"); await sleep(200); await click(".pop [data-go]"); await sleep(400);
  check("Delete removes the draft from the left column and from storage", await p.evaluate(n => DRAFTS.length === n && document.querySelectorAll("#launch-list [data-draft]").length === n && JSON.parse(localStorage.getItem("lc-drafts")).length === n, nd));
  check("the live launch keeps its own settings while drafts change", await p.evaluate(() => ROUTE === "live" && WCFG === LIVE_CFG && !!LST));
  // 9. wallets page, activity log, search palette
  await clickText(".nav a", "My Wallets"); await sleep(400);
  check("wallets table lists live wallets with volume", await p.evaluate(() => document.querySelectorAll("#wallets-page tbody tr").length >= 10 && [...document.querySelectorAll("#wallets-page tbody td:nth-child(5)")].some(td => td.textContent !== "–")));
  await clickText("#wallets-page .fd", "HOLDER"); await sleep(200);
  check("wallet folders filter (HOLDER shows holder wallets)", await p.evaluate(() => { const c = [...document.querySelectorAll("#wallets-page tbody .rolechip")]; return c.length > 0 && c.every(x => /holder/.test(x.textContent)) }));
  check("Generate Activity / Delete / Manage wait for a selection, as in the tool", await p.evaluate(() => [...document.querySelectorAll("#wallets-page .wl-bar .btn")].filter(b => /Generate Activity|Delete|Manage/.test(b.textContent)).every(b => b.disabled)));
  await p.evaluate(() => document.querySelector("#wallets-page tbody input[type=checkbox]").click()); await sleep(200);
  await clickText("#wallets-page .wl-bar .btn", "Funding"); await sleep(200);
  check("wallets Funding opens the Fund Wallets pop-up", await p.evaluate(() => /Fund Wallets/.test((document.querySelector(".pop .m-h") || {}).textContent || "")));
  await click(".pop [data-close]"); await sleep(150);
  await clickText("#wallets-page .wl-bar .btn", "Generate Activity"); await sleep(200);
  check("Generate Activity opens a pop-up", await p.evaluate(() => /Generate Activity/.test((document.querySelector(".pop .m-h") || {}).textContent || "")));
  await click(".pop [data-close]"); await sleep(150);
  await clickText(".nav a", "Activity"); await sleep(400);
  check("activity log shows tool events", await p.evaluate(() => document.querySelectorAll("#activity-page tbody tr").length >= 5), await p.evaluate(() => ACT.length));
  await clickText("#activity-page .chips2 button", "^Trades$"); await sleep(200);
  check("activity filter chip narrows rows", await p.evaluate(() => [...document.querySelectorAll("#activity-page .ctx")].every(c => /Trades/.test(c.textContent))));
  await p.keyboard.down("Meta"); await p.keyboard.press("k"); await p.keyboard.up("Meta"); await sleep(200);
  check("⌘K opens the search palette", await p.evaluate(() => !!document.querySelector(".palette")));
  await p.keyboard.type("compare"); await p.keyboard.press("Enter"); await sleep(300);
  check("palette jumps to Compare", (await st()).route === "compare");
  // 10. speed buttons + routes
  await clickText(".clock .seg button", "^5×$"); await sleep(1500); const ta = (await st()).t; await sleep(1000); const tb = (await st()).t;
  check("5× speed advances ~5 s per second", tb - ta > 3 && tb - ta < 8, (tb - ta).toFixed(1));
  for (const r of ["My Wallets", "Activity", "Configurations", "Compare", "Import & match", "Workspace"]) { await clickText(".nav a", r); await sleep(300) }
  check("all routes open", (await st()).route === "live");
  // 11. import a launch with a transfers CSV: the sweep signal shows in the result
  await clickText(".nav a", "Import & match"); await sleep(400);
  await p.$eval("#impname", e => e.value = "Synthetic sweep");
  await (await p.$("#ftrades")).uploadFile(__dirname + "/fixtures/synthetic_trades.csv");
  await (await p.$("#ftransfers")).uploadFile(__dirname + "/fixtures/synthetic_transfers.csv");
  await clickText("#t-import button", "^Import$"); await sleep(1500);
  check("import with transfers shows the sweep signal", await p.evaluate(() => /HIGH/.test($("matchout").textContent) && /9 trading wallets/.test($("matchout").textContent)), await p.evaluate(() => $("matchout").textContent.slice(0, 160)));
  // 12. Configurations: Blank loads the everything-off config
  await clickText(".nav a", "Configurations"); await sleep(400);
  await clickText("#t-config button", "^Blank$"); await sleep(500);
  check("Blank button loads the everything-off config", await p.evaluate(() => cur.name === "Blank (everything off)" && !cur.vb_enabled && !cur.as_enabled && !cur.org_enabled && cur.sn_count === 0 && cur.ct_count === 0 && cur.dev_buy_pct === 0 && $("cfgname").value === "Blank (everything off)"));
  // 13. market caps in USD: pin SOL at $100 through the status-bar dialog, then check the displays
  await clickText(".nav a", "Workspace"); await sleep(300);
  await click("#st-sol"); await sleep(200);
  await p.$eval("#sol-man", e => e.value = "100"); await clickText(".modal .m-f .btn", "Pin this price"); await sleep(600);
  const mc = await p.evaluate(() => ({ sol: LST.mc_sol, head: [...$("hdr").querySelectorAll(".metric")].find(m => /Mcap/.test(m.textContent)).querySelector("span").textContent, tape: $("tape").firstChild ? $("tape").firstChild.children[1].textContent : "", chip: $("st-sol").textContent }));
  const want = "$" + (mc.sol * 100 >= 1e4 ? (mc.sol * 100 / 1e3).toFixed(1) + "K" : (mc.sol * 100 / 1e3).toFixed(2) + "K");
  check("status bar shows a SOL price after load", await p.evaluate(() => /^\$\d/.test($("st-sol").textContent) || !SOLUSD));
  check("pinned SOL price shows in the status bar", mc.chip === "$100", mc.chip);
  check("header market cap is in USD at the pinned price", mc.head === want, `${mc.head} vs ${want}`);
  check("trades tape market cap is in USD", /^\$/.test(mc.tape), mc.tape);
  await p.evaluate(() => { W_STEP = 2; show("create") }); await sleep(800);
  check("plan estimate market cap is in USD", await p.evaluate(() => /Est\. Market Cap[^$]{0,4}\$\d/.test($("summary").textContent)), await p.evaluate(() => ($("summary").textContent.match(/Est\. Market Cap[^\n]{0,40}/) || [""])[0]));
  await p.evaluate(() => { lsSet("lc-solusd-manual", null) });
  await p.evaluate(() => show("live")); await sleep(300);
  await p.evaluate(() => { const li = document.querySelector("#launch-list .li"); li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 130 })) }); await sleep(200);
  await clickText(".ctx-menu button", "Delete"); await sleep(200); await click(".pop [data-go]"); await sleep(500);
  check("Delete on the live launch ends it and returns to the Dashboard", await p.evaluate(() => !LST && ROUTE === "dashboard" && !document.querySelector("#launch-list .li .live-dot")));
  await p.evaluate(() => newLaunch()); await sleep(400); await p.evaluate(() => { W_STEP = 3; wRender() }); await sleep(900);
  const nd2 = await p.evaluate(() => DRAFTS.length);
  await clickText(".fw-bar .btn", "Delete"); await sleep(200);
  check("Delete is the tool's Delete Plan confirm", await p.evaluate(() => /Delete Plan/.test(document.querySelector(".pop .m-h").textContent) && /permanently deleted/.test(document.querySelector(".pop").textContent) && document.querySelector(".pop [data-go]").textContent.trim() === "Confirm"));
  await click(".pop [data-go]"); await sleep(400);
  check("Delete Plan removes the draft", await p.evaluate(n => DRAFTS.length === n - 1 && ROUTE !== "create", nd2));
  await p.evaluate(() => show("wallets")); await sleep(300);
  await p.evaluate(() => document.querySelector("#wallets-page .wl-bar .btn").click()); await sleep(150);
  await p.evaluate(() => { const i = document.querySelector("#cl-n"); i.value = 3; i.dispatchEvent(new Event("input")); document.querySelector(".pop [data-go]").click() }); await sleep(300);
  check("My Wallets Create keeps new wallets in My Wallets (NOT READY folder)", await p.evaluate(() => MYW.length >= 3 && MYW.slice(-3).every(w => WFOLDER[w.id] === "notready")));
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
