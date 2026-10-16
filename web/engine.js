/* Launch Config Lab engine: JavaScript port of the Python lab (chain.py, config.py, operator_tools.py,
   crowd.py, runner.py, analysis.py, lab.py). Pure simulation: no wallets, keys, RPC or chain.
   Runs in a Web Worker in the page, or in Node for tests. */
"use strict";

// ================================================================== chain
// Solana slots: 200 ms since 9 Oct 2026 (SIMD-0525 cut them from 400 ms in four steps; measured ~216 ms on 15 Oct)
const SLOT_S = 0.2, SUPPLY = 1e9, V_SOL0 = 30, V_TOK0 = 1073e6, REAL_TOK0 = 793.1e6, MIGRATION_FEE = 0.015;
const CURVE_FEES = [0.003, 0.0095, 0];   // [creator, protocol, LP] share of each trade
// Launchpads. pump.fun: its published curve, migration to PumpSwap with market-cap-tiered fees.
// Meteora DBC -> DAMM v2: fitted to the SHARDS launch's own pool balances (5 Oct 2026): a constant-product curve with ~28.74 virtual SOL
// and ~1.0615B virtual tokens that completes at 800M tokens sold (~88 SOL); the DAMM v2 pool opened with 84.83 SOL / 199.6M tokens
// (so ~3.13 SOL went to migration); curve fee ~1% and pool fee ~0.25% (the lowest fees direct traders paid on SHARDS).
const PAD_MODELS = {
  // synth: since 7 Oct 2026 pump.fun's v3 buys don't stop at the end of the curve: the rest of the SOL buys from the pool the coin
  // is about to get, at that pool's price and the curve's fees ("synthetic migration", pump-public-docs SYNTHETIC_MIGRATION.md)
  pumpfun: { name: "pump.fun", pool_name: "PumpSwap", vs0: V_SOL0, vt0: V_TOK0, real0: REAL_TOK0, migFee: MIGRATION_FEE, poolTok: SUPPLY - REAL_TOK0, curveFees: CURVE_FEES, poolFees: null, synth: true, uva: true },
  meteora: { name: "Meteora DBC", pool_name: "Meteora DAMM v2", vs0: 28.74, vt0: 1061.5e6, real0: 800e6, migFee: 3.13, poolTok: 199.6e6, curveFees: [0.002, 0.008, 0], poolFees: [0, 0.0005, 0.002] },
};
const SWAP_TIERS = [[420, .003, .0093, .0002], [1470, .0095, .0005, .002], [2460, .009, .0005, .002], [3440, .0085, .0005, .002],
  [4420, .008, .0005, .002], [9820, .0075, .0005, .002], [14740, .007, .0005, .002], [19650, .0065, .0005, .002],
  [24560, .006, .0005, .002], [29470, .0055, .0005, .002], [34380, .005, .0005, .002], [39300, .0045, .0005, .002],
  [44210, .004, .0005, .002], [49120, .0035, .0005, .002], [54030, .003, .0005, .002], [58940, .00275, .0005, .002],
  [63860, .0025, .0005, .002], [68770, .00225, .0005, .002], [73681, .002, .0005, .002], [78590, .00175, .0005, .002],
  [83500, .0015, .0005, .002], [88400, .00125, .0005, .002], [93330, .001, .0005, .002], [98240, .00075, .0005, .002],
  [Infinity, .0005, .0005, .002]];
const GAS = 0.000005 + 0.0001, KEEP = 0.003, MINT = "TOKEN";
// Fees as Solana charges them: 5,000 lamports per signature, a priority fee that varies per transaction and spikes while a launch
// is congested, and rent the first time a wallet gets an account (recoverable on close). Rent is 5,080 lamports per byte since the
// Sep 2026 cut (SIMD-0437, step 2): a pump.fun coin account is Token-2022, 170 bytes = 0.00151384 SOL, and a wallet's first pump.fun
// buy also opens its 137-byte user_volume_accumulator = 0.0013462 SOL (mainnet getMinimumBalanceForRentExemption, 15 Oct 2026).
const RENT_PER_BYTE = 5080e-9, ATA_RENT = (128 + 170) * RENT_PER_BYTE, UVA_RENT = (128 + 137) * RENT_PER_BYTE;
const BASE_FEE = 0.000005, FEE_MAX = 0.02;
// The tool's documented platform fee: 5% of SOL received from sells made through it (Sell, AutoSell, Nuke, Sniper Guard).
// Buybacks (Cleanup, layer moves) are exempt. Volume Bot sells are not named on the fee page, so they are left uncharged.
const PLATFORM_SELL_TOOLS = new Set(["manual_sell", "instant_trade", "autosell", "nuke", "sniper_guard"]);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sec = s => Math.round(Number(s) / SLOT_S + 1e-9);   // 0.7 s = 3.5 slots rounds up, not down by float error

function RNG(seed) {
  let s = (Math.abs(Math.floor(seed)) * 2654435761 + 1013904223) >>> 0;
  const r = {};
  r.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.uniform = (a, b) => a + (b - a) * r.random();
  r.randint = (a, b) => a + Math.floor(r.random() * (b - a + 1));
  r.choice = arr => arr[Math.floor(r.random() * arr.length)];
  r.gauss = (mu, sd) => { let u = 0; while (!u) u = r.random(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.random()); };
  r.lognorm = (mu, sd) => Math.exp(r.gauss(mu, sd));
  r.sample = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
  return r;
}

class Chain {
  constructor(seed) {
    this.rng = RNG(seed);
    this.lp = PAD_MODELS.pumpfun; this.vs = V_SOL0; this.vt = V_TOK0; this.real_sol = 0; this.real_tok = REAL_TOK0;
    this.complete = false; this.pool = null; this.migrated_slot = null; this.creator_fees = 0; this.synth = null;
    this.sol = Object.create(null); this.tok = Object.create(null); this.truth = Object.create(null);
    this.cex = new Set(); this.cex_name = Object.create(null);
    this.ledger = []; this.events = new Map(); this.hooks = [];
    this.slot = 0; this.idx = 0; this.running = false; this.mc_path = [];
    this.seed = seed; this.feeRng = RNG((seed >>> 0) ^ 0x9e3779b9);   // its own stream, so fee draws don't shift the rest of a seeded run
    this.prio = 0.0003; this.ata = new Set(); this.feeLog = { cats: {}, byWallet: Object.create(null), series: [], total: 0 };
  }
  isOp(a) { return (this.truth[a] || "").startsWith("op_") }
  // priority fee for one transaction: log-normal around the median, x3 in the first 30 s after deploy, capped
  prioFee(extra = 0) { const z = Math.sqrt(-2 * Math.log(this.feeRng.random() || 1e-9)) * Math.cos(2 * Math.PI * this.feeRng.random()), busy = this.slot >= 0 && this.slot < sec(30) ? 3 : 1;
    return Math.min(0.005, Math.max(0.000002, this.prio * busy * Math.exp(0.8 * z))) + extra }
  fee(w, cat, amt) {   // record a cost paid by one of the operator's wallets
    if (!(amt > 0) || !this.isOp(w)) return;
    const c = this.feeLog.cats[cat] || (this.feeLog.cats[cat] = { sum: 0, n: 0, min: Infinity, max: 0 });
    c.sum += amt; c.n++; c.min = Math.min(c.min, amt); c.max = Math.max(c.max, amt);
    this.feeLog.byWallet[w] = (this.feeLog.byWallet[w] || 0) + amt; this.feeLog.total += amt;
    const S = this.feeLog.series, t = Math.round(this.slot * SLOT_S); if (!S.length || S[S.length - 1][0] !== t) S.push([t, this.feeLog.total]); else S[S.length - 1][1] = this.feeLog.total;
  }
  // a wallet never pays more priority fee than it has
  // outside traders pay what they really pay on pump.fun (15 Oct 2026 sample): ordinary trades about half the tool's default
  // (median ~0.00017 SOL); snipers a little more than the tool, ~0.001 SOL in the congested first 30 s
  gas(w, extra = 0) { const role = this.truth[w], k = role === "sniper" ? 1.1 : role === "organic" || role === "copy" ? 0.55 : 1;
    const p = this.cex.has(w) ? 0 : Math.min(this.prioFee(extra) * k, Math.max(0, (this.sol[w] || 0) - BASE_FEE)), all = BASE_FEE + p; this.sol[w] -= all; this.fee(w, "network", BASE_FEE); this.fee(w, "priority", p); return all }
  // SOL these wallets would actually get by selling everything now, one after another into the curve (or PumpSwap pool),
  // after trade fees, network fees and the tool's 5% sell fee: real exit value, not tokens x spot price
  exitValue(ws) {
    let vs = this.vs, vt = this.vt, pool = this.pool ? this.pool.slice() : null, out = 0;
    const [cf, pf, lf] = this.fees();
    for (const w of ws) { const t = this.tok[w] || 0; if (t <= 1) continue; let g;
      if (pool) { const [X, Y] = pool; g = X * t / (Y + t); pool = [X - g * (1 - lf), Y + t] } else { g = vs - vs * vt / (vt + t); vs -= g; vt += t }
      out += g * (1 - cf - pf - lf) * 0.95 - BASE_FEE - this.prio }
    return Math.max(0, out);
  }
  rent(payer, owner) {
    if (this.ata.has(owner)) return; this.ata.add(owner); this.sol[payer] -= ATA_RENT; this.fee(payer, "rent", ATA_RENT);
    if (this.lp && this.lp.uva && !(this.uva || (this.uva = new Set())).has(owner)) { this.uva.add(owner); this.sol[payer] -= UVA_RENT; this.fee(payer, "rent", UVA_RENT) }   // pump.fun's per-wallet volume account
  }
  wallet(role, sol = 0) {
    let a;
    do { a = ""; for (let i = 0; i < 8; i++) a += B58[Math.floor(this.rng.random() * 58)]; } while (a in this.truth);
    this.truth[a] = role; this.sol[a] = sol; this.tok[a] = 0;
    return a;
  }
  exchange(name) { const a = this.wallet("cex", 1e12); this.cex.add(a); this.cex_name[a] = name; return a; }
  at(slot, fn, first = false) {
    slot = Math.trunc(slot);
    if (this.running && slot <= this.slot) slot = this.slot + 1;
    let l = this.events.get(slot); if (!l) this.events.set(slot, l = []); first ? l.unshift(fn) : l.push(fn);
  }
  log(o) { o.slot = this.slot; o.idx = this.idx++; this.ledger.push(o); return o; }
  start() {   // pre-launch history (negative slots), then the clock stands at slot 0
    for (const s of [...this.events.keys()].filter(k => k < 0).sort((a, b) => a - b)) {
      this.slot = s; this.idx = 0; const l = this.events.get(s); this.events.delete(s); for (const fn of l) fn();
    }
    this.running = true; this.next = 0;
  }
  step(perSlot = []) {
    const s = this.next++;
    this.slot = s; this.idx = 0;
    if (this.complete && !this.pool) this._migrate();
    const l = this.events.get(s); if (l) { this.events.delete(s); for (const fn of l) fn(); }
    for (const f of perSlot) f(s);
  }
  run(end, perSlot = []) { this.start(); while (this.next < end) this.step(perSlot); }
  mc() { return this.pool ? this.pool[0] / this.pool[1] * SUPPLY : this.vs / this.vt * SUPPLY; }
  setPad(k) { const p = PAD_MODELS[k] || PAD_MODELS.pumpfun; this.lp = p; this.vs = p.vs0; this.vt = p.vt0; this.real_tok = p.real0; return this }
  fees() { if (!this.pool) return this.lp.curveFees; if (this.lp.poolFees) return this.lp.poolFees; const m = this.mc(); return SWAP_TIERS.find(t => m < t[0]).slice(1); }
  _migrate() { const [xs, xt] = this.synth || [0, 0]; this.pool = [Math.max(0.01, this.real_sol - this.lp.migFee) + xs, this.lp.poolTok - xt]; this.migrated_slot = this.slot; this.log({ kind: "migrate", sol: this.pool[0], tok: this.pool[1] }); }
  tradable() { return this.created && !(this.complete && !this.pool); }
  // a bot's sell that lands between curve completion and migration fails; like a real bot it tries again next block
  sellSoon(w, part, tool) { if (!this.created) return; if (!this.tradable()) { this.at(this.slot + 1, () => this.sellSoon(w, part, tool)); return; } this.sell(w, (this.tok[w] || 0) * part, tool); }
  sol_for(tokens) {
    const fee = this.fees().reduce((a, b) => a + b, 0);
    if (this.pool) { const [X, Y] = this.pool; tokens = Math.min(tokens, Y * 0.95); return X * tokens / (Y - tokens) / (1 - fee); }
    tokens = Math.min(tokens, this.real_tok);
    return (this.vs * this.vt / (this.vt - tokens) - this.vs) / (1 - fee);
  }
  send(frm, to, amt, tool = "transfer") {
    amt = Math.min(amt, this.sol[frm] - (this.cex.has(frm) ? 0 : 0.006));
    if (!(amt > 0)) return 0;
    if (!this.cex.has(frm)) this.gas(frm);
    this.sol[frm] -= amt; this.sol[to] = (this.sol[to] || 0) + amt;
    if (tool === "jito_tip") this.fee(frm, "tips", amt);
    this.log({ kind: "sol", frm, to, sol: amt, tool });
    return amt;
  }
  canPay(w, extra = 0) { return this.cex.has(w) || (this.sol[w] || 0) >= BASE_FEE + 0.0002 + extra; }
  // tokens that sell for `sol` SOL right now (after fees): for SOL-sized sells
  tokForSol(sol) {
    const fee = this.fees().reduce((a, b) => a + b, 0), g = Math.max(0, sol) / (1 - fee);
    if (this.pool) { const [X, Y] = this.pool; return g >= X * 0.95 ? Y : g * Y / (X - g); }
    if (g >= this.vs * 0.95) return this.vt;
    return this.vs * this.vt / (this.vs - g) - this.vt;
  }
  send_tok(frm, to, tokens, tool = "transfer", kind = "tokx", payer = frm) {
    tokens = Math.min(tokens, this.tok[frm]);
    if (!(tokens > 0)) return 0;
    if (!this.canPay(payer, this.ata.has(to) ? 0 : ATA_RENT)) return 0;   // the signer must afford the fee and any new token account
    this.tok[frm] -= tokens; this.tok[to] = (this.tok[to] || 0) + tokens; this.gas(payer); this.rent(payer, to);
    this.log({ kind, frm, to, tok: tokens, tool });
    return tokens;
  }
  pad(w, amt, tool = "generate_activity") {
    for (const side of ["buy", "sell"]) this.log({ kind: "swap", mint: "OTHER", signer: w, side, sol: amt, tok: 0, tool });
    const b0 = this.sol[w]; this.gas(w); this.gas(w); this.sol[w] -= amt * 0.025; this.fee(w, "trade", amt * 0.025);
    if (tool === "generate_activity" && this.isOp(w)) { const g = this.ga || (this.ga = { loops: 0, wallets: new Set(), volume: 0, cost: 0 }); g.loops++; g.wallets.add(w); g.volume += 2 * amt; g.cost += b0 - this.sol[w] }
  }
  buy(w, sol_in, tool) {
    if (!this.tradable()) return 0;
    sol_in = Math.min(sol_in, this.sol[w] - KEEP - FEE_MAX / 4 - (this.ata.has(w) ? 0 : ATA_RENT));   // leave room for this tx's own fees and rent
    if (!(sol_in > 0.0005)) return 0;
    const [cf, pf, lf] = this.fees();
    let net = sol_in * (1 - cf - pf - lf), out;
    if (this.pool) {
      const [X, Y] = this.pool; out = Y * net / (X + net); this.pool = [X + sol_in * (1 - cf - pf), Y - out];
    } else {
      out = this.vt - this.vs * this.vt / (this.vs + net);
      if (out >= this.real_tok) {
        const want = sol_in;
        out = this.real_tok; net = this.vs * this.vt / (this.vt - out) - this.vs; sol_in = net / (1 - cf - pf - lf); this.complete = true;
        this.vs += net; this.vt -= out; this.real_sol += net; this.real_tok -= out;
        if (this.lp.synth && want - sol_in > 0.0005) {   // the rest buys from the would-be pool (seeded at migration with these extra reserves)
          const rest = want - sol_in, n2 = rest * (1 - cf - pf - lf), X = Math.max(0.01, this.real_sol - this.lp.migFee), Y = this.lp.poolTok, o2 = Y * n2 / (X + n2);
          this.synth = [n2, o2]; out += o2; sol_in = want;
        }
      } else { this.vs += net; this.vt -= out; this.real_sol += net; this.real_tok -= out; }
    }
    this.creator_fees += sol_in * cf;
    this.sol[w] -= sol_in; this.gas(w); this.rent(w, w); this.tok[w] += out;
    this.fee(w, "trade", sol_in * (cf + pf + lf));
    const tx = this.log({ kind: "swap", mint: MINT, signer: w, side: "buy", sol: sol_in, tok: out, mc: this.mc(), tool });
    this.mc_path.push([this.slot, this.mc()]);
    for (const h of this.hooks.slice()) h(tx);
    return out;
  }
  sell(w, tokens, tool) {
    if (!this.tradable()) return 0;
    tokens = Math.min(tokens, this.tok[w]);
    if (!(tokens > 1) || !this.canPay(w)) return 0;   // no SOL for the fee, no sell
    const [cf, pf, lf] = this.fees();
    let gross;
    if (this.pool) { const [X, Y] = this.pool; gross = X * tokens / (Y + tokens); this.pool = [X - gross * (1 - lf), Y + tokens]; }
    else { gross = this.vs - this.vs * this.vt / (this.vt + tokens); this.vs -= gross; this.vt += tokens; this.real_sol -= gross; this.real_tok += tokens; }
    const out = gross * (1 - cf - pf - lf);
    this.creator_fees += gross * cf;
    this.tok[w] -= tokens; this.sol[w] += out; this.gas(w);
    this.fee(w, "trade", gross * (cf + pf + lf));
    if (PLATFORM_SELL_TOOLS.has(tool) && this.isOp(w)) { this.sol[w] -= out * 0.05; this.fee(w, "platform", out * 0.05); }   // the tool keeps 5% of SOL from its sells
    const tx = this.log({ kind: "swap", mint: MINT, signer: w, side: "sell", sol: out, tok: tokens, mc: this.mc(), tool });
    this.mc_path.push([this.slot, this.mc()]);
    for (const h of this.hooks.slice()) h(tx);
    return out;
  }
}

// ================================================================== config
const CEXES = ["Binance", "KuCoin", "Bitget", "Gate", "Husher", "Bybit"];   // the tool's six CEX funding sources (all on by default)
const SCHEMA = [
  ["Run", [
    ["name", "Configuration name", "text", "Untitled", {}],
    ["seed", "Random seed", "int", 1, { help: "Same seed + same settings = identical run." }],
    ["duration_min", "Simulated minutes", "int", 30, { range: [2, 180] }]]],
  ["Wallet preparation", [
    ["wallets", "Number of wallets (holders)", "int", 20, { range: [0, 200], help: "Holder wallets. Block-0 adds its MEV/temp layers on top. Holders + Empty Holders stay within 200 (the tool's limit)." }],
    ["empty_holders", "Empty Holders", "int", 0, { range: [0, 200], help: "Extra wallets that are funded but do not buy at launch (Advanced Settings in the tool)." }],
    ["funding_source", "Funding source", "select", "funder", { options: [["funder", "Single Funder (direct)"], ["classic", "Funder via proxy hops (Classic)"], ["cex", "CEX Funding (routed through exchanges by Husher)"]] }],
    ["cex_sources", "CEX sources", "multi", CEXES.slice(), { options: CEXES, show: "funding_source=cex" }],
    ["funding_delay_min", "Funding Delay (min between wallets)", "float", 30, { range: [0, 600], help: "The tool recommends a 30-minute funding delay; its Recommended Wallets are funded 24 h+ before launch, 25 min+ apart." }],
    ["funding_extra_mode", "Extra SOL per wallet", "select", "tool", { options: [["tool", "As the tool budgets it (+10% slippage, 0.4 per MEV, 0.2 per temp, 0.13 per holder)"], ["fixed", "Fixed extra per wallet"], ["range", "Random extra per wallet"]] }],
    ["funding_extra", "Extra SOL (fixed)", "float", 0.3, { show: "funding_extra_mode=fixed" }],
    ["funding_extra_min", "Extra SOL min", "float", 0.1, { show: "funding_extra_mode=range" }],
    ["funding_extra_max", "Extra SOL max", "float", 0.6, { show: "funding_extra_mode=range" }],
    ["wallet_source", "Wallet source", "select", "fresh", { options: [["fresh", "Fresh wallets made for this launch"], ["marketplace", "Marketplace (bought pre-aged wallets)"]], help: "Marketplace wallets arrive already funded hours earlier from mixed sources, with one prior transaction each." }],
    ["mkt_age_min_h", "Marketplace: youngest wallet age (h)", "float", 24, { show: "wallet_source=marketplace", range: [0.5, 72] }],
    ["mkt_age_max_h", "Marketplace: oldest wallet age (h)", "float", 20, { show: "wallet_source=marketplace", range: [1, 240] }],
    ["mkt_cex_pct", "Marketplace: % first funded straight from an exchange", "float", 35, { show: "wallet_source=marketplace", range: [0, 100], help: "The rest come through a private proxy wallet (the tool's \"Classic Funding\"; its exact route is an assumption)." }],
    ["ga_enabled", "Generate Activity (pre-age wallets)", "bool", false, {}],
    ["ga_amount_min", "GA amount per tx min (SOL)", "float", 0.01, { show: "ga_enabled" }],
    ["ga_amount_max", "GA amount per tx max (SOL)", "float", 0.05, { show: "ga_enabled" }],
    ["ga_loops", "GA loop count", "int", 10, { show: "ga_enabled", range: [1, 15], help: "The tool allows 1-15 loops per session." }],
    ["ga_delay_s", "GA delay between loops (s)", "float", 60, { show: "ga_enabled" }]]],
  ["Launch", [
    ["launchpad", "Launchpad", "select", "pumpfun", { options: [["pumpfun", "PumpFun (bonding curve → PumpSwap)"], ["meteora", "Meteora DBC → DAMM v2 (curve fitted to SHARDS)"]] }],
    ["mode", "Launch mode", "select", "block0", { options: [["block0", "Block-0"], ["quick", "Quick (not offered on PumpFun)"], ["organic", "Organic"], ["manual", "Manual"]], help: "On PumpFun the tool offers Block-0, Organic and Manual. Quick exists on other launchpads." }],
    ["dev_buy_pct", "Dev Buy (% supply)", "float", 1.5, { range: [0, 20] }],
    ["buy_overrides", "Per-wallet Token Buy % (Funding page edits)", "json", {}, { show: "never" }],
    ["funder_deposit", "Funder deposit (sandbox SOL)", "float", 1000, { range: [0, 100000], help: "What the Funder starts with. Anything the plan doesn't spend stays there; fees come out of it." }],
    ["prio_median", "Priority fee, median per transaction (SOL)", "float", 0.0003, { range: [0, 0.005], help: "Solana priority fee per transaction. Varies around this (x3 for the first 30 s after deploy). Base fee 0.000005 SOL and token-account rent 0.00204 SOL are added on top." }],
    ["fee_target", "Fee Target (SOL)", "float", 0, { range: [0, 5], help: "Extra priority fee. In Block-0 it is added to the deploy bundle's Jito tip." }],
    ["holder_deviation_pct", "Holders buy deviation from average (%)", "float", 40, { range: [0, 99], help: "How randomly the holders' total buy is split across wallets: 40% gives each wallet 0.6x-1.4x the average (the tool's Holders Buy Distribution)." }],
    ["holder_supply_pct", "Holders target % supply (Quick/Organic/Manual)", "float", 40, { range: [0, 75], show: "mode!=block0" }],
    ["buy_delay_s", "Buy Delay (s between holder buys)", "float", 0.7, { help: "Organic mode (tool default 0.7 s) and Block-0 Custom. Block-0 presets set it: Quick 0.7 s, Clean/Full 16 s. Quick mode = 0." }],
    ["holder_buy_sol", "Organic: Holders Buy (SOL, total)", "float", 0, { show: "mode=organic", help: "In Organic mode the tool takes the holder buy in SOL. 0 = use the % above instead." }],
    ["scheduled", "Scheduled Mode (hold holder buys until Snipe)", "bool", false, { show: "mode!=manual", help: "Not offered with Manual. Dev Buy still runs at launch." }],
    ["snipe_manual", "Snipe with a button (Workspace) instead of at a set time", "bool", false, { show: "scheduled" }],
    ["snipe_at_s", "Snipe at (s after deploy)", "float", 60, { show: "scheduled" }],
    ["manual_buy_at_s", "Manual: holders buy at (s)", "float", 20, { show: "mode=manual" }],
    ["manual_style", "Manual: multi-wallet style", "select", "stagger", { options: ["stagger", "parallel"], show: "mode=manual" }],
    ["exit_enabled", "Manual sells (operator exit)", "bool", false, { help: "Holder wallets sell out over a window, via Sell in the Live Workspace." }],
    ["exit_start_s", "Exit starts at (s)", "float", 300, { show: "exit_enabled" }],
    ["exit_window_s", "Exit window (s)", "float", 900, { show: "exit_enabled" }],
    ["exit_pct", "Exit sells % of holdings", "float", 100, { show: "exit_enabled" }],
    ["exit_wallets", "Exit wallets", "select", "holders", { options: ["holders", "all"], show: "exit_enabled" }],
    ["exit_withdraw", "Withdraw SOL to Funder after exit", "bool", true, { show: "exit_enabled" }],
    ["exit_withdraw_route", "Withdraw route", "select", "hop", { options: [["hop", "Via a hop wallet (as the tool does)"], ["direct", "Direct to Funder"]], show: "exit_withdraw" }]]],
  ["Block-0 layers", [
    ["preset", "Preset", "select", "quick", { options: [["quick", "Quick Build"], ["clean", "Clean Build"], ["full", "Full Build"], ["custom", "Custom"]], show: "mode=block0" }],
    ["target_supply_pct", "Target % of supply (Front MEV)", "float", 55, { range: [1, 75], show: "mode=block0" }],
    ["back_tuning", "Back MEV Tuning (multiplier)", "float", 1.0, { range: [0.4, 1.6], show: "mode=block0", help: "The tool's slider: 0.4x (Less Sniper) to 1.6x (Less Top Trader), default 1.0. Scales the preset's Front and Back MEV counts." }],
    ["front_count", "Front MEV count", "int", 4, { range: [1, 12], show: "preset=custom" }],
    ["back_count", "Back MEV count", "int", 5, { range: [0, 100], show: "preset=custom" }],
    ["temp_count", "Temp Holders count", "int", 0, { range: [0, 200], show: "preset=custom" }],
    ["front_back_delay_s", "Front->Back delay (s, per Back wallet)", "float", 0.7, { show: "preset=custom" }],
    ["back_temp_delay_s", "Back->Temp delay (s, per temp wallet)", "float", 0.7, { show: "preset=custom" }],
    ["alloc_method", "Holder allocation method", "select", "buyback", { options: [["buyback", "Buyback (sell -> relay -> buy)"], ["streamflow", "Streamflow Airdrop (transfer + claim)"]], show: "mode=block0", help: "Streamflow Airdrop is only offered on routes without Back MEV; picking it sets Back MEV to 0." }]]],
  ["Sniper Guard", [
    ["sg_enabled", "Enable Sniper Guard", "bool", false, {}],
    ["sg_threshold", "Threshold: outside buys (SOL)", "float", 5, { show: "sg_enabled" }],
    ["sg_response", "Response", "select", "nuke_all", { options: [["nuke_all", "Nuke - All"], ["nuke_holders", "Nuke - Holders Only"], ["nuke_dev", "Nuke - Dev Only"], ["complete_early", "Complete Early"]], show: "sg_enabled" }],
    ["sg_complete_early", "Dev Only: also Complete Early", "bool", true, { show: "sg_response=nuke_dev" }],
    ["sg_end", "End condition", "select", "until_complete", { options: [["until_complete", "Until Complete"], ["timed", "Timed"]], show: "sg_enabled" }],
    ["sg_timed_s", "Timed duration (s)", "float", 30, { show: "sg_end=timed" }],
    ["sg_whitelist", "Whitelist (addresses whose buys are ignored)", "json", [], { show: "never" }]]],
  ["Volume Bot", [
    ["vb_enabled", "Enable Volume Bot", "bool", false, {}],
    ["vb_start_s", "Start at (s)", "float", 0, { show: "vb_enabled", help: "0 = starts when the coin launches (a Volume Bot planned on the Funding page always starts at launch)." }],
    ["vb_target", "Target volume (SOL, both sides)", "float", 32, { show: "vb_enabled" }],
    ["vb_mode", "Timing mode", "select", "duration", { options: [["duration", "Duration mode"], ["delay", "Delay mode"]], show: "vb_enabled" }],
    ["vb_duration_s", "Duration (s)", "float", 240, { show: "vb_mode=duration" }],
    ["vb_delay_min", "Delay min (s)", "float", 15, { show: "vb_mode=delay" }],
    ["vb_delay_max", "Delay max (s)", "float", 35, { show: "vb_mode=delay" }],
    ["vb_exec", "Execution", "select", "organic", { options: [["organic", "Organic (separate txs)"], ["bundle", "Bundle (same-block buy+sell)"]], show: "vb_enabled" }],
    ["vb_wave", "Wave Intensity (0 Tight -> 1 Big waves)", "float", 0, { range: [0, 1], show: "vb_exec=organic" }],
    ["vb_size_mode", "Trade sizes", "select", "auto", { options: [["auto", "Auto (Duration mode)"], ["fixed", "Fixed"], ["random", "Random"]], show: "vb_enabled" }],
    ["vb_size", "Fixed size (SOL)", "float", 1.0, { show: "vb_size_mode=fixed" }],
    ["vb_size_min", "Random size min (SOL)", "float", 0.3, { show: "vb_size_mode=random" }],
    ["vb_size_max", "Random size max (SOL)", "float", 3.0, { show: "vb_size_mode=random" }],
    ["vb_wallets", "Wallets used", "select", "front", { options: [["front", "Front MEV wallets"], ["back", "Back MEV wallets"], ["holders", "Holder wallets"], ["dedicated", "Dedicated new wallets"]], show: "vb_enabled" }],
    ["vb_dedicated_n", "Dedicated wallets", "int", 6, { show: "vb_wallets=dedicated" }],
    ["vb_fee_target", "Fee Target (tip budget, SOL)", "float", 0.05, { show: "vb_enabled" }]]],
];
function autoFields(p, side) {
  const unit = side === "buy" ? "SOL" : "M tokens", react = side === "buy" ? "outside sells" : "outside buys";
  return [
    [`${p}_enabled`, `Enable Auto${side[0].toUpperCase() + side.slice(1)}`, "bool", false, {}],
    [`${p}_wallets`, "Wallets used", "select", "holders", { options: ["holders", "front", "back", "all"], show: `${p}_enabled` }],
    [`${p}_start_delay_s`, "Start Delay (s)", "float", 0, { show: `${p}_enabled` }],
    [`${p}_counter`, `Counter Trading (react to ${react})`, "bool", true, { show: `${p}_enabled` }],
    [`${p}_rate`, "Trigger: Rate (% chance to answer each trade)", "float", 100, { range: [0, 100], show: `${p}_counter` }],
    [`${p}_min_trigger`, "Trigger: Min. SOL (smallest trade answered)", "float", 0, { show: `${p}_counter` }],
    [`${p}_min_trigger_tok`, "Trigger: Min. Token (smallest trade answered, tokens)", "float", 0, { show: `${p}_counter` }],
    [`${p}_replication`, "Replication Factor (% of the observed trade's SOL)", "float", 50, { show: `${p}_counter` }],
    [`${p}_min_per_trade`, side === "buy" ? "Min SOL per Buy (accumulate first)" : "Min. % Supply per Sell (accumulate first, M tokens: 1 = 0.1%)", "float", side === "buy" ? 0.1 : 1, { show: `${p}_counter` }],
    [`${p}_dca`, "DCA", "bool", false, { show: `${p}_enabled` }],
    [`${p}_dca_interval_s`, "DCA interval (s)", "float", 30, { range: [1, 86400], show: `${p}_dca` }],
    [`${p}_dca_mode`, "DCA amount", "select", "fixed", { options: ["fixed", "random"], show: `${p}_dca` }],
    [`${p}_dca_amount`, `DCA fixed amount (${unit})`, "float", side === "buy" ? 0.2 : 2, { show: `${p}_dca_mode=fixed` }],
    [`${p}_dca_min`, `DCA min (${unit})`, "float", side === "buy" ? 0.1 : 1, { show: `${p}_dca_mode=random` }],
    [`${p}_dca_max`, `DCA max (${unit})`, "float", side === "buy" ? 0.4 : 4, { show: `${p}_dca_mode=random` }],
    [`${p}_limits`, `Limit Orders (MC SOL:amount ${unit}, comma-sep)`, "text", "", { show: `${p}_enabled`, help: "AutoBuy targets must decrease; AutoSell targets must increase. e.g. 300:2, 200:3" }],
    [`${p}_mc_min`, "Market Cap Range min (SOL, 0 = none)", "float", 0, { show: `${p}_enabled` }],
    [`${p}_mc_max`, "Market Cap Range max (SOL, 0 = none)", "float", 0, { show: `${p}_enabled` }],
    [`${p}_end_amount`, `End after amount (${unit}, 0 = none)`, "float", 0, { show: `${p}_enabled` }],
    [`${p}_end_duration_s`, "End after duration (s, 0 = none)", "float", 0, { show: `${p}_enabled` }],
    [`${p}_whitelist`, "Whitelist (Counter Trading ignores these addresses)", "json", [], { show: "never" }],
    [`${p}_extra`, "More strategies on this side (set in the Auto pop-up)", "json", [], { show: "never" }]];
}
SCHEMA.push(["AutoBuy", autoFields("ab", "buy")], ["AutoSell", autoFields("as", "sell")],
  ["Cleanup", [
    ["cl_enabled", "Enable live Cleanup", "bool", false, { help: "Block-0 layer moves already run their own Cleanup; this is an extra run from the Live Workspace." }],
    ["cl_start_s", "Start at (s)", "float", 0, { show: "cl_enabled" }],
    ["cl_inputs", "Sellers (input wallets)", "select", "holders", { options: ["holders", "front", "back", "temp"], show: "cl_enabled" }],
    ["cl_outputs", "Buyers (new output wallets)", "int", 10, { range: [1, 200], show: "cl_enabled" }],
    ["cl_share_pct", "% of sellers' holdings moved", "float", 100, { range: [1, 100], show: "cl_enabled" }],
    ["cl_delay_mode", "Delay Between Rounds", "select", "random", { options: ["fixed", "random"], show: "cl_enabled" }],
    ["cl_delay", "Fixed delay (s)", "float", 15, { range: [0.5, 300], show: "cl_delay_mode=fixed" }],
    ["cl_delay_min", "Random delay min (s)", "float", 0.5, { range: [0.5, 300], show: "cl_delay_mode=random" }],
    ["cl_delay_max", "Random delay max (s)", "float", 5.5, { range: [0.5, 300], show: "cl_delay_mode=random" }],
    ["cl_double_pct", "Double Buy %", "float", 0, { range: [0, 100], show: "cl_enabled" }],
    ["cl_method", "Method", "select", "buyback", { options: [["buyback", "Buyback"], ["streamflow", "Streamflow Airdrop"]], show: "cl_enabled" }]]],
  ["Outside traders: snipers", [
    ["sn_level", "Sniper activity", "select", "typical", { options: [["none", "None"], ["typical", "Typical launch"], ["busy", "Busy"], ["hot", "Hot (SHARDS-like)"], ["custom", "Custom (fields below)"]], help: "Levels fill the fields below; Custom keeps your own values." }],
    ["sn_count", "Sniper bot wallets", "int", 4, { range: [0, 300], show: "sn_level=custom" }],
    ["sn_vary", "Vary the count each run (most launches get a few, some none, a few many)", "bool", false, { show: "sn_level=custom" }],
    ["sn_cluster", "Wallets per cluster (same slot, shared funder)", "int", 3, { range: [1, 10], show: "sn_level=custom" }],
    ["sn_window_s", "Entry window (s after deploy)", "float", 4, { show: "sn_level=custom" }],
    ["sn_size", "Median buy (SOL)", "float", 0.4, { show: "sn_level=custom" }],
    ["sn_hold_min", "Hold min (s)", "float", 8, { show: "sn_level=custom" }],
    ["sn_hold_max", "Hold max (s)", "float", 300, { show: "sn_level=custom", help: "Holds are spread evenly on a log scale between min and max, so most sell early and a few hold much longer." }],
    ["sn_big_pct", "Large same-slot outsider (% supply, 0 = none)", "float", 0, { range: [0, 20], show: "sn_level=custom" }]]],
  ["Outside traders: organic", [
    ["org_enabled", "Organic traders", "bool", false, { help: "Off by default: most launches never get organic flow until they reach a much higher market cap." }],
    ["org_start_mc_sol", "Organic interest starts at market cap (SOL, 0 = from launch)", "float", 0, { show: "org_enabled", help: "No organic buys until the market cap first reaches this. Convert from USD at today's SOL price." }],
    ["org_n", "Organic wallets available", "int", 600, { range: [0, 3000], show: "org_enabled" }],
    ["org_peak_rate", "Peak arrivals per second", "float", 2.5, { show: "org_enabled" }],
    ["org_peak_s", "Attention peaks at (s)", "float", 250, { show: "org_enabled" }],
    ["org_fomo", "Momentum chasing (FOMO)", "float", 1.5, { range: [0, 5], show: "org_enabled" }],
    ["org_size", "Median buy (SOL)", "float", 0.35, { show: "org_enabled" }],
    ["org_rebuy_pct", "Re-buy share of arrivals (%)", "float", 30, { range: [0, 100], show: "org_enabled" }],
    ["org_panic", "Panic sell below x entry MC", "float", 0.6, { range: [0.05, 1], show: "org_enabled" }],
    ["org_tp", "Take profit above x entry MC", "float", 2.5, { show: "org_enabled" }],
    ["org_flip_pct", "Fast flippers (%)", "float", 25, { range: [0, 100], show: "org_enabled" }],
    ["org_hold_s", "Typical hold otherwise (s)", "float", 600, { show: "org_enabled" }],
    ["org_level", "Organic level", "select", "custom", { options: [["dead", "Dead"], ["verylow", "Very low"], ["mid", "Mid"], ["bullish", "Bullish"], ["custom", "Custom (fields above)"]], show: "org_enabled", help: "Presets fill the fields above; Custom keeps your own values." }],
    ["org_hawkes", "Herding: follow-on buys per buy", "float", 0, { range: [0, 0.9], show: "org_enabled", help: "Buys draw more buys for ~8 s (self-exciting), so organic flow comes in clusters." }],
    ["org_noise", "Attention noise (random lulls and surges)", "float", 0, { range: [0, 2], show: "org_enabled" }],
    ["org_shock_rate", "Attention shocks per minute (calls, tweets)", "float", 0, { range: [0, 5], show: "org_enabled" }],
    ["org_whale_pct", "Whale buys (% of arrivals, 3-30 SOL)", "float", 0, { range: [0, 20], show: "org_enabled" }],
    ["org_tail", "Long tail (share of peak attention that never fades)", "float", 0, { range: [0, 1], show: "org_enabled" }],
    ["org_grad_fade", "Attention after the curve completes (x)", "float", 1, { range: [0, 1], show: "org_enabled", help: "1 = unchanged. Below 1, organic flow drops this much once the coin moves to its pool and keeps fading over ~10 min." }]]],
  ["Outside traders: copy-traders", [
    ["ct_count", "Copy-trade bots", "int", 6, { range: [0, 200] }],
    ["ct_trigger_sol", "Copy buys of at least (SOL)", "float", 2.0, {}],
    ["ct_window_s", "Only during first (s)", "float", 600, {}],
    ["ct_delay_s", "Copy delay (s)", "float", 1.2, {}],
    ["ct_mode", "Copy size", "select", "fixed", { options: [["fixed", "Fixed amount per copy"], ["ratio", "% of the leader's buy"]] }],
    ["ct_fixed_sol", "Fixed amount (SOL)", "float", 0.25, { show: "ct_mode=fixed" }],
    ["ct_ratio_pct", "Copy size (% of leader's buy)", "float", 30, { show: "ct_mode=ratio" }],
    ["ct_follow_pct", "Each bot copies a given buy with prob (%)", "float", 15, { range: [0, 100] }],
    ["ct_copy_sells", "Also copy the leader's sells", "bool", true, {}]]]);

const FIELDS = {};
for (const [, fs] of SCHEMA) for (const [k, label, typ, def, ex] of fs) FIELDS[k] = { label, typ, def, ex };
// Block-0 presets as Proxima's Launch Settings computes them (Solana / PumpFun, read off the app 2026-10-15 by switching each preset
// to Custom). Front/Back counts depend only on holder count, preset and the Back MEV Tuning multiplier (holder % and dev % don't
// change them): count = ceil(base(holders) x multiplier). Bases were measured at 10/20/30/50/70/100/200 holders with the multiplier
// at 1.0 and are interpolated in between; below 10 holders is an extrapolation. ceil(base x m) was checked at m = 0.4 and 1.6.
// Delays are per wallet: each Back buyback is Front->Back after the last, each temp transfer Back->Temp, each holder buy Buy Delay,
// which reproduces the tool's "Cleanup Time" (backs*FB + temps*BT + (holders-1)*Buy).
const PRESET_H = [10, 20, 30, 50, 70, 100, 200];
const PRESETS = {
  quick: { front: [1, 1, 2, 3, 4, 4, 4], back: [2, 3, 6, 11, 13, 14, 14], front_back_delay_s: 0.7, back_temp_delay_s: 0.7, buy_delay_s: 0.7, temp: false },
  clean: { front: [1, 1, 2, 4, 5, 5, 5], back: [2, 4, 8, 15, 17, 18, 18], front_back_delay_s: 0.7, back_temp_delay_s: 0.7, buy_delay_s: 16, temp: false },
  full: { front: [1, 1, 2, 3, 4, 4, 4], back: [2, 3, 6, 11, 13, 14, 14], front_back_delay_s: 0.7, back_temp_delay_s: 0.7, buy_delay_s: 16, temp: true },
};
function presetBase(tab, h) {
  if (h <= PRESET_H[0]) return tab[0] * h / PRESET_H[0];
  for (let i = 1; i < PRESET_H.length; i++) if (h <= PRESET_H[i]) { const a = PRESET_H[i - 1], b = PRESET_H[i]; return tab[i - 1] + (tab[i] - tab[i - 1]) * (h - a) / (b - a); }
  return tab[tab.length - 1];
}
function defaults() { const o = {}; for (const k in FIELDS) o[k] = Array.isArray(FIELDS[k].def) ? FIELDS[k].def.slice() : FIELDS[k].def; return o; }
const DEFAULTS_OF = new Proxy({}, { get: (_, k) => { for (const [, fs] of SCHEMA) for (const f of fs) if (f[0] === k) return f[3]; } });
function normalise(cfg) {
  const out = defaults();
  for (const [k, v0] of Object.entries(cfg || {})) {
    if (!(k in FIELDS)) continue;
    const { typ, ex } = FIELDS[k]; let v = v0;
    if (typ === "int") { v = Math.trunc(Number(v)); if (!isFinite(v)) continue; }
    else if (typ === "float") { v = Number(v); if (!isFinite(v)) continue; }
    else if (typ === "bool") v = v === true || v === "true" || v === "on" || v === 1 || v === "1";
    else if (typ === "multi") v = (Array.isArray(v) ? v : String(v).split(",")).filter(Boolean);
    else if (typ === "json") v = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : (Array.isArray(DEFAULTS_OF[k]) ? [] : {});
    else v = String(v);
    if (ex.range && (typ === "int" || typ === "float")) v = Math.max(ex.range[0], Math.min(ex.range[1], v));
    out[k] = v;
  }
  if (cfg && cfg.sn_level === undefined && Object.keys(cfg).some(k => /^sn_/.test(k))) out.sn_level = "custom";   // older configs keep their own sniper numbers
  if (SN_PRESETS[out.sn_level]) Object.assign(out, preset(SN_PRESETS, out.sn_level));
  if (out.mode === "manual") out.scheduled = false;                       // Scheduled Mode is not offered with Manual
  out.empty_holders = Math.max(0, Math.min(out.empty_holders, 200 - out.wallets));   // holders + empty holders <= 200
  if (out.mode === "block0" && out.preset !== "custom") {
    const p = PRESETS[out.preset], h = Math.max(1, out.wallets), m = out.back_tuning;
    out.front_count = Math.max(1, Math.min(12, Math.ceil(presetBase(p.front, h) * m - 1e-9)));
    out.back_count = Math.max(0, Math.min(100, Math.ceil(presetBase(p.back, h) * m - 1e-9)));
    out.temp_count = p.temp ? Math.min(200, Math.ceil(h * 2 / 3)) : 0;
    out.front_back_delay_s = p.front_back_delay_s; out.back_temp_delay_s = p.back_temp_delay_s; out.buy_delay_s = p.buy_delay_s;
  }
  if (out.mode === "block0" && out.alloc_method === "streamflow") { out.back_tuning = 0; out.back_count = 0; }   // Streamflow only without Back MEV
  out.cex_sources = (out.cex_sources || []).filter(x => CEXES.includes(x)); if (!out.cex_sources.length) out.cex_sources = ["Binance"];
  out.ga_loops = Math.max(1, Math.min(15, Math.trunc(out.ga_loops || 1)));
  return out;
}
function shardsPreset() {
  return normalise(Object.assign(defaults(), {
    name: "SHARDS reconstruction", wallets: 20, mode: "block0", preset: "custom", target_supply_pct: 55, dev_buy_pct: 1.5,
    // seen on-chain: 4 Front MEV, no Back layer
    front_count: 4, back_count: 0, temp_count: 0, front_back_delay_s: 1, back_temp_delay_s: 0, buy_delay_s: 2.5,
    launchpad: "meteora",   // SHARDS launched on Meteora DBC and moved to a DAMM v2 pool ~5 s in
    funding_source: "cex", cex_sources: ["Binance"], funding_extra_mode: "fixed", ga_enabled: true, ga_loops: 15, vb_enabled: true,
    sn_level: "hot", ct_mode: "ratio",   // SHARDS: about 40 outside wallets bought within 16 slots, one of them 9.8% in the creation block
    vb_start_s: 168, vb_target: 32, vb_mode: "delay", vb_wallets: "front", as_enabled: true, as_start_delay_s: 60,
    as_end_duration_s: 240, exit_enabled: true, exit_start_s: 300, exit_window_s: 900 }));
}
// Everything off: no dev or holder buys, no automations, no outside traders. The token deploys and nothing
// trades until you act in the Workspace.
function blankPreset() {
  return normalise(Object.assign(defaults(), {
    name: "Blank (everything off)", mode: "manual", dev_buy_pct: 0, holder_supply_pct: 0, scheduled: false, funding_source: "funder",
    ga_enabled: false, exit_enabled: false, sg_enabled: false, vb_enabled: false, as_enabled: false, ab_enabled: false, cl_enabled: false,
    sn_level: "none", sn_count: 0, sn_big_pct: 0, ct_count: 0, org_enabled: false }));
}
function builtins() {
  const base = shardsPreset(), lib = { "Blank (everything off)": blankPreset(), "SHARDS reconstruction": base };
  const v = (name, o) => { lib[name] = normalise(Object.assign({}, base, { name }, o)); };
  // Fitted to the real SHARDS chart (all 2,361 swaps, 5 Oct 2026) by searching these settings over 3 seeds: Meteora curve, 4 Front MEV
  // buying 55% in the creation block, the network's rotation as Cleanup (41 wallets, 5.5-12 s apart), the 41-wallet dump at 6:45,
  // and an outside market sized to SHARDS' ~690 SOL of outside buying before the dump. Shape and timing match; mid-run levels vary by seed.
  v("SHARDS (fitted to the real chart)", { launchpad: "meteora", duration_min: 30, vb_enabled: false, as_enabled: false, ab_enabled: false, sg_enabled: false,
    sn_level: "custom", sn_count: 35, sn_vary: false, sn_cluster: 4, sn_window_s: 6.4, sn_size: 0.97, sn_hold_min: 35, sn_hold_max: 150, sn_big_pct: 9.8,
    org_enabled: true, org_level: "custom", org_n: 514, org_peak_rate: 3.72, org_peak_s: 111, org_fomo: 0.65, org_size: 0.46, org_hawkes: 0.06, org_hold_s: 837, org_panic: 1.23, org_tp: 1.29, org_flip_pct: 10,
    cl_enabled: true, cl_start_s: 1, cl_inputs: "front", cl_outputs: 41, cl_method: "buyback", cl_delay_mode: "random", cl_delay_min: 5.5, cl_delay_max: 12.3, cl_share_pct: 100, cl_double_pct: 0,
    exit_enabled: true, exit_start_s: 405, exit_window_s: 10, exit_pct: 100, exit_wallets: "all", exit_withdraw: false });
  // the generic presets launch on pump.fun and meet a typical launch's snipers and fixed-size copy bots, not SHARDS' Meteora crowd
  const t = { launchpad: "pumpfun", sn_level: "typical", ct_mode: "fixed" };
  v("Block-0 Quick Build", { ...t, preset: "quick", back_tuning: 1 });
  v("Block-0 Clean Build", { ...t, preset: "clean", back_tuning: 1 });
  v("Block-0 Full Build (temp holders)", { ...t, preset: "full", back_tuning: 1 });
  v("Block-0 + Streamflow airdrop", { ...t, alloc_method: "streamflow" });
  v("Quick mode, no automations", { ...t, mode: "quick", vb_enabled: false, as_enabled: false, holder_supply_pct: 40 });
  v("Organic mode + Bundle volume", { ...t, mode: "organic", buy_delay_s: 3, vb_exec: "bundle", vb_wallets: "dedicated", as_enabled: false });
  v("Manual mode + AutoBuy DCA", { ...t, mode: "manual", ab_enabled: true, ab_dca: true, ab_counter: false, as_enabled: false, vb_enabled: false });
  v("Block-0 + Sniper Guard nuke", { launchpad: "pumpfun", sg_enabled: true, sg_threshold: 40, sg_response: "nuke_all" });
  return lib;
}

// ================================================================== operator (Proxima's tools)
const padOf = cf => PAD_MODELS[cf && cf.launchpad] || PAD_MODELS.pumpfun;
function estCosts(amounts, pad = PAD_MODELS.pumpfun) {
  let vs = pad.vs0, vt = pad.vt0; const fee = pad.curveFees.reduce((a, b) => a + b, 0), out = [];
  for (const tok of amounts) { const x = vs * vt / (vt - tok) - vs; out.push(x / (1 - fee)); vs += x; vt -= tok; }
  return out;
}
function parseLimits(text) {
  const rows = [];
  for (const part of String(text || "").replace(/;/g, ",").split(",")) {
    const m = part.split(":"); if (m.length === 2 && isFinite(+m[0]) && isFinite(+m[1]) && m[0].trim() && m[1].trim()) rows.push([+m[0], +m[1], false]);
  }
  return rows;
}
const sum = a => a.reduce((x, y) => x + y, 0);

class Operator {
  constructor(c, cfg, cx) {
    this.c = c; this.cfg = cfg; this.r = c.rng; this.cx = cx;
    this.halted = false; this.done_launch_buys = false; this.events = []; this.stats = {};
    const b0 = cfg.mode === "block0", w = role => c.wallet(role);
    this.funder = w("op_funder"); this.dev = w("op_dev");
    this.fronts = b0 ? Array.from({ length: cfg.front_count }, () => w("op_front")) : [];
    this.backs = b0 ? Array.from({ length: cfg.back_count }, () => w("op_back")) : [];
    this.temps = b0 ? Array.from({ length: cfg.temp_count }, () => w("op_temp")) : [];
    this.holders = Array.from({ length: cfg.wallets }, () => w("op_holder"));
    this.empties = Array.from({ length: cfg.empty_holders }, () => w("op_empty"));
    this.relays = Array.from({ length: 3 }, () => w("op_relay"));
    this.escrow = w("streamflow"); this.tip = w("jito_tip");
    this.dedicated = cfg.vb_enabled && cfg.vb_wallets === "dedicated" ? Array.from({ length: cfg.vb_dedicated_n }, () => w("op_volume")) : [];
    this.cleanup_out = []; this.hops = []; this.payouts = []; this.targets = new Map(); this.listeners = []; this.runs = [];
    c.hooks.push(tx => { for (const f of this.listeners.slice()) f(tx); });
  }
  own(a) { return (this.c.truth[a] || "").startsWith("op_"); }
  note(msg) { this.events.push([Math.round(Math.max(this.c.slot, 0) * SLOT_S * 10) / 10, msg]); }

  plan() {
    const cf = this.cfg, r = this.r;
    let seq = [[this.dev, cf.dev_buy_pct / 100 * SUPPLY]];
    if (cf.mode === "block0") { const ws = this.fronts.map(() => r.uniform(0.8, 1.2)), s = sum(ws); seq.push(...this.fronts.map((f, i) => [f, cf.target_supply_pct / 100 * SUPPLY * ws[i] / s])); }
    else if (this.holders.length) {
      let pct = cf.holder_supply_pct;
      if (cf.mode === "organic" && cf.holder_buy_sol > 0) {   // the tool takes Organic holder buys in SOL: what that SOL buys after the dev buy
        const P = padOf(cf), fee = sum(P.curveFees), dev = cf.dev_buy_pct / 100 * SUPPLY, vs = P.vs0 * P.vt0 / (P.vt0 - dev), vt = P.vt0 - dev;
        pct = (vt - vs * vt / (vs + cf.holder_buy_sol * (1 - fee))) / SUPPLY * 100;
      }
      const d = Math.max(0, Math.min(0.99, (cf.holder_deviation_pct ?? 40) / 100)), ws = this.holders.map(() => r.uniform(1 - d, 1 + d)), s = sum(ws); seq.push(...this.holders.map((h, i) => [h, pct / 100 * SUPPLY * ws[i] / s]));
    }
    // the Funding page can set one wallet's Token Buy %: that wallet takes it, the rest of its layer is scaled to keep the layer total
    const ov = cf.buy_overrides || {}, keyOf = a => a === this.dev ? "op_dev#0" : this.fronts.includes(a) ? "op_front#" + this.fronts.indexOf(a) : this.holders.includes(a) ? "op_holder#" + this.holders.indexOf(a) : null;
    for (const layer of [[this.dev], this.fronts, this.holders]) {
      const idx = seq.map((x, i) => layer.includes(x[0]) ? i : -1).filter(i => i >= 0); if (!idx.length) continue;
      const set = idx.filter(i => ov[keyOf(seq[i][0])] != null), free = idx.filter(i => !set.includes(i)); if (!set.length) continue;
      const before = sum(idx.map(i => seq[i][1])); set.forEach(i => { seq[i] = [seq[i][0], Math.max(0, +ov[keyOf(seq[i][0])]) / 100 * SUPPLY] });
      const left = Math.max(0, before - sum(set.map(i => seq[i][1]))), fs = sum(free.map(i => seq[i][1])) || 1; if (layer.length > 1) free.forEach(i => { seq[i] = [seq[i][0], seq[i][1] * left / fs] });
    }
    this.keyOf = keyOf;
    const total = sum(seq.map(x => x[1]));
    if (total > 0.78 * SUPPLY) { const k = 0.78 * SUPPLY / total; seq = seq.map(([a, t]) => [a, t * k]); }
    const costs = estCosts(seq.map(x => x[1]), padOf(cf));
    this.targets = new Map(seq);
    const tool = cf.funding_extra_mode === "tool";   // the tool's own budget: +10% on buys, then a buffer per wallet role (see toolPanel)
    const extra = tool ? () => 0 : cf.funding_extra_mode === "fixed" ? () => cf.funding_extra : () => r.uniform(cf.funding_extra_min, cf.funding_extra_max);
    const buf = a => !tool ? 0 : a === this.dev ? 0.37 : this.fronts.includes(a) || this.backs.includes(a) ? 0.4 : this.temps.includes(a) ? 0.2 : 0.13;
    let vbBudget = cf.vb_size_mode === "random" ? cf.vb_size_max : cf.vb_size;
    vbBudget = cf.vb_enabled ? vbBudget * 1.3 + 0.05 : 0;
    const fund = [];
    seq.forEach(([a], i) => { let amt = costs[i] * (tool ? 1.10 : 1.03) + extra() + buf(a) + (tool ? 0 : 0.01); if (cf.vb_enabled && this.fronts.includes(a) && cf.vb_wallets === "front") amt += vbBudget; fund.push([a, amt]); });
    for (const a of this.relays) fund.push([a, 0.05 + 0.006 * (this.holders.length + cf.cl_outputs)]);
    for (const a of [...this.temps, ...this.backs]) fund.push([a, (tool ? buf(a) : 0.02 + extra()) + (cf.vb_wallets === "back" ? vbBudget : 0)]);
    if (cf.mode === "block0") for (const a of this.holders) fund.push([a, tool ? buf(a) : 0.01 + extra()]);
    for (const a of this.empties) fund.push([a, tool ? 0.13 : 0.01 + extra()]);
    for (const a of this.dedicated) fund.push([a, vbBudget + 0.1]);
    if (cf.ab_enabled) { const ab = Math.max(cf.ab_dca_amount, cf.ab_dca_max) * 4 + 1; for (const a of this.autoPool("ab").slice(0, 5)) fund.push([a, ab]); }
    // costs the wallets pay before they trade: Generate Activity loops (2 txs + 2.5% swap cost each) and the CEX withdrawal cut (up to 2%)
    if (cf.vb_enabled && cf.vb_wallets === "holders") for (const f of fund) if (this.holders.includes(f[0])) f[1] += vbBudget;   // the bot trades from the holders' own SOL
    const gaCost = cf.ga_enabled ? cf.ga_loops * (2 * (BASE_FEE + cf.prio_median * 1.5) + 0.025 * (cf.ga_amount_min + cf.ga_amount_max) / 2) : 0;
    const cexK = cf.funding_source === "cex" ? 1 / (1 - 0.02) : 1;
    for (const f of fund) if (!this.relays.includes(f[0])) f[1] = (f[1] + gaCost + 0.006) * cexK;
    this.funding = fund;
    this.stats.plan_supply_pct = sum([...this.targets.values()]) / SUPPLY * 100;
    this.stats.plan_cost_sol = sum(costs);
    this.stats.funding_total_sol = sum(fund.map(x => x[1]));
  }
  prepare() {
    const c = this.c, cf = this.cfg, r = this.r;
    if (!this.funding) this.plan();
    const n = this.funding.length, gap = sec(cf.funding_delay_min * 60);
    const gaSpan = cf.ga_enabled ? sec(cf.ga_loops * cf.ga_delay_s) : 0;
    const start = -(n * gap + gaSpan + sec(1800));
    const total = this.stats.funding_total_sol * 1.02 + 1, grant = Math.max(total, +cf.funder_deposit || 0);
    const src = this.cx[cf.cex_sources[0]] || Object.values(this.cx)[0];
    c.prio = cf.prio_median || 0.0003;
    c.at(start - sec(600), () => c.send(src, this.funder, grant, "funding"));
    if (cf.funding_source === "cex") cf.cex_sources.forEach((name, k) => { const hot = this.cx[name]; if (hot) c.at(start - sec(300) + k, () => c.send(this.funder, hot, total / cf.cex_sources.length, "funding")); });
    this.stats.funder_deposit = grant;
    this.funding.forEach(([a, amt], k) => {
      const slot = start + k * gap;
      if (cf.funding_source === "funder") c.at(slot, () => c.send(this.funder, a, amt, "funding"));
      else if (cf.funding_source === "classic") {
        const p = c.wallet("op_proxy");
        c.at(slot, () => c.send(this.funder, p, amt + 0.002, "funding"));
        c.at(slot + sec(r.uniform(60, 600)), () => c.send(p, a, amt, "funding"));
      } else {
        const hot = this.cx[cf.cex_sources[k % cf.cex_sources.length]] || src;
        c.at(slot, () => { const cut = r.uniform(0.0025, 0.005); c.send(hot, a, amt * (1 - cut), "funding"); c.fee(a, "cex", amt * cut) });
      }
      if (cf.ga_enabled && c.truth[a] !== "op_relay")
        for (let j = 0; j < cf.ga_loops; j++) {
          const t = slot + sec(900) + sec(j * cf.ga_delay_s) + r.randint(0, 3);
          c.at(Math.min(t, -sec(60)), () => c.pad(a, r.uniform(cf.ga_amount_min, cf.ga_amount_max)));
        }
    });
    if (cf.wallet_source === "marketplace") this.marketHistory(start);
    this.stats.funding_hours_before_launch = -start * SLOT_S / 3600;
  }
  // Bought wallets: each was first funded hours before our own funding starts, spaced 30+ min apart (the marketplace's
  // "funding gap"), by an exchange or by a one-off proxy that an exchange funded, then made one small trade.
  marketHistory(start) {
    const c = this.c, cf = this.cfg, r = this.r, hubs = Object.values(this.cx);
    const ws = [...this.fronts, ...this.backs, ...this.temps, ...this.holders, ...this.dedicated], lo = cf.mkt_age_min_h * 3600, hi = Math.max(cf.mkt_age_max_h * 3600, lo + ws.length * 1800);
    const ages = ws.map(() => r.uniform(lo, hi)).sort((a, b) => a - b);
    for (let i = 1; i < ages.length; i++) ages[i] = Math.max(ages[i], ages[i - 1] + 1800);
    r.sample(ws, ws.length).forEach((a, i) => {
      const t = start - sec(ages[i]), amt = r.uniform(0.06, 0.2), hub = hubs[r.randint(0, hubs.length - 1)];
      if (r.random() * 100 < cf.mkt_cex_pct) c.at(t, () => c.send(hub, a, amt, "market_seed"));
      else { const p = c.wallet("mkt_proxy"); c.at(t - sec(r.uniform(600, 7200)), () => c.send(hub, p, amt + 0.01, "market_seed")); c.at(t, () => c.send(p, a, amt, "market_seed")); }
      c.at(t + sec(r.uniform(300, 3600)), () => c.pad(a, r.uniform(0.01, 0.04), "market_history"));
    });
    this.stats.market_wallets = ws.length;
  }
  scheduleLaunch() { this.c.at(0, () => this.launch(), true); }   // first in its slot: nobody can buy ahead of the create + dev buy
  launch() {
    const c = this.c, cf = this.cfg;
    c.log({ kind: "create", signer: this.dev, mint: MINT, tool: "deploy" }); c.created = true;
    if ((this.targets.get(this.dev) || 0) > 0) c.buy(this.dev, c.sol_for(this.targets.get(this.dev)), "dev_buy");
    if (cf.mode === "block0") {
      for (const f of this.fronts) c.buy(f, c.sol_for(this.targets.get(f)), "front_mev");
      if (this.fronts.length) c.send(this.fronts[0], this.tip, 0.001 + cf.fee_target, "jito_tip");
      this.note(`Block-0: dev + ${this.fronts.length} Front MEV bought ${(sum([this.dev, ...this.fronts].map(a => c.tok[a])) / SUPPLY * 100).toFixed(1)}% in the deploy slot`);
    }
    this.snipeFn = () => this.startBuys(c.slot);
    if (cf.scheduled) {
      if (!cf.snipe_manual) c.at(sec(cf.snipe_at_s), () => this.snipe());
      this.note(cf.snipe_manual ? "Scheduled Mode: holder buys held until you press Snipe" : `Scheduled Mode: holder buys held until Snipe at +${cf.snipe_at_s}s`);
    } else this.startBuys(1);
    this.startAutomations();
  }
  snipe() { if (this.snipeFn) { const f = this.snipeFn; this.snipeFn = null; this.note("Snipe: holder buys started"); f(); } }
  startBuys(start) {
    const c = this.c, cf = this.cfg;
    if (!this.cfg.scheduled) this.snipeFn = null;
    if (cf.mode === "block0") c.at(Math.max(start, sec(cf.front_back_delay_s)), () => this.layers());
    else if (!(cf.holder_supply_pct > 0)) c.at(start + 1, () => this.launchDone());   // 0% for holders = no holder buys
    else if (cf.mode === "quick" || cf.mode === "organic") {
      const gap = cf.mode === "quick" ? 0 : sec(cf.buy_delay_s);
      this.holders.forEach((h, i) => c.at(start + i * gap, () => this.holderBuy(h, "holder_buy")));
      c.at(start + this.holders.length * gap + 1, () => this.launchDone());
    } else {
      if (cf.live) { c.at(start + 1, () => this.launchDone()); return; }   // the workspace: Manual means you press Buy yourself
      const t0 = Math.max(start, sec(cf.manual_buy_at_s));
      this.holders.forEach((h, i) => c.at(t0 + (cf.manual_style === "stagger" ? i : 0), () => this.holderBuy(h, "manual_buy")));
      c.at(t0 + this.holders.length + 1, () => this.launchDone());
    }
  }
  launchDone() { if (!this.done_launch_buys) { this.done_launch_buys = true; this.note("All launch buy orders completed"); } }
  holderBuy(h, tool) {
    if (this.halted) return;
    const c = this.c, want = this.targets.get(h) || 0;
    const spend = want ? c.sol_for(want) : c.sol[h] * 0.9;
    c.buy(h, Math.min(spend, c.sol[h] - 0.005), tool);
  }
  layers() {
    const cf = this.cfg, phases = []; let src = this.fronts;
    if (this.backs.length) { phases.push(["buyback", src, this.backs, Math.max(1, sec(cf.front_back_delay_s)), "back_mev"]); src = this.backs; }
    if (this.temps.length) { phases.push(["transfer", src, this.temps, sec(cf.back_temp_delay_s), "temp_transfer"]); src = this.temps; }
    const method = cf.alloc_method === "streamflow" ? "streamflow" : "buyback";
    if (this.holders.length) phases.push([method, src, this.holders, sec(cf.buy_delay_s), method === "buyback" ? "holder_buy" : "streamflow"]);
    this.runPhases(phases);
  }
  runPhases(phases) {
    if (!phases.length || this.halted) { this.launchDone(); return; }
    const [kind, src, dst, gap, tool] = phases[0], rest = phases.slice(1), c = this.c;
    if (kind === "transfer") {
      const total = sum(src.map(s => c.tok[s])); let k = 0;   // one transfer per temp wallet, Back->Temp delay apart
      const next = () => {
        if (this.halted) return;
        if (k >= dst.length) { this.note(`Temp Holders: ${dst.length} wallets received ${(total / SUPPLY * 100).toFixed(1)}% by transfer`); c.at(c.slot + Math.max(1, gap), () => this.runPhases(rest)); return; }
        const d = dst[k++], s = src.reduce((a, b) => c.tok[b] > c.tok[a] ? b : a); c.send_tok(s, d, Math.min(c.tok[s], total / dst.length), tool);
        c.at(c.slot + Math.max(1, gap), next);
      };
      c.at(c.slot + Math.max(1, gap), next);
      return;
    }
    this.move(kind, src, dst, gap, tool, () => this.runPhases(rest));
  }
  // Sell+buy rounds (Block-0 layers and Cleanup) or a Streamflow airdrop. Sells are labelled by the seller's own layer.
  move(kind, src, dst, gap, tool, then = null, doublePct = 0, share = 1, ctl = null, sellTool = null) {
    const c = this.c, r = this.r; dst = dst.slice();
    const stop = () => ctl ? !!(ctl.cancelled || ctl.stopped) : this.halted;
    const finish = () => { if (ctl && ctl.status === "running") ctl.status = ctl.cancelled ? "cancelled" : ctl.stopped || "done"; if (then) then(); };
    const toMove = sum(src.map(s => c.tok[s])) * share;
    const st = { left: toMove, i: 0, rounds: 0, skipped: 0 };
    const gapf = typeof gap === "function" ? gap : () => gap;
    const roleTool = a => sellTool || ({ op_front: "front_mev", op_back: "back_mev", op_temp: "temp_transfer" }[c.truth[a]] || tool);
    if (kind === "streamflow") {
      for (const s of src) c.send_tok(s, this.escrow, c.tok[s] * share, "streamflow", "stream");
      const per = toMove / Math.max(1, dst.length);
      const claim = () => {
        if (ctl) ctl.stats = { claims: st.i - st.skipped, of: dst.length, skipped: st.skipped };
        if (st.i >= dst.length || stop()) { finish(); return; }
        const d = dst[st.i++];
        if (!c.send_tok(this.escrow, d, Math.min(per, c.tok[this.escrow]), "streamflow", "claim", d)) st.skipped++;   // the claimant signs and pays; no SOL, no claim
        c.at(c.slot + Math.max(1, gapf()), claim);
      };
      c.at(c.slot + 1, claim);
      this.note(`Streamflow Airdrop: ${(toMove / SUPPLY * 100).toFixed(1)}% escrowed for ${dst.length} claimants`);
      return;
    }
    // sell `amount` tokens from the sellers, biggest holder first, until it's covered
    // each seller pays into its own relay, so one round never looks like several wallets sweeping into one address
    const sellUpTo = amount => { const parts = [], used = new Set(); let left = amount; for (const s of src.slice().sort((a, b) => c.tok[b] - c.tok[a])) { if (left <= 1) break; const t = Math.min(left, c.tok[s]); if (t <= 1) continue; const g = c.sell(s, t, roleTool(s)); if (g) { left -= t; const free = this.relays.filter(x => !used.has(x)), rl = r.choice(free.length ? free : this.relays); used.add(rl); parts.push([rl, c.send(s, rl, g, tool)]); } } return [parts, amount - left] };
    const rnd = () => {
      if (ctl) ctl.stats = { rounds: st.rounds, buyers: st.i, of: dst.length };
      if (stop() || st.i >= dst.length || st.left < 1) { finish(); return; }
      if (!c.tradable()) { c.at(c.slot + 1, rnd); return; }
      const nLeft = dst.length - st.i;
      const nb = nLeft >= 2 && r.random() < doublePct / 100 ? 2 : 1;
      const chunk = nLeft <= nb ? st.left : st.left * nb / nLeft;   // every buyer gets an equal share of what's left; the last round takes the rest
      const [parts, sold] = sellUpTo(chunk), got = sum(parts.map(x => x[1]));
      st.left -= sold;
      if (!(sold > 1)) { finish(); return; }
      for (let k = 0; k < nb; k++) { const b = dst[st.i++]; for (const [rl, g] of parts) c.send(rl, b, g / nb, tool); c.buy(b, got / nb - 0.002 * parts.length, tool); }
      st.rounds++;
      c.at(c.slot + Math.max(1, gapf()), rnd);
    };
    c.at(c.slot + 1, rnd);
  }
  // Planned automations: each keeps the settings the plan had, and reports scheduled -> running -> done to the workspace.
  startAutomations() {
    const cf = this.cfg, c = this.c, reg = this.onPlanned || (() => ({})), snap = Object.assign({}, cf);
    const go = (ctl, f) => () => { if (ctl.cancelled) return; if (ctl.stopped) { ctl.status = ctl.stopped; return; } ctl.status = "running"; f(ctl) };
    if (cf.sg_enabled) { const ctl = reg("Sniper Guard (planned)", 0); ctl.status = "armed"; this.sniperGuard(ctl, snap, 0) }
    if (cf.vb_enabled) { const ctl = reg("Volume Bot (planned)", cf.vb_start_s); this.track("volume", ctl); c.at(sec(cf.vb_start_s), go(ctl, k => this.volumeBot(k, null, snap))) }
    for (const p of ["ab", "as"]) if (cf[p + "_enabled"]) {
      const name = p === "ab" ? "AutoBuy" : "AutoSell", kind = p === "ab" ? "autobuy" : "autosell", more = Array.isArray(cf[p + "_extra"]) ? cf[p + "_extra"] : [];
      const runs = (cf[p + "_counter"] || cf[p + "_dca"] || cf[p + "_limits"] ? [snap] : []).concat(more.map(q => Object.assign({}, snap, autoOverlay(p, q, snap))));
      runs.forEach((k0, i) => { const ctl = reg(`${name} (planned)${runs.length > 1 ? " " + (i + 1) : ""}`, cf[p + "_start_delay_s"]); this.track(kind, ctl); c.at(sec(cf[p + "_start_delay_s"]), go(ctl, k => this.auto(p, k, k0))) });
    }
    if (cf.cl_enabled) { const ctl = reg("Cleanup (planned)", cf.cl_start_s); this.track("cleanup", ctl); c.at(sec(cf.cl_start_s), go(ctl, k => this.cleanup(k, null, snap))) }
    if (cf.exit_enabled) { const ctl = reg("Scripted exit (sandbox)", cf.exit_start_s); c.at(sec(cf.exit_start_s), go(ctl, k => this.exit(snap, k))) }
  }
  track(kind, ctl) { if (!this.runs.some(x => x.ctl === ctl)) this.runs.push({ kind, ctl }); }
  // Sniper Guard "stop all buys and Cleanup": stops what is running or scheduled now; tools started afterwards still run
  stopRuns(kinds, why) { for (const x of this.runs) if (kinds.includes(x.kind) && (!x.ctl.status || ["running", "scheduled", "armed"].includes(x.ctl.status))) { x.ctl.stopped = why; if (x.ctl.status === "scheduled") x.ctl.status = why; } }
  unlisten(fn) { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); }
  sniperGuard(ctl = {}, cf = Object.assign({}, this.cfg), startSlot = 0) {
    const c = this.c, st = { sum: 0, on: true }, wl = new Set(cf.sg_whitelist || []);
    const end = cf.sg_end === "timed" ? startSlot + sec(cf.sg_timed_s) : null;
    ctl.stats = { outside_buys_sol: 0, of: cf.sg_threshold };
    const finish = why => { if (!st.on) return; st.on = false; this.unlisten(fn); if (["armed", "running"].includes(ctl.status) || !ctl.status) ctl.status = why; };
    const over = () => (end !== null && c.slot > end) || (end === null && this.done_launch_buys);
    const check = () => { if (!st.on) return; if (ctl.cancelled) return finish("cancelled"); if (over()) return finish("done: not triggered"); c.at(c.slot + 5, check); };   // ends on time even when nobody buys
    const fn = tx => {
      if (!st.on) return;
      if (ctl.cancelled) return finish("cancelled");
      if (over()) return finish("done: not triggered");
      if (tx.side !== "buy" || this.own(tx.signer) || wl.has(tx.signer)) return;   // your own wallets and the whitelist never count
      st.sum += tx.sol; ctl.stats = { outside_buys_sol: +st.sum.toFixed(2), of: cf.sg_threshold };
      if (st.sum > cf.sg_threshold) {
        finish("triggered");
        const resp = cf.sg_response;
        this.note(`Sniper Guard triggered at ${st.sum.toFixed(2)} SOL of outside buys -> ${resp}`);
        // All / Holders Only (and Dev Only with Complete Early) stop all buys and Cleanup; Complete Early stops buys without selling
        if (resp !== "nuke_dev" || cf.sg_complete_early) { this.halted = true; this.stopRuns(["autobuy", "volume", "cleanup"], "stopped: Sniper Guard"); }
        if (resp === "complete_early") return;
        const kinds = { nuke_all: ["op_dev", "op_front", "op_back", "op_temp", "op_holder", "op_empty"], nuke_holders: ["op_front", "op_back", "op_temp", "op_holder", "op_empty"], nuke_dev: ["op_dev"] }[resp] || [];
        const ws = Object.keys(c.truth).filter(a => kinds.includes(c.truth[a]) && (c.tok[a] || 0) > 1);
        c.at(c.slot + 1 + Math.floor(c.rng.random() * 2), () => ws.forEach(a => c.sellSoon(a, 1, "sniper_guard")));
      }
    };
    this.listeners.push(fn); c.at(c.slot + 5, check);
  }
  volumeBot(ctl = {}, chosen = null, cf = Object.assign({}, this.cfg)) {
    const c = this.c, r = this.r; this.track("volume", ctl);
    const pool = chosen && chosen.length ? chosen : ({ front: this.fronts, back: this.backs, holders: this.holders, dedicated: this.dedicated }[cf.vb_wallets] || []);
    const target = +cf.vb_target;
    if (!pool.length) { ctl.status = "stopped: no wallets in the chosen group"; this.note("Volume Bot not started: the chosen wallet group is empty"); return; }
    // Duration mode spreads the whole target over the duration: with set trade sizes the step count follows from target / size,
    // with auto sizes it's one step every ~10 s and the size follows. A bundle step trades both sides (2x its size).
    const bundle = cf.vb_exec === "bundle", bundleX = bundle ? 2 : 1, avgSize = cf.vb_size_mode === "fixed" ? cf.vb_size : cf.vb_size_mode === "random" ? (cf.vb_size_min + cf.vb_size_max) / 2 : null;
    let trips = null, interval;
    if (cf.vb_mode === "duration") { trips = avgSize ? Math.max(4, Math.ceil(target / (avgSize * bundleX))) : Math.max(4, Math.trunc(cf.vb_duration_s / 10)); interval = () => Math.max(1, sec(cf.vb_duration_s / trips * r.uniform(0.6, 1.4))); }
    else interval = () => Math.max(1, sec(r.uniform(cf.vb_delay_min, cf.vb_delay_max)));
    const size = cf.vb_size_mode === "fixed" ? () => cf.vb_size : cf.vb_size_mode === "random" ? () => r.uniform(cf.vb_size_min, cf.vb_size_max)
      : () => target / bundleX / (trips || 10) * r.uniform(0.5, 1.5);
    const streak = Math.max(1, Math.round(1 + cf.vb_wave * 6));
    const st = { vol: 0, trades: 0, inv: [], buying: true, run: 0, steps: 0, tips: 0 };
    const endSlot = cf.vb_mode === "duration" ? c.slot + sec(cf.vb_duration_s) : null;
    // Duration mode re-paces every step from what's left (volume still to make / time left, at the volume per step so far)
    const gap = () => {
      if (endSlot === null) return interval();
      const left = endSlot - c.slot, need = target - st.vol; if (left <= 1 || need <= 0) return 1;
      const per = st.steps > 3 ? st.vol / st.steps : (avgSize || target / bundleX / (trips || 10)) * bundleX;
      return Math.max(1, Math.round(left / Math.max(1, need / Math.max(1e-6, per)) * r.uniform(0.6, 1.4)));
    };
    // Fee Target = the session's total tip budget (any mode), spread over the transactions it expects to send
    const unit = avgSize || target / bundleX / (trips || 10), expTx = Math.max(1, target / unit / (bundle ? 2 : 1));
    const tipPer = cf.vb_fee_target > 0 ? cf.vb_fee_target / expTx : 0;
    const tip = w => { if (tipPer > 0 && st.tips + tipPer <= cf.vb_fee_target + 1e-9) st.tips += c.send(w, this.tip, tipPer, "jito_tip"); };
    const lastSol = () => c.ledger[c.ledger.length - 1].sol;
    const stats = () => { ctl.stats = { volume_sol: +st.vol.toFixed(2), of: target, trades: st.trades, tips_sol: +st.tips.toFixed(4) }; };
    const end = why => { for (const [w, tok] of st.inv) { const g = c.sell(w, tok, "volume_bot"); if (g) { st.vol += g; st.trades++; } } st.inv = []; stats(); this.stats.volume_bot = { volume_sol: +st.vol.toFixed(2), trades: st.trades }; if (!ctl.status || ctl.status === "running") ctl.status = why; };
    this.note(`Volume Bot started: ${target} SOL target, ${cf.vb_mode} mode, ${cf.vb_exec}`);
    const step = () => {
      stats();
      if (ctl.cancelled) return end("cancelled");
      if (ctl.stopped) return end(ctl.stopped);
      if (st.vol >= target) return end("done");
      if (endSlot !== null && c.slot > endSlot + sec(60)) return end(`stopped: time up at ${st.vol.toFixed(1)} of ${target} SOL`);
      if (!c.tradable()) { c.at(c.slot + 1, step); return; }   // the moment between curve completion and migration
      const able = pool.filter(a => (c.sol[a] || 0) > 0.02);
      if (!able.length) { this.note("Volume Bot stopped: its wallets are out of SOL"); return end("stopped: wallets out of SOL"); }
      const w = r.choice(able);
      if (bundle) {   // one wallet, both sides in the same block: buy then sell, or sell then buy back when it already holds tokens
        const amt = size(), t = c.tokForSol(amt);
        if ((c.tok[w] || 0) > t && r.random() < 0.5) { const g = c.sell(w, t, "volume_bot"); if (g) { st.vol += g; st.trades++; if (c.buy(w, g, "volume_bot")) { st.vol += lastSol(); st.trades++; } tip(w); } }
        else { const got = c.buy(w, amt, "volume_bot"); if (got) { st.vol += lastSol(); st.trades++; if (c.tradable()) { st.vol += c.sell(w, got, "volume_bot"); st.trades++; } else st.inv.push([w, got]); tip(w); } }
      } else if (st.buying || !st.inv.length) {
        const got = c.buy(w, size(), "volume_bot");
        if (got) { st.vol += lastSol(); st.trades++; st.inv.push([w, got]); tip(w); }
        st.run++;
        if (st.run >= Math.max(1, Math.round(streak * r.uniform(0.6, 1.4)))) { st.buying = false; st.run = 0; }
      } else {
        const [w0, tok] = st.inv.shift(), g = c.sell(w0, tok, "volume_bot"); if (g) { st.vol += g; st.trades++; tip(w0); }
        if (!st.inv.length) st.buying = true;
      }
      st.steps++; stats(); c.at(c.slot + gap(), step);
    };
    step();
  }
  autoPool(p, cf = this.cfg) {
    const sel = cf[p + "_wallets"];
    if (Array.isArray(sel)) return sel;
    if (sel === "all") return [this.dev, ...this.fronts, ...this.backs, ...this.temps, ...this.holders, ...this.empties, ...this.cleanup_out];
    return ({ holders: [...this.holders, ...this.empties, ...this.cleanup_out], front: this.fronts, back: this.backs, dev: [this.dev] })[sel] || [];
  }
  // AutoBuy / AutoSell. Amounts: AutoBuy in SOL; AutoSell in tokens (the UI sends % of supply as millions of tokens).
  // Counter responses are sized by the observed trade's SOL (1 SOL x 20% = 0.2 SOL), as in the tool.
  auto(p, ctl = {}, cf = Object.assign({}, this.cfg), session = null) {
    const c = this.c, r = this.r, side = p === "ab" ? "buy" : "sell", tool = side === "buy" ? "autobuy" : "autosell";
    this.track(tool, ctl);
    const pool = () => this.autoPool(p, cf);
    if (!pool().length) { ctl.status = "stopped: no wallets in the chosen group"; this.note(`${tool} not started: the chosen wallet group is empty`); return; }
    const st = { amount: 0, sol: 0, acc: 0, on: true, n: 0 }, wl = new Set(cf[p + "_whitelist"] || []), mine = [];
    const end = cf[p + "_end_duration_s"] > 0 ? c.slot + sec(cf[p + "_end_duration_s"]) : null;
    const endAmt = cf[p + "_end_amount"] > 0 ? (side === "buy" ? cf[p + "_end_amount"] : cf[p + "_end_amount"] * 1e6) : 0;
    const limits = parseLimits(cf[p + "_limits"]);
    this.note(`${tool} started`);
    const inRange = () => { const m = c.mc(), lo = cf[p + "_mc_min"], hi = cf[p + "_mc_max"]; return (lo <= 0 || m >= lo) && (hi <= 0 || m <= hi); };
    const stats = () => { ctl.stats = side === "buy" ? { trades: st.n, bought_sol: +st.amount.toFixed(3) } : { trades: st.n, sold_pct: +(st.amount / SUPPLY * 100).toFixed(3), got_sol: +st.sol.toFixed(3) }; };
    const stop = why => { if (!st.on) return; st.on = false; mine.forEach(f => this.unlisten(f)); stats(); this.stats[tool] = Object.assign({}, ctl.stats); if (!ctl.status || ctl.status === "running") ctl.status = why; };
    const alive = () => {
      stats();
      if (!st.on) return false;
      if (ctl.cancelled) { stop("cancelled"); return false; }
      if (ctl.stopped) { stop(ctl.stopped); return false; }
      if ((end !== null && c.slot > end) || (endAmt > 0 && st.amount >= endAmt * 0.999)) { stop("done"); return false; }
      if (session && ((session.end !== null && c.slot > session.end) || (session.max > 0 && session.amount >= session.max * 0.999))) { stop("done: session limit"); return false; }
      return true;
    };
    if (end !== null) c.at(end + 1, alive);
    if (session && session.end !== null) c.at(session.end + 1, alive);
    const room = () => Math.min(endAmt > 0 ? endAmt - st.amount : Infinity, session && session.max > 0 ? session.max - session.amount : Infinity);
    // buy `want` SOL / sell `want` tokens, spread over the pool (one wallet after another when one can't cover it)
    const act = want => {
      want = Math.min(want, room()); if (!(want > 0)) return;
      let left = want;
      // a wallet that can cover the whole amount first (one clean fill); only split across wallets when none can
      const cover = w => side === "buy" ? (c.sol[w] || 0) - 0.02 >= want : (c.tok[w] || 0) >= want;
      const shuffled = pool().slice().sort(() => r.random() - 0.5), order = shuffled.filter(cover).concat(shuffled.filter(w => !cover(w)));
      for (const w of order) {
        if (left <= (side === "buy" ? 0.0005 : 1)) break;
        if (side === "buy") { const can = (c.sol[w] || 0) - 0.02; if (can <= 0.001) continue; if (c.buy(w, Math.min(left, can), tool)) { const s = c.ledger[c.ledger.length - 1].sol; left -= s; st.amount += s; st.n++; if (session) session.amount += s; } }
        else { const t = Math.min(left, c.tok[w] || 0); if (t <= 1) continue; const g = c.sell(w, t, tool); if (g) { left -= t; st.amount += t; st.sol += g; st.n++; if (session) session.amount += t; } }
      }
      if (side === "buy" && left >= want * 0.999 && !pool().some(a => (c.sol[a] || 0) > 0.03)) { this.note(`${tool} stopped: its wallets are out of SOL`); stop("stopped: wallets out of SOL"); }
      if (side === "sell" && !pool().some(a => (c.tok[a] || 0) > 1)) stop("done: no tokens left to sell");
      stats(); alive();
    };
    const later = () => 1 + Math.floor(r.random() * 3);   // responses land 1-3 blocks (0.2-0.6 s) after the trade they answer
    if (cf[p + "_counter"]) {
      const fn = tx => {
        if (!alive() || this.own(tx.signer) || wl.has(tx.signer) || !inRange()) return;
        if ((side === "buy" && tx.side !== "sell") || (side === "sell" && tx.side !== "buy")) return;
        // one Trigger Condition: Rate (response probability), Min. SOL or Min. Token (smallest trade answered)
        if (r.random() > cf[p + "_rate"] / 100 || tx.sol < (cf[p + "_min_trigger"] || 0) || tx.tok < (cf[p + "_min_trigger_tok"] || 0)) return;
        st.acc += tx.sol * cf[p + "_replication"] / 100;
        const enough = side === "buy" ? st.acc >= cf[p + "_min_per_trade"] : c.tokForSol(st.acc) >= cf[p + "_min_per_trade"] * 1e6;
        if (enough) { const a = st.acc; st.acc = 0; c.at(c.slot + later(), () => { if (alive()) act(side === "buy" ? a : c.tokForSol(a)); }); }
      };
      this.listeners.push(fn); mine.push(fn);
    }
    if (cf[p + "_dca"]) {
      const dca = () => {
        if (!alive()) return;
        if (inRange()) { const amt = cf[p + "_dca_mode"] === "fixed" ? cf[p + "_dca_amount"] : r.uniform(cf[p + "_dca_min"], cf[p + "_dca_max"]); act(side === "buy" ? amt : amt * 1e6); }
        c.at(c.slot + Math.max(1, sec(cf[p + "_dca_interval_s"])), dca);
      };
      c.at(c.slot + 1, dca);
    }
    if (limits.length) {
      const fn = () => {
        if (!alive()) return;
        const m = c.mc();
        for (const row of limits) {
          if (row[2]) continue;
          if ((side === "buy" && m <= row[0]) || (side === "sell" && m >= row[0])) { row[2] = true; const amt = side === "buy" ? row[1] : row[1] * 1e6; c.at(c.slot + later(), () => { if (alive()) act(amt); }); }
        }
      };
      this.listeners.push(fn); mine.push(fn);
    }
  }
  // Cleanup: input wallets sell, output wallets buy. New outputs get their gas money from the Funder.
  cleanup(ctl = {}, chosen = null, cf = Object.assign({}, this.cfg), outsChosen = null) {
    const r = this.r, c = this.c; this.track("cleanup", ctl);
    const src = (chosen && chosen.length ? chosen : ({ holders: this.holders, front: this.fronts, back: this.backs, temp: this.temps }[cf.cl_inputs] || [])).filter(a => c.tok[a] > 1);
    if (!src.length) { this.note("Cleanup: no input wallets hold tokens, skipped"); ctl.status = "done: nothing to clean"; return; }
    const outs = outsChosen && outsChosen.length ? outsChosen.filter(a => !src.includes(a)) : Array.from({ length: Math.max(1, cf.cl_outputs) }, () => c.wallet("op_holder"));
    if (!(outsChosen && outsChosen.length)) { this.cleanup_out.push(...outs); for (const a of outs) c.send(this.funder, a, 0.006, "cleanup"); }
    let gap;
    if (cf.cl_delay_mode === "fixed") gap = sec(cf.cl_delay);
    else { const lo = Math.min(cf.cl_delay_min, cf.cl_delay_max), hi = Math.max(cf.cl_delay_min, cf.cl_delay_max); gap = () => sec(r.uniform(lo, hi)); }
    this.note(`Cleanup (${cf.cl_method}): ${src.length} sellers -> ${outs.length} ${outsChosen && outsChosen.length ? "" : "new "}wallets`);
    this.move(cf.cl_method, src, outs, gap, cf.cl_method === "buyback" ? "cleanup" : "streamflow", null, cf.cl_double_pct, cf.cl_share_pct / 100, ctl, "cleanup");
  }
  // Planned exit: each wallet sells exit_pct of what it held when the exit began, in 1-3 parts; then the SOL is swept home
  exit(cf = Object.assign({}, this.cfg), ctl = {}) {
    const c = this.c, r = this.r;
    c.at(c.slot + sec(cf.exit_window_s) + 1, () => { if (ctl.status === "running") ctl.status = "done"; });
    const hold = [...this.holders, ...this.empties, ...this.cleanup_out];
    const ws = cf.exit_wallets === "holders" ? hold : [this.dev, ...this.fronts, ...this.backs, ...this.temps, ...hold];
    this.note(`Manual sells: ${ws.length} wallets exit over ${cf.exit_window_s}s`);
    for (const a of ws) {
      const n = r.randint(1, 3), times = Array.from({ length: n }, () => r.uniform(0, cf.exit_window_s)).sort((x, y) => x - y);
      const plan = { total: null, sold: 0 };
      times.forEach((t, k) => {
        const part = () => {
          if (ctl.cancelled) return;
          if (!c.tradable()) { c.at(c.slot + 1, part); return; }   // the moment between curve completion and migration
          if (plan.total === null) plan.total = c.tok[a] * cf.exit_pct / 100;
          const want = k === n - 1 ? plan.total - plan.sold : plan.total / n, t2 = Math.min(want, c.tok[a]);
          if (t2 > 1 && c.sell(a, t2, "manual_sell")) plan.sold += t2;
        };
        c.at(c.slot + sec(t), part);
      });
    }
    if (cf.exit_withdraw) c.at(c.slot + sec(cf.exit_window_s + 60), () => {
      const hop = cf.exit_withdraw_route === "direct" ? null : c.wallet("op_hop"); if (hop) this.hops.push(hop);
      for (const a of [...ws, this.dev, ...this.fronts, ...this.backs, ...this.relays, ...this.dedicated]) if ((c.sol[a] || 0) > 0.01) c.send(a, hop || this.funder, c.sol[a] - 0.003, "withdraw");
      if (hop) c.at(c.slot + sec(this.r.uniform(4, 60)), () => c.send(hop, this.funder, c.sol[hop] - GAS, "withdraw"));
      this.note(hop ? "Withdraw: SOL swept into a hop wallet, then on to the Funder" : "Withdraw: SOL swept back to the Funder");
    });
  }
}

// One Auto Buy / Auto Sell strategy (the pop-up's parameters) -> the settings it runs with. num() checks a number.
function autoOverlay(pre, p, cf, num = (v => +v || 0)) {
  const o = {};
  for (const key of ["rate", "min_trigger", "min_trigger_tok", "replication", "min_per_trade", "dca_interval_s", "dca_amount", "dca_min", "dca_max", "mc_min", "mc_max", "end_amount", "end_duration_s"]) o[pre + "_" + key] = p[key] !== undefined ? num(p[key], key.replace(/_/g, " ")) : (cf[pre + "_" + key] || 0);
  Object.assign(o, { [pre + "_counter"]: !!p.counter, [pre + "_dca"]: !!p.dca, [pre + "_dca_mode"]: p.dca_mode || "fixed", [pre + "_limits"]: p.limits || "", [pre + "_whitelist"]: p.whitelist || [] });
  return o;
}

// ================================================================== crowd
function poisson(r, lam) { if (lam <= 0) return 0; const L = Math.exp(-Math.min(lam, 30)); let k = 0, p = 1; for (;;) { p *= r.random(); if (p <= L) return k; k++; } }
// Sniper levels, from a sample of 38 pump.fun launches on 15 Oct 2026: buyers in the first 5 s had a median of 4 (about a quarter
// had none, p90 about 20). SHARDS' early outsiders bought a median 0.96 SOL (mean 1.47) and first sold after a median 5 s; across
// launches over half of snipers sell within a minute and 85% within 5 minutes, nearly all in one or two sells.
const SN_PRESETS = {
  none: { label: "None", sn_count: 0, sn_vary: false, sn_big_pct: 0 },
  typical: { label: "Typical launch", sn_count: 4, sn_vary: true, sn_cluster: 3, sn_window_s: 4, sn_size: 0.4, sn_hold_min: 8, sn_hold_max: 300, sn_big_pct: 0 },
  busy: { label: "Busy", sn_count: 15, sn_vary: false, sn_cluster: 3, sn_window_s: 4, sn_size: 0.6, sn_hold_min: 5, sn_hold_max: 180, sn_big_pct: 0 },
  hot: { label: "Hot (SHARDS-like)", sn_count: 37, sn_vary: false, sn_cluster: 4, sn_window_s: 4, sn_size: 1.0, sn_hold_min: 3, sn_hold_max: 30, sn_big_pct: 9.8 },
};
const preset = (P, k) => { const o = Object.assign({}, P[k]); delete o.label; return o };
function snipers(c, cfg, cx) {
  if (SN_PRESETS[cfg.sn_level]) Object.assign(cfg, preset(SN_PRESETS, cfg.sn_level));
  const r = c.rng, hot = Object.values(cx);
  c.failed = { n: 0, sol: 0 };
  if (cfg.sn_big_pct > 0) {
    const big = c.wallet("sniper");
    c.at(-sec(7200), () => { c.send(r.choice(hot), big, 60); for (let i = 0; i < 30; i++) c.pad(big, 0.1, "market_history"); });
    c.at(0, () => c.buy(big, c.sol_for(cfg.sn_big_pct / 100 * SUPPLY), "sniper"));
    for (let t = 8; t < 12.8; t += 1.2) c.at(sec(t), () => c.sellSoon(big, 0.2, "sniper"));
    c.at(sec(r.uniform(60, 600)), () => c.sellSoon(big, 1, "sniper"));
  }
  let made = 0;
  // most launches get a few snipers, about one in five none, a few many (log-normal around the set count)
  const count = cfg.sn_vary ? (r.random() < 0.2 ? 0 : Math.min(300, Math.round(cfg.sn_count * Math.exp(r.gauss(0, 1.1))))) : cfg.sn_count;
  const window = Math.max(1, sec(cfg.sn_window_s)), lo = Math.log(Math.max(0.4, cfg.sn_hold_min)), hi = Math.log(Math.max(0.4, cfg.sn_hold_min, cfg.sn_hold_max));
  // contested early slots: snipers also send attempts that fail (no fill) and still pay the network and priority fee
  const tries = 0.5 + count / 10;
  while (made < count) {
    const size = Math.min(cfg.sn_cluster, count - made), boss = c.wallet("sniper_funder");
    c.at(-sec(r.uniform(5, 40) * 3600), () => c.send(r.choice(hot), boss, 6 * size));
    const slot = r.randint(1, window);
    for (let i = 0; i < size; i++) {
      const w = c.wallet("sniper"), amt = Math.min(10, r.lognorm(Math.log(Math.max(0.01, cfg.sn_size)), 0.9));
      c.at(-sec(r.uniform(1, 4) * 3600), () => { c.send(boss, w, amt + 0.3); for (let k = 0; k < 20; k++) c.pad(w, 0.05, "market_history"); });
      const fails = slot <= sec(3.2) ? poisson(r, tries) : 0;
      for (let k = 0; k < fails; k++) c.at(r.randint(1, slot), () => { const p = Math.min(c.prioFee(), Math.max(0, c.sol[w] - BASE_FEE)); if (c.sol[w] > BASE_FEE) { c.sol[w] -= BASE_FEE + p; c.failed.n++; c.failed.sol += BASE_FEE + p } });
      c.at(slot, () => c.buy(w, amt, "sniper"));
      const hold = sec(Math.exp(r.uniform(lo, hi)));
      if (r.random() < 0.35) {   // about a third sell in two parts
        c.at(slot + hold, () => c.sellSoon(w, 0.5, "sniper"));
        c.at(slot + Math.round(hold * r.uniform(1.5, 4)), () => c.sellSoon(w, 1, "sniper"));
      } else c.at(slot + hold, () => c.sellSoon(w, 1, "sniper"));
    }
    made += size;
  }
}
// Organic traders. Real organic flow is irregular, so the arrival rate is an attention curve multiplied by
// (1) momentum chasing, (2) self-excitation: each buy draws more buys for a few seconds, so buys cluster,
// (3) slow log-normal noise: random lulls and surges, (4) occasional attention shocks (a call, a tweet) that decay over a minute.
// Buy sizes are heavy-tailed with a few whales; holders flip, panic-sell, take profit in parts or just drift out.
// The level can be switched live (off / very low / mid / bullish); wallets are created the first time it turns on.
const ORG_PRESETS = {
  // a launch nobody notices: a handful of trades in the first minute, then nothing (13% of real launches have none in 5 minutes)
  dead: { label: "Dead", org_n: 40, org_peak_rate: 0.04, org_peak_s: 12, org_fomo: 0.3, org_size: 0.1, org_rebuy_pct: 5, org_panic: 0.7, org_tp: 1.5, org_flip_pct: 45, org_hold_s: 120, org_hawkes: 0.05, org_noise: 0.5, org_shock_rate: 0, org_whale_pct: 0, org_tail: 0, org_grad_fade: 1 },
  // real median launch: about 28 trades in 5 minutes, ~90% of them in the first minute
  verylow: { label: "Very low", org_n: 200, org_peak_rate: 0.3, org_peak_s: 15, org_fomo: 0.6, org_size: 0.12, org_rebuy_pct: 15, org_panic: 0.7, org_tp: 2, org_flip_pct: 40, org_hold_s: 240, org_hawkes: 0.15, org_noise: 0.9, org_shock_rate: 0.05, org_whale_pct: 0, org_tail: 0.01, org_grad_fade: 1 },
  // roughly the top 2% of coins: hundreds of trades in the first 5 minutes
  mid: { label: "Mid", org_n: 700, org_peak_rate: 0.35, org_peak_s: 260, org_fomo: 0.8, org_size: 0.25, org_rebuy_pct: 25, org_panic: 0.6, org_tp: 2.5, org_flip_pct: 30, org_hold_s: 600, org_hawkes: 0.3, org_noise: 0.6, org_shock_rate: 0.3, org_whale_pct: 1, org_tail: 0.12, org_grad_fade: 0.5 },
  // a real runner: organic graduates took a median 9.8 min and ~850 trades (Apr 2026); interest then drops off after the move to the pool
  bullish: { label: "Bullish", org_n: 1600, org_peak_rate: 0.9, org_peak_s: 1200, org_fomo: 0.7, org_size: 0.3, org_rebuy_pct: 35, org_panic: 0.5, org_tp: 4, org_flip_pct: 30, org_hold_s: 1200, org_hawkes: 0.3, org_noise: 0.5, org_shock_rate: 0.8, org_whale_pct: 3, org_tail: 0.15, org_grad_fade: 0.3 },
};
function organic(c, cfg, cx) {
  if (cfg.org_enabled && ORG_PRESETS[cfg.org_level]) Object.assign(cfg, preset(ORG_PRESETS, cfg.org_level));
  const r = c.rng, q = RNG(((c.seed || 1) * 2654435761) >>> 0), hot = Object.values(cx), pool = [];
  const make = live => {   // wallets: most funded from exchanges hours earlier with some trading history, some via a personal main wallet
    for (let i = 0; i < cfg.org_n; i++) {
      const w = c.wallet("organic"), amt = Math.min(30, r.lognorm(Math.log(2), 0.8));
      if (live) { c.send(r.choice(hot), w, amt) }
      else { const when = -sec(r.uniform(0.5, 48) * 3600);
        if (r.random() < 0.8) c.at(when, () => { c.send(r.choice(hot), w, amt); const n = r.randint(0, 20); for (let k = 0; k < n; k++) c.pad(w, r.uniform(0.02, 0.5)); });
        else { const main = c.wallet("organic_main"); c.at(when - sec(3600), () => c.send(r.choice(hot), main, amt + 1)); c.at(when, () => c.send(main, w, amt)); } }
      pool.push(w);
    }
  };
  if (cfg.org_enabled) make(false);
  const held = new Map(), hist = new Map();
  let start = cfg.org_enabled && cfg.org_start_mc_sol > 0 ? null : 0, excite = 0, noise = 0, shock = 0, onAt = cfg.org_enabled ? 0 : null, gradAt = null;
  return s => {
    hist.set(s, c.mc());
    if (!cfg.org_enabled) return;
    if (!pool.length) make(true);
    if (onAt === null) onAt = s;
    if (start === null && c.mc() >= cfg.org_start_mc_sol) start = s;
    if (s < 1 || start === null || !c.tradable()) return;
    const T = Math.max(1, cfg.org_peak_s), perSlot = cfg.org_peak_rate * SLOT_S, base = 1 / Math.max(1, sec(cfg.org_hold_s));
    const t = (s - Math.max(start, onAt)) * SLOT_S + SLOT_S, ref = hist.has(s - sec(30)) ? hist.get(s - sec(30)) : hist.get(0) || c.mc();
    const mom = Math.max(-0.9, Math.min(1.5, c.mc() / ref - 1));
    // noise: log-OU with a ~60 s memory; excitation decays over ~8 s; shocks decay over ~45 s
    noise += -noise * SLOT_S / 60 + cfg.org_noise * Math.sqrt(SLOT_S / 60) * q.gauss(0, 1);
    excite *= Math.exp(-SLOT_S / 8); shock *= Math.exp(-SLOT_S / 45);
    if (q.random() < cfg.org_shock_rate * SLOT_S / 60) shock += q.uniform(1.5, 6);
    const att = Math.max(cfg.org_tail || 0, (t / T) * Math.exp(1 - t / T));   // attention curve; org_tail keeps a long tail of late buyers
    // excitation: each buy adds org_hawkes expected follow-on buys spread over ~8 s (a branching ratio below 1, so flow clusters without running away)
    // after the move to the pool interest drops to org_grad_fade and fades further over ~10 min (most graduates lose 60% within 20 min)
    if (gradAt === null && c.complete) gradAt = s;
    const fade = gradAt === null || (cfg.org_grad_fade ?? 1) >= 1 ? 1 : cfg.org_grad_fade * Math.max(0.3, Math.exp(-(s - gradAt) * SLOT_S / 600));
    const lam = (perSlot * att * Math.max(0.2, 1 + cfg.org_fomo * mom) * Math.exp(noise) * (1 + shock) + excite * SLOT_S / 8) * fade;
    const n = poisson(r, lam);
    for (let i = 0; i < n; i++) {
      const w = held.size && r.random() < cfg.org_rebuy_pct / 100 ? r.choice([...held.keys()]) : r.choice(pool);
      const want = q.random() * 100 < cfg.org_whale_pct ? Math.min(30, q.lognorm(Math.log(8), 0.6)) : r.lognorm(Math.log(Math.max(0.01, cfg.org_size)), 0.9);
      const got = c.buy(w, Math.min(want, c.sol[w] * 0.8), "organic");
      if (got) { excite += cfg.org_hawkes; if (!held.has(w)) held.set(w, { entry: c.mc(), flip: r.random() < cfg.org_flip_pct / 100 ? s + sec(r.uniform(5, 60)) : null, tp: 0 }) }
    }
    for (const [w, h] of [...held]) {
      if (c.tok[w] <= 1) { held.delete(w); continue; }
      const ratio = c.mc() / h.entry;
      let p = base, part = q.random() < 0.5 ? 1 : q.random() < 0.6 ? 0.5 : 0.25;
      if (h.flip !== null && s >= h.flip) { p = 1; part = 1 }
      else if (ratio < cfg.org_panic) p = 1 / 40;
      else if (ratio > cfg.org_tp * (1 + h.tp)) { p = 1 / 60; part = 0.5; }   // take profit in steps
      if (r.random() < p) { if (c.sell(w, c.tok[w] * part, "organic") && ratio > cfg.org_tp) h.tp++ }
    }
  };
}
function copyTraders(c, cfg, cx) {
  const r = c.rng, hot = Object.values(cx), bots = [];
  for (let i = 0; i < cfg.ct_count; i++) {
    const b = c.wallet("copy");
    c.at(-sec(r.uniform(2, 72) * 3600), () => { c.send(r.choice(hot), b, r.uniform(5, 25)); for (let k = 0; k < 40; k++) c.pad(b, r.uniform(0.1, 1)); });
    bots.push(b);
  }
  if (!bots.length) return;
  const bset = new Set(bots), follows = new Map(), delay = Math.max(1, sec(cfg.ct_delay_s)), window = sec(cfg.ct_window_s);
  c.hooks.push(tx => {
    if (tx.mint !== MINT || bset.has(tx.signer)) return;
    const lead = tx.signer;
    if (tx.side === "buy" && tx.slot <= window && tx.sol >= cfg.ct_trigger_sol) {
      for (const b of bots) if (r.random() < cfg.ct_follow_pct / 100) {
        // most copy bots buy a fixed amount per copy; some copy a share of the leader's size
        const amt = cfg.ct_mode === "ratio" ? tx.sol * cfg.ct_ratio_pct / 100 : cfg.ct_fixed_sol * r.uniform(0.8, 1.2);
        c.at(c.slot + delay + r.randint(0, sec(0.8)), () => c.buy(b, amt, "copy_trade"));
        if (!follows.has(lead)) follows.set(lead, []); follows.get(lead).push(b);
      }
    } else if (tx.side === "sell" && cfg.ct_copy_sells && follows.has(lead)) {
      const before = c.tok[lead] + tx.tok, frac = before > 0 ? tx.tok / before : 1;
      for (const b of new Set(follows.get(lead))) c.at(c.slot + delay + r.randint(0, sec(0.8)), () => c.sellSoon(b, Math.min(1, frac + 0.05), "copy_trade"));
    }
  });
}

// ================================================================== runner
function simulate(cfg, seed = null) {
  cfg = normalise(cfg);
  const c = new Chain(seed === null ? cfg.seed : seed).setPad(cfg.launchpad);
  const cx = {}; for (const n of CEXES) cx[n] = c.exchange(n);
  const op = new Operator(c, cfg, cx);
  op.prepare(); op.scheduleLaunch();
  snipers(c, cfg, cx);
  const tick = organic(c, cfg, cx);
  copyTraders(c, cfg, cx);
  c.run(sec(cfg.duration_min * 60), [tick]);
  return { c, op, cfg };
}
function tradesOf(c) {
  return c.ledger.filter(t => t.kind === "swap" && t.mint === MINT).map(t => ({ t: t.slot * SLOT_S, slot: t.slot, idx: t.idx, wallet: t.signer, side: t.side, sol: t.sol, tok: t.tok, mc: t.mc, tool: t.tool }));
}
function runConfig(cfg, light = false) {
  const { c, op, cfg: n } = simulate(cfg), trades = tradesOf(c), dur = n.duration_min * 60;
  const out = { config: n, summary: summary(c, op, trades), candles: candles(trades, dur), holders: holdersOverTime(c, dur),
    report: report(c, trades), fingerprint: fingerprint(trades, dur), timeline: op.events };
  out.read = simRead(c, op, trades, out.report);
  if (!light) { out.markers = markers(trades); out.graph = fundingGraph(c, trades); }
  return out;
}
function features(cfg, seeds = [1, 2]) {
  const fps = seeds.map(s => { const { c, cfg: n } = simulate(cfg, s); return fingerprint(tradesOf(c), n.duration_min * 60); });
  const o = {}; for (const k of Object.keys(fps[0])) o[k] = sum(fps.map(f => f[k])) / fps.length; return o;
}

// ================================================================== analysis
const GROUPS = { op_dev: "dev", op_front: "front MEV", op_back: "back MEV", op_temp: "temp holders", op_holder: "holders (plan)", op_empty: "empty holders", op_volume: "volume wallets",
  sniper: "snipers", organic: "organic", copy: "copy-traders", streamflow: "Streamflow escrow", op_hop: "withdraw route", op_payout: "withdraw route" };
const grp = role => GROUPS[role] || "other";
const PUBLIC_HUBS = new Set(["cex", "jito_tip", "streamflow", "burn", "creator_vault"]);
const publicLabel = (c, a) => PUBLIC_HUBS.has(c.truth[a]) ? c.truth[a] : null;
const mean = a => sum(a) / a.length;
const pstdev = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const cv = xs => { xs = xs.filter(x => x != null); if (xs.length < 2) return null; const m = mean(xs); return m > 0 ? pstdev(xs) / m : null; };
const level = (x, med, high) => x >= high ? "high" : x >= med ? "med" : x > 0 ? "low" : "none";
const f1 = x => x.toFixed(1);

function summary(c, op, trades) {
  const price = c.mc() / SUPPLY, own = Object.keys(c.truth).filter(a => c.truth[a].startsWith("op_"));
  const isOp = t => c.truth[t.wallet].startsWith("op_");
  const spent = sum(trades.filter(t => t.side === "buy" && isOp(t)).map(t => t.sol)), recv = sum(trades.filter(t => t.side === "sell" && isOp(t)).map(t => t.sol));
  const opTok = sum(own.map(a => c.tok[a]));
  const by = {};
  for (const t of trades) { const g = grp(c.truth[t.wallet]); by[g] = (by[g] || 0) + (t.side === "sell" ? t.sol : -t.sol); }
  for (const a in c.truth) if ((c.tok[a] || 0) > 0) { const g = grp(c.truth[a]); by[g] = (by[g] || 0) + c.tok[a] * price; }
  const peak = c.mc_path.reduce((a, b) => b[1] > a[1] ? b : a, [0, c.lp.vs0 / c.lp.vt0 * SUPPLY]);   // never below the launch price, even with no trades
  return { final_mc_sol: c.mc(), peak_mc_sol: peak[1], peak_t: peak[0] * SLOT_S, graduated_t: c.migrated_slot !== null ? c.migrated_slot * SLOT_S : null,
    trades: trades.length, volume_sol: sum(trades.map(t => t.sol)),
    operator: { bought_sol: spent, sold_sol: recv, tokens_left_pct: opTok / SUPPLY * 100, proxima_fee_sol: 0.05 * recv, creator_fees_sol: c.creator_fees,
      pnl_sol: recv - spent + opTok * price - 0.05 * recv + c.creator_fees * 0.95 },
    pnl_by_group: by, plan: op.stats };
}
function candles(trades, duration, nTarget = 180) {
  const step = Math.max(1, Math.round(duration / nTarget)), out = new Map(); let prev = null;
  for (const t of trades) {
    const b = Math.floor(t.t / step), m = t.mc; let k = out.get(b);
    if (!k) { const o = prev !== null ? prev : m; k = { t: b * step, o, h: Math.max(o, m), l: Math.min(o, m), c: m, v: 0, tools: {} }; out.set(b, k); }
    k.h = Math.max(k.h, m); k.l = Math.min(k.l, m); k.c = m; k.v += t.sol; k.tools[t.tool] = (k.tools[t.tool] || 0) + t.sol; prev = m;
  }
  return { step, bars: [...out.keys()].sort((a, b) => a - b).map(b => out.get(b)) };
}
function markers(trades, cap = 5000) {
  const step = Math.max(1, Math.floor(trades.length / cap)), o = [];
  for (let i = 0; i < trades.length; i += step) { const t = trades[i]; o.push([+t.t.toFixed(1), +t.mc.toFixed(2), t.side[0], +t.sol.toFixed(3), t.tool, t.wallet.slice(0, 6)]); }
  return o;
}
function replayBalances(c, cb) {
  const bal = Object.create(null);
  for (const row of c.ledger) {
    if (row.kind === "swap" && row.mint === MINT) bal[row.signer] = (bal[row.signer] || 0) + (row.side === "buy" ? row.tok : -row.tok);
    else if (row.kind === "tokx" || row.kind === "stream" || row.kind === "claim" || row.kind === "lock") { bal[row.frm] = (bal[row.frm] || 0) - row.tok; bal[row.to] = (bal[row.to] || 0) + row.tok; }
    else if (row.kind === "burn") bal[row.frm] = (bal[row.frm] || 0) - row.tok;
    else continue;
    cb(row.slot * SLOT_S, bal);
  }
}
function holdersOverTime(c, duration, n = 150) {
  const step = Math.max(1, duration / n), snaps = [], peak = Object.create(null); let nxt = 0, last = null;
  const snap = (t, bal) => {
    const live = Object.entries(bal).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]), by = {};
    for (const [a, v] of live) { const g = grp(c.truth[a]); by[g] = (by[g] || 0) + v; }
    const groups = {}; for (const g in by) groups[g] = +(by[g] / SUPPLY * 100).toFixed(3);
    snaps.push({ t: +t.toFixed(1), holders: live.length, top10: sum(live.slice(0, 10).map(x => x[1])) / SUPPLY * 100, groups });
  };
  replayBalances(c, (t, bal) => {
    for (const a in bal) if (bal[a] > (peak[a] || 0)) peak[a] = bal[a];
    while (t >= nxt && nxt <= duration) { snap(nxt, bal); nxt += step; }
    last = bal;
  });
  let top = [];
  if (last) {
    while (nxt <= duration) { snap(nxt, last); nxt += step; }
    top = Object.entries(last).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([a, v]) => ({ wallet: a.slice(0, 6), pct: v / SUPPLY * 100, group: grp(c.truth[a]) }));
  }
  return { series: snaps, peak, top };
}
class UF { constructor() { this.p = new Map(); } find(a) { if (!this.p.has(a)) this.p.set(a, a); while (this.p.get(a) !== a) { this.p.set(a, this.p.get(this.p.get(a))); a = this.p.get(a); } return a; } union(a, b) { this.p.set(this.find(a), this.find(b)); } }
function linkClusters(c) {
  const uf = new UF();
  for (const row of c.ledger) if ((row.kind === "sol" || row.kind === "tokx") && !publicLabel(c, row.frm) && !publicLabel(c, row.to)) uf.union(row.frm, row.to);
  return uf;
}
function fundingGraph(c, trades, maxNodes = 900) {
  const traders = new Set(trades.map(t => t.wallet)), peak = holdersOverTime(c, 1, 1).peak;
  const inbound = new Map(), outbound = new Map();
  const isMove = k => k === "sol" || k === "tokx" || k === "stream" || k === "claim";
  for (const row of c.ledger) if (isMove(row.kind)) {
    if (!inbound.has(row.to)) inbound.set(row.to, []); inbound.get(row.to).push(row);
    if (!outbound.has(row.frm)) outbound.set(row.frm, []); outbound.get(row.frm).push(row);
  }
  const nodes = new Set(traders); let frontier = new Set(traders);
  for (let h = 0; h < 3; h++) {
    const nx = new Set();
    for (const a of frontier) { if (publicLabel(c, a)) continue; for (const row of inbound.get(a) || []) if (!nodes.has(row.frm)) nx.add(row.frm); }
    for (const a of nx) nodes.add(a); frontier = nx;
  }
  for (const a of [...nodes]) if (!publicLabel(c, a)) for (const row of outbound.get(a) || []) nodes.add(row.to);
  const uf = linkClusters(c), comp = new Map();
  for (const a of nodes) if (!publicLabel(c, a)) { const r0 = uf.find(a); if (!comp.has(r0)) comp.set(r0, new Set()); comp.get(r0).add(a); }
  const clusterId = new Map(); let k = 0;
  for (const members of [...comp.values()].sort((x, y) => [...y].filter(a => traders.has(a)).length - [...x].filter(a => traders.has(a)).length))
    if ([...members].filter(a => traders.has(a)).length >= 2) { k++; for (const a of members) clusterId.set(a, k); }
  if (nodes.size > maxNodes) {
    const drop = [...nodes].filter(a => !clusterId.has(a) && !publicLabel(c, a)).sort((x, y) => (peak[x] || 0) - (peak[y] || 0));
    for (const a of drop.slice(0, nodes.size - maxNodes)) nodes.delete(a);
  }
  const edges = new Map();
  for (const row of c.ledger) if (isMove(row.kind) && nodes.has(row.frm) && nodes.has(row.to)) {
    const key = row.frm + "|" + row.to + "|" + (row.kind === "sol" ? "sol" : "tok");
    const e = edges.get(key) || [0, 0]; e[0] += row.sol || row.tok || 0; e[1]++; edges.set(key, e);
  }
  return {
    nodes: [...nodes].map(a => ({ id: a, label: c.cex_name[a] || publicLabel(c, a) || a.slice(0, 6), hub: !!publicLabel(c, a), trader: traders.has(a),
      size: (peak[a] || 0) / SUPPLY * 100, cluster: clusterId.get(a) || 0, truth: GROUPS[c.truth[a]] ? grp(c.truth[a]) : (c.truth[a] || "") })),
    edges: [...edges].map(([key, v]) => { const [f, t, typ] = key.split("|"); return [f, t, typ, +v[0].toFixed(4), v[1]]; }),
  };
}

// ---- trade-only pattern helpers (report + fingerprint)
const slotOf = t => t.slot != null ? t.slot : Math.round(t.t / SLOT_S);
function gridRun(times) {
  let best = null;
  for (let i = 0; i < times.length; i++) for (let j = i + 1; j < Math.min(i + 12, times.length); j++) {
    const g = times[j] - times[i]; if (g < 0.8) continue;
    let n = 2, nxt = times[j] + g, k = j + 1;
    while (k < times.length && times[k] <= nxt + 0.25) {
      if (Math.abs(times[k] - nxt) <= 0.25 && (k + 1 >= times.length || Math.abs(times[k + 1] - nxt) > Math.abs(times[k] - nxt))) { n++; nxt += g; }
      k++;
    }
    if (n >= 6) {
      const span = times.filter(x => times[i] <= x && x <= nxt).length, lam = span / Math.max(1, nxt - times[i]), p = 1 - Math.exp(-lam * 0.5);
      const chance = (n - 2) * Math.log10(Math.max(p, 1e-12)) + Math.log10(times.length * 11);
      if (chance < -2 && (!best || n > best[0])) best = [n, g, chance, times[i]];
    }
  }
  return best;
}
function counterPeak(trades, trig, resp) {
  const key = "sol", idx = new Map();   // responses are sized by the observed trade's SOL (the tool's Replication Factor)
  for (const t of trades) { const s = slotOf(t); if (!idx.has(s)) idx.set(s, []); idx.get(s).push(t); }
  const bins = new Map(), who = new Map();
  for (const t of trades) {
    if (t.side !== trig || t.sol < 0.05 || !(t[key] > 0)) continue;
    const s0 = slotOf(t);
    for (const s of [s0 + 1, s0 + 2, s0 + 3]) for (const u of idx.get(s) || []) if (u.side === resp && u.wallet !== t.wallet) {
      const r = u[key] / t[key];
      if (r >= 0.01 && r <= 10) { const b = Math.round(Math.log(r) / Math.log(1.02)); bins.set(b, (bins.get(b) || 0) + 1); if (!who.has(b)) who.set(b, new Set()); who.get(b).add(u.wallet); }
    }
  }
  if (!bins.size) return null;
  const g = b => bins.get(b) || 0;
  const score = b => { const pk = g(b) + g(b - 1) + g(b + 1), side = []; for (let x = b - 20; x <= b + 20; x++) if (Math.abs(x - b) > 2) side.push(g(x)); const base = 3 * sum(side) / side.length; return [(pk - base) / Math.sqrt(base + 1), pk, base]; };
  const lo = Math.log(0.02) / Math.log(1.02), hi = Math.log(4) / Math.log(1.02), cand = [...bins.keys()].filter(b => b >= lo && b <= hi);
  if (!cand.length) return null;
  const best = cand.reduce((a, b) => score(b)[0] > score(a)[0] ? b : a), [z, pk, base] = score(best);
  const ws = new Set([...(who.get(best) || []), ...(who.get(best - 1) || []), ...(who.get(best + 1) || [])]);
  return { ratio: 1.02 ** best, n: pk, z, base, detected: pk >= 20 && z >= 6, wallets: ws.size, ws: [...(who.get(best) || [])].sort() };
}
function roundTrips(trades) {
  const per = new Map(); for (const t of trades) { if (!per.has(t.wallet)) per.set(t.wallet, []); per.get(t.wallet).push(t); }
  const out = new Map();
  for (const [w, ts] of per) {
    const open = []; let n = 0, same = 0;
    for (const t of ts) {
      if (t.side === "buy") open.push(t);
      else { const i = open.findIndex(b => b.tok && Math.abs(b.tok - t.tok) <= 0.005 * b.tok); if (i >= 0) { const hit = open.splice(i, 1)[0]; n++; same += slotOf(hit) === slotOf(t) ? 1 : 0; } }
    }
    if (n) out.set(w, [n, same]);
  }
  return out;
}
function sellThenFreshBuy(trades) {
  const bySlot = new Map(), first = new Map(); let n = 0;
  for (const t of trades) { const s = slotOf(t); if (!bySlot.has(s)) bySlot.set(s, []); bySlot.get(s).push(t); if (!first.has(t.wallet)) first.set(t.wallet, t); }
  for (const ts of bySlot.values()) ts.forEach((t, i) => {
    if (t.side !== "sell" || t.sol < 0.05) return;
    const buys = ts.slice(i + 1).filter(u => u.side === "buy" && first.get(u.wallet) === u);
    const tot = sum(buys.slice(0, 3).map(u => u.sol));
    if (buys.length && tot / t.sol >= 0.8 && tot / t.sol <= 1.05) n++;
  });
  return n;
}

function report(c, trades) {
  const sig = [], traders = new Set(trades.map(t => t.wallet)), firstTrade = new Map();
  for (const t of trades) if (!firstTrade.has(t.wallet)) firstTrade.set(t.wallet, t);
  const history = new Map(), firstIn = new Map(), bySlot = new Map();
  for (const row of c.ledger) {
    if (row.kind === "swap" && row.mint === "OTHER" && row.slot < 0) history.set(row.signer, (history.get(row.signer) || 0) + 1);
    if (row.kind === "sol" && !firstIn.has(row.to)) firstIn.set(row.to, row);
    if (row.slot >= 0) { if (!bySlot.has(row.slot)) bySlot.set(row.slot, []); bySlot.get(row.slot).push(row); }
  }
  // 1 same-block buys
  const d0 = trades.filter(t => t.slot === 0 && t.side === "buy"), d0s = sum(d0.map(t => t.tok)) / SUPPLY * 100, busy = [];
  for (let s = 1; s < sec(60); s++) {
    const fresh = new Set((bySlot.get(s) || []).filter(t => t.kind === "swap" && t.mint === MINT && t.side === "buy" && firstTrade.get(t.signer).slot === s).map(t => t.signer));
    if (fresh.size >= 3) busy.push([s, fresh.size]);
  }
  sig.push({ id: "same_block", name: "Same-block buys", level: level(d0s, 5, 20),
    value: `${new Set(d0.map(t => t.wallet)).size} wallets bought ${f1(d0s)}% of supply in the deploy block`,
    detail: `${busy.length} later blocks in the first minute had 3+ first-time buyers together`, evidence: busy.slice(0, 8).map(([s, n]) => `slot ${s}: ${n} new buyers`) });
  // 2 common funding
  const uf = linkClusters(c), comp = new Map();
  for (const a of traders) { const r0 = uf.find(a); if (!comp.has(r0)) comp.set(r0, new Set()); comp.get(r0).add(a); }
  const clusters = [...comp.values()].filter(m => m.size >= 2);
  let peakShare = 0;
  if (clusters.length) { const cl = []; clusters.forEach(m => cl.push(...m)); replayBalances(c, (t, bal) => { let s = 0; for (const a of cl) s += bal[a] || 0; peakShare = Math.max(peakShare, s / SUPPLY * 100); }); }
  const fan = new Map();
  for (const row of c.ledger) if (row.kind === "sol" && traders.has(row.to) && !publicLabel(c, row.frm)) { if (!fan.has(row.frm)) fan.set(row.frm, []); fan.get(row.frm).push(row); }
  const fanOut = [...fan].filter(([, rows]) => new Set(rows.map(r => r.to)).size >= 3), grid = [];
  for (const [f, rows] of fanOut) { const gaps = rows.slice(1).map((b, i) => b.slot - rows[i].slot), v = cv(gaps); if (v !== null) grid.push([f, rows.length, v, mean(gaps) * SLOT_S / 60]); }
  const biggest = Math.max(0, ...clusters.map(m => m.size));
  sig.push({ id: "common_funding", name: "Common funding (non-exchange links)", level: level(Math.max(peakShare, 0.01 * biggest), 2, 10),
    value: `${clusters.length} linked clusters, largest has ${biggest} traders; clustered wallets peaked at ${f1(peakShare)}% of supply`,
    detail: `${fanOut.length} wallets funded 3+ traders directly`,
    evidence: [...grid.slice(0, 6).map(([f, n, v, gm]) => `${f.slice(0, 6)} funded ${n} traders, gaps ${f1(gm)} min, regularity CV ${v.toFixed(2)}`),
      ...clusters.sort((a, b) => b.size - a.size).slice(0, 4).map(m => `cluster of ${m.size} traders: ${[...m].map(a => a.slice(0, 6)).sort().slice(0, 6).join(", ")}`)] });
  // 3 CEX funding
  const cexFirst = new Map();
  for (const a of traders) if (firstIn.has(a) && publicLabel(c, firstIn.get(a).frm) === "cex") cexFirst.set(a, firstIn.get(a).frm);
  const early = [...traders].filter(a => firstTrade.get(a).t <= 60), earlyCex = early.filter(a => cexFirst.has(a));
  const freshEarly = early.filter(a => firstIn.has(a) && firstIn.get(a).slot > -Math.trunc(24 * 3600 / SLOT_S) && (history.get(a) || 0) < 5);
  const amtGroups = new Map(), byEx = {};
  for (const [a, hot] of cexFirst) { const key = hot + "|" + Math.round(Math.log(Math.max(firstIn.get(a).sol, 1e-9)) * 50); amtGroups.set(key, (amtGroups.get(key) || 0) + 1); byEx[c.cex_name[hot]] = (byEx[c.cex_name[hot]] || 0) + 1; }
  const sameAmt = [...amtGroups.values()].filter(n => n >= 3).length;
  sig.push({ id: "cex_funding", name: "CEX funding sources", level: level(freshEarly.length / Math.max(1, early.length) * 100, 15, 35),
    value: `${cexFirst.size} of ${traders.size} traders first funded from an exchange; early buyers (first 60 s): ${earlyCex.length} of ${early.length}`,
    detail: `${freshEarly.length} early buyers were funded <24 h before launch with little history; ${sameAmt} groups of 3+ near-equal exchange withdrawals`,
    evidence: Object.entries(byEx).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v} traders`) });
  // 4 timing
  const firsts = [...firstTrade.values()].filter(t => t.side === "buy" && t.slot > 0 && t.slot <= sec(600)).sort((a, b) => a.slot - b.slot || a.idx - b.idx);
  const best = gridRun(firsts.map(t => t.t));
  sig.push({ id: "timing", name: "Buy-timing regularity", level: best && best[0] >= 10 ? "high" : best ? "med" : "none",
    value: best ? `${best[0]} first-time buys land on a ${f1(best[1])} s grid from +${Math.round(best[3])} s (chance ~1 in ${Math.round(10 ** -best[2]).toLocaleString()})` : "No run of 6+ first-time buys on a fixed time grid",
    detail: "Organic arrivals are bursty (CV ~1). A steady interval points to a scheduled Buy Delay.", evidence: [] });
  // 5 equal pairs
  const per = new Map(); for (const t of trades) { if (!per.has(t.wallet)) per.set(t.wallet, []); per.get(t.wallet).push(t); }
  const linkedN = new Map(); for (const a of traders) { const r0 = uf.find(a); linkedN.set(r0, (linkedN.get(r0) || 0) + 1); }
  let pairs = 0, sameSlot = 0, pairWallets = 0, repVol = 0; const ev = [];
  for (const [w, ts] of per) {
    const open = []; let n = 0;
    for (const t of ts) {
      if (t.side === "buy") open.push(t);
      else { const i = open.findIndex(b => Math.abs(b.tok - t.tok) <= 0.005 * b.tok); if (i >= 0) { const hit = open.splice(i, 1)[0]; n++; sameSlot += hit.slot === t.slot ? 1 : 0; } }
    }
    pairs += n;
    if (n >= 3 && linkedN.get(uf.find(w)) >= 2) { pairWallets++; repVol += sum(ts.map(t => t.sol)); ev.push(`${w.slice(0, 6)}: ${n} matched round trips`); }
  }
  const vol = sum(trades.map(t => t.sol)) || 1;
  sig.push({ id: "equal_pairs", name: "Equal-size buy/sell pairs", level: pairWallets || sameSlot >= 2 ? level(repVol / vol * 100, 0.5, 2) : "none",
    value: `${pairWallets} linked wallets did 3+ matched round trips (${f1(repVol / vol * 100)}% of volume); ${sameSlot} pairs inside one block; ${pairs} matched pairs in total`,
    detail: "Buying then selling everything is normal, so an honest flipper can look the same. Counted only for wallets linked to other traders by funding, or pairs inside one block.",
    evidence: ev.slice(0, 8) });
  // 6 counter trades
  const det = (a, b) => { const x = counterPeak(trades, a, b); return x && x.detected ? x : null; };
  const ab = det("sell", "buy"), as_ = det("buy", "sell"), ev2 = [];
  for (const [x, what] of [[ab, "buys after outside sells"], [as_, "sells after outside buys"]]) if (x) {
    ev2.push(`${x.n} ${what} at ${Math.round(x.ratio * 100)}% of the trigger size from ${x.wallets} wallets (chance level ~${Math.round(x.base)})`);
    ev2.push(...x.ws.slice(0, 4).map(w => `${w.slice(0, 6)} responder`));
  }
  const nResp = (ab ? ab.n : 0) + (as_ ? as_.n : 0);
  sig.push({ id: "counter", name: "Counter-trade responses", level: level(nResp, 8, 25),
    value: `Counter-buys: ${ab ? `~${Math.round(ab.ratio * 100)}% replication, ${ab.n} responses` : "none"}; counter-sells: ${as_ ? `~${Math.round(as_.ratio * 100)}% replication, ${as_.n} responses` : "none"}`,
    detail: "The ratio estimates the Replication Factor.", evidence: ev2 });
  // 7 cleanup
  let rounds = 0, moved = 0, doubles = 0;
  for (const txs of bySlot.values()) txs.forEach((t, i) => {
    if (t.kind !== "swap" || t.mint !== MINT || t.side !== "sell") return;
    const pay = txs.slice(i + 1, i + 3).find(p => p.kind === "sol" && p.frm === t.signer);
    if (!pay) return;
    const buyers = new Set();
    for (const p of txs.slice(i + 2)) if (p.kind === "sol" && p.frm === pay.to && txs.some(q => q.kind === "swap" && q.mint === MINT && q.side === "buy" && q.signer === p.to && q.idx > p.idx)) buyers.add(p.to);
    if (buyers.size) { rounds++; moved += t.tok; doubles += buyers.size >= 2 ? 1 : 0; }
  });
  const tokx = c.ledger.filter(r => (r.kind === "tokx" || r.kind === "claim") && !publicLabel(c, r.to)), tokMoved = sum(tokx.map(r => r.tok));
  sig.push({ id: "cleanup", name: "Supply moving between wallets (Cleanup)", level: level((moved + tokMoved) / SUPPLY * 100, 2, 10),
    value: `${rounds} sell -> relay -> buy rounds moved ${f1(moved / SUPPLY * 100)}% (${doubles} with 2+ buyers); ${tokx.length} direct token transfers/claims moved ${f1(tokMoved / SUPPLY * 100)}%`,
    detail: "A sell whose SOL pays for a different wallet's buy in the same block links seller and buyer.", evidence: [] });
  // 8 tips
  const tips = c.ledger.filter(r => r.kind === "sol" && publicLabel(c, r.to) === "jito_tip" && r.slot >= 0);
  sig.push({ id: "tips", name: "Jito-tipped bundles", level: level(tips.length, 1, 10), value: `${tips.length} tips from ${new Set(tips.map(r => r.frm)).size} wallets`,
    detail: "Tipped same-block buy+sell is Volume Bot Bundle mode; a tip at deploy is the Block-0 bundle.", evidence: [] });
  // 9 consolidation (shared with real-data imports): see sweepSignal
  sig.push(sweepSignal(c.ledger.filter(r => r.kind === "sol" && r.slot >= 0).map(r => ({ k: r.slot, t: r.slot * SLOT_S, from: r.frm, to: r.to, sol: r.sol })), traders, a => !!publicLabel(c, a)));
  return sig;
}

// Many trading wallets emptying SOL into one non-exchange address in a single block (the tool's withdraw); if that
// address passes >=90% on afterwards, it was a hop. Rows: { k: block key (slot), t: seconds, from, to, sol }.
// Ledger-only: used on simulated ledgers and on imported transfer CSVs alike.
function sweepSignal(rows, traders, isPublic = () => false) {
  const sinks = new Map();
  for (const r of rows) if (traders.has(r.from) && !traders.has(r.to) && !isPublic(r.to)) {
    const key = r.k + "|" + r.to; let g = sinks.get(key); if (!g) sinks.set(key, g = { k: r.k, t: r.t, to: r.to, from: new Set(), sol: 0 }); g.from.add(r.from); g.sol += r.sol;
  }
  // < 0.01 SOL per sender is a fee or tip riding along in the same txs, not where the money went
  const sweeps = [...sinks.values()].filter(g => g.from.size >= 3 && g.sol / g.from.size >= 0.01).sort((x, y) => y.from.size - x.from.size);
  const swept = new Set(sweeps.flatMap(g => [...g.from])), top = sweeps[0];
  const hop = top && rows.find(r => r.from === top.to && r.k > top.k && r.sol >= 0.9 * top.sol);
  return { id: "consolidation", name: "Wallets swept into one address", level: level(swept.size, 3, 8),
    value: top ? `${swept.size} trading wallets in ${sweeps.length} sweep${sweeps.length > 1 ? "s" : ""}; largest ${top.from.size} wallets, ${top.sol.toFixed(1)} SOL${hop ? `, forwarded ${Math.max(0, hop.t - top.t).toFixed(0)} s later (hop)` : ""}` : "none",
    detail: "A same-block sweep from many trading wallets to one non-exchange address links them all; a quick onward transfer marks that address as a hop.",
    evidence: top ? [top.to] : [], swept: [...swept] };
}

// ---- chart reading (sim and imported data): which wallets look coordinated, and what they did to the chart over time.
// Trades only (+ optional funding links / sweep), so a real launch gets exactly the same read as a simulated one.
// o.links: wallet -> cluster key; o.sweep: { t, text }; o.truthSeries: t -> true operator tokens (sim only, the answer key).
const FLAG_ORDER = ["bundle", "linked", "burst", "grid", "counter", "roundtrip"];
const FLAG_INFO = { bundle: "bought in the deploy block", linked: "funded from the same source as a flagged wallet", burst: "first buy in a block with 3+ other first-time buyers",
  grid: "first buy landed on a fixed time grid", counter: "answered outside trades at a fixed ratio within 2 blocks", roundtrip: "3+ equal-size buy/sell round trips" };
function readChart(trades, o = {}) {
  if (!trades.length) return null;
  const flags = new Map(), add = (w, f) => { if (!flags.has(w)) flags.set(w, new Set()); flags.get(w).add(f); };
  const first = new Map(); for (const t of trades) if (!first.has(t.wallet)) first.set(t.wallet, t);
  let s0 = Infinity; for (const t of trades) s0 = Math.min(s0, slotOf(t));
  const marks = [], T0 = trades[0].t;
  // deploy block (+1 for bundles that spill a slot)
  // the creation block only: a Block-0 bundle lands there; snipers a block later are not the team (money links can still add them)
  const b0 = trades.filter(t => t.side === "buy" && slotOf(t) <= s0 && first.get(t.wallet) === t);
  b0.forEach(t => add(t.wallet, "bundle"));
  if (b0.length) marks.push({ t: b0[0].t, kind: "bundle", label: "Bought at launch", text: `${b0.length} wallets bought ${f1(sum(b0.map(t => t.tok)) / SUPPLY * 100)}% of the coin for ${f1(sum(b0.map(t => t.sol)))} SOL in the moment it was created. Nobody outside can see a coin before it exists, so these buys were set up in advance` });
  // bursts of first-time buyers sharing a block
  const fresh = new Map();
  for (const t of first.values()) if (t.side === "buy" && slotOf(t) > s0 + 1 && t.t - T0 <= 600) { const s = slotOf(t); if (!fresh.has(s)) fresh.set(s, []); fresh.get(s).push(t); }
  for (const [, ts] of [...fresh].sort((a, b) => a[0] - b[0])) if (ts.length >= 3) {
    ts.forEach(t => add(t.wallet, "burst"));
    marks.push({ t: ts[0].t, kind: "burst", label: "Bought together", text: `${ts.length} new wallets made their first buy in the same block (0.2 s) (${f1(sum(ts.map(t => t.sol)))} SOL). Real people rarely arrive together; this is usually one script` });
  }
  // first buys on a fixed grid (scheduled Buy Delay)
  const firsts = [...first.values()].filter(t => t.side === "buy" && slotOf(t) > s0 && t.t - T0 <= 600).sort((a, b) => a.t - b.t), g = gridRun(firsts.map(t => t.t));
  if (g) {
    const [n, gap, , start] = g, hit = []; let nxt = start;
    for (const t of firsts) { if (t.t < start - 0.25) continue; if (hit.length >= n) break; if (Math.abs(t.t - nxt) <= 0.25) { hit.push(t); nxt += gap; } else if (t.t > nxt + 0.25) break; }
    hit.forEach(t => add(t.wallet, "grid"));
    marks.push({ t: start, t1: start + gap * (n - 1), kind: "grid", label: "Buys on a timer", text: `${n} new wallets bought exactly ${f1(gap)} s apart. People arrive randomly; a steady beat is a bot (a scheduled buy delay)` });
  }
  // counter trades and round trips
  for (const [trig, resp] of [["sell", "buy"], ["buy", "sell"]]) { const x = counterPeak(trades, trig, resp); if (x && x.detected) x.ws.forEach(w => add(w, "counter")); }
  for (const [w, [n, same]] of roundTrips(trades)) if (n >= 3 || same >= 1) add(w, "roundtrip");
  // funding links spread the bundle flag to the whole cluster (holders funded by the same relays, Cleanup outputs, ...)
  if (o.links) {
    const byKey = new Map(); for (const w of first.keys()) { const k = o.links.get(w); if (k == null) continue; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(w); }
    for (const ws of byKey.values()) if (ws.length >= 2 && ws.some(w => flags.has(w) && flags.get(w).has("bundle"))) ws.forEach(w => add(w, "linked"));   // only the bundle's links spread
  }
  const cls = w => { const f = flags.get(w); return f ? FLAG_ORDER.find(k => f.has(k)) : null; };
  // two groups: launch insiders (the deploy-block bundle and everything linked to it) vs other coordinated wallets (sniper and bot
  // clusters that coordinate among themselves). Without links (trades-only import) insiders are just the bundle wallets.
  const key = w => (o.links && o.links.get(w) != null ? o.links.get(w) : w), inKeys = new Set(b0.map(t => key(t.wallet)));
  const group = w => !flags.has(w) ? "other" : inKeys.has(key(w)) ? "insider" : "bot";
  // time series: flagged vs other volume, supply the flagged wallets hold, new buyers
  const dur = Math.max(10, trades[trades.length - 1].t - T0), step = Math.max(0.4, dur / 240), n = Math.floor(dur / step) + 1;
  // per bucket: volume by group (i insider, b bot, o other) and side; supply each flagged group holds; new buyers
  const S = Array.from({ length: n }, (_, i) => ({ t: T0 + i * step, ib: 0, is: 0, bb: 0, bs: 0, ob: 0, os: 0, held: 0, bheld: 0, truth: null, newb: 0, newf: 0 }));
  const bal = new Map(), H = { insider: 0, bot: 0 }, sells = []; let k = 0;
  const fill = i => { while (k < i) { S[k].held = H.insider; S[k].bheld = H.bot; k++; } };
  for (const t of trades) {
    const i = Math.min(n - 1, Math.floor((t.t - T0) / step)); fill(i);
    const gr = group(t.wallet), b = S[i];
    if (gr !== "other") { const before = bal.get(t.wallet) || 0, after = Math.max(0, before + (t.side === "buy" ? t.tok : -t.tok)); H[gr] += after - before; bal.set(t.wallet, after); }
    b[gr[0] + (t.side === "buy" ? "b" : "s")] += t.sol;
    if (first.get(t.wallet) === t && t.side === "buy") { b.newb++; if (gr !== "other") b.newf++; }
    if (gr === "insider" && t.side === "sell" && t.tok >= 0.005 * SUPPLY) {   // insider sells within 10 s of each other share one mark
      const m = sells[sells.length - 1];
      if (m && t.t - m.last <= 10) { m.n++; m.tok += t.tok; m.sol += t.sol; m.w.add(t.wallet); m.last = t.t; } else sells.push({ t: t.t, last: t.t, n: 1, tok: t.tok, sol: t.sol, w: new Set([t.wallet]) });
    }
  }
  fill(n); S[n - 1].held = H.insider; S[n - 1].bheld = H.bot;
  for (const m of sells) if (m.tok >= 0.01 * SUPPLY) marks.push({ t: m.t, t1: m.last, kind: "sell", label: "Team sold",
    text: `${m.w.size} suspected-team wallet${m.w.size > 1 ? "s" : ""} sold ${f1(m.tok / SUPPLY * 100)}% of supply for ${f1(m.sol)} SOL${m.n > 1 ? ` in ${m.n} sells over ${Math.max(1, Math.round(m.last - m.t))} s` : ""}` });
  for (const b of S) { b.held = b.held / SUPPLY * 100; b.bheld = b.bheld / SUPPLY * 100; if (o.truthSeries) b.truth = o.truthSeries(b.t + step) / SUPPLY * 100; }
  // phases, on ~30 s windows; same-kind phases less than a window apart merge
  const W = Math.max(1, Math.round(30 / step)), phases = [];
  const push = (kind, a, b, drop = 0) => {
    const last = phases[phases.length - 1], prev = phases[phases.length - 2];
    if (last && last.kind === kind && a - last.t1 <= step * W + 1e-6) { last.t1 = b; last.drop += drop; return; }
    if (prev && prev.kind === kind && last.t1 - last.t0 <= step * W + 1e-6 && kind !== "bundle") { phases.pop(); prev.t1 = b; prev.drop += drop; return; }   // absorb a short blip
    phases.push({ kind, t0: a, t1: b, drop });
  };
  let bEnd = T0; for (const [w, f] of flags) if (f.has("bundle") || (f.has("burst") && first.get(w).t - T0 <= 30)) bEnd = Math.max(bEnd, first.get(w).t);   // the bundle phase is the opening burst only
  if (b0.length) phases.push({ kind: "bundle", t0: T0, t1: Math.max(bEnd, T0 + step), drop: 0 });
  for (let i = 0; i < n; i += W) {
    const z = S[Math.min(n - 1, i + W - 1)], ta = S[i].t, tb = z.t + step; if (tb <= bEnd) continue;
    const dh = z.held - (i ? S[i - 1].held : 0), win = S.slice(i, i + W);
    const fb = sum(win.map(x => x.ib + x.bb)), fs = sum(win.map(x => x.is + x.bs)), ov = sum(win.map(x => x.ob + x.os)), fv = fb + fs;
    if (dh <= -0.5) push("exit", Math.max(ta, bEnd), tb, -dh);
    else if (dh >= 0.5) push("accumulate", Math.max(ta, bEnd), tb);
    else if (fv > 0.2 && fv / (fv + ov) >= 0.6 && Math.min(fb, fs) / Math.max(fb, fs) >= 0.5) push("wash", Math.max(ta, bEnd), tb);
  }
  for (const p of phases) if (p.kind === "exit" && p.drop >= 10 && p.t1 - p.t0 <= 120) p.kind = "dump";
  if (o.sweep) marks.push({ t: o.sweep.t, kind: "sweep", label: "Money collected", text: "Many wallets sent their SOL to one address at once: " + o.sweep.text });
  const wallets = {}; for (const [w, f] of flags) wallets[w] = [cls(w), [...f], group(w)];
  const insiders = Object.values(wallets).filter(x => x[2] === "insider").length;
  return { step, series: S, marks: marks.sort((a, b) => a.t - b.t).slice(0, 400), phases, wallets, flagged: flags.size, insiders, bots: flags.size - insiders, traders: first.size, linked: !!o.links,
    held_now: S[n - 1].held, held_peak: Math.max(...S.map(b => b.held)), truth_now: S[n - 1].truth, info: FLAG_INFO };
}
// Funding links from a plain transfers list (imports). A sender counts as a private funder only when most of what it sent went to
// this token's traders; exchange hot wallets and routers send mostly elsewhere, so they don't glue unrelated buyers together.
function transferLinks(rows, traders) {
  const out = new Map(); for (const r of rows) { if (!out.has(r.from)) out.set(r.from, new Set()); out.get(r.from).add(r.to); }
  const uf = new UF();
  for (const [f, tos] of out) { const tr = [...tos].filter(a => traders.has(a)); if (tr.length >= 2 && tr.length >= 0.6 * tos.size) tr.forEach(a => uf.union(f, a)); }
  for (const r of rows) if (traders.has(r.from) && traders.has(r.to)) uf.union(r.from, r.to);
  const m = new Map(); for (const a of traders) m.set(a, uf.find(a)); return m;
}
// The same read on a simulated launch, plus the answer key: true operator holdings and how many operator wallets the read caught.
function simRead(c, op, trades, rep) {
  const uf = linkClusters(c), links = new Map(); for (const t of trades) if (!links.has(t.wallet)) links.set(t.wallet, uf.find(t.wallet));
  const sw = (rep || []).find(s => s.id === "consolidation"); let sweep = null;
  if (sw && sw.level !== "none" && sw.swept && sw.swept.length) {
    const set = new Set(sw.swept), row = c.ledger.find(r => r.kind === "sol" && r.slot >= 0 && set.has(r.frm) && !set.has(r.to) && !PUBLIC_HUBS.has(c.truth[r.to]));
    if (row) sweep = { t: row.slot * SLOT_S, text: sw.value };
  }
  const pts = [], ob = Object.create(null); let tot = 0;
  const mv = (a, d) => { if (!op.own(a)) return; const b = ob[a] || 0, x = Math.max(0, b + d); tot += x - b; ob[a] = x; };
  for (const row of c.ledger) {
    if (row.kind === "swap" && row.mint === MINT) mv(row.signer, row.side === "buy" ? row.tok : -row.tok);
    else if (["tokx", "stream", "claim", "lock"].includes(row.kind)) { mv(row.frm, -row.tok); mv(row.to, row.tok); }
    else if (row.kind === "burn") mv(row.frm, -row.tok);
    else continue;
    pts.push([row.slot * SLOT_S, tot]);
  }
  const truthSeries = t => { let lo = 0, hi = pts.length - 1, v = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m][0] < t) { v = pts[m][1]; lo = m + 1; } else hi = m - 1; } return v; };
  const r = readChart(trades, { links, sweep, truthSeries });
  if (r) {
    const own = new Set(trades.filter(t => op.own(t.wallet)).map(t => t.wallet)), ins = Object.keys(r.wallets).filter(w => r.wallets[w][2] === "insider");
    r.answer = { operator_traders: own.size, caught: ins.filter(w => own.has(w)).length, false_flags: ins.filter(w => !own.has(w)).length,
      missed_as_bot: Object.keys(r.wallets).filter(w => r.wallets[w][2] === "bot" && own.has(w)).length };
  }
  return r;
}

// ---- fingerprint (sim and imported data)
const TIMES = [10, 30, 60, 120, 300, 600, 900, 1200, 1800];
const SCALE = { b0_supply: 10, b0_buyers: 3, early_supply: 10, lpeak: 0.5, ltpeak: 0.8, end_ratio: 0.6, buy_frac: 0.2, pair_frac: 0.05, same_sec_pairs: 0.05,
  lwallets: 0.5, top10_60: 10, top10_300: 10, top10_900: 10, lgrad: 0.5, grid: 0.15, bundle_pairs: 0.15, rt_wallets: 0.15, cb_z: 0.3, cs_z: 0.3, cb_ratio: 0.15,
  cs_ratio: 0.15, buyback: 0.2, fresh_10s: 0.2 };
for (const t of TIMES) SCALE["lmc_" + t] = 0.5;
for (let i = 0; i < 4; i++) SCALE["tpm_" + i] = 0.6;
const FEATURE_LABELS = { b0_supply: "% supply bought in first second", b0_buyers: "buyers in first second", early_supply: "net % bought in first 10 s",
  lpeak: "log peak MC", ltpeak: "log time of peak", end_ratio: "log end / peak MC", buy_frac: "share of trades that are buys", pair_frac: "matched pairs per trade",
  same_sec_pairs: "same-second round trips per trade", lwallets: "log wallets", top10_60: "top-10 % at 1 min", top10_300: "top-10 % at 5 min",
  top10_900: "top-10 % at 15 min", lgrad: "log time to graduation", grid: "log scheduled-buy grid length", bundle_pairs: "log same-block round trips",
  rt_wallets: "log wallets with 3+ round trips", cb_z: "counter-buy strength", cs_z: "counter-sell strength", cb_ratio: "log counter-buy ratio",
  cs_ratio: "log counter-sell ratio", buyback: "log sell-then-fresh-buy rounds", fresh_10s: "log first-time buyers in 10 s" };

function fingerprint(trades, duration) {
  trades = trades.slice().sort((a, b) => a.t - b.t);
  const f = {};
  if (!trades.length) { for (const k in SCALE) f[k] = 0; return f; }
  const mcs = [];
  for (const t of trades) { const p = t.mc || (t.tok ? t.sol / t.tok * SUPPLY : null); if (p) mcs.push([t.t, p]); }
  const first = trades.filter(t => t.t < 1 && t.side === "buy");
  f.b0_supply = sum(first.map(t => t.tok)) / SUPPLY * 100;
  f.b0_buyers = new Set(first.map(t => t.wallet)).size;
  f.early_supply = sum(trades.filter(t => t.t <= 10).map(t => t.side === "buy" ? t.tok : -t.tok)) / SUPPLY * 100;
  let i = 0;
  for (const T of TIMES) { while (i + 1 < mcs.length && mcs[i + 1][0] <= T) i++; f["lmc_" + T] = mcs.length ? Math.log10(Math.max(1e-3, mcs[i][1])) : 0; }
  const pk = mcs.length ? mcs.reduce((a, b) => b[1] > a[1] ? b : a) : [0, 1];
  f.lpeak = Math.log10(Math.max(1e-3, pk[1])); f.ltpeak = Math.log10(1 + pk[0]);
  f.end_ratio = mcs.length ? Math.log10(Math.max(1e-3, mcs[mcs.length - 1][1] / pk[1])) : 0;
  let net = 0, grad = null;
  for (const t of trades) { net += t.side === "buy" ? t.tok : -t.tok; if (net >= 793.1e6 * 0.999 && grad === null) grad = t.t; }
  f.lgrad = Math.log10(1 + (grad !== null ? grad : 3 * duration));
  const edges = [0, 60, 300, 900, 1800];
  for (let k = 0; k < 4; k++) { const n = trades.filter(t => t.t >= edges[k] && t.t < edges[k + 1]).length; f["tpm_" + k] = Math.log10(1 + n / ((edges[k + 1] - edges[k]) / 60)); }
  f.buy_frac = trades.filter(t => t.side === "buy").length / trades.length;
  const per = new Map(); for (const t of trades) { if (!per.has(t.wallet)) per.set(t.wallet, []); per.get(t.wallet).push(t); }
  let pairs = 0, ss = 0;
  for (const ts of per.values()) {
    const open = [];
    for (const t of ts) {
      if (t.side === "buy") open.push(t);
      else { const j = open.findIndex(b => b.tok && Math.abs(b.tok - t.tok) <= 0.005 * b.tok); if (j >= 0) { const hit = open.splice(j, 1)[0]; pairs++; ss += Math.abs(hit.t - t.t) < 1 ? 1 : 0; } }
    }
  }
  f.pair_frac = pairs / trades.length; f.same_sec_pairs = ss / trades.length; f.lwallets = Math.log10(1 + per.size);
  const firstOf = new Map(); for (const t of trades) if (!firstOf.has(t.wallet)) firstOf.set(t.wallet, t);
  const g = gridRun([...firstOf.values()].filter(t => t.side === "buy" && t.t > 0.5 && t.t <= 600).map(t => t.t).sort((a, b) => a - b));
  f.grid = Math.log10(1 + (g ? g[0] : 0));
  const rt = roundTrips(trades);
  f.bundle_pairs = Math.log10(1 + sum([...rt.values()].map(v => v[1])));
  f.rt_wallets = Math.log10(1 + [...rt.values()].filter(v => v[0] >= 3).length);
  for (const [side, a, b] of [["cb", "sell", "buy"], ["cs", "buy", "sell"]]) {
    const x = counterPeak(trades, a, b);
    f[side + "_z"] = x ? Math.log10(1 + Math.max(0, x.z)) : 0;
    f[side + "_ratio"] = x && x.detected ? Math.log10(x.ratio) : 0;
  }
  f.buyback = Math.log10(1 + sellThenFreshBuy(trades));
  f.fresh_10s = Math.log10(1 + [...firstOf.values()].filter(t => t.side === "buy" && t.t > 0.5 && t.t <= 10).length);
  const bal = new Map(); let j = 0;
  for (const T of [60, 300, 900]) {
    while (j < trades.length && trades[j].t <= T) { const t = trades[j]; bal.set(t.wallet, (bal.get(t.wallet) || 0) + (t.side === "buy" ? t.tok : -t.tok)); j++; }
    f["top10_" + T] = sum([...bal.values()].filter(v => v > 0).sort((a, b) => b - a).slice(0, 10)) / SUPPLY * 100;
  }
  return f;
}
function distance(a, b) {
  const parts = {}; let s = 0, n = 0;
  for (const k in SCALE) { parts[k] = (((a[k] || 0) - (b[k] || 0)) / SCALE[k]) ** 2; s += parts[k]; n++; }
  return [Math.sqrt(s / n), parts];
}

// ---- CSV import
const ALIASES = {
  t: ["time", "timestamp", "block_time", "blocktime", "date", "datetime", "ts", "unix", "t"],
  wallet: ["wallet", "owner", "trader", "maker", "signer", "address", "account", "user", "from"],
  side: ["side", "type", "direction", "action", "trade_type", "is_buy"],
  sol: ["sol", "sol_amount", "amount_sol", "quote", "quote_amount", "value_sol", "native", "sol_value", "total_sol"],
  tok: ["tokens", "token_amount", "amount_token", "base", "base_amount", "qty", "quantity", "amount"],
  slot: ["slot", "block", "block_number"],
  label: ["label", "role", "known_role", "tag"],
  pool: ["pool", "venue", "dex"],
  from: ["from", "sender", "source", "src", "from_address", "frm"],
  to: ["to", "receiver", "recipient", "destination", "dst", "to_address"],
  balance: ["balance", "amount", "tokens", "token_balance", "holding"],
  pct: ["pct", "percent", "percentage", "share", "supply_pct"],
};
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
    else field += ch;
  }
  row.push(field); if (row.some(x => x !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] !== undefined ? r[i] : ""])));
}
function pick(header, key) { const low = {}; for (const h of header) low[h.toLowerCase().trim()] = h; for (const a of ALIASES[key]) if (a in low) return low[a]; return null; }
function parseTime(v) { v = String(v).trim(); const x = Number(v); if (v !== "" && isFinite(x)) return x > 1e12 ? x / 1000 : x; const d = Date.parse(v); if (isNaN(d)) throw new Error("bad time"); return d / 1000; }
// Solscan exports. Native SOL and wrapped SOL both count as SOL; USDC and token-to-token routes are skipped.
const SOL_MINTS = new Set(["So11111111111111111111111111111111111111111", "So11111111111111111111111111111111111111112"]);
const SOLSCAN_ROWS = 1000;   // Solscan's export stops here, newest rows first
const isSolscanSwaps = h => ["Token1", "Amount1", "Token2", "Amount2", "From"].every(k => h.includes(k));
// "export_defi_activities" (one row per swap: Token1 in, Token2 out) -> plain trade rows for the token traded most.
function solscanSwaps(rows) {
  const n = {};
  for (const r of rows) for (const k of ["Token1", "Token2"]) if (r[k] && !SOL_MINTS.has(r[k])) n[r[k]] = (n[r[k]] || 0) + 1;
  const mint = Object.keys(n).sort((a, b) => n[b] - n[a])[0], out = [], via = {};
  let skipped = 0;
  for (const r of rows) {
    const sell = r.Token1 === mint, other = sell ? 2 : 1, me = sell ? 1 : 2;
    if (!(sell || r.Token2 === mint) || !SOL_MINTS.has(r["Token" + other])) { skipped++; continue; }
    const amt = i => +r["Amount" + i] / 10 ** +(r["TokenDecimals" + i] || 0);
    const t = { t: parseTime(r["Block Time"] || r["Human Time"]), wallet: r.From.trim(), side: sell ? "sell" : "buy", sol: amt(other), tok: amt(me), slot: null };
    if (!(t.sol > 0 && t.tok > 0 && isFinite(t.t))) { skipped++; continue; }
    // Programs lists the router/bot first, then the launchpad: "FLASHX...|6EF8..." -> FLASHX.
    const progs = (r.Programs || "").split("|").filter(Boolean); t.via = progs.length > 1 ? progs[0] : "direct";
    via[t.via] = (via[t.via] || 0) + 1; out.push(t);
  }
  return { out, meta: { format: "Solscan DeFi activities", mint, rows: rows.length, skipped, via } };
}
function parseTradesCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("The trades CSV is empty.");
  if (Object.keys(rows[0]).includes("Token Address") && !isSolscanSwaps(Object.keys(rows[0])))
    throw new Error("This is a Solscan token transfer export. For trades, use the DeFi Activities export (export_defi_activities_...csv).");
  if (isSolscanSwaps(Object.keys(rows[0]))) {
    const { out, meta } = solscanSwaps(rows);
    if (!out.length) throw new Error("No SOL swaps of the main token were found in this Solscan export.");
    return finishTrades(out, meta);
  }
  const h = Object.keys(rows[0]), col = {};
  for (const k of ["t", "wallet", "side", "sol", "tok", "slot", "label", "pool"]) col[k] = pick(h, k);
  const missing = ["t", "wallet", "side", "sol", "tok"].filter(k => !col[k]);
  if (missing.length) throw new Error(`The trades CSV needs columns for ${missing.join(", ")}. Found: ${h.join(", ")}.`);
  const out = [];
  for (const r of rows) {
    try {
      const s = String(r[col.side]).trim().toLowerCase();
      const side = ["buy", "b", "true", "1", "bid"].includes(s) ? "buy" : ["sell", "s", "false", "0", "ask"].includes(s) ? "sell" : null;
      if (!side) continue;
      const t = { t: parseTime(r[col.t]), wallet: String(r[col.wallet]).trim(), side, sol: Math.abs(+r[col.sol]), tok: Math.abs(+r[col.tok]),
        slot: col.slot && r[col.slot] !== "" ? Math.trunc(+r[col.slot]) : null };
      if (col.label && r[col.label]) t.label = String(r[col.label]).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24);
      if (col.pool && r[col.pool]) t.pool = String(r[col.pool]).trim().slice(0, 12);
      if (isFinite(t.sol) && isFinite(t.tok) && isFinite(t.t)) out.push(t);
    } catch (e) { /* skip bad row */ }
  }
  if (!out.length) throw new Error("No usable trade rows were found.");
  return finishTrades(out, null);
}
function finishTrades(out, meta) {
  out.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || a.t - b.t);
  const t0 = out[0].t, s0 = out[0].slot, z = out[out.length - 1];
  // seconds per slot from the data's own block times when they span a minute+ (real slots run faster or slower than 0.4 s)
  const sps = s0 !== null && z.slot !== null && z.t - t0 >= 60 && z.slot > s0 ? (z.t - t0) / (z.slot - s0) : SLOT_S;
  if (sum(out.filter(t => t.side === "buy").map(t => t.tok)) > 5 * SUPPLY) for (const t of out) t.tok /= 1e6;
  for (const t of out) { t.t = s0 !== null && t.slot !== null ? (t.slot - s0) * sps : t.t - t0; t.mc = t.tok ? t.sol / t.tok * SUPPLY : null; t.tool = t.label || "real"; }
  out.meta = meta; out.t0 = t0;
  return out;
}
function parseHoldersCSV(text) {
  const rows = parseCSV(text); if (!rows.length) return null;
  const h = Object.keys(rows[0]), ct = pick(h, "t"), cw = pick(h, "wallet"), cb = pick(h, "balance"), cp = pick(h, "pct");
  if (!ct || !cw || !(cb || cp)) throw new Error(`The holders CSV needs time, wallet and balance or pct columns. Found: ${h.join(", ")}.`);
  const snaps = new Map();
  for (const r of rows) { try { const t = parseTime(r[ct]), v = cp ? +r[cp] : +r[cb] / SUPPLY * 100; if (!isFinite(v)) continue; if (!snaps.has(t)) snaps.set(t, new Map()); snaps.get(t).set(r[cw], v); } catch (e) { } }
  const ts = [...snaps.keys()].sort((a, b) => a - b), base = ts[0];
  return ts.map(t => { const vals = [...snaps.get(t).values()]; return { t: +(t - base).toFixed(1), holders: vals.filter(v => v > 0).length, top10: sum(vals.sort((a, b) => b - a).slice(0, 10)) }; });
}
// Plain SOL transfers (no token movement), e.g. wallet funding and later withdrawals. Kept in their own time base.
function parseTransfersCSV(text) {
  let rows = parseCSV(text); if (!rows.length) return [];
  if (isSolscanSwaps(Object.keys(rows[0]))) throw new Error("This is a Solscan DeFi activities export. It goes in the Trades CSV box, not SOL transfers.");
  if ("Token Address" in rows[0]) {   // Solscan transfer export: keep SOL moves only, in SOL
    const n = rows.length;
    rows = rows.filter(r => SOL_MINTS.has(r["Token Address"])).map(r => ({ time: r["Block Time"], from: r.From, to: r.To, sol: +r.Amount / 10 ** +(r.Decimals || 9) }));
    if (!rows.length) { const e = []; e.note = `The transfers file is a token transfer export (${n} rows, no SOL moves), so it can't show wallet funding or withdrawals. Ignored.`; return e; }
  }
  const h = Object.keys(rows[0]), col = {}; for (const k of ["t", "from", "to", "sol", "slot"]) col[k] = pick(h, k);
  const missing = ["from", "to", "sol"].filter(k => !col[k]).concat(col.t || col.slot ? [] : ["time or slot"]);
  if (missing.length) throw new Error(`The transfers CSV needs columns for ${missing.join(", ")}. Found: ${h.join(", ")}.`);
  const out = [];
  for (const r of rows) {
    try {
      const sol = Math.abs(+r[col.sol]), slot = col.slot && r[col.slot] !== "" ? Math.trunc(+r[col.slot]) : null, t = col.t && r[col.t] !== "" ? parseTime(r[col.t]) : slot * SLOT_S;
      const from = String(r[col.from]).trim(), to = String(r[col.to]).trim();
      if (from && to && from !== to && isFinite(sol) && sol > 0 && isFinite(t)) out.push({ k: slot ?? Math.floor(t), t, from, to, sol });
    } catch (e) { /* skip bad row */ }
  }
  return out.sort((a, b) => a.k - b.k);
}
// Research labels (a "label" column): wallets labelled crew* are the operator's known wallets, so the import gets the same
// answer key a simulated launch has: how much supply they really held over time and how many of them the trades-only read caught.
const isCrew = l => /^(crew|operator|insider)/.test(l || "");
function labelStory(trades) {
  const out = [], by = new Map(), pct = x => f1(x / SUPPLY * 100) + "%";
  for (const t of trades) { const k = t.label || "outside"; if (!by.has(k)) by.set(k, new Set()); by.get(k).add(t.wallet); }
  // pool change (bonding curve -> AMM): the first trade on a new pool
  for (let i = 1; i < trades.length; i++) if (trades[i].pool && trades[i - 1].pool && trades[i].pool !== trades[i - 1].pool) { out.push({ t: trades[i].t, who: "migration", text: `Trading moved from the ${trades[i - 1].pool} pool to the ${trades[i].pool} pool (bonding curve completed, liquidity migrated)` }); break; }
  // labelled wallets: one line per trade of >=0.3% supply; trades of the same label within 2 s share a line
  let cur = null;
  for (const t of trades) {
    if (!t.label || t.label === "outside" || t.tok < 0.003 * SUPPLY) continue;
    if (cur && cur.label === t.label && cur.side === t.side && t.t - cur.t1 <= 2) { cur.n++; cur.tok += t.tok; cur.sol += t.sol; cur.w.add(t.wallet); cur.t1 = t.t; continue; }
    cur = { t: t.t, t1: t.t, label: t.label, side: t.side, n: 1, tok: t.tok, sol: t.sol, w: new Set([t.wallet]) }; out.push(cur);
  }
  for (const c of out) if (c.label) { c.who = c.label; c.text = `${c.w.size > 1 ? c.w.size + " wallets" : [...c.w][0].slice(0, 6)} ${c.side === "buy" ? "bought" : "sold"} ${pct(c.tok)} of supply for ${f1(c.sol)} SOL${c.n > 1 ? ` (${c.n} trades over ${Math.max(1, Math.round(c.t1 - c.t))} s)` : ""}`; delete c.w; }
  // outside traders: net SOL per 30 s window when it is large
  const W = 30, win = new Map();
  for (const t of trades) if (!t.label || t.label === "outside") { const k = Math.floor(t.t / W); const o = win.get(k) || { b: 0, s: 0, n: 0, w: new Set() }; o[t.side === "buy" ? "b" : "s"] += t.sol; o.n++; o.w.add(t.wallet); win.set(k, o); }
  for (const [k, o] of win) if (o.b + o.s >= 5) out.push({ t: k * W, who: "outside", text: `${o.w.size} outside wallets: ${f1(o.b)} SOL bought, ${f1(o.s)} SOL sold in ${o.n} trades (${mmssE(k * W)}–${mmssE(k * W + W)})` });
  return { story: out.sort((a, b) => a.t - b.t).slice(0, 600), groups: Object.fromEntries([...by].map(([k, v]) => [k, v.size])) };
}
const mmssE = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function makeImport(name, tradesCsv, holdersCsv, transfersCsv, solUsd) {
  const trades = parseTradesCSV(tradesCsv), holders = holdersCsv && holdersCsv.trim() ? parseHoldersCSV(holdersCsv) : null;
  const duration = Math.max(60, trades[trades.length - 1].t);
  const imp = { name, n_trades: trades.length, duration_s: duration, holders, fingerprint: fingerprint(trades, duration), candles: candles(trades, duration), notes: importNotes(trades) };
  let links = null, sweep = null;
  if (transfersCsv && transfersCsv.trim()) {
    const tx = parseTransfersCSV(transfersCsv), traders = new Set(trades.map(t => t.wallet));
    if (tx.note) imp.notes.push(tx.note);
    else {
      const sw = sweepSignal(tx, traders), set = new Set(sw.swept || []);
      if (sw.level !== "none") { const row = tx.find(r => set.has(r.from) && !set.has(r.to)); if (row) sweep = { t: row.t - trades.t0, text: sw.value }; }
      delete sw.swept; Object.assign(imp, { n_transfers: tx.length, signals: [sw] }); links = transferLinks(tx, traders);
    }
  }
  // the chart view: trades in the live chart's row format, plus the same read a simulated launch gets
  const labelled = trades.some(t => t.label);
  let truthSeries = null;
  if (labelled) {
    const pts = [], bal = new Map(); let tot = 0;
    for (const t of trades) if (isCrew(t.label)) { const b = bal.get(t.wallet) || 0, x = Math.max(0, b + (t.side === "buy" ? t.tok : -t.tok)); tot += x - b; bal.set(t.wallet, x); pts.push([t.t, tot]); }
    truthSeries = tm => { let lo = 0, hi = pts.length - 1, v = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m][0] < tm) { v = pts[m][1]; lo = m + 1; } else hi = m - 1; } return v; };
    Object.assign(imp, labelStory(trades));
  }
  imp.read = readChart(trades, { links, sweep, truthSeries });
  if (labelled && imp.read) {
    const r = imp.read, crew = new Set(trades.filter(t => isCrew(t.label)).map(t => t.wallet)), ins = Object.keys(r.wallets).filter(w => r.wallets[w][2] === "insider");
    r.answer = { source: "labels", operator_traders: crew.size, caught: ins.filter(w => crew.has(w)).length, false_flags: ins.filter(w => !crew.has(w)).length,
      missed_as_bot: Object.keys(r.wallets).filter(w => r.wallets[w][2] === "bot" && crew.has(w)).length };
  }
  if (solUsd > 0) imp.sol_usd = solUsd;
  imp.trades = trades.slice(0, 20000).map(t => [+t.t.toFixed(1), t.mc, t.side === "buy" ? 1 : 0, +t.sol.toFixed(4), t.tok, t.tool || "real", t.wallet.slice(0, 6), 0, t.wallet]);
  if (trades.length > 20000) imp.notes.push(`The chart shows the first 20,000 of ${trades.length} trades.`);
  return imp;
}

// Warnings shown with an import: where the data came from and whether it covers the launch.
function importNotes(trades) {
  const m = trades.meta, notes = [], first = trades.slice(0, 5).map(t => t.mc).filter(x => x > 0).sort((a, b) => a - b);
  if (m) {
    const top = Object.entries(m.via).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k === "direct" ? "direct" : k.slice(0, 6) + "…"} ${v}`).join(", ");
    notes.push(`${m.format}: ${trades.length} of ${m.rows} rows used${m.skipped ? `, ${m.skipped} skipped (not a SOL swap of ${m.mint.slice(0, 6)}…)` : ""}. Routed via: ${top}.`);
    if (m.rows >= SOLSCAN_ROWS) notes.push(`Solscan stops exports at ${SOLSCAN_ROWS} rows, newest first. Older trades are missing.`);
  }
  const start = first.length ? first[Math.floor(first.length / 2)] : 0;
  if (start > 40) notes.push(`The first trades are at ~${start.toFixed(0)} SOL market cap; a fresh pump.fun launch starts near 28. This file probably starts after the launch, so the launch-time fingerprint and any match are not reliable. Export from the token's first trade.`);
  return notes;
}

// ---- matching
const SEARCH = {
  mode: ["choice", ["block0", "quick", "organic", "manual"]], preset: ["choice", ["quick", "clean", "full"]],
  target_supply_pct: ["float", 15, 70], back_tuning: ["int", 0, 8], wallets: ["int", 4, 60], dev_buy_pct: ["float", 0, 5],
  holder_supply_pct: ["float", 10, 60], buy_delay_s: ["float", 0.5, 8], alloc_method: ["choice", ["buyback", "streamflow"]],
  vb_enabled: ["bool"], vb_target: ["float", 5, 80], vb_exec: ["choice", ["organic", "bundle"]],
  as_enabled: ["bool"], as_rate: ["float", 10, 80], as_replication: ["float", 5, 60],
  exit_start_s: ["float", 60, 900], exit_window_s: ["float", 120, 1500],
  org_enabled: ["bool"], org_peak_rate: ["float", 0.5, 5], org_peak_s: ["float", 60, 600], org_fomo: ["float", 0.3, 3],
  sn_level: ["choice", ["none", "typical", "busy", "hot"]],
};
function perturb(cfg, rng, strength = 1) {
  const c = Object.assign({}, cfg), keys = rng.sample(Object.keys(SEARCH), Math.max(2, Math.trunc(Object.keys(SEARCH).length * 0.35 * strength)));
  for (const k of keys) {
    const sp = SEARCH[k];
    if (sp[0] === "choice") c[k] = rng.choice(sp[1]);
    else if (sp[0] === "bool") c[k] = rng.random() < 0.5;
    else {
      const [lo, hi] = [sp[1], sp[2]];
      let v = strength < 1 && typeof c[k] === "number" ? c[k] + rng.gauss(0, (hi - lo) * 0.15 * strength) : rng.uniform(lo, hi);
      v = Math.min(hi, Math.max(lo, v)); c[k] = sp[0] === "int" ? Math.round(v) : v;
    }
  }
  return normalise(c);
}
function match(imp, library, extra = 40, progress = () => { }) {
  const target = imp.fingerprint, minutes = Math.max(2, Math.min(60, Math.ceil(imp.duration_s / 60))), rng = RNG(7), scored = [];
  const total = library.length + extra;
  const evaluate = (cfg, origin) => {
    cfg = Object.assign({}, cfg, { duration_min: minutes });
    const f = features(cfg), [d, parts] = distance(target, f);
    scored.push({ distance: d, config: normalise(cfg), origin, features: f, parts });
    progress(scored.length, total);
  };
  for (const cfg of library) evaluate(cfg, "library");
  scored.sort((a, b) => a.distance - b.distance);
  const half = Math.trunc(extra / 2);
  for (let i = 0; i < half; i++) evaluate(perturb(scored[Math.min(i % 3, scored.length - 1)].config, rng, 1), "search");
  scored.sort((a, b) => a.distance - b.distance);
  for (let i = 0; i < extra - half; i++) evaluate(perturb(scored[i % 2].config, rng, 0.4), "refine");
  scored.sort((a, b) => a.distance - b.distance);
  const best = runConfig(scored[0].config, true);
  const top = scored.slice(0, 8).map((s, k) => ({
    name: s.origin === "library" ? s.config.name : `${s.origin} #${k + 1} (from ${s.config.name})`, distance: s.distance, origin: s.origin, config: s.config,
    mismatch: Object.entries(s.parts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k2]) => [k2, FEATURE_LABELS[k2] || k2, target[k2] || 0, s.features[k2] || 0]) }));
  return { evaluated: scored.length, top, best_run: best };
}


// What the tool's Launch Settings side panel shows for a plan. Fitted to its readings on 2026-10-15 (Solana/PumpFun; Quick/Clean/Full
// at 20/50/100 holders, 55% and 30% holder buy, 1.5% dev): extra funding and maximum loss match to ~0.03 SOL, cleanup time to 1 s.
// "Bubble Maps" is the tool's own static label per preset (Quick: Uncertain, others: Likely clean), shown as the tool shows it.
function toolPanel(cf, cost, L, mcHigh) {
  const b0 = cf.mode === "block0", deep = b0 && L.temp > 0, held = b0 ? cf.target_supply_pct : cf.holder_supply_pct;
  const mev = b0 ? L.front + L.back : 0, H = L.holders;
  const extra = 0.37 + 0.10 * cost + 0.4 * mev + 0.2 * L.temp + 0.13 * H;
  const lossPre = cost > 0 ? 0.1191 * cost + 0.00834 * H + (deep ? 0.022 * cost + 0.0013 * L.temp : 0) : 0;
  const lossPost = cost > 0 ? 0.3563 * cost + 0.008 * H + 0.814 + (deep ? 0.0077 * cost + 0.001 * L.temp : 0) : 0;
  const P = padOf(cf), k = P.vs0 * P.vt0, vtEnd = P.vt0 - P.real0, gradMc = k / vtEnd / vtEnd * SUPPLY;
  return {
    bubble_maps: b0 ? (cf.buy_delay_s < 5 ? "Uncertain" : "Likely Clean") : null,   // the tool's estimate from Buy Delay (not a scan of real links)
    supply_cost_pct: b0 && cost > 0 ? held * (deep ? 0.0727 : 0.0491) : null,
    detection_mode: b0 ? (cf.back_tuning - 0.4) / 1.2 : null,
    cleanup_time_s: b0 ? L.back * cf.front_back_delay_s + L.temp * cf.back_temp_delay_s + Math.max(0, H - 1) * cf.buy_delay_s : 0,
    mc_low_sol: mcHigh * (deep ? 0.862 : 0.9), mc_high_sol: mcHigh, grad_mc_sol: gradMc,
    supply_high: cf.dev_buy_pct + (cost > 0 ? held : 0), supply_low: cf.dev_buy_pct + (cost > 0 ? held * (deep ? 0.927 : 0.951) : 0),
    holders_high: cost > 0 ? held : 0, holders_low: cost > 0 ? held * (deep ? 0.927 : 0.951) : 0,
    supply_cost_sol: cost, extra_sol: extra, funding_sol: cost + extra, loss_pre_sol: lossPre, loss_post_sol: lossPost,
  };
}

// ================================================================== live workspace session
const LIVE_TOOLS_OWN = ["dev_buy", "front_mev", "back_mev", "holder_buy", "manual_buy", "cleanup", "streamflow", "volume_bot", "autobuy", "autosell", "sniper_guard", "manual_sell", "instant_trade", "nuke"];
class Live {
  constructor(cfg) {
    cfg = normalise(cfg);
    // Workspace runs open-ended: automations come from clicks, not the timeline settings.
    this.cfg = cfg;
    const c = this.c = new Chain(cfg.seed).setPad(cfg.launchpad);
    this.cx = {}; for (const n of CEXES) this.cx[n] = c.exchange(n);
    // Planned automations (Sniper Guard, Volume Bot, AutoBuy/AutoSell) come from the config; Cleanup and exits are clicked live.
    const run = Object.assign({}, cfg, { live: true });
    this.op = new Operator(c, run, this.cx);
    this.op.plan();
    this.phase = "planned"; this.autos = []; this.nextId = 1; this.burnHub = c.wallet("burn"); this.vault = c.wallet("creator_vault");
    this.op.onPlanned = (title, startS) => { const a = { id: this.nextId++, title, status: "scheduled", stats: null, t: startS, planned: true }; this.autos.push(a); return a };
    this.claimed = 0; this.deposit = 0; this.detAt = -1; this.det = null;
  }
  names() {
    const o = this.op, n = {};
    n[o.funder] = "Funder"; n[o.dev] = "Dev";
    o.fronts.forEach((a, i) => n[a] = "Front MEV " + (i + 1)); o.backs.forEach((a, i) => n[a] = "Back MEV " + (i + 1));
    o.temps.forEach((a, i) => n[a] = "Temp " + (i + 1)); o.holders.forEach((a, i) => n[a] = "Holder " + (i + 1)); o.empties.forEach((a, i) => n[a] = "Empty holder " + (i + 1));
    o.cleanup_out.forEach((a, i) => n[a] = "Cleanup " + (i + 1)); o.relays.forEach((a, i) => n[a] = "Relay " + (i + 1));
    o.dedicated.forEach((a, i) => n[a] = "Volume " + (i + 1));
    o.hops.forEach((a, i) => n[a] = "Withdraw hop " + (i + 1)); o.payouts.forEach((a, i) => n[a] = "Payout " + (i + 1));
    return n;
  }
  planInfo() {
    const o = this.op, names = this.names(), cf = this.cfg;
    const rows = o.funding.map(([a, amt]) => ({ id: a, name: names[a] || a.slice(0, 6), role: this.c.truth[a], fund: amt, tokens: o.targets.get(a) || 0, key: o.keyOf ? o.keyOf(a) : null }));
    const supply = o.stats.plan_supply_pct, cost = o.stats.plan_cost_sol;
    const P = padOf(cf); let vs = P.vs0, vt = P.vt0;
    for (const t of o.targets.values()) { const x = vs * vt / (vt - t) - vs; vs += x; vt -= t; }
    return { wallets: rows, supply_pct: supply, cost_sol: cost, funding_sol: o.stats.funding_total_sol, est_mc_sol: vs / vt * SUPPLY,
      layers: { front: o.fronts.length, back: o.backs.length, temp: o.temps.length, holders: o.holders.length },
      cleanup_time_s: cf.mode === "block0" ? o.backs.length * cf.front_back_delay_s + o.temps.length * cf.back_temp_delay_s + Math.max(0, o.holders.length - 1) * cf.buy_delay_s : 0,
      funding_hours: (o.funding.length * cf.funding_delay_min) / 60 + (cf.ga_enabled ? cf.ga_loops * cf.ga_delay_s / 3600 : 0) + 0.5,
      panel: toolPanel(cf, cost, { front: o.fronts.length, back: o.backs.length, temp: o.temps.length, holders: o.holders.length }, vs / vt * SUPPLY) };
  }
  fund() {
    if (this.phase !== "planned") throw new Error("Already funded.");
    this.op.prepare();
    snipers(this.c, this.cfg, this.cx); this.tick = organic(this.c, this.cfg, this.cx); copyTraders(this.c, this.cfg, this.cx);
    this.c.start();   // funding history happens at Distribute (negative slots), so the Funder's balance and fees are real before launch
    this.phase = "funded";
  }
  launch() {
    if (this.phase === "planned") this.fund();
    if (this.phase !== "funded") throw new Error("Already launched.");
    this.op.scheduleLaunch(); if (!this.c.running) this.c.start(); this.phase = "live";
    this.c.step([this.tick]);
  }
  step(n) {
    if (this.phase !== "live") return;
    n = Math.max(0, Math.min(6000, Math.trunc(n)));   // up to 20 minutes per call
    for (let i = 0; i < n; i++) this.c.step([this.tick]);
  }
  addAuto(kind, title) { const a = { id: this.nextId++, kind, title, status: "running", stats: {}, cancelled: false, t: this.c.slot * SLOT_S }; this.autos.push(a); return a; }
  action(name, p) {
    const c = this.c, op = this.op, cf = op.cfg, names = this.names();
    if (this.phase !== "live" && name !== "snipe") throw new Error("Launch first.");
    const own = a => op.own(a);
    const pick = ws => (ws || []).filter(a => own(a));
    const num = (v, what, min = 0) => { const x = +v; if (!isFinite(x) || x < min) throw new Error(`${what} must be a number${min > 0 ? " above " + min : min === 0 ? " of 0 or more" : ""}.`); return x; };
    const snap = o => Object.assign({}, cf, o);   // each tool keeps its own copy of the settings
    switch (name) {
      case "trade": {
        const ws = pick(p.wallets); if (!ws.length) throw new Error("Select at least one of your wallets.");
        const amt = num(p.amount, "Amount"); if (!(amt > 0)) throw new Error("Enter an amount above 0.");
        const res = { n: 0, sol: 0 };
        ws.forEach((w, k) => {
          const go = () => { const g = p.side === "buy" ? (c.buy(w, amt, "manual_buy") ? c.ledger[c.ledger.length - 1].sol : 0) : c.sell(w, c.tok[w] * Math.min(100, amt) / 100, "manual_sell"); if (g) { res.n++; res.sol += g; } };
          if (p.style === "parallel") go(); else c.at(c.slot + 1 + k, go);
        });
        op.note(p.style === "parallel" ? `${p.side === "buy" ? "Bought" : "Sold"} from ${res.n} of ${ws.length} wallet(s): ${res.sol.toFixed(3)} SOL${res.n < ws.length ? " (the rest had no SOL or tokens)" : ""}`
          : `${p.side === "buy" ? "Buy" : "Sell"} queued: ${ws.length} wallet(s), ${amt}${p.side === "buy" ? " SOL each" : "% each"}, one per block`); break;
      }
      case "instant": {
        const w = pick([p.wallet])[0]; if (!w) throw new Error("Pick a wallet.");
        const amt = num(p.amount, "Amount"); if (!c.tradable()) throw new Error("The curve just completed; trading resumes on the pool in a moment.");
        const g = p.side === "buy" ? (c.buy(w, amt, "instant_trade") ? c.ledger[c.ledger.length - 1].sol : 0) : c.sell(w, c.tok[w] * Math.min(100, amt) / 100, "instant_trade");
        op.note(g ? `Instant ${p.side} from ${names[w]}: ${g.toFixed(3)} SOL` : `Instant ${p.side} from ${names[w]} did not fill (no ${p.side === "buy" ? "SOL" : "tokens"})`); break;
      }
      case "snipe": op.snipe(); break;
      case "create_wallets": {   // the tool's Add Wallets → Create: new empty wallets, filed with the holders
        const n = Math.trunc(num(p.n, "Number of wallets")); if (n < 1 || n > 200) throw new Error("Create between 1 and 200 wallets.");
        for (let i = 0; i < n; i++) op.holders.push(c.wallet("op_holder"));
        op.note(`Created ${n} wallet${n > 1 ? "s" : ""} (empty, not funded)`); break;
      }
      case "deposit": { const amt = num(p.amount, "Deposit"); if (!(amt > 0)) throw new Error("Enter a deposit above 0."); const hot = this.cx[p.cex || "Binance"]; c.send(hot, op.funder, amt, "funding"); this.deposit += amt; op.note(`Deposited ${amt} SOL into the Funder`); break; }
      case "organic": {   // switch the outside market live: off / very low / mid / bullish
        if (p.level !== "off" && !ORG_PRESETS[p.level]) throw new Error("Unknown organic level.");
        const oc = this.cfg;   // the organic traders read the launch's own config
        if (p.level === "off") oc.org_enabled = false; else Object.assign(oc, ORG_PRESETS[p.level], { org_enabled: true, org_level: p.level, org_start_mc_sol: 0 });
        op.note(`Organic market: ${p.level === "off" ? "off" : ORG_PRESETS[p.level].label}`); break;
      }
      case "fund": {
        const ws = pick(p.wallets); if (!ws.length) throw new Error("Select the wallets to fund.");
        const amt = num(p.amount, "Amount per wallet"); if (!(amt > 0)) throw new Error("Enter an amount above 0.");
        const need = amt * ws.length; if ((c.sol[op.funder] || 0) < need + 0.01) throw new Error(`The Funder has ${(c.sol[op.funder] || 0).toFixed(2)} SOL; this needs ${need.toFixed(2)}. Deposit first.`);
        if (p.method === "cex") { const hot = this.cx[p.cex || "Binance"]; c.send(op.funder, hot, need * 1.005, "funding"); ws.forEach(w => c.send(hot, w, amt, "funding")); }
        else ws.forEach(w => c.send(op.funder, w, amt, "funding"));
        op.note(`Funded ${ws.length} wallet(s) with ${amt} SOL each (${p.method === "cex" ? "via " + (p.cex || "Binance") : "direct from Funder"}). Live funding is instant here; the tool spaces fundings 30+ min.`); break;
      }
      case "volume": {
        const ws = pick(p.wallets); if (!ws.length) throw new Error("Select the wallets the Volume Bot should use.");
        const k = snap({ vb_target: num(p.target, "Target volume"), vb_mode: p.mode === "duration" ? "duration" : "delay", vb_duration_s: +p.duration || 0, vb_delay_min: +p.delay_min || 0, vb_delay_max: +p.delay_max || 0,
          vb_exec: p.exec === "bundle" ? "bundle" : "organic", vb_wave: Math.max(0, Math.min(1, +p.wave || 0)), vb_size_mode: ["fixed", "random"].includes(p.size_mode) ? p.size_mode : "auto",
          vb_size: +p.size || 0, vb_size_min: +p.size_min || 0, vb_size_max: +p.size_max || 0, vb_fee_target: Math.max(0, +p.fee_target || 0) });
        if (!(k.vb_target > 0)) throw new Error("Set a target volume above 0.");
        if (k.vb_mode === "duration" && !(k.vb_duration_s > 0)) throw new Error("Set a duration.");
        if (k.vb_mode === "delay" && !(k.vb_delay_max >= k.vb_delay_min && k.vb_delay_max > 0)) throw new Error("Set a min and max delay.");
        if (k.vb_size_mode === "fixed" && !(k.vb_size > 0)) throw new Error("Set an amount per trade above 0.");
        if (k.vb_size_mode === "random" && !(k.vb_size_max >= k.vb_size_min && k.vb_size_min > 0)) throw new Error("Set a min and max amount per trade.");
        const a = this.addAuto("volume", `Volume Bot · ${k.vb_target.toFixed(2)} SOL · ${k.vb_exec}`); op.volumeBot(a, ws, k); break;
      }
      case "auto": {
        const pre = p.side === "buy" ? "ab" : "as", o = autoOverlay(pre, p, cf, num);
        o[pre + "_wallets"] = Array.isArray(p.wallets) && p.wallets.length ? pick(p.wallets) : p.pool || "holders";
        if (!o[pre + "_counter"] && !o[pre + "_dca"] && !o[pre + "_limits"]) throw new Error("Choose a strategy: Counter, DCA or Limit Orders.");
        if (o[pre + "_counter"] && !(o[pre + "_replication"] > 0)) throw new Error("Replication factor is required.");
        if (o[pre + "_dca"] && !(o[pre + "_dca_interval_s"] > 0)) throw new Error("Interval is required.");
        const k = snap(o);
        // one session (all strategies started together) can share global end conditions
        let sess = null; if (p.session_id) { const S = this.sessions || (this.sessions = {}); sess = S[p.session_id] || (S[p.session_id] = { max: +p.session_end_amount > 0 ? (pre === "ab" ? +p.session_end_amount : +p.session_end_amount * 1e6) : 0, end: +p.session_end_duration_s > 0 ? c.slot + sec(+p.session_end_duration_s) : null, amount: 0 }); }
        const a = this.addAuto(pre === "ab" ? "autobuy" : "autosell", `Auto${p.side === "buy" ? "Buy" : "Sell"} · ${[p.counter && `counter ${k[pre + "_rate"]}%×${k[pre + "_replication"]}%`, p.dca && "DCA", p.limits && "limits"].filter(Boolean).join(", ")}`);
        const delay = +p.start_delay_s > 0 ? +p.start_delay_s : 0;
        if (delay) { a.status = "scheduled"; a.t = c.slot * SLOT_S + delay; op.track(pre === "ab" ? "autobuy" : "autosell", a); c.at(c.slot + sec(delay), () => { if (a.cancelled) return; if (a.stopped) { a.status = a.stopped; return; } a.status = "running"; op.auto(pre, a, k, sess); }); }
        else op.auto(pre, a, k, sess);
        break;
      }
      case "cleanup": {
        const ws = pick(p.wallets); if (!ws.length) throw new Error("Select the seller wallets for Cleanup.");
        const outsChosen = pick(p.output_wallets);
        const k = snap({ cl_outputs: Math.trunc(+p.outputs || outsChosen.length || 0), cl_share_pct: Math.max(1, Math.min(100, +p.share || 100)), cl_delay_mode: p.delay_mode === "random" ? "random" : "fixed",
          cl_delay: Math.max(0.5, +p.delay || 0.5), cl_delay_min: Math.max(0.5, +p.delay_min || 0.5), cl_delay_max: Math.max(0.5, +p.delay_max || 0.5), cl_double_pct: Math.max(0, Math.min(100, +p.double_pct || 0)), cl_method: "buyback" });   // live Cleanup is always Buyback, as in the tool
        if (!(k.cl_outputs >= 1)) throw new Error("Choose at least one output wallet.");
        const a = this.addAuto("cleanup", `Cleanup · ${ws.length} → ${k.cl_outputs} wallets`); op.cleanup(a, ws, k, outsChosen); break;
      }
      case "guard": {
        const k = snap({ sg_threshold: num(p.threshold, "Threshold"), sg_response: ["nuke_all", "nuke_holders", "nuke_dev", "complete_early"].includes(p.response) ? p.response : "nuke_all",
          sg_end: p.end === "timed" ? "timed" : "until_complete", sg_timed_s: +p.timed_s || 0, sg_complete_early: !!p.complete_early, sg_whitelist: p.whitelist || [] });
        if (!(k.sg_threshold > 0)) throw new Error("Threshold must be above 0.");
        if (k.sg_end === "timed" && !(k.sg_timed_s >= 1)) throw new Error("Set a duration of at least 1 second.");
        if (k.sg_end === "until_complete" && op.done_launch_buys) throw new Error("Launch buys are already complete, so 'Until Complete' would end at once. Choose Timed to guard from now on.");
        const a = this.addAuto("guard", `Sniper Guard · >${k.sg_threshold} SOL → ${k.sg_response}`);
        op.sniperGuard(a, k, c.slot); break;
      }
      case "burn": case "lock": {   // the tool burns / locks from the developer wallet only, as % of total supply
        const pct = num(p.pct, "Amount"); const dev = op.dev, has = (c.tok[dev] || 0) / SUPPLY * 100, want = pct / 100 * SUPPLY;
        if (!(has > 1e-7)) throw new Error("The developer wallet holds no tokens to " + name + ".");
        if (!(pct > 0)) throw new Error("Enter an amount above 0%.");
        if (pct > has + 1e-6) throw new Error(`The developer wallet holds ${has.toFixed(2)}% of supply, so you can ${name} at most that.`);
        if (name === "lock" && (c.sol[dev] || 0) < 0.2) throw new Error("Keep at least 0.2 SOL in the developer wallet for the Streamflow lock.");
        const days = name === "lock" ? Math.max(1, +p.days || 30) : 0;
        const moved = name === "burn" ? c.send_tok(dev, this.burnHub, want, "burn", "burn") : c.send_tok(dev, op.escrow, want, "lock", "lock");
        if (!moved) throw new Error("The developer wallet can't pay the transaction fee.");
        op.note(`${name === "burn" ? "Burned" : `Locked for ${days} days via Streamflow`} ${(moved / SUPPLY * 100).toFixed(2)}% of supply from the developer wallet`); break;
      }
      case "claim": {   // creator rewards go to the dev; Proxima keeps 5%; the dev signs and pays the fee
        const amt = c.creator_fees - this.claimed; if (amt <= 0.0001) throw new Error("No creator fees to claim yet.");
        this.claimed += amt; c.sol[op.dev] = (c.sol[op.dev] || 0) + amt * 0.95; c.gas(op.dev);
        this.platformFees = (this.platformFees || 0) + amt * 0.05;
        c.log({ kind: "sol", frm: this.vault, to: op.dev, sol: amt * 0.95, tool: "claim_fees" });
        op.note(`Claimed ${amt.toFixed(3)} SOL creator fees (the tool keeps 5%)`); break;
      }
      case "withdraw": {
        // Like the tool: Collecting (every wallet -> one fresh hop wallet, same slot) -> Hop funded -> Completed
        // (hop -> recipient 4-60 s later). route "direct" skips the hop. Optional "leave dust" keeps
        // a fixed or random SOL amount in chosen roles so the wallets stay reusable.
        const dustOn = new Set(p.dust_on || []), roleKey = r => r === "op_dev" ? "dev" : /op_(holder|empty)/.test(r) ? "holders" : "mev";
        const imported = new Set(p.imported || []);
        if (p.amount !== undefined && p.amount !== "" && !(+p.amount >= 0)) throw new Error("Amount must be 0 or more.");
        const hop = p.route === "direct" ? null : c.wallet("op_hop");
        let to = op.funder;
        if (p.recipient === "fresh") { to = c.wallet("op_payout"); op.payouts.push(to); }
        if (hop) op.hops.push(hop);
        let n = 0, got = 0; const cap = +p.amount > 0 ? +p.amount : Infinity;
        const inGroup = a => { const r = c.truth[a]; if (p.skip_dev && r === "op_dev") return false; if (p.skip_imp && imported.has(a)) return false; const g = p.group || "all";
          return g === "all" || (g === "holders" ? /op_(holder|empty)/.test(r) : g === "dev" ? r === "op_dev" : g === "mev" ? /op_(front|back|temp)/.test(r) : true); };
        for (const a of Object.keys(names)) {
          if (a === op.funder || a === hop || a === to || /op_(hop|payout)/.test(c.truth[a]) || !inGroup(a) || got >= cap) continue;
          const keep = p.dust > 0 && dustOn.has(roleKey(c.truth[a])) ? (p.dust_random ? p.dust * (0.5 + c.rng.random()) : p.dust) : 0;
          const amt = Math.min((c.sol[a] || 0) - 0.003 - keep, cap - got);
          if (amt > 0.01) { got += c.send(a, hop || to, amt, "withdraw"); n++; }
        }
        const dustTxt = p.dust > 0 ? `, leaving ${p.dust_random ? "~" : ""}${p.dust} SOL dust` : "", dest = to === op.funder ? "the Funder" : "a fresh payout wallet";
        if (hop) {
          const delay = sec(c.rng.uniform(4, 60));   // SHARDS operator: one hop forwarded after ~45 s, another within 0.4-3 s
          op.withdraw = { phase: "hop", hop, n, sol: got, at: c.next + delay };
          op.note(`Withdraw: collected ${got.toFixed(2)} SOL from ${n} wallets into a hop wallet${dustTxt}`);
          c.at(c.next + delay, () => { const out = c.send(hop, to, c.sol[hop] - GAS, "withdraw"); op.withdraw = { phase: "done", n, sol: out }; op.note(`Withdraw: hop paid ${out.toFixed(2)} SOL to ${dest}`); });
        } else { op.withdraw = { phase: "done", n, sol: got }; op.note(`Withdraw: SOL from ${n} wallets straight to ${dest}${dustTxt}`); }
        break;
      }
      case "nuke": {   // sells every included wallet; it does not stop other tools (the tool's Nuke only sells)
        if (!["all", "holders", "dev"].includes(p.scope)) throw new Error("Choose who to nuke: all, holders or dev.");
        const go = () => { const ws = Object.keys(names).filter(a => (c.tok[a] || 0) > 1 && (p.scope === "all" || (p.scope === "holders" ? a !== op.dev : a === op.dev))); let n = 0, sol = 0; for (const a of ws) { const g = c.sell(a, c.tok[a], "nuke"); if (g) { n++; sol += g; } } op.note(`Nuke (${p.scope}): ${n} wallets sold for ${sol.toFixed(2)} SOL`); };
        if (c.tradable()) go(); else { c.at(c.slot + 1, go); op.note("Nuke queued: the curve just completed, selling on the pool next block"); }
        break;
      }
      case "cancel": { const a = this.autos.find(x => x.id === +p.id); if (a && ["running", "scheduled", "armed"].includes(a.status)) { a.cancelled = true; a.status = "cancelled"; } break; }
      default: throw new Error("Unknown action " + name);
    }
  }
  tradesSince(cursor) {   // new swaps since ledger index `cursor`, for the live chart and tape
    const c = this.c, names = this.names(), out = [];
    for (let i = cursor; i < c.ledger.length; i++) {
      const r = c.ledger[i];
      if (r.kind !== "swap" || r.mint !== MINT) continue;
      out.push([+(r.slot * SLOT_S).toFixed(1), r.mc, r.side === "buy" ? 1 : 0, +r.sol.toFixed(4), r.tok, r.tool, names[r.signer] || r.signer.slice(0, 6), this.op.own(r.signer) ? r.signer : 0, r.signer]);
    }
    return { cursor: c.ledger.length, trades: out };
  }
  state(full = false) {
    const c = this.c, op = this.op, names = this.names(), trades = tradesOf(c);
    const t = this.phase === "live" ? (c.next - 1) * SLOT_S : 0;
    const out = { phase: this.phase, t, mc_sol: c.mc(), migrated: !!c.pool, complete: c.complete,
      curve_pct: c.pool ? 100 : (c.lp.real0 - c.real_tok) / c.lp.real0 * 100, venue: c.pool ? c.lp.pool_name : c.lp.name + " curve", launchpad: c.lp.name, snipe_pending: !!op.snipeFn && this.phase === "live",
      funder_sol: c.sol[op.funder] || 0, withdraw: op.withdraw || null, timeline: op.events.slice(-60), autos: (c.ga ? [{ id: 0, title: "Generate Activity (before launch)", status: "done", t: -1, stats: { loops: c.ga.loops, wallets: c.ga.wallets.size, volume_sol: +c.ga.volume.toFixed(2), cost_sol: +c.ga.cost.toFixed(4), note: "swaps on other tokens before deploy: not on this chart" } }] : []).concat(this.autos.map(a => ({ id: a.id, title: a.title, status: a.status, stats: a.stats, t: a.t, planned: !!a.planned }))) };
    if (this.phase !== "live") { out.fees = { total: c.feeLog.total }; return out; }
    if (full !== "light") out.candles = candles(trades, Math.max(60, t), 160);
    const step = Math.max(1, Math.floor(trades.length / 3000));
    if (full !== "light") out.markers = trades.filter((x, i) => i % step === 0 || LIVE_TOOLS_OWN.includes(x.tool)).map(x => [+x.t.toFixed(1), +x.mc.toFixed(2), x.side[0], +x.sol.toFixed(3), x.tool, x.wallet.slice(0, 6)]);
    out.feed = trades.slice(-40).reverse().map(x => ({ t: x.t, side: x.side, sol: x.sol, tok: x.tok, tool: x.tool, who: names[x.wallet] || x.wallet.slice(0, 6), own: op.own(x.wallet) }));
    out.wallets = Object.keys(names).filter(a => a !== op.funder && !/op_(hop|payout)/.test(c.truth[a])).map(a => ({ id: a, name: names[a], role: c.truth[a], sol: c.sol[a] || 0, tok: c.tok[a] || 0, pct: (c.tok[a] || 0) / SUPPLY * 100 }));
    const bal = Object.entries(c.tok).filter(([a, v]) => v > 1 && !PUBLIC_HUBS.has(c.truth[a]) || (c.truth[a] === "streamflow" && v > 1)).sort((x, y) => y[1] - x[1]);
    out.holders = { count: bal.length, top10: sum(bal.slice(0, 10).map(x => x[1])) / SUPPLY * 100,
      list: bal.slice(0, 25).map(([a, v]) => ({ who: names[a] || (c.truth[a] === "streamflow" ? "Streamflow (locked/escrow)" : a.slice(0, 6)), pct: v / SUPPLY * 100, own: op.own(a), group: grp(c.truth[a]) })) };
    const price = c.mc() / SUPPLY, ownW = Object.keys(names);
    const spent = sum(trades.filter(x => op.own(x.wallet) && x.side === "buy").map(x => x.sol)), got = sum(trades.filter(x => op.own(x.wallet) && x.side === "sell").map(x => x.sol));
    const org = trades.filter(x => c.truth[x.wallet] === "organic");
    const orgW = new Set(org.map(x => x.wallet));
    const F = c.feeLog, cats = {}; for (const k in F.cats) { const x = F.cats[k]; cats[k] = { sum: x.sum, n: x.n, min: x.n ? x.min : 0, max: x.max, avg: x.n ? x.sum / x.n : 0 }; }
    const top = Object.entries(F.byWallet).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([a, v]) => ({ who: names[a] || a.slice(0, 6), sol: v }));
    out.fees = { total: F.total, cats, top, series: F.series.length > 300 ? F.series.filter((_, i) => i % Math.ceil(F.series.length / 300) === 0).concat([F.series[F.series.length - 1]]) : F.series,
      funder_start: op.stats.funder_deposit || 0, prio_median: c.prio, rent_accounts: [...c.ata].filter(a => c.isOp(a)).length };
    const ownList = Object.keys(names), exitNow = c.exitValue(ownList.filter(a => (c.tok[a] || 0) > 1)), deposited = (op.stats.funder_deposit || 0) + this.deposit, solNow = sum(ownList.map(a => c.sol[a] || 0));
    out.pnl2 = { deposited, sol_now: solNow, exit_sol: exitNow, paper_sol: sum(ownList.map(a => (c.tok[a] || 0) * price)), fees: c.feeLog.total, platform: (c.feeLog.cats.platform || { sum: 0 }).sum,
      claimable: c.creator_fees - this.claimed, realised: solNow - deposited, if_exit: solNow + exitNow - deposited, liquidity_sol: c.pool ? c.pool[0] : c.real_sol, migrated: !!c.pool };
    out.organic = { on: !!this.cfg.org_enabled, level: this.cfg.org_enabled ? this.cfg.org_level : "off" };
    out.pnl = { op_sol_now: sum(ownW.map(a => c.sol[a] || 0)), op_tokens_value: sum(ownW.map(a => (c.tok[a] || 0) * price)), spent, got, proxima_fee: 0.05 * got,
      funded: op.stats.funding_total_sol, creator_fees: c.creator_fees - this.claimed,
      organic: sum(org.map(x => x.side === "sell" ? x.sol : -x.sol)) + sum([...orgW].map(a => c.tok[a] * price)), organic_n: orgW.size };
    if (full === true || this.detAt < 0 || c.next - this.detAt > sec(5)) { this.det = report(c, trades); this.read = simRead(c, op, trades, this.det); if (this.read) this.read.stamp = c.next; this.detAt = c.next; }
    out.report = this.det; out.read = this.read;
    if (full === true) out.graph = fundingGraph(c, trades);
    return out;
  }
}
// ================================================================== worker / node glue
let LIVE = null;
const API = {
  live_plan: p => new Live(p.config).planInfo(),
  live_create: p => { LIVE = new Live(p.config); return { plan: LIVE.planInfo(), state: LIVE.state() }; },
  live_fund: () => { LIVE.fund(); return LIVE.state(); },
  live_launch: () => { LIVE.launch(); return LIVE.state(); },
  // audit of the running launch: every trade on the token by tool and side (what the chart draws), plus non-trade moves and the timeline
  live_audit: () => {
    if (!LIVE) return null; const c = LIVE.c, tools = {}, moves = {};
    for (const r of c.ledger) {
      if (r.kind === "swap" && r.mint === MINT && r.slot >= 0) { const k = r.tool || "?"; const o = tools[k] || (tools[k] = { buy: 0, sell: 0, sol: 0, first_s: r.slot * SLOT_S }); o[r.side]++; o.sol += r.sol; o[r.side + "_sol"] = +((o[r.side + "_sol"] || 0) + r.sol).toFixed(4); o.last_s = +(r.slot * SLOT_S).toFixed(1); }
      else if (r.slot >= 0 && r.kind !== "swap") { const k = (r.tool || r.kind) + ":" + r.kind; moves[k] = (moves[k] || 0) + 1; }
    }
    for (const o of Object.values(tools)) o.sol = +o.sol.toFixed(3);
    return { t: +(c.slot * SLOT_S).toFixed(1), tools, moves, timeline: LIVE.op.events.map(e => [e[0], e[1]]), ga: c.ga ? { loops: c.ga.loops, wallets: c.ga.wallets.size, cost_sol: +c.ga.cost.toFixed(4) } : null,
      failed_tx: c.failed ? { n: c.failed.n, sol: +c.failed.sol.toFixed(4) } : null };
  },
  live_step: p => { if (!LIVE) return null; LIVE.step(p.slots); const st = LIVE.state(p.light ? "light" : false); if (p.cursor !== undefined) st.inc = LIVE.tradesSince(p.cursor); return st; },
  live_action: p => { LIVE.action(p.name, p.params || {}); const st = LIVE.state(); if (p.cursor !== undefined) st.inc = LIVE.tradesSince(p.cursor); return st; },
  live_graph: () => LIVE.state(true),
  init: () => ({ schema: SCHEMA, defaults: defaults(), builtins: builtins(), slot_s: SLOT_S }),
  normalise: p => normalise(p.config),
  run: p => runConfig(p.config),
  compare: p => { const runs = p.configs.map(c => runConfig(c, true)); const cfgs = runs.map(r => r.config);
    const diff = Object.keys(FIELDS).filter(k => k !== "name" && k !== "seed" && new Set(cfgs.map(c => JSON.stringify(c[k]))).size > 1).map(k => [k, FIELDS[k].label, ...cfgs.map(c => c[k])]);
    return { runs, diff }; },
  import: p => makeImport(p.name, p.trades_csv, p.holders_csv, p.transfers_csv, p.sol_usd),
  demo_csv: p => "timestamp,wallet,side,sol_amount,token_amount\n" + tradesOf(simulate(p.config).c).map(t => [1760000000 + t.t, t.wallet, t.side, t.sol.toFixed(9), (t.tok * 1e6).toFixed(0)].join(",")).join("\n"),
};
if (typeof self !== "undefined" && typeof window === "undefined" && typeof self.postMessage === "function") {
  self.onmessage = e => {
    const { id, op, payload } = e.data;
    try {
      let res;
      if (op === "match") res = match(payload.import, payload.library, payload.extra, (n, total) => self.postMessage({ id, progress: [n, total] }));
      else res = API[op](payload);
      self.postMessage({ id, ok: true, result: res });
    } catch (err) { self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) }); }
  };
}
if (typeof module !== "undefined") module.exports = { SLOT_S, API, Live, toolPanel, readChart, simRead, transferLinks, blankPreset, simulate, tradesOf, runConfig, features, fingerprint, report, match, makeImport, sweepSignal, parseTransfersCSV, normalise, builtins, shardsPreset, gridRun, roundTrips, counterPeak, SUPPLY };
