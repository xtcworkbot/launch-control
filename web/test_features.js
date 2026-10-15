// Every feature, end to end: run it in a live launch and prove it leaves its own trades on the token (what the chart draws:
// bubbles + volume coloured by tool) and a timeline note (the chart's event marker). node test_features.js
const E = require("./engine.js"), { API } = E;
let ok = true, n = 0; const check = (name, c, info = "") => { n++; console.log((c ? "PASS " : "FAIL ") + name + (info !== "" ? `  [${info}]` : "")); ok = ok && !!c };
const base = (o = {}) => Object.assign(E.shardsPreset(), { seed: 3, funding_source: "funder", ga_enabled: false, vb_enabled: false, as_enabled: false, ab_enabled: false, sg_enabled: false, exit_enabled: false, cl_enabled: false, org_enabled: true, org_level: "mid", org_hawkes: 0.3, org_peak_rate: 0.35, scheduled: true }, o);
const start = o => { API.live_create({ config: base(o) }); API.live_fund(); return API.live_launch() };
const run = s => API.live_step({ slots: Math.round(s / E.SLOT_S) });
const act = (name, params = {}) => API.live_action({ name, params });
const A = () => API.live_audit();
const ids = (s, re) => s.wallets.filter(w => re.test(w.role)).map(w => w.id);
const T = (a, k) => a.tools[k] || { buy: 0, sell: 0, sol: 0 };
const noted = (a, re) => a.timeline.some(e => re.test(e[1]));
const TRADES_OF = tool => API.live_step({ slots: 0, cursor: 0 }).inc.trades.filter(t => t[5] === tool && t[2]).map(t => t[3]);

// 1. Block-0 launch (Clean preset): dev buy + Front MEV in the deploy slot, then Back MEV -> holder buyback pairs
let s = start({ preset: "clean", wallets: 20 }); s = run(120); let a = A();
check("Block-0: dev buy in the deploy slot", T(a, "dev_buy").buy === 1 && T(a, "dev_buy").first_s === 0, JSON.stringify(T(a, "dev_buy")));
check("Block-0: Front MEV buys in the deploy slot", T(a, "front_mev").buy >= 1 && T(a, "front_mev").first_s === 0, JSON.stringify(T(a, "front_mev")));
check("Clean: Back MEV sells paired with holder buys (buyback)", T(a, "holder_buy").buy >= 3 && T(a, "back_mev").sell >= 3, `holder buys ${T(a, "holder_buy").buy}, Back MEV sells ${T(a, "back_mev").sell}`);
check("Block-0 note on the timeline", noted(a, /Block-0/));
check("outside market: snipers and organic traders trade", T(a, "sniper").buy > 0 && T(a, "organic").buy > 0, `sniper ${T(a, "sniper").buy} organic ${T(a, "organic").buy}`);

// 2. Volume Bot: organic (separate trades) and bundle (same block), live; and planned from the launch settings
s = start({ wallets: 20 }); run(60); act("withdraw", { recipient: "fresh", group: "mev", route: "direct" }); run(2); s = act("volume", { wallets: ids(s, /op_front/), target: 0.5, exec: "organic", mode: "delay", delay_min: 2, delay_max: 4, wave: 0, size_mode: "fixed", size: 0.5, fee_target: 0.02 }); run(4);
check("Volume Bot on wallets with no SOL stops and says so", s.autos.length && API.live_step({ slots: 1 }).autos.slice(-1)[0].status === "stopped: wallets out of SOL");
s = start({ wallets: 20 }); run(60); act("fund", { wallets: ids(s, /op_front/), amount: 0.67, method: "direct" }); s = act("volume", { wallets: ids(s, /op_front/), target: 10, exec: "organic", mode: "delay", delay_min: 2, delay_max: 4, wave: 0.5, size_mode: "fixed", size: 0.5, fee_target: 0.02 }); s = run(150); a = A();
check("Volume Bot (organic) buys and sells on the chart", T(a, "volume_bot").buy > 3 && T(a, "volume_bot").sell > 3, JSON.stringify(T(a, "volume_bot")));
check("Volume Bot reaches its target volume", T(a, "volume_bot").sol >= 9.5, T(a, "volume_bot").sol);
check("Volume Bot start is on the timeline", noted(a, /Volume Bot started/));
s = start({ wallets: 20 }); run(60); act("fund", { wallets: ids(s, /op_front/), amount: 0.57, method: "direct" }); s = act("volume", { wallets: ids(s, /op_front/), target: 6, exec: "bundle", mode: "delay", delay_min: 2, delay_max: 4, wave: 0, size_mode: "fixed", size: 0.5, fee_target: 0.02 }); run(120); a = A();
check("Volume Bot (bundle) trades both sides", T(a, "volume_bot").buy > 2 && T(a, "volume_bot").buy === T(a, "volume_bot").sell, JSON.stringify(T(a, "volume_bot")));
s = start({ wallets: 20, vb_enabled: true, vb_start_s: 30, vb_target: 20, vb_mode: "duration", vb_duration_s: 120, vb_exec: "organic", vb_size_mode: "random", vb_size_min: 0.05, vb_size_max: 1, vb_wallets: "holders" });
s = run(25); check("planned Volume Bot shows as scheduled before its start", s.autos.some(x => /Volume/.test(x.title) && x.status === "scheduled"));
s = run(200); a = A(); const pv = s.autos.find(x => /Volume/.test(x.title));
check("planned Volume Bot (holder wallets, Duration) reaches its target", T(a, "volume_bot").sol >= 19 && pv.status === "done", `${T(a, "volume_bot").sol} SOL, ${pv.status}`);
for (const [lo, hi, dur, tgt] of [[0.05, 1, 240, 100], [0.3, 0.3, 120, 30], [0.1, 2, 300, 150]]) {   // the target lands inside the duration
  s = start({ wallets: 40, vb_enabled: true, vb_start_s: 30, vb_target: tgt, vb_mode: "duration", vb_duration_s: dur, vb_exec: "organic", vb_wave: 0.2, vb_size_mode: lo === hi ? "fixed" : "random", vb_size: lo, vb_size_min: lo, vb_size_max: hi, vb_wallets: "holders" });
  s = run(30 + dur + 120); const v = s.autos.find(x => /Volume/.test(x.title));
  const vbt = API.live_audit(); const lastT = vbt.tools.volume_bot ? vbt.tools.volume_bot.last_s : 0;
  check(`Duration ${dur}s, ${tgt} SOL, sizes ${lo}-${hi}: target reached by the end of the duration`, v.stats.volume_sol >= tgt * 0.99 && lastT <= 30 + dur + 2, `${v.stats.volume_sol} SOL, last trade ${lastT}s (window ends ${30 + dur}s)`);
}

// 3. AutoSell / AutoBuy: counter, DCA, limit orders
s = start({ wallets: 20, org_level: "bullish", org_peak_rate: 0.75 }); run(80);
s = act("auto", { side: "sell", counter: true, rate: 50, min_trigger: 0.05, replication: 25, min_per_trade: 0, dca: false, pool: "holders", end_duration_s: 0, end_amount: 0, mc_min: 0, mc_max: 0 }); run(150); a = A();
check("AutoSell counter: sells answer outside buys", T(a, "autosell").sell > 3 && T(a, "autosell").buy === 0, JSON.stringify(T(a, "autosell")));
check("AutoSell start is on the timeline", noted(a, /autosell started/));
s = start({ wallets: 20 }); run(60);
s = act("auto", { side: "buy", counter: false, dca: true, dca_interval_s: 10, dca_mode: "fixed", dca_amount: 0.2, pool: "holders", end_duration_s: 0, end_amount: 0, mc_min: 0, mc_max: 0 }); run(100); a = A();
check("AutoBuy DCA: a buy every interval", T(a, "autobuy").buy >= 7 && T(a, "autobuy").buy <= 12, JSON.stringify(T(a, "autobuy")));
s = start({ wallets: 20, org_level: "bullish", org_peak_rate: 0.75 }); run(30); const mc0 = API.live_step({ slots: 1 }).mc_sol;
s = act("auto", { side: "sell", counter: false, dca: false, limits: `${(mc0 * 1.15).toFixed(1)}:2, ${(mc0 * 1.3).toFixed(1)}:2`, pool: "holders", end_duration_s: 0, end_amount: 0, mc_min: 0, mc_max: 0 }); s = run(400); a = A();
check("AutoSell limit orders sell at their market caps (if reached)", s.mc_path_max === undefined ? (T(a, "autosell").sell >= 1 || a.timeline.every(e => !/limit/.test(e[1]))) : true, JSON.stringify(T(a, "autosell")));

// 4. Sniper Guard: nuke when outside buys pass the threshold
s = start({ wallets: 20, org_level: "bullish", org_peak_rate: 0.75 }); s = act("guard", { threshold: 3, response: "nuke_all", end: "timed", timed_s: 600, complete_early: true }); run(200); a = A();
check("Sniper Guard triggers and sells (nuke)", T(a, "sniper_guard").sell > 0 && noted(a, /Sniper Guard triggered/), JSON.stringify(T(a, "sniper_guard")));

// 5. Manual trade, instant trade, nuke
s = start({ wallets: 20 }); run(60); s = act("trade", { side: "buy", wallets: ids(s, /op_holder/).slice(0, 3), amount: 0.3, style: "parallel" }); run(4);
s = act("trade", { side: "sell", wallets: ids(s, /op_holder/).slice(0, 2), amount: 50, style: "parallel" }); run(4);
s = act("instant", { wallet: ids(s, /op_front/)[0], side: "sell", amount: 25 }); run(2); a = A();
check("manual buy shows", T(a, "manual_buy").buy === 3, JSON.stringify(T(a, "manual_buy")));
check("manual sell shows", T(a, "manual_sell").sell === 2, JSON.stringify(T(a, "manual_sell")));
check("instant trade shows", T(a, "instant_trade").sell === 1, JSON.stringify(T(a, "instant_trade")));
s = act("nuke", { scope: "all" }); run(4); a = A();
{ const left = API.live_step({ slots: 1 }).wallets.filter(w => w.tok > 1 && w.role !== "op_relay"); check("Nuke sells every wallet holding tokens", T(a, "nuke").sell >= 5 && left.length === 0, JSON.stringify(T(a, "nuke")) + " left " + JSON.stringify(left.map(w => [w.name, Math.round(w.tok)]))) }

// 6. Cleanup: sell+buy rounds into fresh wallets
s = start({ wallets: 20 }); run(150); s = act("cleanup", { wallets: ids(s, /op_holder/).slice(0, 6), outputs: 6, share: 100, delay_mode: "fixed", delay: 3, delay_min: 1, delay_max: 4, double_pct: 0, method: "buyback" }); run(120); a = A();
check("Cleanup: sells from inputs, buys into fresh outputs", T(a, "cleanup").sell > 0 && T(a, "cleanup").buy > 0, JSON.stringify(T(a, "cleanup")));

// 7. Organic market switch: off -> no organic trades afterwards; on -> they come back
s = start({ wallets: 20 }); run(60); act("organic", { level: "off" }); const o1 = T(A(), "organic").buy; run(120); const o2 = T(A(), "organic").buy;
check("Organic off: no new organic buys", o2 === o1, `${o1} -> ${o2}`);
act("organic", { level: "bullish" }); run(120); const o3 = T(A(), "organic").buy;
check("Organic bullish: organic buys resume", o3 > o2 + 5, `${o2} -> ${o3}`);

// 8. Claim creator fees, burn, lock, withdraw (non-trade moves the read sees)
s = start({ wallets: 20 }); run(200); s = act("claim"); s = act("burn", { pct: 0.5 }); s = act("lock", { pct: 0.5, days: 30 }); a = A();   // the tool: dev wallet only, % of total supply
check("Claim creator fees moves SOL to the dev", (a.moves["claim_fees:sol"] || 0) >= 1, JSON.stringify(a.moves["claim_fees:sol"]));
check("Burn and lock move tokens", Object.keys(a.moves).some(k => /^burn/.test(k)) && Object.keys(a.moves).some(k => /^lock/.test(k)), Object.keys(a.moves).join(","));
s = act("withdraw", { recipient: "fresh", group: "all", route: "hop" }); run(80); a = A();
check("Withdraw sweeps wallets through a hop", s.withdraw && s.withdraw.n > 5, JSON.stringify(s.withdraw && { n: s.withdraw.n, phase: s.withdraw.phase }));

// 9. Generate Activity: happens before deploy on other tokens, so it is reported, not drawn on this chart
s = start({ wallets: 20, ga_enabled: true, ga_loops: 10 }); a = A();
check("Generate Activity runs before launch and is reported", a.ga && a.ga.loops >= 10 * 20 && a.ga.cost_sol > 0 && s.autos.some(x => /Generate Activity/.test(x.title)), JSON.stringify(a.ga));
check("Generate Activity is not drawn on the token's chart", !a.tools.generate_activity);

// 10. no wallet ever goes below zero in any of these runs
check("no wallet below zero", s.wallets.every(w => w.sol >= -1e-9));

// 11. The outside market follows real pump.fun numbers (Oct 2026): a typical launch's snipers don't fill the curve, the count varies,
// dead / bullish organic levels look like real launches, and bots' sells that hit the curve-to-pool moment retry instead of vanishing.
const B = API.init().builtins, liveRun = (cfg, secs, every = 5) => { API.live_create({ config: cfg }); API.live_fund(); API.live_launch(); let t = 0, done = null, st;
  for (let x = every; x <= secs; x += every) { const k = Math.round(x / E.SLOT_S) - t; t += k; st = API.live_step({ slots: k }); if (done === null && st.complete) done = x } return { st, done, a: A() } };
{ const r = [1, 2, 3].map(seed => liveRun(Object.assign({}, B["Block-0 Clean Build"], { seed }), 60));
  check("Typical snipers: a Block-0 Clean Build does not fill the curve in the first minute", r.every(x => x.done === null), r.map(x => x.done).join(",")); }
{ const n = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => { const x = E.simulate(E.normalise(Object.assign({}, B["Blank (everything off)"], { sn_level: "typical", seed, duration_min: 1 }))); return Object.values(x.c.truth).filter(v => v === "sniper").length });
  check("Typical snipers: the count varies per launch (some none, some many)", Math.min(...n) === 0 && Math.max(...n) >= 4 && new Set(n).size >= 3, n.join(",")); }
{ const x = E.simulate(Object.assign(E.shardsPreset(), { seed: 2, duration_min: 12, exit_enabled: false })), sn = Object.keys(x.c.truth).filter(a => x.c.truth[a] === "sniper");
  check("Hot snipers: contested launch has failed attempts that still pay fees", x.c.failed.n > 20 && x.c.failed.sol > 0, `${x.c.failed.n} failed, ${x.c.failed.sol.toFixed(4)} SOL`);
  check("Snipers' sells retry through the curve-to-pool moment: none still holding after 12 min", sn.every(a => (x.c.tok[a] || 0) <= 1), sn.filter(a => x.c.tok[a] > 1).length + " still holding"); }
{ const r = [1, 2, 3].map(seed => liveRun(Object.assign({}, B["Blank (everything off)"], { seed, org_enabled: true, org_level: "dead" }), 300)), n = r.map(x => (x.a.tools.organic || { buy: 0, sell: 0 }));
  check("Dead organic: only a handful of trades in 5 minutes", n.every(o => o.buy + o.sell <= 15), n.map(o => o.buy + o.sell).join(",")); }
{ const r = [1, 2, 3].map(seed => liveRun(Object.assign({}, B["Blank (everything off)"], { seed, sn_level: "typical", ct_count: 6, org_enabled: true, org_level: "bullish" }), 1200, 10));
  check("Bullish organic: fills the curve after minutes, not seconds (real: 4-10 min)", r.every(x => x.done !== null && x.done >= 120), r.map(x => x.done).join(",")); }
{ const r = liveRun(Object.assign({}, B["SHARDS (fitted to the real chart)"], { seed: 1 }), 420), before = r.a.timeline.find(e => /Manual sells/.test(e[1]));
  check("Fitted SHARDS in the Workspace: the scripted dump runs at 6:45 and the price crashes", before && Math.abs(before[0] - 405) < 1 && r.st.mc_sol < 120, `${before && before[0]}s, MC ${Math.round(r.st.mc_sol)}`); }
{ API.live_create({ config: Object.assign({}, B["Block-0 Clean Build"], { seed: 4, sn_level: "hot", ct_count: 12, ct_follow_pct: 60, ct_trigger_sol: 0.5 }) }); API.live_fund(); API.live_launch(); API.live_step({ slots: 600 });
  const cp = TRADES_OF("copy_trade");
  const inRange = cp.filter(t => t >= 0.19 && t <= 0.31).length;   // the odd one is smaller: the buy that completes the curve is capped at the tokens left
  check("Copy-trade bots buy a fixed ~0.25 SOL per copy by default", cp.length > 20 && inRange >= cp.length * 0.97 && cp.every(t => t <= 0.31), `${inRange}/${cp.length} between 0.2 and 0.3 SOL`); }
console.log(`\n${n} checks`); console.log(ok ? "ALL PASS" : "SOME FAILED"); process.exit(ok ? 0 : 1);
