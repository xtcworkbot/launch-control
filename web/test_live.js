// Node test for the live Workspace session: node test_live.js
const { API } = require("./engine.js");
const E = require("./engine.js");
let ok = true; const check = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (i !== "" ? `  [${i}]` : "")); ok = ok && !!c; };
const cfg = Object.assign(E.shardsPreset(), { scheduled: true, snipe_manual: true, vb_enabled: false, as_enabled: false, org_enabled: true });   // AutoSell needs outside buyers
let r = API.live_create({ config: cfg });
check("plan: 4 Front MEV, 20 holders, ~56.5% supply", r.plan.layers.front === 4 && r.plan.layers.holders === 20 && Math.abs(r.plan.supply_pct - 56.5) < 0.1, r.plan.supply_pct.toFixed(1));
check("plan estimate MC ~110-130 SOL", r.plan.est_mc_sol > 100 && r.plan.est_mc_sol < 140, r.plan.est_mc_sol.toFixed(0));
API.live_fund(); let s = API.live_launch();
check("launched, snipe pending", s.phase === "live" && s.snipe_pending, s.t);
s = API.live_step({ slots: 50 });
check("no holder buys before Snipe", !s.feed.some(x => x.tool === "holder_buy"));
s = API.live_action({ name: "snipe" }); s = API.live_step({ slots: 150 });
check("Snipe starts Block-0 holder buys", s.feed.some(x => x.tool === "holder_buy") || s.timeline.some(x => /Snipe/.test(x[1])), s.timeline.slice(-2).map(x => x[1]).join(" / "));
s = API.live_step({ slots: 200 });
const mine = s.wallets.filter(w => w.role === "op_holder" && w.tok > 1).map(w => w.id);
check("holders hold tokens", mine.length >= 10, mine.length);
s = API.live_action({ name: "deposit", params: { amount: 20 } });
s = API.live_action({ name: "fund", params: { wallets: s.wallets.filter(w => w.role === "op_front").map(w => w.id), amount: 3, method: "cex" } });
s = API.live_action({ name: "volume", params: { target: 10, mode: "delay", duration: 120, delay_min: 2, delay_max: 4, exec: "bundle", wave: 0, size_mode: "fixed", size: 0.5, size_min: 0.3, size_max: 1, fee_target: 0.02, wallets: s.wallets.filter(w => w.role === "op_front").map(w => w.id) } });
s = API.live_action({ name: "auto", params: { side: "sell", counter: true, rate: 50, min_trigger: 0.05, replication: 25, min_per_trade: 0, dca: false, pool: "holders", end_duration_s: 200, end_amount: 0, mc_min: 0, mc_max: 0 } });
s = API.live_action({ name: "guard", params: { threshold: 9999, response: "nuke_all", end: "timed", timed_s: 60 } });
s = API.live_step({ slots: 400 });
const vb = s.autos.filter(a => a.title.startsWith("Volume")).pop(), as = s.autos.filter(a => a.title.startsWith("AutoSell")).pop();
check("Volume Bot ran", vb && vb.stats.volume_sol > 5, JSON.stringify(vb && vb.stats));
check("AutoSell responding", as && as.stats.trades > 3, JSON.stringify(as && as.stats));
s = API.live_action({ name: "cancel", params: { id: as.id } }); const n0 = s.autos.find(a => a.id === as.id).stats.trades; s = API.live_step({ slots: 200 });
check("cancel stops AutoSell", s.autos.find(a => a.id === as.id).status === "cancelled" && s.autos.find(a => a.id === as.id).stats.trades === n0);
s = API.live_action({ name: "cleanup", params: { outputs: 6, share: 50, delay_mode: "random", delay: 5, delay_min: 0.5, delay_max: 3, double_pct: 50, method: "buyback", wallets: mine.slice(0, 5) } });
s = API.live_step({ slots: 200 });
check("Cleanup created wallets", s.wallets.filter(w => w.name.startsWith("Cleanup")).length === 6);
{ const dev0 = s.wallets.find(w => w.role === "op_dev").tok;
  s = API.live_action({ name: "lock", params: { pct: 0.5, days: 30 } });
  check("Lock takes 0.5% of supply from the dev wallet into Streamflow", Math.abs(dev0 - s.wallets.find(w => w.role === "op_dev").tok - 5e6) < 1 && s.timeline.some(e => /Locked for 30 days via Streamflow/.test(e[1])));
  s = API.live_action({ name: "burn", params: { pct: 0.5 } });
  check("Burn takes 0.5% of supply from the dev wallet", Math.abs(dev0 - s.wallets.find(w => w.role === "op_dev").tok - 1e7) < 1); }
s = API.live_action({ name: "instant", params: { side: "buy", wallet: s.wallets.find(w => w.role === "op_dev").id, amount: 0.2 } });
s = API.live_action({ name: "claim" });
s = API.live_action({ name: "nuke", params: { scope: "all" } }); s = API.live_step({ slots: 20 });
check("Nuke sells everything", s.wallets.filter(w => w.tok > 1 && w.role !== "op_relay").length === 0, s.wallets.filter(w => w.tok > 1).length);
s = API.live_action({ name: "withdraw" }); s = API.live_step({ slots: 160 });
check("withdraw moves SOL to Funder", s.funder_sol > 1, s.funder_sol.toFixed(2));
const g = API.live_graph();
check("report + graph available", g.report.length === 9 && g.graph.nodes.length > 50, g.report.map(x => x.level[0]).join(""));
console.log("t", s.t, "MC", s.mc_sol.toFixed(0), "P&L", JSON.stringify(Object.fromEntries(Object.entries(s.pnl).map(([k, v]) => [k, +v.toFixed(2)]))));
let bad = 0; try { API.live_action({ name: "trade", params: { side: "buy", wallets: ["notmine"], amount: 1, style: "parallel" } }); } catch (e) { bad = 1; }
check("refuses non-operator wallets", bad === 1);
{ // blank config in the live Workspace: nothing moves until you click
  const B = E.blankPreset(); API.live_create({ config: B }); API.live_fund(); API.live_launch();
  let st = API.live_step({ slots: 250, cursor: 0 });
  check("blank live launch: no trades by itself", st.inc.trades.length === 0, st.inc.trades.length);
  const ids = st.wallets.filter(w => w.role === "op_holder").slice(0, 3).map(w => w.id), cur = st.inc.cursor;
  API.live_action({ name: "trade", params: { side: "buy", wallets: ids, amount: 0.1, style: "parallel" } }); st = API.live_step({ slots: 5, cursor: cur });
  check("blank live launch: manual buys work", st.inc.trades.filter(t => t[5] === "manual_buy").length === 3, st.inc.trades.length);
}
console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
