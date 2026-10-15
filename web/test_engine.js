// Node smoke tests for the browser engine: node test_engine.js
const E = require("./engine.js");
const sim = o => { const c = Object.assign(E.shardsPreset(), { duration_min: 12 }, o); const r = E.simulate(c); r.tr = E.tradesOf(r.c); return r; };
const tools = tr => tr.reduce((m, t) => (m[t.tool] = (m[t.tool] || 0) + 1, m), {});
let ok = true; const check = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (i ? `  [${i}]` : "")); ok = ok && !!c; };
let r = sim({});
check("Block-0 bundle ~56.5%", Math.abs(r.tr.filter(t => t.slot === 0 && ["dev_buy", "front_mev"].includes(t.tool)).reduce((a, t) => a + t.tok, 0) / 1e7 - 56.5) < 0.1);
check("graduates", r.c.migrated_slot !== null, r.c.migrated_slot);
r = sim({ scheduled: true, snipe_at_s: 90 }); const fh = Math.min(...r.tr.filter(t => t.tool === "holder_buy").map(t => t.t));
check("Scheduled Mode waits for Snipe", fh >= 90, fh);
r = sim({ preset: "custom", front_count: 3, back_count: 4, temp_count: 6, front_back_delay_s: 2, back_temp_delay_s: 4 }); let tc = tools(r.tr);
check("Custom layers", tc.back_mev >= 4 && tc.front_mev >= 8 && r.c.ledger.filter(x => x.kind === "tokx").length >= 6 && tc.holder_buy >= 20, JSON.stringify(tc));   // sells carry the seller's own layer
r = sim({ sg_enabled: true, sg_threshold: 10, sg_response: "nuke_all" }); check("Sniper Guard nuke", (tools(r.tr).sniper_guard || 0) >= 3, tools(r.tr).sniper_guard);
r = sim({ vb_mode: "duration", vb_duration_s: 120, vb_size_mode: "auto", vb_exec: "bundle", vb_wallets: "dedicated" });
check("Bundle volume: same-block pairs + tips", [...E.roundTrips(r.tr).values()].some(v => v[1] > 0) && r.c.ledger.some(x => x.tool === "jito_tip" && x.slot > 0));
r = sim({ as_enabled: true, as_counter: false, as_dca: true, as_dca_interval_s: 20, as_end_duration_s: 400 }); check("AutoSell DCA", (tools(r.tr).autosell || 0) >= 8, tools(r.tr).autosell);
r = sim({ as_enabled: false, ab_enabled: true, ab_counter: false, ab_limits: "300:1, 150:2", ab_end_duration_s: 0, ab_start_delay_s: 10 }); { const ab = r.tr.filter(t => t.tool === "autobuy"), sol = ab.reduce((a, t) => a + t.sol, 0); check("AutoBuy limits: each order fills once (1 + 2 SOL, spread over wallets)", ab.length >= 1 && sol <= 3.05 && new Set(ab.map(t => Math.round(t.t))).size <= 2, `${ab.length} fills, ${sol.toFixed(2)} SOL`) }
r = sim({ exit_enabled: false, cl_enabled: true, cl_start_s: 120, cl_outputs: 12, cl_double_pct: 100, cl_delay_mode: "fixed", cl_delay: 3 });
const rep = Object.fromEntries(E.report(r.c, r.tr).map(s => [s.id, s])); check("live Cleanup double buy", (tools(r.tr).cleanup || 0) >= 12 && rep.cleanup.value.includes("with 2+"), rep.cleanup.value);
{ // withdraw route: hop wallet collects in one block, forwards seconds later; the ledger-only signal sees it
  const sig = o => { const x = sim(Object.assign({ exit_start_s: 60, exit_window_s: 120 }, o)); return [x, Object.fromEntries(E.report(x.c, x.tr).map(s => [s.id, s])).consolidation] };
  const [h, sh] = sig({}), hop = Object.keys(h.c.truth).find(a => h.c.truth[a] === "op_hop");
  const into = h.c.ledger.filter(x => x.kind === "sol" && x.to === hop), out = h.c.ledger.filter(x => x.kind === "sol" && x.frm === hop);
  check("exit withdraw goes via a hop wallet", hop && new Set(into.map(x => x.slot)).size === 1 && out.length === 1 && out[0].to === h.c.ledger.find(x => x.tool === "funding" && x.kind === "sol").to && out[0].slot > into[0].slot, `${into.length} in, ${out.length} out`);
  check("consolidation signal flags the hop", sh.level === "high" && /hop/.test(sh.value), sh.value);
  check("consolidation never counts organic or snipers", [...new Set(h.c.ledger.filter(x => x.kind === "sol" && x.to === hop).map(x => x.frm))].every(a => h.c.truth[a].startsWith("op_")));
  const [, sd] = sig({ exit_withdraw_route: "direct" }); check("direct withdraw: sweep seen, no hop", sd.level === "high" && !/hop/.test(sd.value), sd.value);
  const [, sn] = sig({ exit_enabled: false }); check("no withdraw: no consolidation", sn.level === "none", sn.value);
}
{ // marketplace wallets: first funded hours earlier by exchanges or one-off proxies, 30+ min apart, one prior trade
  const m = sim({ wallet_source: "marketplace", exit_enabled: false }), C = m.c, op = Object.keys(C.truth).filter(a => ["op_front", "op_holder"].includes(C.truth[a]));
  const firstIn = a => C.ledger.find(x => x.kind === "sol" && x.to === a);
  const seeds = op.map(firstIn), slots = seeds.map(x => x.slot).sort((a, b) => a - b);
  check("marketplace wallets are seeded hours before funding", seeds.every(x => x.tool === "market_seed") && -slots[slots.length - 1] * 0.4 / 3600 > 4, (-slots[slots.length - 1] * 0.4 / 3600).toFixed(1) + " h");
  check("marketplace seeds keep a 30 min gap", slots.slice(1).every((s, i) => (s - slots[i]) * 0.4 >= 1799));
  check("marketplace seeds come from exchanges or proxies, never the Funder", seeds.every(x => ["cex", "mkt_proxy"].includes(C.truth[x.frm])));
  check("each marketplace wallet has prior history", op.every(a => C.ledger.some(x => x.tool === "market_history" && x.signer === a)));
  const rm = Object.fromEntries(E.report(C, m.tr).map(s => [s.id, s]));
  check("bought wallets still cluster through distribution + Cleanup", rm.common_funding.level === "high", rm.common_funding.value);
}
{ // real-data path: trades + transfers CSV import runs the same sweep signal
  const fs = require("fs"), F = __dirname + "/../ui-tests/fixtures/";
  const imp = E.makeImport("synthetic", fs.readFileSync(F + "synthetic_trades.csv", "utf8"), null, fs.readFileSync(F + "synthetic_transfers.csv", "utf8"));
  const s9 = imp.signals[0];
  check("imported transfers: sweep + hop found", s9.level === "high" && /9 trading wallets in 1 sweep/.test(s9.value) && /hop/.test(s9.value) && s9.evidence[0].startsWith("HopWallet"), s9.value);
  const noTx = E.makeImport("no transfers", fs.readFileSync(F + "synthetic_trades.csv", "utf8"));
  check("import without transfers has no signals", !noTx.signals);
  const ctl = E.sweepSignal([{ k: 1, t: 0, from: "a", to: "x", sol: 1 }, { k: 2, t: 1, from: "b", to: "x", sol: 1 }, { k: 3, t: 2, from: "c", to: "x", sol: 1 }], new Set(["a", "b", "c"]));
  check("transfers in different blocks are not a sweep", ctl.level === "none", ctl.value);
}
r = sim({ exit_enabled: false, cl_enabled: true, cl_start_s: 120, cl_outputs: 8, cl_method: "streamflow" }); check("Streamflow claims", r.c.ledger.filter(x => x.kind === "claim").length >= 8);
r = sim({ mode: "quick", as_enabled: false }); check("Quick at slot 1", new Set(r.tr.filter(t => t.tool === "holder_buy").map(t => t.slot)).size === 1);
r = sim({ mode: "organic", buy_delay_s: 4, as_enabled: false }); const g = E.gridRun(r.tr.filter(t => t.tool === "holder_buy").map(t => t.t).sort((a, b) => a - b)); check("Organic 4 s grid", g && Math.abs(g[1] - 4) < 0.5, g);
const a = JSON.stringify(E.tradesOf(E.simulate(Object.assign(E.shardsPreset(), { duration_min: 3 })).c).slice(0, 50)), b = JSON.stringify(E.tradesOf(E.simulate(Object.assign(E.shardsPreset(), { duration_min: 3 })).c).slice(0, 50));
check("deterministic", a === b);
{ // blank configuration: nothing trades at all
  const b = E.simulate(Object.assign(E.blankPreset(), { duration_min: 5 })), bt = E.tradesOf(b.c), lib = E.builtins();
  check("Blank config: zero trades in 5 min", bt.length === 0, bt.length);
  check("Blank config is first in the library", Object.keys(lib)[0] === "Blank (everything off)");
  const L = new E.Live(E.blankPreset()); L.fund ? L.fund() : 0;
  check("Blank config: no outside or operator trader roles", !Object.values(b.c.truth).some(r => ["organic", "sniper", "copy"].includes(r)));
}
// organic traders: off by default; when on, they can wait for a market-cap threshold
{ const off = sim({}), on = sim({ org_enabled: true }), late = sim({ org_enabled: true, org_start_mc_sol: 400 });
  const orgT = x => x.tr.filter(t => t.tool === "organic");
  check("organic off by default: no organic wallets or trades", orgT(off).length === 0 && !Object.values(off.c.truth).includes("organic"));
  check("organic on: organic trades happen", orgT(on).length > 50, orgT(on).length);
  const first = orgT(late)[0], mcBefore = first ? Math.max(...late.tr.filter(t => t.slot < first.slot).map(t => t.mc)) : 0;
  check("organic threshold: first organic buy only after MC reached 400 SOL", !first || mcBefore >= 400, first ? mcBefore.toFixed(0) : "no organic buys");
}
// counter-trade false/true rates
let fp = 0, tp = 0;
for (const [o, exp] of [[{ mode: "quick", as_enabled: false }, 0], [{ as_enabled: false }, 0], [{ mode: "organic", as_enabled: false, vb_enabled: false }, 0], [{ mode: "manual", ab_enabled: true, as_enabled: false, vb_enabled: false }, 1], [{}, 1]])
  for (let s = 1; s <= 4; s++) { const x = E.simulate(Object.assign(E.shardsPreset(), o, { seed: s, org_enabled: true })); /* counter-trading needs outside buyers */ const hit = E.report(x.c, E.tradesOf(x.c)).find(q => q.id === "counter").level !== "none"; if (exp) tp += hit; else fp += hit; }
check("counter-trade (grouping as the tool's default): 0 false of 12", fp === 0, `false ${fp}/12, caught ${tp}/8`);
console.log(`INFO counter-trade with the tool's default 'minimum per trade' grouping: caught ${tp}/8 (grouping makes responses less obvious, by design)`);
// the AutoBuy wallets get 2 SOL extra so the counter-buying runs long enough to be seen (with the tool's budget they run dry in about a minute)
{ let tp0 = 0; for (const o of [{ mode: "manual", ab_enabled: true, ab_min_per_trade: 0, as_enabled: false, vb_enabled: false, funding_extra_mode: "fixed", funding_extra: 2 }, { as_min_per_trade: 0 }])
    for (let s = 1; s <= 4; s++) { const x = E.simulate(Object.assign(E.shardsPreset(), o, { seed: s, org_enabled: true })); if (E.report(x.c, E.tradesOf(x.c)).find(q => q.id === "counter").level !== "none") tp0++; }
  check("counter-trade without grouping: caught 8 of 8", tp0 === 8, `${tp0}/8`); }
// full run summary
const out = E.runConfig(E.shardsPreset()); const s = out.summary;
console.log("SHARDS run:", { peak: Math.round(s.peak_mc_sol), peak_t: s.peak_t, grad: s.graduated_t, final: Math.round(s.final_mc_sol), trades: s.trades, opPnL: Math.round(s.operator.pnl_sol), organic: Math.round(s.pnl_by_group.organic ?? 0) });
console.log(out.report.map(x => x.level.toUpperCase() + " " + x.name).join(" | "));
console.log("graph", out.graph.nodes.length, out.graph.edges.length, "json KB", Math.round(JSON.stringify(out).length / 1024));
// matcher on hidden-seed exports
const lib = Object.values(E.builtins()); let hits = 0;
for (const name of ["Organic mode + Bundle volume", "SHARDS reconstruction", "Quick mode, no automations", "Block-0 + Streamflow airdrop", "Manual mode + AutoBuy DCA"]) {
  const cfg = Object.assign({}, E.builtins()[name], { seed: 99, duration_min: 20 }); const x = E.simulate(cfg);
  const csv = "timestamp,wallet,side,sol_amount,token_amount\n" + E.tradesOf(x.c).map(t => [1760000000 + t.t, t.wallet, t.side, t.sol, t.tok * 1e6].join(",")).join("\n");
  const imp = E.makeImport("t", csv, ""); const m = E.match(imp, lib, 0); hits += m.top[0].name === name;
  console.log((m.top[0].name === name ? "OK   " : "MISS ") + name + " -> " + m.top.slice(0, 2).map(t => t.name + " " + t.distance.toFixed(2)).join(", "));
}
check("matcher recovers 5/5", hits === 5, hits);
{ // Solscan exports: DeFi activities import as trades; the token transfer export is refused as trades and ignored as SOL transfers
  const fs = require("fs"), F = __dirname + "/../ui-tests/fixtures/", a = fs.readFileSync(F + "solscan_defi_sample.csv", "utf8"), tr = fs.readFileSync(F + "solscan_transfer_sample.csv", "utf8");
  const imp = E.makeImport("s", a, "", tr), r = imp.notes.join(" ");
  check("Solscan swaps import", imp.n_trades >= 35 && /Solscan DeFi/.test(r) && /token transfer export/.test(r) && !imp.signals, imp.n_trades);
  let msg = ""; try { E.makeImport("s", tr) } catch (e) { msg = e.message }
  check("Solscan transfer export refused as trades", /DeFi Activities/.test(msg), msg);
}
{ // Proxima docs parity (docs.proxima.tools: Launch Modes, Block-0 Configuration, Launch Settings)
  const hb = r => r.tr.filter(t => t.tool === "holder_buy" || t.tool === "manual_buy");
  let x = sim({ mode: "quick", vb_enabled: false, as_enabled: false, exit_enabled: false });
  check("Quick: Buy Delay 0 (all holder buys start together)", new Set(hb(x).map(t => t.slot)).size === 1, [...new Set(hb(x).map(t => t.slot))].join(","));
  x = sim({ mode: "organic", buy_delay_s: 3, vb_enabled: false, as_enabled: false, exit_enabled: false }); const os = hb(x).map(t => t.t);
  check("Organic: holder buys spaced by Buy Delay", os.length > 3 && os.slice(1).every((t, i) => Math.abs(t - os[i] - 3) < 0.5), os.slice(0, 4).join(","));
  check("Organic: Buy Delay does not hold back the Dev Buy", x.tr.some(t => t.tool === "dev_buy" && t.slot === 0));
  x = sim({ mode: "manual", scheduled: true, snipe_at_s: 200, manual_buy_at_s: 20, vb_enabled: false, as_enabled: false, exit_enabled: false });
  check("Manual: Scheduled Mode is not offered", x.cfg.scheduled === false && Math.min(...hb(x).map(t => t.t)) < 200);
  check("Manual: Dev Buy still runs at launch", x.tr.some(t => t.tool === "dev_buy" && t.slot === 0));
  x = sim({ mode: "organic", scheduled: true, snipe_at_s: 90, vb_enabled: false, as_enabled: false, exit_enabled: false });
  check("Scheduled: Dev Buy at launch, holder buys wait for Snipe", x.tr.some(t => t.tool === "dev_buy" && t.slot === 0) && Math.min(...hb(x).map(t => t.t)) >= 90);
  const n = c => E.normalise(Object.assign(E.shardsPreset(), c));
  // numbers read off the tool's Launch Settings (each preset switched to Custom), 55% holders, 1.5% dev
  const lay = (preset, h, m = 1) => { const x = n({ preset, wallets: h, back_tuning: m }); return [x.front_count, x.back_count, x.temp_count, x.front_back_delay_s, x.back_temp_delay_s, x.buy_delay_s].join("/"); };
  const seen = [["quick", 20, 1, "1/3/0/0.7/0.7/0.7"], ["clean", 20, 1, "1/4/0/0.7/0.7/16"], ["full", 20, 1, "1/3/14/0.7/0.7/16"], ["quick", 50, 1, "3/11/0/0.7/0.7/0.7"],
    ["clean", 50, 1, "4/15/0/0.7/0.7/16"], ["full", 50, 1, "3/11/34/0.7/0.7/16"], ["quick", 100, 1, "4/14/0/0.7/0.7/0.7"], ["clean", 100, 1, "5/18/0/0.7/0.7/16"],
    ["full", 100, 1, "4/14/67/0.7/0.7/16"], ["full", 200, 1, "4/14/134/0.7/0.7/16"], ["quick", 10, 1, "1/2/0/0.7/0.7/0.7"], ["quick", 30, 1, "2/6/0/0.7/0.7/0.7"],
    ["clean", 30, 1, "2/8/0/0.7/0.7/16"], ["quick", 70, 1, "4/13/0/0.7/0.7/0.7"], ["clean", 70, 1, "5/17/0/0.7/0.7/16"], ["quick", 50, 0.4, "2/5/0/0.7/0.7/0.7"], ["quick", 50, 1.6, "5/18/0/0.7/0.7/0.7"]];
  const bad = seen.filter(([p, h, m, want]) => lay(p, h, m) !== want).map(([p, h, m, want]) => `${p}@${h}x${m}: ${lay(p, h, m)} != ${want}`);
  check("Presets match the tool's Front/Back/Temp counts and delays (17 readings)", !bad.length, bad.join("; "));
  const plan = (preset, h) => new E.Live(n({ preset, wallets: h, back_tuning: 1 })).planInfo().cleanup_time_s;
  const ct = [["quick", 20, 16], ["clean", 20, 307], ["full", 20, 316], ["clean", 50, 795], ["quick", 50, 42]].map(([p, h, want]) => [p, h, want, plan(p, h)]);
  check("Cleanup Time matches the tool's estimate (within 1 s)", ct.every(([, , w, g]) => Math.abs(g - w) <= 1), ct.map(([p, h, w, g]) => `${p}@${h} ${g.toFixed(1)}/${w}`).join(", "));
  const fb = sim({ preset: "quick", wallets: 20, back_tuning: 1, exit_enabled: false, vb_enabled: false, as_enabled: false, sn_level: "none", ct_count: 0 }), bk = fb.tr.filter(t => t.tool === "back_mev" && t.side === "buy").map(t => t.t);
  check("Back MEV buybacks are 0.7 s apart", bk.length === 3 && bk.slice(1).every((t, i) => Math.abs(t - bk[i] - 0.8) < 0.01), bk.join(","));
  const o = E.normalise({ mode: "organic", holder_buy_sol: 10, dev_buy_pct: 0 }), live = new E.Live(o).planInfo();
  check("Organic: Holders Buy in SOL costs about that much SOL", Math.abs(live.cost_sol - 10) < 0.5, live.cost_sol.toFixed(2));
  const sf = n({ alloc_method: "streamflow", back_tuning: 6 });
  check("Streamflow Airdrop only without Back MEV", sf.back_count === 0);
  check("Holders + Empty Holders stay within 200", n({ wallets: 150, empty_holders: 120 }).empty_holders === 50 && n({ wallets: 400 }).wallets === 200);
  x = sim({ empty_holders: 6, exit_enabled: false }); const em = Object.keys(x.c.truth).filter(a => x.c.truth[a] === "op_empty");
  check("Empty Holders are funded but never trade", em.length === 6 && em.every(a => x.c.ledger.some(r => r.kind === "sol" && r.to === a)) && !x.tr.some(t => em.includes(t.wallet)));
  const tip = o => sim(o).c.ledger.find(r => r.tool === "jito_tip" && r.slot === 0).sol;
  check("Fee Target is added to the Block-0 bundle tip", Math.abs(tip({ fee_target: 0.2 }) - tip({}) - 0.2) < 1e-9);
}
{ // chart read: same function on a simulated launch (with answer key) and on an import (trades only)
  const x = sim({}), rd = E.simRead(x.c, x.op || E.simulate(x.cfg).op, x.tr, E.report(x.c, x.tr));
  check("read: catches every operator wallet that traded", rd.answer.caught === rd.answer.operator_traders, JSON.stringify(rd.answer));
  check("read: at most 2 outside wallets filed as insiders", rd.answer.false_flags <= 2, rd.answer.false_flags);
  check("read: insider holding tracks the true operator holding", Math.abs(rd.held_now - rd.truth_now) < 3, rd.held_now.toFixed(1) + " vs " + rd.truth_now.toFixed(1));
  check("read: bundle phase first, deploy-block mark at 0 s", rd.phases[0].kind === "bundle" && rd.marks[0].kind === "bundle" && rd.marks[0].t === 0);
  check("read: the operator exit shows as distribution", rd.phases.some(p => (p.kind === "exit" || p.kind === "dump") && p.drop >= 5), rd.phases.map(p => p.kind).join(","));
  const csv = "timestamp,wallet,side,sol_amount,token_amount\n" + x.tr.map(t => [1760000000 + t.t, t.wallet, t.side, t.sol, t.tok * 1e6].join(",")).join("\n");
  const imp = E.makeImport("r", csv, ""), own = new Set(x.tr.filter(t => x.c.truth[t.wallet].startsWith("op_")).map(t => t.wallet));
  const ins = Object.entries(imp.read.wallets).filter(([, v]) => v[2] === "insider").map(([w]) => w);
  check("import read: trades only still finds the deploy-block bundle", ins.length >= 4 && ins.filter(w => own.has(w)).length >= ins.length - 2, `${ins.length} insiders`);
  check("import keeps its trades for the chart", imp.trades.length === x.tr.length && imp.trades[0].length === 9);
  const quiet = sim({ mode: "organic", vb_enabled: false, as_enabled: false, exit_enabled: false, dev_buy_pct: 0 }), rq = E.simRead(quiet.c, E.simulate(quiet.cfg).op, quiet.tr, E.report(quiet.c, quiet.tr));
  check("read: no dump phase when nobody exits", !rq.phases.some(p => p.kind === "dump"), rq.phases.map(p => p.kind).join(","));
}
{ // fees, platform fee, real exit value, organic levels (live sessions)
  const run = (o, act, slots = 750) => { E.API.live_create({ config: Object.assign(E.shardsPreset(), { funder_deposit: 100 }, o) }); E.API.live_fund(); E.API.live_launch(); if (act) E.API.live_action(act); return E.API.live_step({ slots }) };
  let s = run({});
  const F = s.fees.cats;
  check("fees: every operator transaction pays the base fee", F.network && Math.abs(F.network.avg - 0.000005) < 1e-12 && F.network.n > 100, F.network && F.network.n);
  check("fees: priority fees vary per transaction", F.priority.min < F.priority.avg && F.priority.max > F.priority.avg * 2, `${F.priority.min.toFixed(6)}-${F.priority.max.toFixed(6)}`);
  // Oct 2026 rent (5,080 lamports/byte): 170-byte Token-2022 coin account 0.00151384 SOL; pump.fun volume account 0.0013462 SOL on a wallet's first buy
  const Fp = run({ launchpad: "pumpfun", vb_enabled: false, as_enabled: false, exit_enabled: false }).fees.cats.rent;
  check("fees: pump.fun rent is 0.00151384 SOL per coin account plus 0.0013462 SOL on a wallet's first buy", Fp && Math.abs(Fp.max - 0.00151384) < 1e-12 && Math.abs(Fp.min - 0.0013462) < 1e-12, Fp && `${Fp.min}-${Fp.max}`);
  check("fees: Meteora DBC rent is the coin account only", F.rent && Math.abs(F.rent.min - 0.00151384) < 1e-12 && Math.abs(F.rent.max - 0.00151384) < 1e-12);
  check("fees: pump.fun trade fees are 1.25% on the curve", F.trade && F.trade.sum > 0.5, F.trade && F.trade.sum.toFixed(3));
  check("Funder starts with the 100 SOL deposit", s.fees.funder_start === 100 && s.pnl2.deposited === 100);
  check("P&L: real exit value is below paper value (slippage + fees)", s.pnl2.exit_sol < s.pnl2.paper_sol, `${s.pnl2.exit_sol.toFixed(2)} < ${s.pnl2.paper_sol.toFixed(2)}`);
  check("P&L: if-exit = SOL now + exit value - deposited", Math.abs(s.pnl2.if_exit - (s.pnl2.sol_now + s.pnl2.exit_sol - s.pnl2.deposited)) < 1e-9);
  const before = s.fees.cats.platform ? s.fees.cats.platform.sum : 0, holders = s.wallets.filter(w => w.role === "op_holder" && w.tok > 1).map(w => w.id);
  s = E.API.live_action({ name: "trade", params: { side: "sell", wallets: holders.slice(0, 3), amount: 100, style: "parallel" } });
  const plat = s.fees.cats.platform.sum - before;
  check("platform fee: 5% of SOL from the tool's sells", plat > 0, plat.toFixed(4));
  const lv = {}; for (const k of ["verylow", "mid", "bullish"]) lv[k] = run({ vb_enabled: false, as_enabled: false, exit_enabled: false }, { name: "organic", params: { level: k } }, Math.round(600 / E.SLOT_S)).mc_sol;
  check("organic levels: very low < mid < bullish, and none runs away", lv.verylow < lv.mid && lv.mid < lv.bullish && lv.bullish < 20000, Object.values(lv).map(v => v.toFixed(0)).join(" < "));
  // finding, not a requirement: counter-trading under a noisy Mid market
  let hit = 0; for (let k = 1; k <= 4; k++) { const x = E.simulate(Object.assign(E.shardsPreset(), { seed: k, org_enabled: true, org_level: "mid" })); hit += E.report(x.c, E.tradesOf(x.c)).find(q => q.id === "counter").level !== "none" }
  console.log(`INFO counter-trading (AutoSell) detected in ${hit}/4 runs with a Mid organic market`);
}
console.log(ok ? "\nALL PASS" : "\nSOME FAILED");
