/* Pop-ups, laid out like the launch tool's dialogs: Auto Sell / Auto Buy strategies, Sniper Guard, Volume Bot, Cleanup,
   Deposit, Withdraw, Add Wallets (Create / Import / Marketplace), Delete, Export, Rescue, Archive, Token Buy %.
   Every dialog works in two places: on the pre-launch Funding page (it edits the plan, WCFG) and in the live workspace
   (it sends the action to the engine with lAct). Nothing here touches a chain; all wallets and SOL are sandbox. */
"use strict";
const isLive = () => !!(LST && LST.phase === "live") && ROUTE !== "create";   // the Funding page edits the next plan, everything else acts on the live launch
const usdToSol = v => SOLUSD ? v / SOLUSD : v;           // tool fields are in USD market cap; the engine thinks in SOL
const solToUsd = v => SOLUSD ? v * SOLUSD : v;
const qv = (root, sel) => { const e = root.querySelector(sel); return e ? e.value : "" };
const qn = (root, sel) => +qv(root, sel) || 0;
// HOURS : MIN : SEC and MIN : SEC inputs (stored as seconds)
function hms(name, s = 0, parts = ["h", "m", "s"]) {
  const v = { h: Math.floor(s / 3600), m: Math.floor(s % 3600 / 60), s: Math.round(s % 60) }, L = { h: "HOURS", m: "MIN", s: "SEC" };
  return `<div class="pf-i hms" data-hms="${name}">${parts.map((p, i) => `${i ? '<span class="pt-sep">:</span>' : ""}<div class="pt"><label>${L[p]}</label><input type="number" min="0" data-p="${p}" value="${s ? v[p] : ""}" placeholder=""></div>`).join("")}</div>`;
}
const readHMS = (root, name) => { const el = root.querySelector(`[data-hms="${name}"]`); if (!el) return 0; const g = p => +(el.querySelector(`[data-p="${p}"]`) || { value: 0 }).value || 0; return g("h") * 3600 + g("m") * 60 + g("s") };
const seg2 = (name, opts, val) => `<div class="seg mini" data-seg="${name}">${opts.map(([v, n]) => `<button type="button" class="${v === val ? "on" : ""}" data-v="${v}">${n}</button>`).join("")}</div>`;
const segRead = (root, name) => { const b = root.querySelector(`[data-seg="${name}"] button.on`); return b ? b.dataset.v : null };
function wireSegs(root, onChange) { root.addEventListener("click", e => { const b = e.target.closest("[data-seg] button"); if (!b) return; b.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); onChange && onChange(b.parentNode.dataset.seg, b.dataset.v) }) }
const advLine = (label, open) => `<div class="adv-line ${open ? "open" : ""}" data-adv>${label}<i></i>${ICON("chev", "i chev")}</div>`;
function wireAdv(root) { root.querySelectorAll("[data-adv]").forEach(l => { const b = l.nextElementSibling; if (b) b.hidden = !l.classList.contains("open"); l.onclick = () => { l.classList.toggle("open"); if (b) b.hidden = !l.classList.contains("open") } }) }
// The tool's dialog frame: title + close, scrolling body, footer with a left and a right button.
function popup({ title, head, body, width = 560, left = ["Cancel"], right, cls = "" }) {
  const d = document.createElement("div"); d.className = "palette modal pop " + cls;
  d.innerHTML = `<div class="box" role="dialog" aria-label="${esc(title)}" style="width:min(${width}px,calc(100vw - 24px))"><div class="m-h">${head || `<b>${esc(title)}</b>`}<button class="x" aria-label="Close" data-close>${ICON("x")}</button></div><div class="m-b">${body}</div>
    <div class="m-f">${left ? `<button class="btn pf-cancel" data-close>${left[0]}</button>` : "<span></span>"}${right ? `<button class="btn pf-go" data-go ${right[2] ? "disabled" : ""}>${right[0]}</button>` : ""}</div></div>`;
  document.body.append(d);
  const close = () => { d.remove(); removeEventListener("keydown", k) };
  // Escape closes only the topmost layer: an open menu first, then the newest pop-up, never the one underneath
  // Enter submits from a field, Tab stays inside the dialog
  const k = e => {
    const all = document.querySelectorAll(".palette"); if (all[all.length - 1] !== d || document.querySelector(".ctx-menu")) return;
    if (e.key === "Escape") { close(); return }
    if (e.key === "Enter" && e.target.matches && e.target.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]), select") && d.contains(e.target) && !e.target.closest("[data-own-enter]")) {
      const g = d.querySelector("[data-go]"); if (g && !g.disabled) { e.preventDefault(); e.target.blur(); g.click() } }
    if (e.key === "Tab") { const f = [...d.querySelectorAll("button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea, [tabindex]:not([tabindex='-1'])")].filter(x => x.offsetParent);
      if (!f.length) return; const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus() } }
  }; addEventListener("keydown", k);
  setTimeout(() => { if (!d.isConnected || d.contains(document.activeElement)) return; const f = d.querySelector(".m-b input:not([type=hidden]):not([disabled]):not([type=checkbox]):not([type=radio]):not([type=range]), .m-b textarea") || d.querySelector("[data-go]:not([disabled])") || d.querySelector("[data-close]"); if (f) f.focus({ preventScroll: true }) });
  d.addEventListener("input", () => { d.dirty = true });
  d.addEventListener("click", async e => {
    if (e.target === d && d.dirty) { toast("Unsaved changes: press Cancel or × to discard them", "warn"); return }   // a stray click outside doesn't throw edits away
    if (e.target === d || e.target.closest("[data-close]")) { close(); return }
    if (e.target.closest("[data-go]") && right && right[1]) { const r = await right[1](d); if (r !== false) close() }
  });
  wireAdv(d);
  return d;
}
const goBtn = (d, label, enabled = true) => { const b = d.querySelector("[data-go]"); if (b) { if (label != null) b.innerHTML = label; b.disabled = !enabled } };
// ---------------------------------------------------------------- Auto Sell / Auto Buy
// One or more strategies (Counter Trading, DCA, Limit Orders), each a card with its own fields, like the tool.
const STRAT_COL = { counter: "var(--signal)", dca: "#e0a841", limit: "var(--down)" };
function stratCard(side, s, i, open) {
  const sell = side === "sell", tk = esc(typeof tick === "function" && WCFG ? tick() : "TOKEN");
  const sub = s.mode === "limit" ? (s.rows.filter(r => r[1] > 0).map(r => `${r[0]}% @ $${fmtK(r[1])}`).join(", ") || "-") : `$${s.mcmin ? fmtK(s.mcmin) : 0} → ${s.mcmax ? "$" + fmtK(s.mcmax) : "∞"}`;
  const err = stratErr(s);
  const tile = (k, t, v) => `<button type="button" class="st-tile ${s.open === k ? "on" : ""}" data-tile="${k}"><b>${t}</b><small>${v}</small></button>`;
  const opt = s.open === "mc" ? `<div class="st-opt"><div class="pf-l">Market Cap Range <span class="pf-o">(optional)</span><span class="q" title="Only act while the market cap is inside this range.">?</span></div><div class="mc-range"><div class="pf-i"><span class="pre">Min.</span><input type="number" data-k="mcmin" value="${s.mcmin || 0}"><span class="suf">$</span></div><span>→</span><div class="pf-i"><span class="pre">Max.</span><input type="number" data-k="mcmax" value="${s.mcmax || ""}" placeholder="∞"><span class="suf">$</span></div></div></div>`
    : s.open === "end" ? `<div class="st-opt"><div class="pf-l">End Conditions <span class="pf-o">(optional)</span></div><p class="help">You can choose to stop this strategy only after a certain amount of tokens has been ${sell ? "sold" : "bought"}, after a certain amount of time has passed, or both. Other strategies will continue running.</p>
        <div class="pf-grid">${pf("Max Amount", `<input type="number" data-k="endamt" value="${s.endamt || ""}" placeholder="${sell ? "1%" : "1"}"><span class="suf">${sell ? "% Supply" : "SOL"}</span>`, { opt: true })}<div class="pf"><div class="pf-l">Duration <span class="pf-o">(optional)</span></div>${hms("enddur" + i, s.enddur || 0)}</div></div></div>`
    : s.open === "wl" ? `<div class="st-opt"><div class="pf-l">Whitelist <span class="pf-o">(optional)</span><span class="q" title="Trades from these addresses never trigger this strategy.">?</span></div><div class="wl-add"><div class="pf-i"><input data-k="wladdr" placeholder="Address"></div><button type="button" class="btn sq" data-act="wladd">${ICON("plus")}</button></div>${(s.wl || []).map(a => `<span class="role">${esc(a.slice(0, 10))}</span>`).join("")}</div>` : "";
  const fields = s.mode === "counter" ? `<p class="help">Counter Trading will ${sell ? "sell tokens every time someone buys" : "buy tokens every time someone sells"} the token.</p>
      ${pf("Replication Factor", `<input type="number" data-k="rep" value="${s.rep ?? ""}" placeholder="50%">`, { req: true, help: "Each response is this share of the outside trade's size.", full: true })}
      <div class="pf full"><div class="pf-l">Trigger Condition<span class="req">*</span><span class="q" title="Rate: respond to this % of outside trades. Min. SOL / Min. Token: only respond to trades at least this big.">?</span></div><div class="trig"><div class="pf-i sel"><select data-k="trig">${[["rate", "Rate (%)"], ["sol", "Min. SOL"], ["tok", "Min. Token"]].map(([v, n]) => `<option value="${v}" ${s.trig === v ? "selected" : ""}>${n}</option>`).join("")}</select></div><div class="pf-i"><input type="number" data-k="trigv" value="${s.trigv ?? 100}"></div></div></div>
      ${sell ? pf("Min. % Supply per Sell", `<input type="number" data-k="minper" value="${s.minper ?? 0.1}"><span class="suf">% Supply</span>`, { opt: true, full: true, help: "Small responses add up until they reach this size." }) : pf("Min SOL per Buy", `<input type="number" data-k="minper" value="${s.minper ?? 0.1}">`, { full: true, help: "Small responses add up until they reach this size." })}
      <div class="st-tiles three">${tile("mc", "Market Cap Range", `${s.mcmin ? "$" + fmtK(s.mcmin) : 0}→${s.mcmax ? "$" + fmtK(s.mcmax) : "∞"}`)}${tile("end", "End Conditions", s.endamt || s.enddur ? [s.endamt && s.endamt + (sell ? "%" : " SOL"), s.enddur && fmtDur(s.enddur)].filter(Boolean).join(" · ") : "—")}${tile("wl", "Whitelist", `${(s.wl || []).length} Wallets`)}</div>${opt}`
    : s.mode === "dca" ? `<p class="help">DCA will ${sell ? "sell" : "buy"} tokens every time the delay is reached.</p>
      ${seg2("dcam" + i, [["fixed", "Fixed Amount"], ["random", "Randomized"]], s.dcam || "fixed")}
      ${s.dcam === "random" ? `<div class="pf-grid">${pf("Min", `<input type="number" data-k="dmin" value="${s.dmin ?? ""}"><span class="suf">${sell ? "% Supply" : "SOL"}</span>`, { req: true })}${pf("Max", `<input type="number" data-k="dmax" value="${s.dmax ?? ""}"><span class="suf">${sell ? "% Supply" : "SOL"}</span>`, { req: true })}</div>`
        : pf("Amount", `<input type="number" data-k="damt" value="${s.damt ?? ""}" placeholder="${sell ? "1%" : "0.1"}"><span class="suf">${sell ? "% Supply" : "SOL"}</span>`, { req: true, full: true })}
      <div class="pf full"><div class="pf-l">Interval<span class="req">*</span><span class="q" title="Time between ${sell ? "sells" : "buys"}.">?</span></div>${hms("int" + i, s.int || 0)}</div>
      <div class="st-tiles two">${tile("mc", "Market Cap Range", `${s.mcmin ? "$" + fmtK(s.mcmin) : 0}→${s.mcmax ? "$" + fmtK(s.mcmax) : "∞"}`)}${tile("end", "End Conditions", s.endamt || s.enddur ? "set" : "—")}</div>${opt}`
    : `<p class="help">Limit Order will ${sell ? "sell" : "buy"} certain amount of tokens based on the market cap.</p>
      <div class="lim-h"><span>${sell ? "% Supply" : "SOL"}<span class="req">*</span></span><span>Market Cap (USD)<span class="req">*</span></span></div>
      ${s.rows.map((r, j) => `<div class="lim-row"><div class="pf-i"><input type="number" data-row="${j}" data-c="0" value="${r[0] || ""}" placeholder="${sell ? "1%" : "0.5"}"><span class="suf">${sell ? "% Supply" : "SOL"}</span></div><div class="pf-i"><input type="number" data-row="${j}" data-c="1" value="${r[1] || ""}" placeholder="$1,000,000"></div><button type="button" class="btn sq" data-act="${j === s.rows.length - 1 ? "rowadd" : "rowdel"}" data-j="${j}">${ICON(j === s.rows.length - 1 ? "plus" : "x")}</button></div>`).join("")}
      <p class="help" style="margin:8px 0 0">Total: ${f2(s.rows.reduce((a, r) => a + (+r[0] || 0), 0), 2).replace(/\.00$/, "")} ${sell ? "% of $" + tk : "SOL"}</p>`;
  return `<div class="strat" data-i="${i}" style="--sc:${STRAT_COL[s.mode]}"><div class="st-h"><i class="bar"></i><div><b>${{ counter: "Counter", dca: "DCA", limit: "Limit" }[s.mode]}${err && s.touched ? `<span class="err-dot" title="${esc(err)}">!</span>` : ""}</b><small>${sub}${s.mode !== "limit" && !s.mcmin && !s.mcmax ? ' <span class="inr">In-Range</span>' : ""}</small></div><span class="sp"></span><button type="button" class="ic" data-act="del" aria-label="Remove strategy">${ICON("trash")}</button><button type="button" class="ic" data-act="fold" aria-label="Collapse">${ICON("chev", "i chev" + (open ? " up" : ""))}</button></div>
    ${open ? `<div class="st-b"><div class="pf-l">Mode</div><div class="st-modes">${[["counter", "repeat", "Counter Trading"], ["dca", "clock", "DCA"], ["limit", "trend", "Limit Orders"]].map(([m, ic, n]) => `<button type="button" class="${s.mode === m ? "on" : ""}" data-mode="${m}" style="--mc:${STRAT_COL[m]}">${ICON(ic)}${n}</button>`).join("")}</div>${fields}${err && s.touched ? `<div class="note bad">${ICON("alert")}<span>${esc(err)}</span></div>` : ""}</div>` : ""}</div>`;
}
function stratErr(s) {
  if (s.mode === "counter") return !(+s.rep > 0) ? "Replication factor is required" : "";
  if (s.mode === "dca") { const miss = []; if (!(+s.int > 0)) miss.push("Interval is required"); if (s.dcam === "random" ? !(+s.dmin > 0 && +s.dmax >= +s.dmin) : !(+s.damt > 0)) miss.push("Amount is required"); return miss.join(". ") }
  return s.rows.some(r => +r[0] > 0 && +r[1] > 0) ? "" : "Empty mcap ladder";
}
const newStrat = (mode = "counter") => ({ mode, rep: null, trig: "rate", trigv: 100, minper: 0.1, dcam: "fixed", rows: [[null, null]], wl: [], open: null });
// strategies already set on the plan (pre-launch) come back into the dialog
function stratFromCfg(p, sell) {
  const c = WCFG, out = [];
  if (!c[p + "_enabled"]) return out;
  const base = { mcmin: c[p + "_mc_min"] ? solToUsd(c[p + "_mc_min"]) : 0, mcmax: c[p + "_mc_max"] ? solToUsd(c[p + "_mc_max"]) : 0, endamt: c[p + "_end_amount"] ? (sell ? c[p + "_end_amount"] / 10 : c[p + "_end_amount"]) : 0, enddur: c[p + "_end_duration_s"] || 0, wl: [], open: null };
  if (c[p + "_counter"]) out.push(Object.assign(newStrat("counter"), base, { rep: c[p + "_replication"], trig: "rate", trigv: c[p + "_rate"], minper: sell ? c[p + "_min_per_trade"] / 10 : c[p + "_min_per_trade"] }));
  if (c[p + "_dca"]) out.push(Object.assign(newStrat("dca"), base, { dcam: c[p + "_dca_mode"], damt: sell ? c[p + "_dca_amount"] / 10 : c[p + "_dca_amount"], dmin: sell ? c[p + "_dca_min"] / 10 : c[p + "_dca_min"], dmax: sell ? c[p + "_dca_max"] / 10 : c[p + "_dca_max"], int: c[p + "_dca_interval_s"] }));
  const lim = parseLimitsUI(c[p + "_limits"]); if (lim.length) out.push(Object.assign(newStrat("limit"), base, { rows: lim.map(([mc, amt]) => [sell ? amt / 10 : amt, Math.round(solToUsd(mc))]).concat([[null, null]]) }));
  for (const q of c[p + "_extra"] || []) out.push(stratFromParams(q, sell));
  return out;
}
// a stored strategy (stratParams output) back into the dialog's card
function stratFromParams(q, sell) {
  const un = v => sell ? v / 10 : v, base = { mcmin: q.mc_min ? solToUsd(q.mc_min) : 0, mcmax: q.mc_max ? solToUsd(q.mc_max) : 0, endamt: q.end_amount ? un(q.end_amount) : 0, enddur: q.end_duration_s || 0, wl: (q.whitelist || []).slice(), open: null };
  if (q.counter) return Object.assign(newStrat("counter"), base, { rep: q.replication, trig: q.min_trigger ? "sol" : q.min_trigger_tok ? "tok" : "rate", trigv: q.min_trigger || q.min_trigger_tok || q.rate, minper: un(q.min_per_trade || 0) });
  if (q.dca) return Object.assign(newStrat("dca"), base, { dcam: q.dca_mode, damt: un(q.dca_amount), dmin: un(q.dca_min), dmax: un(q.dca_max), int: q.dca_interval_s });
  return Object.assign(newStrat("limit"), base, { rows: parseLimitsUI(q.limits).map(([mc, amt]) => [un(amt), Math.round(solToUsd(mc))]).concat([[null, null]]) });
}
const parseLimitsUI = t => (t || "").split(/[,;]/).map(x => x.split(":").map(Number)).filter(x => x.length === 2 && x.every(isFinite));
// engine params for one strategy (sell amounts: % supply → M tokens = % x 10)
function stratParams(side, s, adv) {
  const sell = side === "sell", tok = v => sell ? v * 10 : v;
  const q = { side, counter: s.mode === "counter", dca: s.mode === "dca", limits: "", mc_min: s.mcmin ? usdToSol(s.mcmin) : 0, mc_max: s.mcmax ? usdToSol(s.mcmax) : 0,
    end_amount: s.endamt ? tok(s.endamt) : 0, end_duration_s: s.enddur || 0, pool: adv.pool, start_delay_s: adv.delay };
  // one Trigger Condition, as in the tool: Rate (chance to answer), Min. SOL or Min. Token (smallest trade answered)
  if (q.counter) Object.assign(q, { replication: +s.rep, rate: s.trig === "rate" ? +s.trigv : 100, min_trigger: s.trig === "sol" ? +s.trigv : 0, min_trigger_tok: s.trig === "tok" ? +s.trigv : 0, min_per_trade: tok(+s.minper || 0), whitelist: (s.wl || []).slice() });
  if (adv.sess) Object.assign(q, { session_id: adv.sess, session_end_amount: adv.endamt ? tok(adv.endamt) : 0, session_end_duration_s: adv.enddur || 0 });
  if (q.dca) Object.assign(q, { dca_mode: s.dcam, dca_amount: tok(+s.damt || 0), dca_min: tok(+s.dmin || 0), dca_max: tok(+s.dmax || 0), dca_interval_s: +s.int });
  if (s.mode === "limit") q.limits = s.rows.filter(r => +r[0] > 0 && +r[1] > 0).map(r => `${usdToSol(+r[1]).toFixed(2)}:${tok(+r[0])}`).join(", ");
  return q;
}
function openAuto(side) {
  const sell = side === "sell", p = sell ? "as" : "ab", live = isLive();
  let S = live ? [] : stratFromCfg(p, sell); if (!S.length) S = [newStrat()];
  let openI = 0; const adv = { delay: live ? 0 : WCFG[p + "_start_delay_s"] || 0, slip: 5, pool: live ? "holders" : WCFG[p + "_wallets"] || "holders" };
  const running = live ? (LST.autos || []).filter(a => a.status === "running" && a.title.startsWith("Auto" + (sell ? "Sell" : "Buy"))) : [];
  const body = () => `${running.length ? `<div class="sess">${running.map(a => `<div><span class="live-dot"></span><b>${esc(a.title)}</b><span class="mute">${Object.entries(a.stats || {}).map(([k, v]) => `${k} ${typeof v === "number" ? f2(v, 2) : v}`).join(" · ")}</span><button class="btn sm" data-cancel="${a.id}">Stop</button></div>`).join("")}</div>` : ""}
    <div class="strats">${S.map((s, i) => stratCard(side, s, i, i === openI)).join("")}</div>
    <button type="button" class="btn add-strat" data-act="addstrat">${ICON("plus")}Add Strategy</button>
    ${advLine("ADVANCED OPTIONS")}<div class="adv-body"><div class="pf-grid">
      <div class="pf"><div class="pf-l">${ICON("clock")}Start Delay <span class="pf-o">(optional)</span><span class="q" title="Wait this long after launch (or after you press Run) before the strategies start.">?</span></div>${hms("delay", adv.delay, ["m", "s"])}</div>
      ${pf("Slippage", `<input type="number" data-adv="slip" value="${adv.slip}" disabled data-tip="Not modelled in the sandbox"><span class="suf">%</span>`, { opt: true, icon: ICON("trend"), help: "Not modelled: sandbox trades fill at the curve price." })}
      <div class="pf full wsel"><div><div class="pf-l">${ICON("wallet")}Wallets <span class="pf-o">(optional)</span></div><p class="help" style="margin:0">Choose which wallets to use for trading.</p></div><div class="pf-i sel"><select data-adv="pool">${[["holders", "Holders"], ["front", "Front MEV"], ["back", "Back MEV"], ["all", "All wallets"]].map(([v, n]) => `<option value="${v}" ${adv.pool === v ? "selected" : ""}>${n}</option>`).join("")}</select></div></div>
      <div class="pf full"><div class="pf-l">${ICON("flag")}End Conditions <span class="pf-o">(optional)</span></div><p class="help" style="margin:0 0 6px">If you set both options, Auto ${sell ? "Sell" : "Buy"} will stop completely as soon as either condition is reached.</p>
        <div class="pf-grid">${pf("Max Amount", `<input type="number" data-adv="endamt" value="${adv.endamt || ""}" placeholder="${sell ? "5" : "10"}"><span class="suf">${sell ? "% Supply" : "SOL"}</span>`, { opt: true })}<div class="pf"><div class="pf-l">Duration <span class="pf-o">(optional)</span></div>${hms("sessdur", adv.enddur || 0)}</div></div></div></div></div>`;
  const ok = () => S.length && S.every(s => !stratErr(s));
  const d = popup({ title: sell ? "Auto Sell" : "Auto Buy", width: 620, body: body(), left: ["Close"], right: [`Run ${S.length} Strateg${S.length === 1 ? "y" : "ies"}`, async d => {
    adv.delay = readHMS(d, "delay"); adv.pool = qv(d, '[data-adv="pool"]') || adv.pool; adv.endamt = +(qv(d, '[data-adv="endamt"]') || 0); adv.enddur = readHMS(d, "sessdur");
    if (live) { adv.sess = (adv.endamt || adv.enddur) ? "s" + Date.now().toString(36) : null; for (const s of S) await lAct("auto", stratParams(side, s, adv)); toast(`Auto${sell ? "Sell" : "Buy"}: ${S.length} strateg${S.length === 1 ? "y" : "ies"} running`); return }
    // before launch: the first strategy of each mode fills the plan's fields, any further ones are kept as extra strategies
    const c = WCFG, q = S.map(s => stratParams(side, s, adv)), get = m => q[S.findIndex(s => s.mode === m)];
    const firsts = new Set(["counter", "dca", "limit"].map(m => S.findIndex(s => s.mode === m)).filter(i => i >= 0));
    c[p + "_extra"] = q.filter((x, i) => !firsts.has(i));
    const cn = get("counter"), dc = get("dca"), lm = get("limit"), any = cn || dc || lm || q[0];
    Object.assign(c, { [p + "_enabled"]: true, [p + "_counter"]: !!cn, [p + "_dca"]: !!dc, [p + "_limits"]: lm ? lm.limits : "", [p + "_wallets"]: adv.pool, [p + "_start_delay_s"]: adv.delay,
      [p + "_mc_min"]: any.mc_min, [p + "_mc_max"]: any.mc_max, [p + "_end_amount"]: adv.endamt ? (sell ? adv.endamt * 10 : adv.endamt) : any.end_amount, [p + "_end_duration_s"]: adv.enddur || any.end_duration_s });
    if (cn) Object.assign(c, { [p + "_rate"]: cn.rate, [p + "_replication"]: cn.replication, [p + "_min_trigger"]: cn.min_trigger, [p + "_min_trigger_tok"]: cn.min_trigger_tok, [p + "_min_per_trade"]: cn.min_per_trade, [p + "_whitelist"]: cn.whitelist });
    if (dc) Object.assign(c, { [p + "_dca_mode"]: dc.dca_mode, [p + "_dca_amount"]: dc.dca_amount, [p + "_dca_min"]: dc.dca_min, [p + "_dca_max"]: dc.dca_max, [p + "_dca_interval_s"]: dc.dca_interval_s });
    WPLAN = null; wRender(); toast(`Auto ${sell ? "Sell" : "Buy"}: ${S.length} strateg${S.length === 1 ? "y" : "ies"} added to the plan`);
  }, !ok()] });
  const m = d.querySelector(".m-b");
  const sync = () => {   // read the open card back into S
    const card = m.querySelector(`.strat[data-i="${openI}"]`); if (!card) return; const s = S[openI]; s.touched = true;   // errors show once you've typed
    card.querySelectorAll("[data-k]").forEach(e => { const k = e.dataset.k; s[k] = e.tagName === "SELECT" ? e.value : e.value === "" ? null : +e.value });
    card.querySelectorAll("[data-row]").forEach(e => { s.rows[+e.dataset.row][+e.dataset.c] = e.value === "" ? null : +e.value });
    const i = openI; if (s.mode === "dca") { s.int = readHMS(card, "int" + i); s.dcam = segRead(card, "dcam" + i) || s.dcam }
    if (card.querySelector(`[data-hms="enddur${i}"]`)) s.enddur = readHMS(card, "enddur" + i);
    adv.delay = readHMS(m, "delay"); const sl = m.querySelector('[data-adv="slip"]'); if (sl) adv.slip = +sl.value; const pl = m.querySelector('[data-adv="pool"]'); if (pl) adv.pool = pl.value;
  };
  const redraw = () => { const advOpen = m.querySelector("[data-adv].open"); m.innerHTML = body(); if (advOpen) m.querySelector(".adv-line").classList.add("open"); wireAdv(m); goBtn(d, `Run ${S.length} Strateg${S.length === 1 ? "y" : "ies"}`, ok()) };
  m.addEventListener("input", () => { sync(); goBtn(d, null, ok()); const card = m.querySelector(`.strat[data-i="${openI}"]`); if (card) { const s = S[openI], e = stratErr(s), n = card.querySelector(".note.bad"); if (!e && n) n.remove() } });
  m.addEventListener("change", e => { if (e.target.matches("select[data-k]")) { sync(); redraw() } });
  m.addEventListener("click", async e => {
    const c = e.target.closest("[data-cancel]"); if (c) { await lAct("cancel", { id: +c.dataset.cancel }); c.closest("div").remove(); toast("Strategy stopped"); return }
    const card = e.target.closest(".strat"), i = card ? +card.dataset.i : -1, a = e.target.closest("[data-act]"), md = e.target.closest("[data-mode]"), tl = e.target.closest("[data-tile]"), sg = e.target.closest("[data-seg] button");
    if (card && e.target.closest(".st-h") && !a) { sync(); openI = openI === i ? -1 : i; redraw(); return }
    if (a) {
      sync(); const k = a.dataset.act;
      if (k === "addstrat") { S.push(newStrat()); openI = S.length - 1 }
      else if (k === "del") { S.splice(i, 1); if (!S.length) S.push(newStrat()); openI = 0 }
      else if (k === "fold") openI = openI === i ? -1 : i;
      else if (k === "rowadd") S[i].rows.push([null, null]);
      else if (k === "rowdel") S[i].rows.splice(+a.dataset.j, 1);
      else if (k === "wladd") { const v = (card.querySelector('[data-k="wladdr"]') || {}).value; if (v) S[i].wl.push(v.trim()) }
      redraw(); return;
    }
    if (md) { sync(); const s = S[i]; s.mode = md.dataset.mode; s.open = null; redraw(); return }
    if (tl) { sync(); S[i].open = S[i].open === tl.dataset.tile ? null : tl.dataset.tile; redraw(); return }
    if (sg) { sync(); const s = S[i]; s.dcam = sg.dataset.v; redraw() }
  });
}
// ---------------------------------------------------------------- Sniper Guard
const SG_TXT = { all: "All: Sell all tokens from all wallets including the dev wallet and stop all buys and cleanup.", holders: "Holders Only: Sell all tokens from holder wallets except the dev wallet and stop all buys and cleanup.", dev: "Dev Only: Sell only dev wallet tokens and stop all buys and cleanup." };
let LIVE_SG = null;   // the settings of the guard armed on the live launch, so reopening shows it
function openSniperGuard() {
  const live = isLive(), armed = live && LIVE_SG && (LST.autos || []).find(a => a.id === LIVE_SG.id && ["armed", "running"].includes(a.status));
  const c = live ? (armed ? { sg_response: LIVE_SG.response, sg_complete_early: LIVE_SG.complete_early, sg_end: LIVE_SG.end, sg_timed_s: LIVE_SG.timed_s, sg_whitelist: LIVE_SG.whitelist, sg_threshold: LIVE_SG.threshold } : null) : WCFG;
  const r0 = c ? c.sg_response || "nuke_all" : "nuke_all";
  const st = { mode: r0 === "complete_early" ? "early" : "nuke", with: r0 === "nuke_holders" ? "holders" : r0 === "nuke_dev" ? "dev" : "all", early: c ? c.sg_complete_early !== false : true, end: c ? c.sg_end || "until_complete" : "timed", timed: c ? c.sg_timed_s || 30 : 120, wl: c ? (c.sg_whitelist || []).slice() : [] };
  const body = () => `<p class="help lead">Sniper Guard monitors external buys during launch and triggers an action if they exceed the configured Solana threshold.</p>${armed ? `<div class="note">${ICON("shield")}<span>Armed now: ${esc(armed.title)} (${f2((armed.stats || {}).outside_buys_sol || 0, 2)} SOL counted). Arming again replaces it.</span></div>` : ""}
    <div class="note warn">${ICON("alert")}<span>Chain congestion, slippage, and chaotic on-chain conditions can prevent sells from completing. In the simulator every sell fills; on a real chain they may not.</span></div><hr>
    <div class="sec-t">Threshold Amount</div><p class="help">Maximum total Solana that external wallets (such as snipers) can buy before triggering action.</p>
    <div class="pf-i"><input type="number" id="sg-th" value="${c ? c.sg_threshold || 0 : 5}"><span class="mark">${MARKS.Solana}</span></div><hr>
    <div class="sec-t">Mode</div><p class="help">Action to take when the threshold is exceeded.</p>
    <div class="sg-modes">${[["nuke", "bomb", "Nuke"], ["early", "check", "Complete Early"]].map(([k, ic, n]) => `<button type="button" class="${st.mode === k ? "on " + k : ""}" data-sg="${k}">${ICON(ic)}${n}</button>`).join("")}</div>
    ${st.mode === "nuke" ? `<div class="pf-l" style="margin-top:10px">Nuke With:</div><div class="sg-with">${[["all", "users", "All"], ["holders", "user", "Holders Only"], ["dev", "crown", "Dev Only"]].map(([k, ic, n]) => `<button type="button" class="${st.with === k ? "on" : ""}" data-with="${k}">${ICON(ic)}${n}</button>`).join("")}</div>
      ${st.with === "dev" ? `<label class="sg-early"><input type="checkbox" id="sg-early" ${st.early ? "checked" : ""}><div><b>Complete early</b><small>When enabled, stop all holder buys after selling the dev wallet.</small></div></label>` : ""}
      <div class="note warn">${ICON("alert")}<span>${SG_TXT[st.with]}</span></div>` : `<div class="note warn">${ICON("alert")}<span>Complete Early: Stop all holder buys and finalize launch early without selling.</span></div>`}
    ${advLine("ADVANCED SETTINGS")}<div class="adv-body"><div class="sec-t">End Condition</div><p class="help">When the Sniper Guard should stop if the threshold is not exceeded.</p>
      <div class="sg-modes">${[["until_complete", "check", "Until Complete"], ["timed", "clock", "Timed"]].map(([k, ic, n]) => `<button type="button" class="${st.end === k ? "on early" : ""}" data-end="${k}">${ICON(ic)}${n}</button>`).join("")}</div>
      ${st.end === "timed" ? `<div class="pf" style="margin-top:10px"><div class="pf-l">Duration</div>${hms("sgt", st.timed, ["m", "s"])}</div>` : `<p class="help">Until Complete: Sniper Guard will continue running until all your buy orders are completed.</p>`}<hr>
      <div class="sec-t">Whitelist <span class="pf-o">(optional)</span></div><p class="help">Additional wallet addresses to whitelist.<br>Deployer, Funder, MEVs, and Holder wallets are automatically whitelisted.</p>
      <div class="wl-add" data-own-enter><div class="pf-i"><input id="sg-wl" placeholder="Address"></div><button type="button" class="btn sm" data-wladd>+ Add Address</button></div>${st.wl.map(a => `<span class="role">${esc(a.slice(0, 10))}</span>`).join("")}</div>`;
  const d = popup({ title: "Sniper Guard", width: 560, body: body(), right: [live ? "Arm" : "Plan", async d => {
    const th = +d.querySelector("#sg-th").value; if (!(th > 0)) { toast("Set a threshold above 0 SOL", "warn"); return false }
    const resp = st.mode === "early" ? "complete_early" : { all: "nuke_all", holders: "nuke_holders", dev: "nuke_dev" }[st.with], early = st.with === "dev" ? (d.querySelector("#sg-early") || { checked: st.early }).checked : true;
    const timed = st.end === "timed" ? readHMS(d, "sgt") || st.timed : st.timed;
    if (live) { const q = { threshold: th, response: resp, end: st.end, timed_s: timed, complete_early: early, whitelist: st.wl.slice() };
      if (armed) await lAct("cancel", { id: armed.id });
      const ok = await lAct("guard", q); if (!ok) return false;
      const g = (LST.autos || []).filter(a => /^Sniper Guard/.test(a.title)).pop(); LIVE_SG = Object.assign(q, { id: g && g.id }); toast(armed ? "Sniper Guard replaced" : "Sniper Guard armed"); return }
    Object.assign(WCFG, { sg_enabled: true, sg_threshold: th, sg_response: resp, sg_end: st.end, sg_timed_s: timed, sg_complete_early: early, sg_whitelist: st.wl.slice() }); WPLAN = null; wRender(); toast("Sniper Guard added to the plan");
  }] });
  const m = d.querySelector(".m-b");
  const redraw = () => { const th = m.querySelector("#sg-th").value, open = m.querySelector(".adv-line.open"); if (m.querySelector('[data-hms="sgt"]')) st.timed = readHMS(m, "sgt") || st.timed; m.innerHTML = body(); m.querySelector("#sg-th").value = th; if (open) m.querySelector(".adv-line").classList.add("open"); wireAdv(m) };
  m.addEventListener("click", e => {
    const a = e.target.closest("[data-sg]"), w = e.target.closest("[data-with]"), en = e.target.closest("[data-end]"), wl = e.target.closest("[data-wladd]");
    if (a) { st.mode = a.dataset.sg; redraw() } else if (w) { st.with = w.dataset.with; redraw() } else if (en) { st.end = en.dataset.end; redraw() }
    else if (wl) { const v = m.querySelector("#sg-wl").value.trim(); if (v) { st.wl.push(v); redraw() } }
  });
  m.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "sg-wl") { e.preventDefault(); m.querySelector("[data-wladd]").click(); const i = m.querySelector("#sg-wl"); if (i) i.focus() } });
}
// ---------------------------------------------------------------- Volume Bot (Estimate → Start)
// Volume Bot: one pop-up for the plan (Funding page, "Plan") and the live launch ("Estimate" → "Start"), laid out like the tool's.
// Wave Intensity gets a small looping preview (ours): buy streaks of ~1 + 6×wave trades, then sell streaks, the engine's own rule.
const VB_PLAN_GROUPS = [["front", "Front MEV wallets"], ["back", "Back MEV wallets"], ["holders", "Holder wallets"], ["dedicated", "Dedicated new wallets"]];
function openVolumeBot(plan = false) {
  if (!plan && !isLive()) { toast("Volume Bot runs on a live launch", "warn"); return }
  const c = WCFG || {};
  // opens like the tool's: Duration, USD $100, Custom Trade Amounts off. Once you press Plan, it reopens with what you planned.
  const fresh = plan && !c.vb_planned && !c.vb_enabled;   // a preset that already runs a Volume Bot opens with its own values
  const st = fresh ? { unit: "usd", target: 100, tmode: "duration", dur: c.vb_duration_s || 240, dmin: c.vb_delay_min ?? 15, dmax: c.vb_delay_max ?? 35, exec: c.vb_exec || "organic", wave: 0, custom: false, amode: "fixed", size: 0.1, smin: 0.05, smax: 0.15, fee: 0.05, pool: c.vb_wallets || "front" }
    : plan ? { unit: "sol", target: c.vb_target, tmode: c.vb_mode || "duration", dur: c.vb_duration_s || 240, dmin: c.vb_delay_min ?? 15, dmax: c.vb_delay_max ?? 35, exec: c.vb_exec || "organic", wave: c.vb_wave ?? 0.3,
        custom: c.vb_size_mode === "fixed" || c.vb_size_mode === "random", amode: c.vb_size_mode === "fixed" ? "fixed" : "random", size: c.vb_size ?? 0.1, smin: c.vb_size_min ?? 0.05, smax: c.vb_size_max ?? 0.15, fee: c.vb_fee_target ?? 0.05, pool: c.vb_wallets || "front" }
    : { unit: "usd", target: 100, tmode: "duration", dur: 0, dmin: 5, dmax: 20, exec: "organic", wave: 0, custom: false, amode: "fixed", size: 0.1, smin: 0.05, smax: 0.15, fee: 0.05, pool: "holders", picked: null };
  const solMark = `<span class="mark">${MARKS.Solana}</span>`;
  const poolN = () => { const L = WPLAN && WPLAN.layers; if (!plan) return st.picked ? st.picked.size : groupIdsOf(st.pool).length;
    return st.pool === "dedicated" ? c.vb_dedicated_n || 6 : L ? L[st.pool] ?? "–" : "–" };
  const amount = req => `<div class="vb-row sec"><div><div class="pf-l">Amount per trade${req ? '<span class="req">*</span>' : ' <span class="pf-o">(optional)</span>'}</div><p class="help">${st.amode === "fixed" ? "Fixed amount per trade in Solana." : "Min and max amount per trade in Solana."}</p></div>${seg2("amode", [["fixed", "Fixed"], ["random", "Random"]], st.amode)}</div>
    ${st.amode === "fixed" ? `<div class="pf-i"><input type="number" id="vb-size" value="${st.size}" step="0.01">${solMark}</div>`
      : `<div class="pf-grid mm"><div class="pf-i"><span class="pre">Min.</span><input type="number" id="vb-smin" value="${st.smin}" step="0.01">${solMark}</div><div class="pf-i"><span class="pre">Max.</span><input type="number" id="vb-smax" value="${st.smax}" step="0.01">${solMark}</div></div>`}`;
  const body = () => `${plan && c.vb_enabled ? `<div class="note info" style="margin:0 0 12px">${ICON("info")}<span>${fresh ? `This launch's preset already runs a Volume Bot (${f2(c.vb_target, 2)} SOL from +${c.vb_start_s}s). Plan replaces it.` : `Planned for this launch: ${f2(c.vb_target, 2)} SOL from +${c.vb_start_s}s.`} <button type="button" class="link" data-off>Turn off</button></span></div>` : ""}
    <div class="vb-row"><div><div class="pf-l">Target Volume<span class="req">*</span></div><p class="help">Amount of volume to generate.</p></div>${seg2("unit", [["sol", "Solana"], ["usd", "USD"]], st.unit)}</div>
    <div class="pf-i"><input type="number" id="vb-t" value="${st.target ?? 100}"><span class="suf">${st.unit === "usd" ? "$" : solMark}</span></div>
    ${st.unit === "usd" && !SOLUSD ? `<p class="help">No SOL price yet, so USD is read as SOL. Set one from the SOL price in the status bar.</p>` : ""}<hr>
    <div class="vb-row"><div><div class="pf-l">${st.tmode === "duration" ? "Duration" : "Delay"}<span class="req">*</span><span class="q" data-tip="${st.tmode === "duration" ? "All volume will be generated within the duration." : "Random delay between min and max for each trade."}">?</span></div><p class="help">${st.tmode === "duration" ? "All volume will be generated within the duration." : "Random delay between min and max for each trade."}</p></div>${seg2("tmode", [["duration", "Duration"], ["delay", "Delay"]], st.tmode)}</div>
    ${st.tmode === "duration" ? hms("vbdur", st.dur || 0) : `<div class="pf-grid"><div class="pf"><div class="pf-l">Min Delay</div>${hms("vbdmin", st.dmin, ["m", "s"])}</div><div class="pf"><div class="pf-l">Max Delay</div>${hms("vbdmax", st.dmax, ["m", "s"])}</div></div><hr>${amount(true)}`}
    ${advLine("ADVANCED", st.adv)}<div class="adv-body"><div class="pf-l">Mode</div><p class="help">Choose how to generate volume.</p>
      <div class="sg-modes vb">${[["bundle", "layers", "Bundle"], ["organic", "sprout", "Organic"]].map(([k, ic, n]) => `<button type="button" class="${st.exec === k ? "on " + k : ""}" data-exec="${k}">${ICON(ic)}${n}</button>`).join("")}</div>
      <div class="note info">${ICON("info")}<span>${st.exec === "organic" ? "Organic: spread trades with delays." : "Bundle: one wallet buys and sells in the same block."}</span></div>
      ${st.exec === "organic" ? `<hr><div class="vb-row"><div><div class="pf-l">Wave Intensity<span class="q" data-tip="How long buy/sell streaks last before reversing.">?</span></div><p class="help">Controls how long buy/sell streaks last before reversing.</p></div><b class="wv">${(+st.wave).toFixed(1)}</b></div>
        <input type="range" class="tune" id="vb-wave" min="0" max="1" step="0.1" value="${st.wave}" style="--p:${st.wave * 100}%"><div class="slider-ends"><span>— Tight</span><span>Big waves ∿</span></div>
        <div class="wave-prev"><canvas id="vb-wcv" height="64"></canvas><span class="mute" id="vb-wtxt"></span></div>` : ""}
      ${st.tmode === "duration" ? `<hr><div class="ck-card vbc${st.custom ? " on" : ""}"><label><input type="checkbox" id="vb-cust" ${st.custom ? "checked" : ""}><div><b>${ICON("sliders")}Custom Trade Amounts</b><small>${st.custom ? "Trade sizes will be manually set." : "Trade sizes will be auto-calculated based on target volume and duration."} <a class="link" data-tip="Off: each trade is about target ÷ trades (×0.5–1.5). On: you set a fixed size, or a min–max range.">Learn more</a></small></div></label>${st.custom ? `<div class="vbc-in">${amount(false)}</div>` : ""}</div>` : ""}
      <hr><div class="vb-row mid"><div><div class="pf-l">Wallets <span class="pf-o">(optional)</span></div><p class="help" style="margin:0">Choose which wallets to use for volume.</p></div><button type="button" class="btn sm" data-wpick>${ICON("users")}Select Wallets (${poolN()})</button></div>
      <hr><div class="pf-l">${ICON("coin")}Fee Target <span class="pf-o">(optional)</span></div><p class="help">Total tip budget for the session.</p><div class="pf-i"><input type="number" id="vb-fee" value="${st.fee}" step="0.01">${solMark}</div></div>`;
  const read = m => { const g = id => m.querySelector(id); st.target = +g("#vb-t").value; if (g('[data-hms="vbdur"]')) st.dur = readHMS(m, "vbdur"); if (g('[data-hms="vbdmin"]')) { st.dmin = readHMS(m, "vbdmin"); st.dmax = readHMS(m, "vbdmax") }
    if (g("#vb-wave")) st.wave = +g("#vb-wave").value; if (g("#vb-cust")) st.custom = g("#vb-cust").checked; if (g("#vb-size")) st.size = +g("#vb-size").value; if (g("#vb-smin")) { st.smin = +g("#vb-smin").value; st.smax = +g("#vb-smax").value } st.fee = +g("#vb-fee").value; st.adv = !!g(".adv-line.open") };
  const sizeMode = () => st.tmode === "delay" || st.custom ? st.amode : "auto";
  const check = () => { const sol = st.unit === "usd" ? usdToSol(st.target) : st.target;
    if (!(sol > 0)) { toast("Set a target volume", "warn"); return null } if (st.tmode === "duration" && !(st.dur > 0)) { toast("Set a duration", "warn"); return null }
    if (st.tmode === "delay" && !(st.dmax >= st.dmin && st.dmax > 0)) { toast("Set a min and max delay", "warn"); return null }
    if (sizeMode() === "random" && !(st.smax >= st.smin && st.smin > 0)) { toast("Max amount must be at least the min", "warn"); return null } return sol };
  let stage = 0;
  const d = popup({ title: "Volume Bot", width: 560, body: body(), right: [plan ? "Plan" : "Estimate", async d => {
    const m = d.querySelector(".m-b");
    if (plan) { read(m); const sol = check(); if (sol == null) return false;
      Object.assign(c, { vb_enabled: true, vb_planned: true, vb_target: +sol.toFixed(4), vb_mode: st.tmode, vb_exec: st.exec, vb_wave: st.wave, vb_size_mode: sizeMode(), vb_size: st.size, vb_size_min: st.smin, vb_size_max: st.smax, vb_wallets: st.pool, vb_fee_target: st.fee });
      if (st.tmode === "duration") c.vb_duration_s = st.dur; else { c.vb_delay_min = st.dmin; c.vb_delay_max = st.dmax }
      WPLAN = null; wPlan(); setTimeout(rerenderStage, 300); toast(`Volume Bot planned: ${f2(sol, 2)} SOL from +${c.vb_start_s}s`); return }
    if (stage === 0) {
      read(m); const sol = check(); if (sol == null) return false; const dur = st.tmode === "duration" ? st.dur : 0, sm = sizeMode();
      const avg = sm === "fixed" ? st.size : sm === "random" ? (st.smin + st.smax) / 2 : Math.max(0.05, Math.min(2, sol / 40)), n = Math.ceil(sol / avg), ws = poolN();
      // the bot trades from the chosen wallets' own SOL: check they can afford a trade each, offer to top them up from the Funder
      const ids = st.picked ? [...st.picked] : groupIdsOf(st.pool), maxT = sm === "random" ? st.smax : avg, need = +(maxT * (st.exec === "bundle" ? 1.1 : 1.3) + 0.02).toFixed(3);
      if (!ids.length) { toast("Choose at least one wallet for the Volume Bot", "warn"); stage = 0; return false }
      const short = (LST.wallets || []).filter(w => ids.includes(w.id) && w.sol < need); st.fundIds = short.map(w => w.id); st.fundEach = need;
      st.sol = sol; stage = 1; stopWave();
      m.innerHTML = `<div class="est-list"><div><span>Target volume</span><b>${f2(sol, 2)} SOL${SOLUSD ? ` ≈ $${fmtK(solToUsd(sol))}` : ""}</b></div><div><span>Trades (both sides)</span><b>~${n}</b></div><div><span>Average trade</span><b>${f2(avg, 3)} SOL</b></div>
        <div><span>${st.tmode === "duration" ? "Duration" : "Delay"}</span><b>${st.tmode === "duration" ? fmtDur(dur) : `${st.dmin}–${st.dmax} s`}</b></div><div><span>Mode</span><b>${st.exec === "organic" ? `Organic · wave ${f2(st.wave, 1)}` : "Bundle"}</b></div><div><span>Wallets</span><b>${ws}</b></div>
        <div><span>Round trips</span><b>~${Math.ceil(n / 2)}</b></div><div><span>Required per wallet</span><b>${need} SOL</b></div>
        <div><span>Min. duration</span><b>${fmtDur(Math.ceil(n * (st.tmode === "delay" ? (st.dmin + st.dmax) / 2 : SLOT)))}</b></div>
        <div><span>Fees (curve + tips)</span><b>~${f2(sol * 0.0125 + st.fee, 3)} SOL</b></div></div>
        ${short.length ? `<div class="note warn" style="margin-top:10px">${ICON("alert")}<span>${short.length} of ${ids.length} wallets have under ${need} SOL, enough for one trade. Without SOL the bot stops at once.</span></div><label class="ck-card"><input type="checkbox" id="vb-fund" checked><div><b>Fund them from the Funder first</b><small>${need} SOL each to ${short.length} wallets (${f2(need * short.length, 2)} SOL), direct.</small></div></label>` : `<p class="help">Wallets: ${ids.length}, each with at least ${need} SOL.</p>`}
        <p class="help">Each round trip loses the curve fee both ways. A detector sees the same wallets buying and selling equal sizes: watch "Equal-size buy/sell pairs".</p>`;
      goBtn(d, "Start Volume Bot"); return false;
    }
    const sm = sizeMode(), fb = d.querySelector("#vb-fund");
    if (fb && fb.checked && st.fundIds.length) { const okF = await lAct("fund", { wallets: st.fundIds, amount: st.fundEach, method: "direct" }); if (!okF) return false }
    await lAct("volume", { wallets: st.picked ? [...st.picked] : groupIdsOf(st.pool), target: st.sol, exec: st.exec, mode: st.tmode, duration: st.dur || 180, delay_min: st.dmin, delay_max: st.dmax,
      size_mode: sm, wave: st.wave, size: st.size, size_min: st.smin, size_max: st.smax, fee_target: st.fee });
    toast("Volume Bot started");
  }] });
  const m = d.querySelector(".m-b");
  // wave preview: an endless strip of buy (up) / sell (down) streaks, regenerated from a fixed seed so it loops
  let raf = 0;
  const stopWave = () => cancelAnimationFrame(raf);
  const drawWave = () => {
    stopWave(); const cv = m.querySelector("#vb-wcv"); if (!cv) return;
    const W = cv.clientWidth || 500, H = 64, dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const streak = Math.max(1, Math.round(1 + st.wave * 6)), seq = []; let buy = true, run = 0, lim = Math.max(1, Math.round(streak * (0.6 + rnd() * 0.8)));
    for (let i = 0; i < 96; i++) { seq.push(buy ? 1 : -1); if (++run >= lim) { buy = !buy; run = 0; lim = Math.max(1, Math.round(streak * (0.6 + rnd() * 0.8))) } }
    const avgRun = (seq.length / seq.reduce((a, v, i) => a + (i && v !== seq[i - 1] ? 1 : 0), 1)).toFixed(1);
    const t = m.querySelector("#vb-wtxt"); if (t) t.textContent = `Preview: streaks of ~${avgRun} trades before reversing`;
    const css = getComputedStyle(document.documentElement), up = css.getPropertyValue("--up").trim(), dn = css.getPropertyValue("--down").trim(), ln = css.getPropertyValue("--text-2").trim();
    const bw = 8, t0 = performance.now();
    const frame = now => {
      if (!cv.isConnected) return; const off = ((now - t0) / 60) % (seq.length * bw); x.clearRect(0, 0, W, H);
      const mid = H / 2, n = Math.ceil(W / bw) + 2, first = Math.floor(off / bw);
      let p = 0; const pts = [];
      for (let k = 0; k < first; k++) p += seq[k % seq.length];
      for (let k = 0; k < n; k++) { const v = seq[(first + k) % seq.length], px = k * bw - (off % bw); x.fillStyle = v > 0 ? up : dn; x.globalAlpha = .55; x.fillRect(px + 1, v > 0 ? mid - 12 : mid, bw - 2, 12); p += v; pts.push([px + bw / 2, p]) }
      x.globalAlpha = 1; const lo = Math.min(...pts.map(q => q[1])), hi = Math.max(...pts.map(q => q[1])), sy = v => H - 4 - (v - lo) / Math.max(1, hi - lo) * (H - 8);
      x.strokeStyle = ln; x.lineWidth = 1.5; x.beginPath(); pts.forEach(([px, v], i) => i ? x.lineTo(px, sy(v)) : x.moveTo(px, sy(v))); x.stroke();
      raf = requestAnimationFrame(frame) };
    raf = requestAnimationFrame(frame);
  };
  const redraw = () => { read(m); m.innerHTML = body(); wireAdv(m); drawWave() };
  wireSegs(m, (k, v) => { read(m); st[k] = v; if (k === "unit") { const s = st.unit === "usd" ? solToUsd(st.target) : usdToSol(st.target); if (SOLUSD && v !== (st._u || (plan ? "sol" : "usd"))) st.target = +s.toFixed(st.unit === "usd" ? 0 : 3); st._u = v } redraw() });
  m.addEventListener("click", e => {
    if (e.target.closest("[data-adv]")) setTimeout(drawWave, 0);
    const x = e.target.closest("[data-exec]"); if (x) { read(m); st.exec = x.dataset.exec; redraw() }
    if (e.target.closest("[data-off]")) { c.vb_enabled = false; WPLAN = null; wPlan(); setTimeout(rerenderStage, 300); toast("Volume Bot off for this launch"); d.remove(); stopWave() }
    if (e.target.closest("[data-wpick]")) { read(m);
      if (plan) { const pd = popup({ title: "Select Wallets", width: 420, body: `<div class="pick-list">${VB_PLAN_GROUPS.map(([k, n]) => `<label><input type="radio" name="vbg" value="${k}" ${st.pool === k ? "checked" : ""}><span>${n}</span></label>`).join("")}</div><p class="help">In a plan the bot uses a whole wallet group; dedicated wallets are created for it and funded at Distribute.</p>`, right: ["Done", pd => { const r = pd.querySelector("input:checked"); if (r) st.pool = r.value; redraw() }] }) }
      else { const ws = LST.wallets.filter(w => w.role !== "op_relay" && w.role !== "op_funder"), set = st.picked || new Set(groupIdsOf(st.pool)); pickWallets(ws, set, () => { st.picked = set; redraw() }) } }
  });
  m.addEventListener("change", e => { if (e.target.id === "vb-cust") redraw() });
  m.addEventListener("input", e => { if (e.target.id === "vb-wave") { e.target.style.setProperty("--p", e.target.value * 100 + "%"); st.wave = +e.target.value; m.querySelector(".wv").textContent = st.wave.toFixed(1); drawWave() } });
  d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-close]")) stopWave() });
  drawWave();
}
const groupIdsOf = g => { const ws = (LST && LST.wallets) || []; if (g === "selected") return [...LSEL]; if (g === "all") return ws.filter(w => w.role !== "op_relay").map(w => w.id); return ws.filter(w => w.role === GROUP_ROLE[g]).map(w => w.id) };
// ---------------------------------------------------------------- Cleanup
function openCleanup() {
  if (!isLive()) { toast("Cleanup runs on a live launch", "warn"); return }
  const st = { inputs: new Set(groupIdsOf("holders").filter(id => (LST.wallets.find(w => w.id === id) || {}).tok > 1)), outs: 10, dm: "fixed" };
  const ws = LST.wallets.filter(w => w.role !== "op_relay");
  const body = () => { const sel = ws.filter(w => st.inputs.has(w.id)), pct = sel.reduce((a, w) => a + w.pct, 0);
    return `<p class="help lead">Sell tokens from input wallets and distribute to output wallets via sell+buy rounds on the market.</p>
    <div class="cl-io"><div><div class="cl-h"><b>Input Wallets (Sellers)</b><button type="button" class="btn sm" data-pick>Select (${sel.length})</button></div><div class="cl-list">${sel.length ? sel.slice(0, 8).map(w => `<div><span>${esc(w.name)}</span><span>${f2(w.pct, 2)}%</span></div>`).join("") + (sel.length > 8 ? `<div class="mute">+${sel.length - 8} more</div>` : "") : '<p class="mute">No wallets selected</p>'}</div><div class="cl-t"><span>Total</span><span>${f2(pct, 2)}%</span></div></div>
      <div><div class="cl-h"><b>Output Wallets (Buyers)</b><span class="pf-i sm"><input type="number" id="cl-n" value="${st.outs}" min="1" max="200" aria-label="New output wallets"><span class="suf">new</span></span></div><div class="cl-list"><p class="mute">${st.outs} fresh wallets are created and buy from the sells.</p></div><div class="cl-t"><span>Total</span><span>${f2(pct, 2)}%</span></div></div></div>
    <div class="vb-row" style="margin-top:16px"><div><div class="pf-l">Delay Between Rounds</div><p class="help">${st.dm === "fixed" ? "Fixed delay between each cleanup round. (0.5s - 300s)" : "Random delay between rounds, inside the range. (0.5s - 300s)"}</p></div>${seg2("dm", [["fixed", "Fixed"], ["random", "Random"]], st.dm)}</div>
    ${st.dm === "fixed" ? `<div class="pf"><div class="pf-l">Delay</div>${hms("cld", st.d ?? 16, ["m", "s"])}</div>` : `<div class="pf-grid"><div class="pf"><div class="pf-l">Min</div>${hms("clmin", st.dmin ?? 1, ["m", "s"])}</div><div class="pf"><div class="pf-l">Max</div>${hms("clmax", st.dmax ?? 6, ["m", "s"])}</div></div>`}
    ${advLine("ADVANCED OPTIONS (OPTIONAL)")}<div class="adv-body"><div class="pf-grid">${pf("Double Buy %", `<input type="number" id="cl-dbl" value="${st.dbl ?? 0}"><span class="suf">%</span>`, { opt: true, help: "Share of rounds where two wallets buy from one sell." })}${pf("Alternative Routing", `<input type="number" id="cl-alt" value="${st.alt ?? 0}"><span class="suf">%</span>`, { opt: true, help: "Not modelled yet." })}
      <div class="pf full"><div class="pf-l">Method</div><div class="pf-i sel"><select id="cl-m" disabled title="Live Cleanup is always Buyback in the tool. Streamflow Airdrop is set in Launch Settings before the plan is created."><option value="buyback">Buyback (sell → relay → buy)</option></select></div></div></div></div>` };
  const read = m => { st.outs = +m.querySelector("#cl-n").value; if (m.querySelector('[data-hms="cld"]')) st.d = readHMS(m, "cld"); if (m.querySelector('[data-hms="clmin"]')) { st.dmin = readHMS(m, "clmin"); st.dmax = readHMS(m, "clmax") } st.dbl = +m.querySelector("#cl-dbl").value; st.m = m.querySelector("#cl-m").value };
  const d = popup({ title: "Cleanup", width: 560, body: body(), right: ["Run", async d => {
    const m = d.querySelector(".m-b"); read(m); if (!st.inputs.size) { toast("Select input wallets", "warn"); return false }
    await lAct("cleanup", { wallets: [...st.inputs], outputs: st.outs, share: 100, delay_mode: st.dm, delay: Math.max(0.5, st.d ?? 16), delay_min: Math.max(0.5, st.dmin ?? 1), delay_max: Math.max(0.5, st.dmax ?? 6), double_pct: st.dbl || 0, method: st.m || "buyback" }); toast("Cleanup started");
  }] });
  const m = d.querySelector(".m-b"), redraw = () => { const open = m.querySelector(".adv-line.open"); m.innerHTML = body(); if (open) m.querySelector(".adv-line").classList.add("open"); wireAdv(m) };
  wireSegs(m, (k, v) => { read(m); st.dm = v; redraw() });
  m.addEventListener("click", e => { if (e.target.closest("[data-pick]")) { read(m); pickWallets(ws, st.inputs, () => redraw()) } });
}
// small wallet picker used by Cleanup (and Delete)
function pickWallets(ws, set, done, title = "Select Wallets") {
  const d = popup({ title, width: 520, body: `<div class="pick-list">${ws.map(w => `<label><input type="checkbox" value="${w.id}" ${set.has(w.id) ? "checked" : ""}><span>${esc(w.name)}</span><span class="rolechip">${esc(ROLE[w.role] || w.role)}</span><span class="mute">${w.pct != null ? f2(w.pct, 2) + "%" : ""}</span></label>`).join("")}</div>`,
    right: ["Done", d => { set.clear(); d.querySelectorAll(".pick-list input:checked").forEach(i => set.add(i.value)); done() }] });
  return d;
}
// ---------------------------------------------------------------- Deposit
const fakeAddr = seed => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); let s = ""; for (let i = 0; i < 44; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177); s += B58C[(h >>> 0) % 58] } return s };
const B58C = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function qrSvg(text) {   // a QR-looking pattern drawn from the address (decorative: the sandbox has nothing to send to)
  let h = 7; const n = 25, cells = []; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 2654435761);
  const fin = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if (fin(x, y)) continue; h = Math.imul(h ^ (h >>> 15), 2246822507) ^ (x * 73856093 + y * 19349663); if ((h >>> 0) % 100 < 46 && !(x > 9 && x < 15 && y > 9 && y < 15)) cells.push(`M${x} ${y}h1v1h-1z`) }
  const eye = (x, y) => `<rect x="${x + .5}" y="${y + .5}" width="6" height="6" rx="1.6" fill="none" stroke="#000" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".8"/>`;
  return `<svg viewBox="0 0 ${n} ${n}" class="qr"><path d="${cells.join("")}"/>${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}<rect x="10.2" y="10.2" width="4.6" height="4.6" rx="1.2" fill="#22313e"/><g transform="translate(10.6 10.9) scale(.16)">${MARKS.Solana.replace(/<\/?svg[^>]*>/g, "")}</g></svg>`;
}
function openDeposit() {
  const live = isLive(), addr = live ? fakeAddr("funder" + (WCFG ? WCFG.name : "")) : funderAddr();
  const need = live ? 50 : Math.max(0, preRequired());
  popup({ title: "Deposit", width: 400, body: `<div class="pf-l">From Network</div><div class="pf-i sel"><span class="mark">${MARKS.Solana}</span><select><option>Solana</option></select></div>
    <p class="dep-note">Only deposit SOL on Solana Network.</p>
    <div class="dep-box">${qrSvg(addr)}<div><small>Deposit Address</small><code>${addr}</code><button class="ic copy" title="Copy" onclick="navigator.clipboard&&navigator.clipboard.writeText('${addr}');toast('Address copied (sandbox)')">${ICON("copy")}</button></div></div>
    <div class="dep-sim"><div class="pf-l">${ICON("flask")}Simulate a deposit <span class="pf-o">(sandbox SOL)</span></div><div class="trig"><div class="pf-i"><input type="number" id="dep-amt" value="${need ? (Math.ceil(need * 100 + 1e-6) / 100).toFixed(2) : "5.00"}"><span class="mark">${MARKS.Solana}</span></div><button class="btn btn-create" id="dep-go">Deposit</button></div></div>`, left: ["Close"], right: null })
    .querySelector("#dep-go").addEventListener("click", async e => {
      const amt = +document.querySelector("#dep-amt").value; if (!(amt > 0)) return;
      if (live) { await lAct("deposit", { amount: amt }) } else { PRE.funder = (PRE.funder || 0) + amt; PRE.deposited = (PRE.deposited || 0) + amt; rerenderStage() }
      toast(`Deposited ${f2(amt, 2)} sandbox SOL into the Funder`); e.target.closest(".palette").remove();
    });
}
// ---------------------------------------------------------------- Withdraw (Simple / Custom, then a review step)
function openWithdraw() {
  const live = isLive();
  const bal = live ? (LST.wallets || []).reduce((a, w) => a + w.sol, 0) : (PRE.funder || 0) + preDistributed();
  let tab = "simple", stage = 0;
  const groups = live ? [["all", "All"], ["holders", "Holders"], ["mev", "MEV wallets"], ["dev", "Deployer"]] : [["all", "All"], ["funder", "Funder"]];
  const book = live ? [["funder", "Funder wallet", fakeAddr("funder" + WCFG.name)], ["fresh", "Fresh payout wallet", fakeAddr("payout" + WCFG.name)]] : [["fresh", "Fresh payout wallet", fakeAddr("payout" + WCFG.name)]];
  const body = () => `<div class="wd-sub">${[["simple", "Simple"], ["custom", "Custom"]].map(([k, n]) => `<button type="button" class="${tab === k ? "on" : ""}" data-tab="${k}">${n}</button>`).join("")}</div>
    ${tab === "simple" ? `<div class="pf-grid"><div class="pf"><div class="pf-l">Wallet</div><div class="pf-i sel"><select id="wd-g">${groups.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div></div>
        <div class="pf"><div class="pf-l">Withdraw to</div><div class="pf-i sel"><span class="mark">${MARKS.Solana}</span><select><option>Solana</option></select></div></div>
        <div class="pf full"><div class="pf-l">Recipient (SOL)</div><div class="pf-i"><input id="wd-addr" placeholder="Enter recipient address..."><button type="button" class="ic" data-book title="Address book">${ICON("doc")}</button></div></div>
        <div class="pf full"><div class="pf-l">Amount</div><div class="pf-i"><span class="mark">${MARKS.Solana}</span><input type="number" id="wd-amt" placeholder="Amount"><button type="button" class="btn sm" data-max>Max</button></div></div></div>
      ${`${advLine(`${ICON("gear")}ADVANCED SETTINGS (OPTIONAL)`, true)}<div class="adv-body">
        <label class="ck-card"><input type="checkbox" id="wd-imp"><div><b>Don't withdraw Imported Wallets</b><small>Don't withdraw wallets imported from My Wallets.</small></div></label>
        <label class="ck-card"><input type="checkbox" id="wd-dev"><div><b>Don't withdraw Deployer</b><small>Don't withdraw the deployer wallet.</small></div></label>
        <label class="ck-card"><input type="checkbox" id="wd-dust"><div><b>Leave Dust</b><small>Leave a chosen amount of SOL in selected wallets</small></div></label>
        <div id="wd-dust-o" hidden>${seg2("dm", [["fixed", "Fixed"], ["random", "Random"]], "fixed")}<div class="pf-l" style="margin-top:10px">Dust Amount</div><div class="pf-i"><input type="number" id="wd-damt" value="0.1"><span class="mark">${MARKS.Solana}</span></div>
          <div class="pf-l" style="margin-top:10px">Leave dust on:</div>${[["dev", "Deployer", false], ["mine", "My Wallets", true], ["holders", "Holders", true], ["mev", "Others", false]].map(([k, n, on]) => `<label class="chk"><input type="checkbox" class="wd-on" value="${k}" ${on ? "checked" : ""}> ${n}</label>`).join("")}</div>
        <div class="pf" style="margin-top:12px"><div class="pf-l">${ICON("flask")}Route <span class="pf-o">(simulator)</span><span class="q" title="The tool withdraws through a fresh hop wallet. A detector links every wallet swept in one block, then sees the hop forward it.">?</span></div><div class="pf-i sel"><select id="wd-route"><option value="hop">Via a hop wallet (as the tool does)</option><option value="direct">Direct</option></select></div></div></div>`}`
    : `<div class="wd-cust"><div class="wd-ch"><span>From</span><span>To ⇅</span><span>Amount ⇅</span><span></span></div>
        <div class="wd-cr"><div class="pf-i sel"><select id="wdc-from">${groups.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div><div class="pf-i"><input id="wdc-to" placeholder="Recipient"></div><div class="pf-i"><span class="mark">${MARKS.Solana}</span><input type="number" id="wdc-amt"><button type="button" class="btn sm" data-max2>Max</button></div><button type="button" class="ic" aria-label="Remove row">${ICON("trash")}</button></div>
        <div class="wd-tot"><span class="mute">${live ? (LST.wallets || []).length : 1} Senders</span><span class="mute">1 Recipients</span><span><span class="mark">${MARKS.Solana}</span>${f2(bal, 2)} SOL</span></div>
        <div class="wd-btns"><button type="button" class="btn sm" disabled title="Bulk add is not needed in the sandbox">Bulk Add</button><button type="button" class="btn sm" disabled>+ Add</button></div></div>`}`;
  const review = q => `<div class="wd-rev"><b>Withdraw Instructions</b><ul><li>Only withdraw SOL to the Solana Network.</li><li>Verify that the recipient is a valid Solana wallet address.</li><li>You can send a small amount first to verify the address.</li></ul>
    <div class="est-list"><div><span>Recipient</span><b>${esc(q.label)}</b></div><div><span>Duration</span><b>${q.route === "hop" ? "~3s + hop" : "~3s"}</b></div><div><span>You'll receive</span><b>${q.amount > 0 ? f2(q.amount, 3) : "≈" + f2(q.est, 3)} SOL</b></div></div>
    <label class="chk"><input type="checkbox" id="wd-ok"> I confirm that I want to withdraw to the address provided.</label></div>`;
  let Q = null;
  const d = popup({ title: "Withdraw", head: `<div class="wd-tabs"><button class="on">${ICON("out")}Withdraw</button><button data-hist>${ICON("clock")}History</button></div>`, width: 480, body: body(), right: ["Withdraw", async d => {
    const m = d.querySelector(".m-b");
    if (stage === 0) {
      const addr = ((tab === "simple" ? m.querySelector("#wd-addr") : m.querySelector("#wdc-to")).value || "").trim();
      const amt = +((tab === "simple" ? m.querySelector("#wd-amt") : m.querySelector("#wdc-amt")).value) || 0, g = (tab === "simple" ? m.querySelector("#wd-g") : m.querySelector("#wdc-from")).value;
      if (!addr) { toast("Enter a recipient address", "warn"); return false }
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) { toast("That isn't a valid Solana address", "warn"); return false }
      const bk = book.find(b => b[2] === addr), to = bk ? bk[0] : "fresh";
      Q = { recipient: to, label: (bk ? bk[1] + " · " : "") + addr.slice(0, 6) + "…" + addr.slice(-4) + (bk ? "" : " (sandbox)"), amount: amt, group: g, est: Math.min(bal, amt || bal), route: (m.querySelector("#wd-route") || { value: "hop" }).value };
      Q.imported = Object.entries((WCFG && WCFG.w_swap) || {}).filter(([, v]) => v.imported).map(([k]) => k);
      if (m.querySelector("#wd-dust")) { Q.skip_imp = m.querySelector("#wd-imp").checked; Q.skip_dev = m.querySelector("#wd-dev").checked; if (m.querySelector("#wd-dust").checked) Object.assign(Q, { dust: +m.querySelector("#wd-damt").value, dust_random: segRead(m, "dm") === "random", dust_on: [...m.querySelectorAll(".wd-on:checked")].map(x => x.value === "mine" ? "holders" : x.value) }) }
      stage = 1; m.innerHTML = review(Q); d.querySelector(".pf-cancel").textContent = "Back"; goBtn(d, `Withdraw ${f2(Q.amount || Q.est, 3)} SOL`, false);
      m.querySelector("#wd-ok").addEventListener("change", e => goBtn(d, null, e.target.checked)); return false;
    }
    if (!live) {   // before launch: from the Funder, then (Wallet: All) from distributed wallets, leaving dust where asked
      let want = Q.amount || Infinity, got = 0; const take = x => { const t = Math.max(0, Math.min(x, want - got)); got += t; return t };
      PRE.funder = (PRE.funder || 0) - take(PRE.funder || 0);
      if (Q.group === "all") for (const w of WPLAN.wallets) { const have = PRE.dist[w.id] || 0; if (!have) continue; if (Q.skip_dev && w.role === "op_dev") continue; if (Q.skip_imp && isImported(w.id)) continue;
        const keep = Q.dust != null && (Q.dust_on || []).some(k => k === "dev" ? w.role === "op_dev" : k === "holders" ? /op_(holder|empty)/.test(w.role) : !/op_(dev|holder|empty)/.test(w.role)) ? Math.min(have, Q.dust_random ? Q.dust * (0.5 + Math.random()) : Q.dust) : 0;
        PRE.dist[w.id] = have - take(have - keep) }
      PRE.deposited = Math.max(0, (PRE.deposited || 0) - got); if (preDistributed() < preTotal() - 1e-6 && PRE.phase === "ready") PRE.phase = "draft"; rerenderStage(); toast(`Withdrew ${f2(got, 3)} sandbox SOL`); return }
    const ok = await lAct("withdraw", Q); if (!ok) return;
    if (LST.withdraw && LST.withdraw.phase === "hop") withdrawProgress(); else toast("Withdraw complete"); if (ROUTE === "wallets") renderWalletsPage();
  }] });
  const m = d.querySelector(".m-b");
  // Back on the review step returns to the form instead of closing
  d.querySelector(".pf-cancel").addEventListener("click", e => { if (stage === 1) { e.stopPropagation(); stage = 0; m.innerHTML = body(); wireAdv(m); d.querySelector(".pf-cancel").textContent = "Cancel"; goBtn(d, "Withdraw", true); wire() } }, true);
  d.querySelector("[data-hist]").addEventListener("click", () => { const w = live && LST.withdraw; toast(w ? `Last withdraw: ${f2(w.sol, 2)} SOL from ${w.n} wallets (${w.phase})` : "No withdraws yet") });
  const wire = () => {
    const bb = m.querySelector("[data-book]"); if (bb) bb.onclick = e => menuAt(e, `<div class="cm-h">Address book</div>${book.map(([k, n, a]) => `<button data-a="${a}">${n}<span class="sp"></span><span class="mono mute">${a.slice(0, 4)}...${a.slice(-4)}</span></button>`).join("")}`, a => { m.querySelector("#wd-addr").value = a });
    const du = m.querySelector("#wd-dust"); if (du) du.onchange = () => { m.querySelector("#wd-dust-o").hidden = !du.checked };
    const mx = m.querySelector("[data-max]"); if (mx) mx.onclick = () => { m.querySelector("#wd-amt").value = bal.toFixed(3) };
    const mx2 = m.querySelector("[data-max2]"); if (mx2) mx2.onclick = () => { m.querySelector("#wdc-amt").value = bal.toFixed(3) };
  };
  m.addEventListener("click", e => { const t = e.target.closest("[data-tab]"); if (t && stage === 0) { tab = t.dataset.tab; m.innerHTML = body(); wireAdv(m); wire() } });
  wireSegs(m); wire();
}
// ---------------------------------------------------------------- Add Wallets: Create / Import / Marketplace
function openAddWallets(tab = "create") {
  const live = isLive();
  if (tab === "import" && !live) { openImportWallets(); return }   // the tool's "+ Import Wallets" opens the wide picker
  const tabs = [["create", "plus", "Create"], ["import", "download", "Import"], ["market", "cart", "Marketplace"]];
  const plan = (WPLAN && WPLAN.wallets) || [];
  const body = () => `<div class="aw-tabs">${tabs.map(([k, ic, n]) => `<button type="button" class="${tab === k ? "on" : ""}" data-aw="${k}">${ICON(ic)}${n}</button>`).join("")}</div>
    ${tab === "create" ? `<div class="pf-l">Number of wallets to create</div><div class="pf-i"><input type="number" id="aw-n" min="0" max="200" value="0"></div><p class="help" style="margin-top:8px">${live ? "New wallets start empty; fund them from the rail or Wallets page." : "Added to the plan as Empty Holders: funded at Distribute, no launch buy."}</p>`
    : tab === "import" ? `<div class="aw-mk">${ICON("cart")}<div><b><span>MARKETPLACE</span> Buy wallets from the Marketplace</b><small>Purchase any amount of wallets and auto-import them to your launch.</small></div><button type="button" class="link" data-aw="market">Marketplace ›</button></div>
        <div class="aw-bar"><div class="pf-i sm"><span class="ic">${ICON("search")}</span><input placeholder="Search Wallet" id="aw-q"></div><span class="sp"></span><span class="pill">All Folders</span></div>
        <div class="pick-list aw-list">${(live ? LST.wallets : plan.map(w => ({ id: w.id, name: w.name, role: w.role, sol: w.fund }))).map(w => `<label><input type="checkbox" checked disabled><span>${esc(w.name)}</span><span class="rolechip">${esc(ROLE[w.role] || w.role)}</span><span class="mute">${f2(w.sol || 0, 3)} SOL</span><span class="mute">already in this launch</span></label>`).join("") || `<p class="mute" style="padding:16px">No wallets in My Wallets yet.</p>`}</div>
        <p class="help">The sandbox has no saved wallets outside this launch, so there is nothing new to import. Use Create, or Marketplace for aged wallets.</p>`
    : `<div class="aw-mk big">${ICON("cart")}<div><b>Recommended Wallets</b><small>Aged wallets: funded 24 h+ before launch, at least 25 min apart, each with prior activity. In the plan this is the Marketplace wallet source.</small></div></div>
        <div class="pf-l" style="margin-top:12px">Wallets</div><div class="pf-i"><input type="number" id="aw-mn" value="${(WCFG && WCFG.wallets) || 20}"></div>
        <p class="help">${live ? "Wallet source can only change before launch." : "Switches the plan's holder wallets to aged Marketplace wallets."}</p>`}`;
  const label = () => tab === "create" ? `Add ${+(d && d.querySelector("#aw-n") ? d.querySelector("#aw-n").value : 0) || 0} Wallets` : tab === "import" ? "Import 0 Wallets" : live ? "Close" : "Use Marketplace Wallets";
  const d = popup({ title: "Add Wallets", width: tab === "import" ? 720 : 420, body: body(), right: ["Add 0 Wallets", async d => {
    if (tab === "create") { const n = Math.trunc(+d.querySelector("#aw-n").value || 0); if (!(n > 0)) return false;
      if (live) { await lAct("create_wallets", { n }); toast(`Created ${n} wallets (sandbox)`) } else { WCFG.empty_holders = Math.min(200 - WCFG.wallets, (WCFG.empty_holders || 0) + n); WPLAN = null; wPlan(); setTimeout(rerenderStage, 250); toast(`${n} wallets added to the plan`) } return }
    if (tab === "market" && !live) { WCFG.wallet_source = "marketplace"; WCFG.mkt_age_min_h = Math.max(24, WCFG.mkt_age_min_h || 0); WCFG.w_imported = true; WPLAN = null; wPlan(); setTimeout(rerenderStage, 250); toast("Plan now uses aged Marketplace wallets") }
  }, true] });
  const m = d.querySelector(".m-b"), box = d.querySelector(".box");
  const upd = () => goBtn(d, label(), tab === "create" ? +(m.querySelector("#aw-n") || { value: 0 }).value > 0 : tab === "market" && !live);
  m.addEventListener("click", e => { const t = e.target.closest("[data-aw]"); if (t && t.dataset.aw === "import" && !live) { d.remove(); openImportWallets(); return } if (t) { tab = t.dataset.aw; box.style.width = `min(${tab === "import" ? 720 : 420}px,calc(100vw - 24px))`; m.innerHTML = body(); upd() } });
  m.addEventListener("input", upd); upd();
}
// ---------------------------------------------------------------- small confirms
function openDeleteWallets() {
  if (isLive()) { popup({ title: "Delete Wallets", width: 420, body: `<p class="help lead">Wallets that took part in a live launch stay in its history. Withdraw their SOL instead; the simulator keeps them so the detector can still read them.</p>`, left: ["Close"] }); return }
  const ws = ((WPLAN && WPLAN.wallets) || []).filter(w => /op_(holder|empty)/.test(w.role)), set = new Set();
  popup({ title: "Delete Wallets", width: 520, body: `<p class="help lead">Remove holder wallets from this launch. Deployer and MEV layers come from the preset and can't be removed here.</p><div class="pick-list">${ws.map(w => `<label><input type="checkbox" value="${esc(w.id)}"><span>${esc(w.name)}</span><span class="rolechip">${esc(ROLE[w.role] || w.role)}</span><span class="mute">${f2(w.fund, 3)} SOL</span></label>`).join("") || '<p class="mute">No removable wallets.</p>'}</div>`,
    right: ["Delete", d => { const sel = [...d.querySelectorAll(".pick-list input:checked")]; if (!sel.length) return false; removeFromPlan(sel.map(i => ws.find(w => w.id === i.value))) }], cls: "danger" });
}
function removeFromPlan(ws) {
  let h = 0, e = 0; for (const w of ws) { if (!w) continue; if (w.role === "op_empty") e++; else h++ }
  WCFG.wallets = Math.max(1, WCFG.wallets - h); WCFG.empty_holders = Math.max(0, (WCFG.empty_holders || 0) - e); WPLAN = null; wPlan(); setTimeout(rerenderStage, 250);
  toast(`Removed ${h + e} wallet${h + e === 1 ? "" : "s"} from the plan`);
}
function openExport(name) { popup({ title: "Export", width: 420, body: `<div class="note warn">${ICON("alert")}<span>Never share a private key. Anyone with it controls the wallet.</span></div><p class="help lead" style="margin-top:12px"><b>${esc(name)}</b> is a sandbox wallet. It has no private key: the simulator never creates real keypairs, so there is nothing to export.</p>`, left: ["Close"] }) }
function openMoveFolder(name) {
  popup({ title: "Move to Folder", width: 400, body: `<p class="help lead">${esc(name)}</p><div class="pick-list">${["HOLDER", "READY", "NOT READY"].map((f, i) => `<label><input type="radio" name="mf" ${i ? "" : "checked"}><span class="fi f-op_holder">${ICON("folder")}</span><span>${f}</span></label>`).join("")}</div><p class="help">In the simulator folders follow wallet roles; this only files the wallet visually.</p>`, right: ["Move", () => toast(`${name} moved (sandbox)`)] });
}
function openRescue() {
  popup({ title: "Rescue", width: 440, body: `<p class="help lead">Recover residual SOL from this launch's wallets back to the Funder: distributed SOL is pulled back and the plan returns to Draft.</p><div class="est-list"><div><span>Distributed so far</span><b>${f2(preDistributed(), 3)} SOL</b></div><div><span>Back to the Funder</span><b>${f2(preDistributed() * 0.998, 3)} SOL</b></div></div>`,
    right: ["Rescue funds", () => { PRE.funder = (PRE.funder || 0) + preDistributed() * 0.998; PRE.phase = "draft"; PRE.prog = 0; rerenderStage(); toast("Funds rescued to the Funder (sandbox)") }] });
}
function openArchive() {
  popup({ title: "Archive", width: 420, body: `<p class="help lead">Archive this draft? Its settings go to Archived, where you can restore it later. The current draft is cleared.</p>`, right: ["Archive", () => { archiveDraft(); const was = DRAFT_ID; DRAFT_ID = null; DRAFTS = DRAFTS.filter(x => x.id !== was); saveDrafts(); PRE = PRE_NEW(); WPLAN = null; W_STEP = 0; show("archived"); toast("Draft archived") }] });
}
function openTokenBuy(w) {
  const pct = (w.tokens || 0) / 1e7;
  popup({ title: "Token Buy %", width: 400, body: `<p class="help lead">${esc(w.name)} · ${esc(ROLE[w.role] || w.role)}</p><div class="pf-i"><input type="number" id="tb-pct" value="${f2(pct, 2)}" step="0.1" min="0"><span class="suf">%</span></div><p class="help">Other wallets in the same layer are scaled so the layer total stays the same.</p>`,
    right: ["Save", d => { const [v, err] = tbCheck(d.querySelector("#tb-pct").value); if (err) { toast(err, "warn"); return false } WCFG.buy_overrides = Object.assign({}, WCFG.buy_overrides || {}, { [w.key]: v }); WPLAN = null; wPlan(); setTimeout(rerenderStage, 250); toast(`${w.name}: ${f2(v, 2)}%`) }] });
}
// Generate Activity (Wallets page): pre-age wallets with small transfers before deploy
function openGenerateActivity() {
  const libSel = ROUTE === "wallets" ? LIB.filter(w => WSEL.has(w.id)) : [];
  if (libSel.length) {   // My Wallets: pre-age the selected wallets with small self-transfers (paid from their own SOL)
    const d = popup({ title: "Generate Activity", width: 460, body: `<p class="help lead">Pre-age ${libSel.length} selected wallet${libSel.length === 1 ? "" : "s"} with small transfers, so they don't look freshly made.</p><div class="pf-grid">${pf("Loops", `<input type="number" id="la-l" value="10">`)}${pf("Amount per transfer", `<input type="number" id="la-a" value="0.01" step="0.005"><span class="suf">SOL</span>`)}</div><p class="help">Each transfer costs a network fee. Wallets need some SOL first (Funding).</p>`,
      right: ["Generate", d => { const L = Math.max(1, Math.trunc(+d.querySelector("#la-l").value || 0)), fee = 0.000005 * 2 * L; let skipped = 0; for (const w of libSel) { if (w.bal < fee + 0.001) { skipped++; continue } w.bal -= fee; w.acts = (w.acts || 0) + L } saveLib(); renderWalletsPage(); toast(skipped ? `Activity on ${libSel.length - skipped} wallets; ${skipped} had no SOL for fees` : `Generated ${L} loops on ${libSel.length} wallets`) }] });
    return d;
  }
  const c = WCFG || {};
  popup({ title: "Generate Activity", width: 480, body: `<p class="help lead">Pre-age wallets with small transfers before launch, so they don't look freshly made.</p>
    <div class="pf-grid">${pf("Amount min", `<input type="number" id="ga-a" value="${c.ga_amount_min ?? 0.01}"><span class="suf">SOL</span>`)}${pf("Amount max", `<input type="number" id="ga-b" value="${c.ga_amount_max ?? 0.05}"><span class="suf">SOL</span>`)}${pf("Loop Count", `<input type="number" id="ga-l" value="${Math.min(15, c.ga_loops ?? 10)}" min="1" max="15" placeholder="1-15">`, { help: "1-15 loops per session, as in the tool." })}${pf("Delay between loops", `<input type="number" id="ga-d" value="${c.ga_delay_s ?? 60}"><span class="suf">s</span>`)}</div>
    <p class="help">${isLive() ? "Applies to the next launch plan; this launch's wallets already have their history." : "Runs as part of the plan's funding history."} A detector reading "fresh wallet" signals sees less; funding links still show.</p>`,
    right: ["Generate", d => { if (!WCFG) return; Object.assign(WCFG, { ga_enabled: true, ga_amount_min: +d.querySelector("#ga-a").value, ga_amount_max: +d.querySelector("#ga-b").value, ga_loops: Math.max(1, Math.min(15, Math.trunc(+d.querySelector("#ga-l").value || 1))), ga_delay_s: +d.querySelector("#ga-d").value }); WPLAN = null; toast("Generate Activity set on the plan") }] });
}
// ---------------------------------------------------------------- Fund Wallets / Burn / Lock (live)
function openFundWallets() {
  if (!isLive()) { openDeposit(); return }
  const body = `<div class="pf-grid"><div class="pf full"><div class="pf-l">Wallets</div><div class="pf-i sel"><select id="fw-g">${GROUPS.map(([k, n]) => `<option value="${k}" ${k === "holders" ? "selected" : ""}>${n} (${groupIdsOf(k).length})</option>`).join("")}</select></div></div>
    ${pf("SOL per wallet", `<input type="number" id="fw-amt" value="0.5" step="0.1"><span class="mark">${MARKS.Solana}</span>`)}<div class="pf"><div class="pf-l">Route</div><div class="pf-i sel"><select id="fw-r"><option value="direct">Direct from Funder</option><option value="cex">Via an exchange (Binance)</option></select></div></div></div>
    <div class="est-list" style="margin-top:12px"><div><span>Funder balance</span><b>${f2(LST.funder_sol || 0, 3)} SOL</b></div></div>
    <p class="help">Each funding is a transfer a detector can see. Exchange routes break the direct link; the tool also spaces fundings 30+ min, which the sandbox does instantly.</p>`;
  popup({ title: "Fund Wallets", width: 460, body, right: ["Fund", async d => { const ids = groupIdsOf(d.querySelector("#fw-g").value); if (!ids.length) { toast("That group has no wallets", "warn"); return false }
    const ok = await lAct("fund", { wallets: ids, amount: +d.querySelector("#fw-amt").value, method: d.querySelector("#fw-r").value, cex: "Binance" }); if (!ok) return false; toast(`Funded ${ids.length} wallets`) }] });
}
function openBurnLock(kind) {
  if (!isLive()) return;
  const burn = kind === "burn";
  const dev = (LST.wallets || []).find(w => w.role === "op_dev") || { pct: 0, sol: 0 };
  popup({ title: burn ? "Burn Supply" : "Lock Supply", width: 440, body: `<p class="help lead">${burn ? "Send the developer wallet's tokens to the burn address. They leave circulation for good. This can't be undone." : "Lock the developer wallet's tokens in a Streamflow contract for a set time. It can't be undone from the tool."}</p>
    <div class="pf-grid">${pf("Amount (% of total supply)", `<input type="number" id="bl-p" value="${f2(Math.min(dev.pct, 1), 2)}" step="0.1" min="0" max="${f2(dev.pct, 2)}"><span class="suf">% · max ${f2(dev.pct, 2)}%</span>`, { full: true })}
    ${burn ? "" : pf("Lock duration", `<input type="number" id="bl-d" value="30" min="1"><span class="suf">days</span>`, { full: true, help: `Keep at least 0.2 SOL in the developer wallet for the lock (it has ${f2(dev.sol, 3)} SOL).` })}</div>`, cls: burn ? "danger" : "",
    right: [burn ? "Burn" : "Lock", async d => { const pv = +d.querySelector("#bl-p").value; if (!(pv > 0) || pv > dev.pct + 1e-6) { toast(`Enter between 0 and ${f2(dev.pct, 2)}% (what the developer wallet holds)`, "warn"); return false } const ok = await lAct(kind, { pct: pv, days: +((d.querySelector("#bl-d") || {}).value || 0) }); if (!ok) return false; toast(burn ? "Tokens burned" : "Tokens locked via Streamflow") }] });
}
// ---------------------------------------------------------------- Fees & costs (live): what the launch has paid so far
const FEE_INFO = { network: ["Network fee", "Solana charges 0.000005 SOL for every transaction, no matter what."], priority: ["Speed fee (priority)", "Extra paid so a transaction goes through fast. Costs about 3× more in the first 30 seconds after launch, when everyone rushes."],
  trade: ["Trading fee", "pump.fun takes 1.25% of every buy and sell on the curve (0.95% to pump.fun, 0.30% to the coin's creator). After the coin moves to PumpSwap, PumpSwap's fees apply instead."], tips: ["Tips to go first (Jito)", "Paid to make several transactions land together in one block: the launch bundle and bundle-mode volume."],
  rent: ["Account deposit (rent)", "0.00151384 SOL the first time a wallet holds the coin, to open its coin account, plus 0.0013462 SOL on a wallet's first pump.fun buy for pump.fun's volume account (Oct 2026 rates). You get it back if the account is closed."], cex: ["Exchange fee", "The cut an exchange keeps when it sends SOL to your wallets (0.25%–0.5% through Husher)."], platform: ["Tool's 5%", "The tool keeps 5% of the SOL from its sells (Sell, AutoSell, Nuke, Sniper Guard). Buybacks are free."] };
function feeSpark(series, w = 480, h = 90) {
  if (!series || series.length < 2) return `<p class="help">Not enough data yet.</p>`;
  const t0 = Math.min(...series.map(p => p[0])), t1 = Math.max(...series.map(p => p[0])) || 1, mx = Math.max(...series.map(p => p[1])) || 1;
  const X = t => (t - t0) / ((t1 - t0) || 1) * (w - 8) + 4, Y = v => h - 6 - v / mx * (h - 14);
  const d = series.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="fee-spark"><path d="${d}L${X(t1)} ${h - 6}L${X(t0)} ${h - 6}z" class="a"/><path d="${d}" class="l"/><text x="4" y="12">${f2(mx, 3)} SOL</text><text x="${w - 4}" y="${h - 1}" text-anchor="end">${t0 < 0 ? "pre-launch → " : ""}${mmss(Math.max(0, t1))}</text></svg>`;
}
function openFees() {
  if (!LST || !LST.fees) { toast("Fees show once a launch is live", "warn"); return }
  const F = LST.fees, cats = Object.entries(F.cats).sort((a, b) => b[1].sum - a[1].sum), fmtS = x => x >= 0.01 ? f2(x, 4) : x.toFixed(6);
  popup({ title: "Fees & costs", width: 640, body: `<div class="fee-top"><div><small>Fees paid so far</small><b class="down">−${f2(F.total, 4)} SOL</b>${SOLUSD ? `<span class="mute">≈ $${fmt(F.total * SOLUSD, 2)}</span>` : ""}</div>
      <div><small>Funder</small><b>${f2(LST.funder_sol, 3)} <span class="mute">/ ${f2(F.funder_start, 2)} SOL deposited</span></b></div><div><small>Priority fee median</small><b>${fmtS(F.prio_median)} SOL</b></div></div>
    ${feeSpark(F.series)}
    <table class="fee-t"><thead><tr><th>Cost</th><th>Total</th><th>Txs</th><th>Min</th><th>Avg</th><th>Max</th></tr></thead><tbody>${cats.map(([k, v]) => `<tr title="${esc((FEE_INFO[k] || [k, ""])[1])}"><td><b>${(FEE_INFO[k] || [k])[0]}</b><small>${esc((FEE_INFO[k] || ["", ""])[1])}</small></td><td>${fmtS(v.sum)}</td><td>${fmt(v.n, 0)}</td><td>${fmtS(v.min)}</td><td>${fmtS(v.avg)}</td><td>${fmtS(v.max)}</td></tr>`).join("")}</tbody></table>
    <div class="sec-t" style="margin-top:14px">Who paid the most</div><div class="est-list">${F.top.map(t => `<div><span>${esc(t.who)}</span><b>−${fmtS(t.sol)} SOL</b></div>`).join("") || "<div><span>Nobody yet</span></div>"}</div>
    <p class="help">All amounts are sandbox SOL paid by your launch wallets (Funder, dev, MEV layers, holders). Outside traders pay their own fees and aren't counted. Trade fees include the creator share, which you can claim back with Claim Rewards.</p>`, left: ["Close"] });
}
// ---------------------------------------------------------------- Archived: saved launches and drafts for later analysis
// Each live launch can be archived with its chart (trades), the detector's read and report, timeline, fees and P&L;
// drafts keep their settings. Stored in this browser; Export gives a JSON file for outside analysis.
let ARCH = lsGet("lc-archive", []), AQ = "", AF = "all", AVIEW = null;
function saveArchive() {
  for (let n = ARCH.length; n >= 0; n--) { try { localStorage.setItem("lc-archive", JSON.stringify(ARCH)); return true } catch (e) { const big = ARCH.filter(a => a.trades && a.trades.length).sort((x, y) => x.at - y.at)[0]; if (!big) break; big.trades = []; big.trimmed = true } }
  toast("Browser storage is full: export older runs and delete them", "warn"); return false;
}
function archiveLive() {
  if (!LST) return;
  const e = { id: "L" + Date.now(), kind: "launch", name: WCFG.name, ticker: tick(), at: Date.now(), t: LST.t, mc: LST.mc_sol, migrated: LST.migrated, config: JSON.parse(JSON.stringify(WCFG)),
    trades: TRADES.slice(0, 12000), read: LST.read || null, report: LST.report || [], timeline: LST.timeline || [], fees: LST.fees || null, pnl: LST.pnl2 || null, holders: LST.holders ? { count: LST.holders.count, top10: LST.holders.top10 } : null, autos: (LST.autos || []).map(a => a.title + " · " + a.status) };
  if (TRADES.length > 12000) e.trimmed = true;
  ARCH.unshift(e); saveArchive(); renderNavBadge(); toast(`${WCFG.name} archived at ${mmss(LST.t)} · ${TRADES.length} trades`);
}
function archiveDraft() { ARCH.unshift({ id: "D" + Date.now(), kind: "draft", name: WCFG.name, ticker: tick(), at: Date.now(), config: JSON.parse(JSON.stringify(WCFG)) }); saveArchive(); renderNavBadge() }
function renderNavBadge() { const a = document.querySelector('.nav a[data-r="archived"] .badge'); if (a) a.textContent = ARCH.length }
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago" };
function renderArchived() {
  const el = $("archived-page"); if (!el) return;
  if (AVIEW) { renderArchiveView(); return }
  const list = ARCH.filter(a => (AF === "all" || (AF === "live" ? a.kind === "launch" : a.kind === "draft")) && (!AQ || (a.name + " " + a.ticker).toLowerCase().includes(AQ)));
  el.innerHTML = `<div class="ar-top"><b>${ARCH.length} Archived Launches</b><div class="pf-i sm ar-q"><span class="ic">${ICON("search")}</span><input placeholder="Search name, ticker…" value="${esc(AQ)}" oninput="AQ=this.value.toLowerCase();clearTimeout(this.t);this.t=setTimeout(()=>{renderArchived();const i=document.querySelector('.ar-q input');i.focus();i.setSelectionRange(i.value.length,i.value.length)},150)"></div><span class="sp"></span>
      <span class="mute">Sort by Newest</span><div class="seg mini">${[["live", "Launches"], ["draft", "Drafts"], ["all", "All"]].map(([k, n]) => `<button class="${AF === k ? "on" : ""}" onclick="AF='${k}';renderArchived()">${n}</button>`).join("")}</div></div>
    ${list.length ? `<div class="ar-grid">${list.map(a => { const pl = a.pnl ? a.pnl.if_exit : null;
      return `<div class="ar-card"><div class="ar-h"><div class="avatar">${esc((a.name || "T").slice(0, 2).toUpperCase())}</div><div class="ar-n"><b>$${esc(a.ticker)} <span class="mute">${esc(a.name)}</span></b><small><span class="marks">${mark("PumpFun")}</span><span class="pill">${a.kind === "launch" ? `${mmss(a.t)} sim · ${mcFmt(a.mc)}` : esc(a.config.mode + (a.config.mode === "block0" ? " · " + a.config.preset : ""))}</span><span class="pill">${ICON("clock")}${ago(a.at)}</span></small></div>
        ${pl != null ? `<span class="ar-pl ${pl >= 0 ? "up" : "down"}">${pl >= 0 ? "+" : ""}${f2(pl, 2)} SOL</span>` : ""}<span class="ar-k ${a.kind}">${a.kind === "launch" ? "Live" : "Draft"}</span></div>
        <div class="ar-f">${a.kind === "launch" ? `<button class="link" onclick="AVIEW='${a.id}';renderArchived()">See Launch</button>` : ""}<button class="link" onclick="restoreArchive('${a.id}')">Restore</button><button class="link" onclick="exportArchive('${a.id}')">Export</button><button class="link del" onclick="deleteArchive('${a.id}')">Delete</button></div></div>` }).join("")}</div>`
      : `<div class="empty" style="padding:60px 10px">${ICON("archive").replace('class="i"', 'class="i" style="width:30px;height:30px;color:var(--signal)"')}<h2>Nothing archived yet</h2><p>Archive a live launch from the Workspace (top right) to keep its chart, the detector's read, fees and P&L for later. Drafts can be archived from the Funding page.</p></div>`}`;
}
function renderArchiveView() {
  const a = ARCH.find(x => x.id === AVIEW), el = $("archived-page"); if (!a) { AVIEW = null; renderArchived(); return }
  const p = a.pnl, F = a.fees;
  el.innerHTML = `<div class="ar-top"><button class="btn sm" onclick="AVIEW=null;renderArchived()">← Archived</button><b>$${esc(a.ticker)} <span class="mute">${esc(a.name)}</span></b><span class="pill">${mmss(a.t)} sim · ${ago(a.at)}</span>${a.trimmed ? `<span class="pill">chart trimmed to fit storage</span>` : ""}<span class="sp"></span><button class="btn sm" onclick="restoreArchive('${a.id}')">Restore settings</button><button class="btn sm" onclick="exportArchive('${a.id}')">${ICON("download")}Export JSON</button></div>
    <div class="ar-body">${a.trades && a.trades.length ? chartCard("a-", "ACH") : `<div class="card"><p class="help">No chart stored for this run.</p></div>`}
      <div class="ar-cols"><div class="card"><h3>P&L at archive time</h3>${p ? `<div class="kv"><span>Deposited</span><span>${f2(p.deposited, 2)}</span><span>SOL in wallets</span><span>${f2(p.sol_now, 2)}</span><span>Real exit value</span><span>${f2(p.exit_sol, 2)}</span><span>Paper value</span><span>${f2(p.paper_sol, 2)}</span><span class="tot">If exited then</span><span class="tot ${p.if_exit >= 0 ? "up" : "down"}">${f2(p.if_exit, 2)}</span><span>Fees paid</span><span class="down">−${f2(p.fees, 3)}</span></div>` : '<p class="help">—</p>'}</div>
        <div class="card"><h3>Fees by kind</h3>${F ? `<div class="kv">${Object.entries(F.cats).sort((x, y) => y[1].sum - x[1].sum).map(([k, v]) => `<span>${(FEE_INFO[k] || [k])[0]} <span class="mute">(${v.n})</span></span><span>${f2(v.sum, 4)}</span>`).join("")}</div>` : '<p class="help">—</p>'}</div>
        <div class="card"><h3>What the chain showed</h3>${(a.report || []).map(r => `<div class="sigrow"><span class="lv ${r.level}">${r.level.toUpperCase()}</span><b>${esc(r.name)}</b><span class="v">${esc(r.value)}</span></div>`).join("") || '<p class="help">—</p>'}</div></div>
      ${a.read ? readTimeline(a.read) : ""}
      <div class="card" style="margin-top:12px"><h3>Settings and automations</h3><p class="help">${esc(a.config.mode)}${a.config.mode === "block0" ? " · " + esc(a.config.preset) : ""} · ${a.config.wallets} holders · dev ${a.config.dev_buy_pct}% · organic ${a.config.org_enabled ? esc(a.config.org_level) : "off"}</p>${(a.autos || []).map(x => `<div class="help">• ${esc(x)}</div>`).join("")}</div></div>`;
  if (a.trades && a.trades.length) requestAnimationFrame(() => { window.ACH = new LiveChart($("a-chart"), $("a-chartwrap"), "a-", "ACH"); ACH.title = a.name; ACH.add(a.trades); ACH.setNow(a.t, a.timeline || []); if (a.read) { ACH.setRead(a.read); ACH.color = "read" } ACH.renderLegend(); ACH.reset(); ACH.followMode = false });
}
function restoreArchive(id) { const a = ARCH.find(x => x.id === id); if (!a) return; const d = draftNew(JSON.parse(JSON.stringify(a.config))); DRAFT_ID = d.id; WCFG = d.config; WPLAN = null; PRE = PRE_NEW(); W_STEP = 2; show("create"); toast(`Restored ${a.name}: settings loaded`) }
function exportArchive(id) { const a = ARCH.find(x => x.id === id); if (!a) return; const blob = new Blob([JSON.stringify(a, null, 1)], { type: "application/json" }), u = URL.createObjectURL(blob), l = document.createElement("a"); l.href = u; l.download = `launch-control-${a.ticker}-${new Date(a.at).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`; document.body.append(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000) }
function deleteArchive(id) { const a = ARCH.find(x => x.id === id); if (!a) return; popup({ title: "Delete archived run", width: 420, cls: "danger", body: `<p class="help lead">Delete <b>$${esc(a.ticker)}</b> (${a.kind === "launch" ? "archived launch" : "draft"}) from this browser? Export it first if you want to keep the data.</p>`, right: ["Delete", () => { ARCH = ARCH.filter(x => x.id !== id); saveArchive(); renderNavBadge(); renderArchived() }] }) }
// ---------------------------------------------------------------- Simulation settings (Funding page, flask icon)
function openSimSettings() {
  const d = popup({ title: "Simulation settings", width: 640, body: simSettingsHTML(), left: ["Close"], right: ["Done", () => { WPLAN = null; wPlan(); setTimeout(rerenderStage, 300) }] });
  const m = d.querySelector(".m-b");
  const redraw = () => { const top = m.scrollTop; m.innerHTML = simSettingsHTML(); m.scrollTop = top };
  m.addEventListener("change", e => { const el = e.target, k = el.dataset.w, km = el.dataset.wm;
    if (k) { const t = fieldDef(k)[2]; WCFG[k] = t === "bool" ? el.checked : (t === "int" || t === "float") ? +el.value : el.value }
    if (km) WCFG[km] = [...m.querySelectorAll(`[data-wm="${km}"]:checked`)].map(x => x.value);
    WPLAN = null; redraw() });
  m.addEventListener("click", e => { if (e.target.closest(".opt")) setTimeout(redraw, 0) });   // the level cards call wSet, which re-renders the page underneath
}
// Volume Bot before launch: saved on the plan and started by the launch itself (at "Start at"), with the plan's wallets
function openVolumeBotPlan() { openVolumeBot(true) }
// hover labels for wallets (role, layer, buy %, funding), like the tool's wallet hovers
document.addEventListener("mouseover", e => { const t = e.target.closest("[data-tip]"); if (!t) return; tip(e, t.dataset.tip); t.addEventListener("mouseleave", () => tip(null, null), { once: true }) });
document.addEventListener("mousemove", e => { const t = e.target.closest("[data-tip]"); if (t) tip(e, t.dataset.tip) });
const ROLE_FULL = { op_dev: "Deployer", op_front: "Front MEV", op_back: "Back MEV", op_temp: "Temp Holder", op_holder: "Holder", op_empty: "Empty Holder", op_relay: "Relay", op_volume: "Volume wallet", op_funder: "Funder" };
const ROLE_WHAT = { op_dev: "Deploys the token and makes the Dev Buy.", op_front: "Buys in the deploy block (Block-0 bundle).", op_back: "Buys back from Front MEV right after deploy.", op_temp: "Receives supply by token transfer, then hands it on.", op_holder: "Final holder wallet.", op_empty: "Funded, makes no launch buy.", op_relay: "Pays buyback SOL between layers.", op_volume: "Trades for the Volume Bot." };
const walletTip = (name, role, extra = "") => esc(`<b>${esc(name)}</b> · ${ROLE_FULL[role] || role}<br><span class="mute">${ROLE_WHAT[role] || ""}</span>${extra}`);

// ================================================================ drafts (left column) + dashboard
// Drafts are kept like the tool's sidebar list: each one its own launch settings, saved in this browser.
// Right-click (or ⋯) on a sidebar launch: Archive / Clone (as the tool) plus Delete.
let DRAFTS = [], DRAFT_ID = null, LIVE_CFG = null;
const draftOf = id => DRAFTS.find(x => x.id === id);
const cfgTick = c => esc(c.ticker || (c.name || "TOKEN").slice(0, 6).toUpperCase());
const cfgAvatar = c => `<div class="avatar">${esc((c.name || "T").slice(0, 2).toUpperCase())}</div>`;
function saveDrafts() { const d = draftOf(DRAFT_ID); if (d && WCFG === d.config) d.step = W_STEP; lsSet("lc-drafts", DRAFTS.map(x => ({ id: x.id, at: x.at, step: x.step, config: x.config }))) }
function draftNew(cfg) { cfg.funder_deposit = Math.max(+cfg.funder_deposit || 0, 1000); const d = { id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), step: 0, config: cfg }; DRAFTS.unshift(d); saveDrafts(); return d }
function draftsBoot() {
  DRAFTS = (lsGet("lc-drafts", []) || []).filter(d => d && d.config);
  if (!DRAFTS.length) { const c = JSON.parse(JSON.stringify(BUILTIN["SHARDS reconstruction"])); c.name = "SANDBOX"; draftNew(c) }
  for (const d of DRAFTS) d.config.funder_deposit = Math.max(+d.config.funder_deposit || 0, 1000);   // sandbox Funder: 1,000 SOL
  DRAFT_ID = DRAFTS[0].id; WCFG = DRAFTS[0].config;
}
function draftOpen(id) { const d = draftOf(id); if (!d) return; saveDrafts(); DRAFT_ID = id; WCFG = d.config; WPLAN = null; PRE = PRE_NEW(); W_STEP = d.step || 0; show("create") }
// a new launch starts like the tool's Create Launch: pump.fun, Block-0 Quick, nothing planned yet (no Volume Bot, Auto Sell or scripted dump)
function draftFresh() { const c = Object.assign(JSON.parse(JSON.stringify(DEFAULTS || BUILTIN["Blank (everything off)"])), { name: "Untitled", launchpad: "pumpfun", vb_enabled: false, as_enabled: false, ab_enabled: false, sg_enabled: false, cl_enabled: false, exit_enabled: false }); delete c.ticker; const d = draftNew(c); DRAFT_ID = d.id; WCFG = c; WPLAN = null; PRE = PRE_NEW(); W_STEP = 0 }
function draftDrop(id) { DRAFTS = DRAFTS.filter(x => x.id !== id); if (DRAFT_ID === id) { DRAFT_ID = null; if (ROUTE === "create") { show(LST ? "live" : "dashboard") } } saveDrafts(); renderLaunchList() }
// the launch that is live keeps its own settings; drafts opened meanwhile don't touch it
function useLiveCfg() { if (LST && LIVE_CFG) WCFG = LIVE_CFG }
function endLive() { lSpeed(0); LST = null; LIVE_CFG = null; TRADES = []; LSEL.clear(); $("live-empty").hidden = false; $("ws").hidden = true; statusBar(); const d = draftOf(DRAFT_ID); if (d) WCFG = d.config; if (ROUTE === "live") show("dashboard"); else renderLaunchList() }
function launchMenu(e, kind, id) {
  e.preventDefault(); e.stopPropagation(); document.querySelectorAll(".ctx-menu").forEach(x => x.remove());
  const c = kind === "live" ? LIVE_CFG || WCFG : (draftOf(id) || {}).config; if (!c) return;
  const m = document.createElement("div"); m.className = "ctx-menu"; m.setAttribute("role", "menu");
  m.innerHTML = `<div class="cm-h">$${cfgTick(c)} · ${esc(c.name || "")}</div><button data-a="archive">${ICON("archive")}Archive</button><button data-a="clone">${ICON("copy")}Clone</button><hr><button data-a="delete" class="danger">${ICON("trash")}Delete</button>`;
  document.body.append(m); const r = e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
  const x = e.clientX || (r ? r.right - 20 : 100), y = e.clientY || (r ? r.bottom : 100); m.style.left = Math.min(x, innerWidth - 200) + "px"; m.style.top = Math.min(y, innerHeight - 160) + "px";
  const close = () => { m.remove(); removeEventListener("mousedown", out, true); removeEventListener("keydown", esc_) }, out = ev => { if (!m.contains(ev.target)) close() }, esc_ = ev => { if (ev.key === "Escape") close() };
  setTimeout(() => { addEventListener("mousedown", out, true); addEventListener("keydown", esc_) });
  m.addEventListener("click", ev => { const b = ev.target.closest("[data-a]"); if (!b) return; close(); const a = b.dataset.a;
    if (a === "clone") { const cc = JSON.parse(JSON.stringify(c)); cc.name = (c.name || "Launch") + " copy"; delete cc.ticker; const d = draftNew(cc); draftOpen(d.id); toast(`Cloned $${cfgTick(c)} as a new draft`); return }
    if (a === "archive") {
      if (kind === "live") {   // ending a live launch is not undoable: ask, and offer the top bar's keep-running copy too
        const d = popup({ title: "Archive the live launch", width: 460, body: `<p class="help lead">Archive saves the whole run of <b>$${cfgTick(c)}</b> (chart, read, fees, P&amp;L) under Archived.</p><p class="help">Archive and end also stops the launch. To keep it running, save a copy instead.</p><button type="button" class="btn" data-copy style="margin-top:6px">${ICON("archive")}Save a copy, keep running</button>`,
          right: ["Archive and end", () => { archiveLive(); endLive() }] });
        d.querySelector("[data-copy]").addEventListener("click", () => { archiveLive(); d.querySelector("[data-close]").click() });
        return }
      else { ARCH.unshift({ id: "D" + Date.now(), kind: "draft", name: c.name, ticker: cfgTick(c), at: Date.now(), config: JSON.parse(JSON.stringify(c)) }); saveArchive(); renderNavBadge(); draftDrop(id) }
      toast(`$${cfgTick(c)} archived`); return }
    popup({ title: kind === "live" ? "Delete launch" : "Delete draft", width: 420, cls: "danger", body: `<p class="help lead">Delete <b>$${cfgTick(c)}</b> (${esc(c.name || "")})${kind === "live" ? ", the running sandbox launch, without archiving it" : ""}? This can't be undone. Use Archive instead to keep it.</p>`,
      right: ["Delete", () => { if (kind === "live") endLive(); else draftDrop(id); toast(`$${cfgTick(c)} deleted`) }] });
  });
}

// ---------------------------------------------------------------- Dashboard (the tool's account page: P&L across launches)
let DASH_TF = "all", DASH_TAB = "recent", DASH_MODE = "line";
const dashNet = a => a.pnl ? (a.pnl.if_exit ?? a.pnl.realised ?? 0) : null;
function dashRuns() {
  const runs = ARCH.filter(a => a.kind === "launch" && a.pnl).map(a => ({ id: a.id, name: a.name, ticker: a.ticker, at: a.at, net: dashNet(a), live: false }));
  if (LST && LST.pnl2) runs.unshift({ id: "live", name: (LIVE_CFG || WCFG).name, ticker: cfgTick(LIVE_CFG || WCFG), at: Date.now(), net: LST.pnl2.if_exit, live: true });
  const span = { "24h": 864e5, "7d": 6048e5, "30d": 2592e6, "1y": 31536e6 }[DASH_TF];
  return runs.filter(r => !span || Date.now() - r.at <= span);
}
const usdOrSol = v => SOLUSD ? `${v < 0 ? "−" : ""}$${Math.abs(v * SOLUSD).toFixed(2)}` : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(3)} SOL`;
const agoFmt = t => { const s = (Date.now() - t) / 1e3; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago" };
function renderDashboard() {
  const el = $("dashboard-page"); if (!el) return;
  const runs = dashRuns(), tot = runs.reduce((a, r) => a + r.net, 0), n = runs.length, big = usdOrSol(tot), dot = big.lastIndexOf(".");
  const rows = (DASH_TAB === "best" ? runs.slice().sort((a, b) => b.net - a.net) : runs.slice().sort((a, b) => b.at - a.at)).slice(0, 20);
  el.innerHTML = `<div class="dash">
    <div class="dash-banner"><div class="db-dots"><i></i><i></i><i></i><i></i></div></div>
    <div class="dash-id"><div class="dash-av">${ICON("rocket")}</div><div class="dash-nm"><b>Sandbox researcher</b><small>@launch-control</small></div><span class="sp"></span>
      <button class="btn primary sm" onclick="newLaunch()">${ICON("plus")}Create launch</button><button class="btn sm" onclick="dashExport()">${ICON("share")}Export runs</button></div>
    <div class="dash-pnl"><div><small>P&L</small><div class="big ${tot >= 0 ? "up" : "down"}">${n ? `${dot > 0 ? big.slice(0, dot) + `<span>${big.slice(dot)}</span>` : big}` : "–"}</div><p class="help">${{ "24h": "24 hours", "7d": "7 days", "30d": "30 days", "1y": "1 year", all: "All time" }[DASH_TF]} · ${n} launch${n === 1 ? "" : "es"}</p></div>
      <span class="sp"></span><div class="seg" id="dash-tf">${[["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["1y", "1Y"], ["all", "All time"]].map(([k, l]) => `<button class="${DASH_TF === k ? "on" : ""}" onclick="DASH_TF='${k}';renderDashboard()">${l}</button>`).join("")}</div><button class="btn sm" onclick="dashCalendar()">${ICON("calendar")}P&L Calendar</button></div>
    <div class="dash-chart"><div class="dc-modes">${[["line", "trend", "Cumulative P&L"], ["bar", "chart", "P&L per launch"]].map(([k, ic, t]) => `<button class="${DASH_MODE === k ? "on" : ""}" title="${t}" aria-label="${t}" onclick="DASH_MODE='${k}';renderDashboard()">${ICON(ic)}</button>`).join("")}</div><canvas id="dash-cv"></canvas><div class="dash-tip" id="dash-tip" hidden></div>
      ${n ? "" : `<div class="dash-empty"><b>No finished launches yet</b><p class="help">Launch in the sandbox, then Archive it from the sidebar (right-click) or the top bar. Its P&L lands here.</p></div>`}</div>
    <div class="dash-stats"><div><small>Avg. P&L / launch</small><b class="${n && tot / n < 0 ? "down" : ""}">${n ? usdOrSol(tot / n) : "–"}</b></div><div><small>Total launches</small><b>${n}</b></div></div>
    <div class="dash-tabs"><button class="${DASH_TAB === "recent" ? "on" : ""}" onclick="DASH_TAB='recent';renderDashboard()">Recent launches</button><span></span><button class="${DASH_TAB === "best" ? "on" : ""}" onclick="DASH_TAB='best';renderDashboard()">Best P&L</button></div>
    <div class="dash-table"><table><thead><tr><th>Launch</th><th>Launchpad</th><th>Net P&L</th><th style="text-align:right">Launched</th></tr></thead><tbody>
      ${rows.map(r => `<tr onclick="${r.live ? "show('live')" : `AVIEW='${r.id}';show('archived')`}"><td><div class="dl">${cfgAvatar(r)}<div><b>${esc(r.name)}</b><small>$${esc(r.ticker)}</small></div>${r.live ? '<span class="pill live">Live</span>' : ""}</div></td><td><span class="mark">${MARKS.PumpFun || ""}</span></td><td class="data ${r.net >= 0 ? "up" : "down"}">${usdOrSol(r.net)}</td><td class="mute" style="text-align:right">${r.live ? "running" : agoFmt(r.at)}</td></tr>`).join("") || `<tr><td colspan="4" class="mute" style="text-align:center;padding:22px">No launches in this period.</td></tr>`}
    </tbody></table></div></div>`;
  requestAnimationFrame(() => dashDraw(runs));
}
function dashDraw(runs) {
  const cv = $("dash-cv"); if (!cv) return; const W = cv.clientWidth, H = 220, d = devicePixelRatio || 1; cv.width = W * d; cv.height = H * d; const x = cv.getContext("2d"); x.setTransform(d, 0, 0, d, 0, 0);
  const css = getComputedStyle(document.documentElement), col = v => css.getPropertyValue(v).trim(), up = col("--up"), dn = col("--down"), grid = col("--line"), mute = col("--muted");
  const rs = runs.slice().sort((a, b) => a.at - b.at); if (!rs.length) return;
  const k = SOLUSD || 1, L = 46, R = 74, T = 14, B = 10, PW = W - L - R, PH = H - T - B;
  let cum = 0; const pts = rs.map(r => ({ r, v: (cum += r.net) * k, one: r.net * k }));
  const vals = DASH_MODE === "line" ? pts.map(p => p.v).concat(0) : pts.map(p => p.one).concat(0), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo || 1) * 0.12;
  const y0 = lo - pad, y1 = hi + pad, Y = v => T + (y1 - v) / (y1 - y0) * PH;
  x.font = "11px " + (col("--f-data") || "monospace"); x.fillStyle = mute; x.strokeStyle = grid; x.lineWidth = 1;
  for (let i = 0; i <= 3; i++) { const v = y0 + (y1 - y0) * i / 3, yy = Math.round(Y(v)) + .5; x.beginPath(); x.moveTo(L, yy); x.lineTo(W - R, yy); x.stroke(); x.fillText(`${v < 0 ? "−" : ""}${SOLUSD ? "$" : ""}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: Math.abs(y1 - y0) < 5 ? 2 : 0 })}${SOLUSD ? "" : " SOL"}`, W - R + 8, yy + 4) }
  const yz = Y(0), hit = [];
  if (DASH_MODE === "line") {
    const X = i => L + (pts.length === 1 ? PW / 2 : i / (pts.length - 1) * PW), last = pts[pts.length - 1].v, c = last >= 0 ? up : dn;
    const g = x.createLinearGradient(0, T, 0, T + PH); g.addColorStop(0, c + "33"); g.addColorStop(1, c + "00");
    x.beginPath(); x.moveTo(X(0), yz); pts.forEach((p, i) => x.lineTo(X(i), Y(p.v))); x.lineTo(X(pts.length - 1), yz); x.closePath(); x.fillStyle = g; x.fill();
    x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(i), Y(p.v)) : x.moveTo(X(i), Y(p.v))); x.strokeStyle = c; x.lineWidth = 2; x.stroke();
    pts.forEach((p, i) => hit.push([X(i), Y(p.v), p, "Cumulative"])); const lp = hit[hit.length - 1]; x.fillStyle = c; x.beginPath(); x.arc(lp[0], lp[1], 4, 0, 6.283); x.fill();
  } else {
    const bw = Math.max(4, Math.min(36, PW / pts.length - 4));
    pts.forEach((p, i) => { const cx = L + (i + .5) / pts.length * PW, top = Math.min(Y(p.one), yz), h = Math.max(2, Math.abs(Y(p.one) - yz)); x.fillStyle = p.one >= 0 ? up : dn; x.beginPath(); x.roundRect(cx - bw / 2, top, bw, h, p.one >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]); x.fill(); hit.push([cx, Y(p.one), p, "This launch"]) });
  }
  const tipEl = $("dash-tip");
  cv.onmousemove = e => { const r = cv.getBoundingClientRect(), mx = e.clientX - r.left; let best = null; for (const h of hit) if (!best || Math.abs(h[0] - mx) < Math.abs(best[0] - mx)) best = h;
    if (!best || Math.abs(best[0] - mx) > 40) { tipEl.hidden = true; return } const p = best[2]; tipEl.hidden = false; tipEl.style.left = Math.min(best[0] + 10, W - 190) + "px"; tipEl.style.top = Math.max(0, best[1] - 50) + "px";
    tipEl.innerHTML = `<b>${esc(p.r.name)}</b> <span class="mute">$${esc(p.r.ticker)}</span><br>This launch <b class="${p.one >= 0 ? "up" : "down"}">${usdOrSol(p.r.net)}</b>${DASH_MODE === "line" ? `<br>Running total <b>${usdOrSol(p.v / k)}</b>` : ""}<br><span class="mute">${p.r.live ? "running now" : new Date(p.r.at).toLocaleString()}</span>` };
  cv.onmouseleave = () => { tipEl.hidden = true };
}
// P&L Calendar with month navigation (‹ ›); shows net P&L per day of the launches in that month
function dashCalendar() {
  const runs = dashRuns(); let off = 0;
  const body = () => {
    const now = new Date(), ref = new Date(now.getFullYear(), now.getMonth() + off, 1), y = ref.getFullYear(), mo = ref.getMonth(), first = ref.getDay(), days = new Date(y, mo + 1, 0).getDate(), by = {};
    for (const r of runs) { const t = new Date(r.at); if (t.getFullYear() === y && t.getMonth() === mo) by[t.getDate()] = (by[t.getDate()] || 0) + r.net }
    const tot = Object.values(by).reduce((a, b) => a + b, 0), n = Object.keys(by).length;
    const cells = Array.from({ length: first }, () => "<div></div>").concat(Array.from({ length: days }, (_, i) => { const v = by[i + 1]; return `<div class="cal-d ${v == null ? "" : v >= 0 ? "pos" : "neg"}"><span>${i + 1}</span>${v != null ? `<b>${usdOrSol(v)}</b>` : ""}</div>` }));
    return `<div class="cal-nav"><button type="button" class="btn sm" data-m="-1" aria-label="Previous month">‹</button><b>${ref.toLocaleString(undefined, { month: "long", year: "numeric" })}</b><button type="button" class="btn sm" data-m="1" aria-label="Next month" ${off >= 0 ? "disabled" : ""}>›</button></div>
      <p class="help">${n ? `${n} day${n === 1 ? "" : "s"} with launches · net ${usdOrSol(tot)}` : "No launches finished this month."} Net P&amp;L per day of launches finished in the sandbox.</p>
      <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="cal-h">${d}</div>`).join("")}${cells.join("")}</div>`;
  };
  const d = popup({ title: "P&L Calendar", width: 560, left: ["Close"], body: body() }), m = d.querySelector(".m-b");
  m.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) { off += +b.dataset.m; m.innerHTML = body() } });
}
function dashExport() { const blob = new Blob([JSON.stringify(ARCH, null, 1)], { type: "application/json" }), u = URL.createObjectURL(blob), l = document.createElement("a"); l.href = u; l.download = `launch-control-runs-${new Date().toISOString().slice(0, 10)}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); toast(`Exported ${ARCH.length} archived run${ARCH.length === 1 ? "" : "s"}`) }
addEventListener("beforeunload", () => { try { saveDrafts() } catch (e) { } });

// ================================================================ Funding page controls, as the tool has them
// Folders (My Wallets + the row menu), wallets kept in My Wallets (MYW), per-plan wallet swaps (fresh / imported), funders.
let FOLD = lsGet("lc-folders", null) || [{ id: "holder", name: "HOLDER", color: "#46a758" }, { id: "notready", name: "NOT READY", color: "#e5484d" }, { id: "ready", name: "READY", color: "#8e4ec6" }];
let WFOLDER = lsGet("lc-wfolder", {}), MYW = lsGet("lc-lib", []);
const saveLib = () => { lsSet("lc-folders", FOLD); lsSet("lc-wfolder", WFOLDER); lsSet("lc-lib", MYW) };
const folderOf = (id, role) => WFOLDER[id] !== undefined ? WFOLDER[id] : role === "op_holder" || role === "op_empty" ? "holder" : role ? "ready" : "notready";
const folderColor = f => (FOLD.find(x => x.id === f) || {}).color || "#9aa3b2";
const swaps = () => (WCFG.w_swap = WCFG.w_swap || {});   // plan wallet id -> { addr, imported, lib }
const aliasOf = id => { const s = WCFG && WCFG.w_swap && WCFG.w_swap[id]; return s ? s.addr : id };
const isImported = id => !!(WCFG && WCFG.w_swap && WCFG.w_swap[id] && WCFG.w_swap[id].imported) || !!(WCFG && WCFG.w_imported && /op_holder/.test(((WPLAN && WPLAN.wallets.find(w => w.id === id)) || {}).role || ""));
const funderAddr = () => { PRE.funders = PRE.funders || [{ addr: fakeAddr("funder" + (WCFG ? WCFG.name : "")), bal: PRE.funder || 0 }]; return PRE.funders[PRE.fidx || 0].addr };
function planOrder(ws) { const o = (WCFG && WCFG.w_order) || []; if (!o.length) return ws; const ix = id => { const k = o.indexOf(id); return k < 0 ? 1e6 : k }; return ws.slice().sort((a, b) => ix(a.id) - ix(b.id)) }

// one small menu at the pointer (the tool's dropdowns)
function menuAt(e, html, onPick, cls = "", sub = false) {
  e.preventDefault && e.preventDefault(); e.stopPropagation(); document.querySelectorAll(sub ? ".ctx-menu.subm" : ".ctx-menu").forEach(x => x.remove());
  const m = document.createElement("div"); m.className = "ctx-menu " + cls; m.innerHTML = html; document.body.append(m);
  const r = e.rect || (e.currentTarget || e.target).getBoundingClientRect(), x = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)), y = r.bottom + 4 + m.offsetHeight > innerHeight ? r.top - m.offsetHeight - 4 : r.bottom + 4;
  m.style.left = x + "px"; m.style.top = Math.max(8, y) + "px";
  if (sub) { m.classList.add("subm"); m.style.left = Math.min(r.right + 4, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = Math.min(r.top - 4, innerHeight - m.offsetHeight - 8) + "px" }
  const close = () => { m.remove(); removeEventListener("mousedown", out, true); removeEventListener("keydown", k) }, out = ev => { if (!(ev.target.closest && ev.target.closest(".ctx-menu"))) { document.querySelectorAll(".ctx-menu").forEach(x => x.remove()); close() } }, k = ev => { if (ev.key === "Escape") { document.querySelectorAll(".ctx-menu").forEach(x => x.remove()); close() } };
  setTimeout(() => { addEventListener("mousedown", out, true); addEventListener("keydown", k) });
  m.addEventListener("click", ev => { const b = ev.target.closest("[data-a]"); if (!b) return; const keep = onPick(b.dataset.a, b, ev); if (!keep) { document.querySelectorAll(".ctx-menu").forEach(x => x.remove()); close() } });
  return m;
}
// Funding page row ⋯: the wallet, Replace by Fresh, Import Wallet, Export Private Key, Add to Folder ›
function openRowMenu(e, i) {
  const ws = planOrder(WPLAN.wallets), w = ws[i]; if (!w) return;
  menuAt(e, `<div class="cm-h">${esc(shortA(aliasOf(w.id)))}${isImported(w.id) ? " · imported" : ""}</div><button data-a="fresh">${ICON("repeat")}Replace by Fresh</button><button data-a="import">${ICON("download")}Import Wallet</button><button data-a="export">${ICON("key")}Export Private Key</button><hr><button data-a="folder" class="sub">${ICON("folder")}Add to Folder<span class="sp"></span>›</button>`, (a, b, ev) => {
    if (a === "fresh") { swaps()[w.id] = { addr: fakeAddr("fresh" + w.id + Date.now()), imported: false }; saveDrafts(); rerenderStage(); toast(`${w.name}: replaced by a fresh wallet`); return }
    if (a === "import") { openImportWallets(w); return }
    if (a === "export") { openExport(w.name); return }
    if (a === "folder") { folderMenu({ rect: b.getBoundingClientRect(), stopPropagation() { }, preventDefault() { } }, [w.id], true); return true }
  });
}
// folder picker with checkboxes (row menu submenu, row folder button, "Assign all to folder", My Wallets → Manage)
function folderMenu(e, ids, sub = false) {
  const state = f => ids.every(id => folderOf(id, (planWallet(id) || {}).role) === f);
  const m = menuAt(e, `${FOLD.map(f => `<button data-a="${f.id}"><span class="fi" style="color:${f.color}">${ICON("folder")}</span>${esc(f.name)}<span class="sp"></span><span class="cbx ${state(f.id) ? "on" : ""}">${state(f.id) ? ICON("check") : ""}</span></button>`).join("")}`, a => {
    const on = state(a); for (const id of ids) WFOLDER[id] = on ? "" : a; saveLib(); if (ROUTE === "create") rerenderStage(); if (ROUTE === "wallets") renderWalletsPage();
    toast(on ? `Removed from ${FOLD.find(f => f.id === a).name}` : `${ids.length > 1 ? ids.length + " wallets" : "Wallet"} added to ${FOLD.find(f => f.id === a).name}`);
  }, "fmenu", sub);
}
const planWallet = id => (WPLAN && WPLAN.wallets.find(w => w.id === id)) || (LST && LST.wallets && LST.wallets.find(w => w.id === id)) || null;
// footer ⋯: All N wallets
function openAllMenu(e, list) {
  const ws = list || planOrder(WPLAN.wallets).map(w => ({ id: aliasOf(w.id), name: w.name, key: w.id }));
  menuAt(e, `<div class="cm-h">All ${ws.length} wallets</div><button data-a="folder" class="sub">${ICON("folder")}Assign all to folder<span class="sp"></span>›</button><hr>${["Axiom", "GMGN", "BullX", "RayBot"].map(t => `<button data-a="t:${t}">${t} Tracker Export</button>`).join("")}`, (a, b) => {
    if (a === "folder") { folderMenu({ rect: b.getBoundingClientRect(), stopPropagation() { }, preventDefault() { } }, ws.map(w => w.key || w.id), true); return true }
    trackerExport(a.slice(2), ws);
  });
}
// tracker export: one file of addresses + names to import into a wallet tracker (sandbox addresses)
function trackerExport(tool, ws) {
  const tick = WCFG ? cfgTick(WCFG) : "TOKEN";
  const body = tool === "Axiom" || tool === "GMGN" ? JSON.stringify(ws.map((w, i) => ({ address: w.id, name: `${tick} ${w.name || "Wallet " + (i + 1)}`, emoji: "🧪" })), null, 1) : ws.map((w, i) => `${w.id},${tick} ${w.name || "Wallet " + (i + 1)}`).join("\n");
  const blob = new Blob([body], { type: "text/plain" }), u = URL.createObjectURL(blob), l = document.createElement("a"); l.href = u; l.download = `${tool.toLowerCase()}-tracker-${tick}.${tool === "Axiom" || tool === "GMGN" ? "json" : "txt"}`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  toast(`${tool} Tracker Export: ${ws.length} wallets (sandbox addresses)`);
}
// Token Buy %: edited in the cell, as the tool does (Enter or ✓ saves, Esc cancels)
// Token Buy % for one wallet: a number from 0 up to what the curve can sell (79.31% on pump.fun, 80% on Meteora DBC)
function tbCheck(raw) {
  const max = WCFG.launchpad === "meteora" ? 80 : 79.31, v = String(raw).trim() === "" ? NaN : +raw;
  if (!isFinite(v)) return [null, "Enter a number, e.g. 2.5"];
  if (v < 0) return [null, "Token Buy % can't be negative"];
  if (v > max) return [null, `One wallet can buy at most ${max}% (all the coins the curve sells)`];
  return [v, null];
}
function tbEdit(btn, i) {
  const w = planOrder(WPLAN.wallets)[i], td = btn.closest("td"), pct = (w.tokens || 0) / 1e7;
  td.innerHTML = `<span class="tb-ed"><input type="number" step="0.1" min="0" value="${f2(pct, 2).replace(/\.00$/, "")}" aria-label="Token Buy %"><span>%</span><button class="ic" aria-label="Save">${ICON("check")}</button></span>`;
  const inp = td.querySelector("input"); inp.focus(); inp.select();
  const save = () => { const [v, err] = tbCheck(inp.value); if (err) { toast(err, "warn"); inp.classList.add("bad"); inp.focus(); return } if (Math.abs(v - pct) < 1e-9) { rerenderStage(); return } WCFG.buy_overrides = Object.assign({}, WCFG.buy_overrides || {}, { [w.key]: v }); WPLAN = null; wPlan(); setTimeout(rerenderStage, 250); toast(`${w.name}: ${f2(v, 2)}%`) };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") save(); if (e.key === "Escape") rerenderStage() });
  td.querySelector("button").addEventListener("mousedown", e => { e.preventDefault(); save() });
  inp.addEventListener("blur", () => setTimeout(() => { if (td.isConnected && td.querySelector(".tb-ed")) { if (tbCheck(inp.value)[1]) rerenderStage(); else save() } }, 120));
}
// funding wallet ▾: funders, New Funder, Fresh Funder
function openFunderMenu(e) {
  funderAddr(); PRE.funders[PRE.fidx || 0].bal = PRE.funder || 0;
  menuAt(e, `${PRE.funders.map((f, i) => `<button data-a="f${i}"><span class="mono">${f.addr.slice(0, 4)}...${f.addr.slice(-4)}</span>${f.fresh ? '<span class="pill">fresh</span>' : ""}<span class="sp"></span><span class="mark">${MARKS.Solana}</span>${f2(f.bal, 2)}${i === (PRE.fidx || 0) ? ICON("check") : ""}</button>`).join("")}<hr><button data-a="new">${ICON("plus")}New Funder</button><button data-a="fresh">${ICON("sprout")}Fresh Funder</button>`, a => {
    if (a === "new" || a === "fresh") { const kind = a; PRE.funders.push({ addr: fakeAddr("funder" + Date.now() + a), bal: 0, fresh: kind === "fresh" }); a = "f" + (PRE.funders.length - 1); toast(kind === "fresh" ? "Fresh Funder created (no history)" : "New Funder created") }
    const i = +a.slice(1); PRE.funders[PRE.fidx || 0].bal = PRE.funder || 0; PRE.fidx = i; PRE.funder = PRE.funders[i].bal; rerenderStage();
  }, "funders");
}
// Delete (wallet table) = Delete Plan, as in the tool
function openDeletePlan() {
  popup({ title: "Delete Plan", width: 440, cls: "danger", body: `<p class="help lead">All wallets and settings in this plan will be permanently deleted.</p><div class="note warn">${ICON("alert")}<span>This action is irreversible. Any funds in pending transactions or already distributed to wallets may not be recoverable.</span></div>`,
    right: ["Confirm", () => { const id = DRAFT_ID; PRE = PRE_NEW(); WPLAN = null; draftDrop(id); toast("Plan deleted") }] });
}
// Rescue runs straight away, as in the tool: distributed SOL comes back to the Funder
// Rescue: every wallet's SOL goes back to the Funder (less network fees). Distribute is locked until it finishes, and the
// refund is what the wallets hold when it completes, so nothing is lost if buttons are pressed quickly.
function doRescue() {
  if (PRE.rescuing || PRE.phase === "distributing") return;
  PRE.rescuing = true; rerenderStage(); toast("Rescuing funding…");
  setTimeout(() => { const got = preDistributed(), back = got * 0.998; PRE.funder = (PRE.funder || 0) + back; PRE.dist = {}; PRE.phase = "draft"; PRE.prog = 0; PRE.rescuing = false; rerenderStage(); toast(got > 0 ? `Rescued ${f2(back, 3)} SOL to the Funder` : "Nothing to rescue: no SOL has been distributed") }, 900);
}
// Import Wallets (wide): pick wallets kept in My Wallets and assign them to this launch's roles
function openImportWallets(target) {
  const plan = WPLAN ? planOrder(WPLAN.wallets) : [], used = new Set(Object.values(swaps()).map(s => s.lib).filter(Boolean)), sel = new Set();
  let q = "", only = false, fold = "";
  const rec = MYW.filter(w => !used.has(w.id) && (w.acts || 0) > 0);
  const rows = () => MYW.filter(w => (!q || w.id.toLowerCase().includes(q)) && (!only || sel.has(w.id)) && (!fold || (WFOLDER[w.id] ?? "notready") === fold));
  const body = () => `<div class="iw-ban exp"><div><b><span>EXPERIMENTAL</span> Recommended Wallets</b><small>Our algorithm pre-selects best wallets for your launch.</small></div><button type="button" class="link" data-rec>${rec.length} Wallet${rec.length === 1 ? "" : "s"} Found ›</button></div>
    <div class="iw-ban mk"><div><b><span>MARKETPLACE</span> Need more wallets?</b><small>Buy extra wallets from the marketplace to avoid flags.</small></div><button type="button" class="link" data-mk>Marketplace ›</button></div>
    <div class="iw-bar"><div class="pf-i sm"><span class="ic">${ICON("search")}</span><input id="iw-q" placeholder="Search Wallet" value="${esc(q)}"></div><label class="tgl"><input type="checkbox" id="iw-only" ${only ? "checked" : ""}><i></i>Selected Only</label><span class="sp"></span>
      <div class="pf-i sel sm"><span class="ic">${ICON("folder")}</span><select id="iw-f"><option value="">All Folders</option>${FOLD.map(f => `<option value="${f.id}" ${fold === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></div><button type="button" class="btn sm" data-cols>${ICON("sliders")}Columns</button><button type="button" class="btn sm" data-hist>${ICON("clock")}History</button></div>
    <div class="iw-table scroll"><table><thead><tr><th style="width:28px"><input type="checkbox" data-all></th><th>Wallet</th><th>Balance</th><th>Launches</th><th>Funding</th></tr></thead><tbody>
      ${rows().map(w => { const inUse = used.has(w.id); return `<tr class="${inUse ? "dim" : ""}"><td><input type="checkbox" data-id="${w.id}" ${sel.has(w.id) ? "checked" : ""} ${inUse ? "disabled" : ""}></td><td><span class="mono">${shortA(w.id)}</span> <span class="fi" style="color:${folderColor(WFOLDER[w.id] ?? "notready")}">${ICON("folder")}</span></td><td><span class="mark">${MARKS.Solana}</span>${f2(w.bal, 2)}<br><small class="mute">≈${SOLUSD ? usdFmt(w.bal * SOLUSD) : "–"}</small></td><td>${w.launches || "–"}</td><td>${esc(w.src || "Wallet")}<br><small class="mute">${agoFmt(w.at)}</small></td></tr>` }).join("") || `<tr><td colspan="5" class="mute" style="padding:22px;text-align:center">No wallets in My Wallets yet. Create some on My Wallets (they can be funded and pre-aged there), or buy aged ones in the Marketplace.<br><button type="button" class="btn sm" style="margin-top:10px" data-mkw>${ICON("plus")}Create wallets in My Wallets</button></td></tr>`}
    </tbody></table></div>`;
  const title = target ? `Import Wallet` : "Import Wallets";
  const d = popup({ title, width: 760, head: `<div class="iw-h"><span class="iw-ic">${ICON("wallet")}</span><div><b>${title}</b><small>${target ? `Replace ${esc(target.name)} with a wallet from My Wallets.` : "Assign wallets to the roles required for your launch."}</small></div></div>`, body: body(), right: ["Import 0 Wallets", () => {
    const ids = [...sel]; if (!ids.length) return false;
    const slots = target ? [target] : plan.filter(w => /op_(holder|empty|front|back)/.test(w.role) && !(swaps()[w.id] && swaps()[w.id].imported));
    ids.slice(0, slots.length).forEach((lid, k) => { swaps()[slots[k].id] = { addr: lid, imported: true, lib: lid }; const L = MYW.find(x => x.id === lid); if (L) L.launches = (L.launches || 0) + 1 });
    WCFG.w_imported = true; saveLib(); saveDrafts(); rerenderStage();
    toast(ids.length > slots.length ? `Imported ${slots.length} wallets; ${ids.length - slots.length} more than this plan has roles for` : `Imported ${ids.length} wallet${ids.length === 1 ? "" : "s"} into the launch`);
  }, true] });
  const m = d.querySelector(".m-b"), upd = () => goBtn(d, `Import ${sel.size} Wallet${sel.size === 1 ? "" : "s"}`, sel.size > 0), redraw = () => { m.innerHTML = body(); upd() };
  m.addEventListener("change", e => { const t = e.target; if (t.dataset.id) { t.checked ? (target ? (sel.clear(), sel.add(t.dataset.id)) : sel.add(t.dataset.id)) : sel.delete(t.dataset.id); if (target) redraw(); else upd() } if (t.id === "iw-only") { only = t.checked; redraw() } if (t.id === "iw-f") { fold = t.value; redraw() } if (t.dataset.all !== undefined) { rows().forEach(w => { if (!used.has(w.id)) t.checked ? sel.add(w.id) : sel.delete(w.id) }); redraw() } });
  m.addEventListener("input", e => { if (e.target.id === "iw-q") { q = e.target.value.toLowerCase(); clearTimeout(m._t); m._t = setTimeout(() => { redraw(); const i = m.querySelector("#iw-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length) }, 150) } });
  m.addEventListener("click", e => {
    if (e.target.closest("[data-rec]")) { rec.forEach(w => sel.add(w.id)); redraw() }
    if (e.target.closest("[data-mk]")) { d.remove(); openAddWallets("market") }
    if (e.target.closest("[data-mkw]")) { d.remove(); show("wallets"); setTimeout(openCreateLib, 200) }
    if (e.target.closest("[data-cols]")) toast("Columns: Wallet, Balance, Launches, Funding");
    if (e.target.closest("[data-hist]")) toast(`${MYW.filter(w => w.launches).length} wallets used in earlier launches`);
  });
  upd();
}
// drag to reorder wallet rows (Funding page)
document.addEventListener("dragstart", e => { const h = e.target.closest && e.target.closest("[data-drag]"); if (!h) return; e.dataTransfer.setData("text/plain", h.dataset.drag); e.dataTransfer.effectAllowed = "move" });
document.addEventListener("dragover", e => { if (e.target.closest && e.target.closest(".fw-table tr")) e.preventDefault() });
document.addEventListener("drop", e => {
  const tr = e.target.closest && e.target.closest(".fw-table tbody tr"); if (!tr || !WPLAN) return; e.preventDefault();
  const from = +e.dataTransfer.getData("text/plain"), to = [...tr.parentNode.children].indexOf(tr), ws = planOrder(WPLAN.wallets).map(w => w.id); if (isNaN(from) || from === to) return;
  const [x] = ws.splice(from, 1); ws.splice(to, 0, x); WCFG.w_order = ws; saveDrafts(); rerenderStage();
});
// ---------------------------------------------------------------- My Wallets: create, fund, delete, folders
// My Wallets → Marketplace: aged sandbox wallets (funded a day or more ago, with past activity) go into My Wallets, ready to import
function openMarketLib() {
  const d = popup({ title: "Marketplace", width: 440, body: `<div class="aw-mk big">${ICON("cart")}<div><b>Aged wallets</b><small>Made 24 h+ ago from mixed sources, at least 25 min apart, each with past trades on other coins. They hold no SOL: fund them before use. Free in the sandbox.</small></div></div>
    <div class="pf-l" style="margin-top:12px">Wallets</div><div class="pf-i"><input type="number" id="mk-n" min="1" max="200" value="20"></div><p class="help">They are added to My Wallets (folder Ready). Use Import Wallets on a launch's Funding page to put them in a plan.</p>`,
    right: ["Add 20 Wallets", d => { const n = Math.trunc(+d.querySelector("#mk-n").value || 0); if (!(n > 0 && n <= 200)) { toast("Choose 1 to 200 wallets", "warn"); return false }
      const t = Date.now(), srcs = ["Binance", "Bybit", "KuCoin", "OKX", "Wallet"];
      for (let i = 0; i < n; i++) { const id = fakeAddr("mkt" + t + i); MYW.push({ id, at: t - (24 + Math.random() * 48) * 3600e3 - i * 25 * 60e3, bal: 0, src: srcs[i % srcs.length], launches: 0, acts: 3 + Math.floor(Math.random() * 12), aged: true }); WFOLDER[id] = "ready" }
      saveLib(); renderWalletsPage(); toast(`${n} aged wallets added to My Wallets`) }] });
  const i = d.querySelector("#mk-n"); i.addEventListener("input", () => goBtn(d, `Add ${Math.max(0, Math.trunc(+i.value || 0))} Wallets`, +i.value > 0));
}
function openCreateLib() {
  const d = popup({ title: "Create Wallets", width: 420, body: `<div class="pf-l">Number of wallets to create</div><div class="pf-i"><input type="number" id="cl-n" min="1" max="500" value="0"></div><p class="help" style="margin-top:8px">Sandbox wallets kept in My Wallets. Fund and pre-age them here, then import them into a launch from its Funding page.</p>`,
    right: ["Create 0 Wallets", d => { const n = Math.trunc(+d.querySelector("#cl-n").value || 0); if (!(n > 0)) return false; const t = Date.now(); for (let i = 0; i < n; i++) MYW.push({ id: fakeAddr("lib" + t + i), at: t, bal: 0, src: "Wallet", launches: 0, acts: 0 }); for (let i = 0; i < n; i++) WFOLDER[MYW[MYW.length - 1 - i].id] = "notready"; saveLib(); renderWalletsPage(); toast(`Created ${n} wallet${n === 1 ? "" : "s"} in My Wallets`) }, true] });
  const i = d.querySelector("#cl-n"); i.addEventListener("input", () => goBtn(d, `Create ${Math.max(0, Math.trunc(+i.value || 0))} Wallets`, +i.value > 0)); i.focus(); i.select();
}
function openLibFund() {
  const sel = MYW.filter(w => WSEL.has(w.id));
  if (!sel.length) { if (isLive() || LST) { openFundWallets(); return } toast("Select wallets in My Wallets to fund (launch wallets are funded by Distribute)", "warn"); return }
  const d = popup({ title: "Funding", width: 440, body: `<p class="help lead">Send SOL from the Funder to ${sel.length} selected wallet${sel.length === 1 ? "" : "s"}.</p><div class="pf-grid"><div class="pf"><div class="pf-l">Amount per wallet</div><div class="pf-i"><input type="number" id="lf-a" value="0.1" step="0.05"><span class="mark">${MARKS.Solana}</span></div></div><div class="pf"><div class="pf-l">Route</div><div class="pf-i sel"><select id="lf-r"><option value="Funder">Direct from Funder</option><option>Binance</option><option>Bybit</option><option>Kucoin</option><option>Gate</option></select></div></div></div><p class="help">Funder holds ${f2(PRE.funder || 0, 2)} SOL. An exchange route breaks the direct funding link a detector would see.</p>`,
    right: ["Fund", d => { const a = +d.querySelector("#lf-a").value, r = d.querySelector("#lf-r").value, need = a * sel.length + 0.000005 * sel.length; if (!(a > 0)) return false; if (need > (PRE.funder || 0)) { toast("Not enough SOL in the Funder", "warn"); return false }
      PRE.funder -= need; sel.forEach(w => { w.bal += a; w.src = r; w.at = Date.now() }); saveLib(); renderWalletsPage(); toast(`Funded ${sel.length} wallets with ${f2(a, 3)} SOL each`) }] });
}
function openLibDelete() {
  const sel = MYW.filter(w => WSEL.has(w.id)), launchSel = WSEL.size - sel.length;
  if (!sel.length) { toast("Launch wallets can't be deleted here: remove them from the launch on its Funding page", "warn"); return }
  popup({ title: "Delete Wallets", width: 440, cls: "danger", body: `<p class="help lead">Delete ${sel.length} wallet${sel.length === 1 ? "" : "s"} from My Wallets?${launchSel ? ` ${launchSel} launch wallet${launchSel === 1 ? " stays" : "s stay"}.` : ""}</p><div class="note warn">${ICON("alert")}<span>This action is irreversible. ${f2(sel.reduce((a, w) => a + w.bal, 0), 3)} SOL in these wallets goes back to the Funder (sandbox).</span></div>`,
    right: ["Delete", () => { PRE.funder = (PRE.funder || 0) + sel.reduce((a, w) => a + w.bal, 0); const ids = new Set(sel.map(w => w.id)); MYW = MYW.filter(w => !ids.has(w.id)); ids.forEach(id => { WSEL.delete(id); delete WFOLDER[id] }); saveLib(); renderWalletsPage(); toast(`Deleted ${ids.size} wallets`) }] });
}
function openNewFolder(edit) {
  const f = edit ? FOLD.find(x => x.id === edit) : null, cols = ["#46a758", "#e5484d", "#8e4ec6", "#3e63dd", "#f0b429", "#12a594", "#9aa3b2"];
  let col = f ? f.color : cols[3];
  const d = popup({ title: f ? "Edit Folder" : "Create New Folder", width: 400, body: `<div class="pf-l">Name</div><div class="pf-i"><input id="nf-n" value="${esc(f ? f.name : "")}" placeholder="Folder name" maxlength="24"></div><div class="pf-l" style="margin-top:12px">Color</div><div class="nf-cols">${cols.map(c => `<button type="button" data-c="${c}" class="${c === col ? "on" : ""}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}</div>`,
    right: [f ? "Save" : "Create", d => { const n = d.querySelector("#nf-n").value.trim().toUpperCase(); if (!n) return false; if (f) Object.assign(f, { name: n, color: col }); else FOLD.push({ id: "f" + Date.now().toString(36), name: n, color: col }); saveLib(); renderWalletsPage(); if (ROUTE === "create") rerenderStage() }] });
  d.querySelector(".nf-cols").addEventListener("click", e => { const b = e.target.closest("[data-c]"); if (!b) return; col = b.dataset.c; d.querySelectorAll(".nf-cols button").forEach(x => x.classList.toggle("on", x === b)) });
  d.querySelector("#nf-n").focus();
}
function openFolderOpts(e, id) {
  const f = FOLD.find(x => x.id === id);
  menuAt(e, `<div class="cm-h">${esc(f.name)}</div><button data-a="edit">${ICON("pen")}Edit Folder</button><button data-a="sel">${ICON("check")}Select wallets in folder</button><hr><button data-a="del" class="danger">${ICON("trash")}Delete Folder</button>`, a => {
    if (a === "edit") openNewFolder(id);
    if (a === "sel") { WFOLD = id; renderWalletsPage(); const h = document.querySelector(".wl-table thead input"); if (h && !h.checked) h.click() }
    if (a === "del") popup({ title: "Delete Folder", width: 400, cls: "danger", body: `<p class="help lead">Delete the folder <b>${esc(f.name)}</b>? Its wallets stay in Solana Wallets.</p>`, right: ["Delete", () => { FOLD = FOLD.filter(x => x.id !== id); for (const k in WFOLDER) if (WFOLDER[k] === id) WFOLDER[k] = ""; if (WFOLD === id) WFOLD = "all"; saveLib(); renderWalletsPage() }] });
  });
}
// ---------------------------------------------------------------- "What am I looking at?" (live chart), plain words
function openChartHelp() {
  const row = (c, n, t) => `<tr><td style="width:190px"><span class="ctx"><i style="background:${c}"></i><b>${esc(n)}</b></span></td><td class="help">${esc(t)}</td></tr>`;
  popup({ title: "What am I looking at?", width: 680, left: ["Close"], body: `
    <table class="ch-help"><tbody>
    <tr><td colspan="2" class="mute">The chart</td></tr>
    ${row("#22c27d", "Candles", "Each candle is 1 s, 5 s, 15 s or 1 min (buttons top left). Green: the price went up in that time. Red: it went down. The bars under the candles show how much SOL traded.")}
    ${row("#8b949e", "Bubbles", "One bubble per trade. Bigger bubble = more SOL. Hover one to see who traded, how much, and when.")}
    ${row("#f4b23e", "Who it was / Chart's guess", "Who it was: colours each trade by who really made it (your Dev, Front MEV, Volume Bot, snipers, normal traders…). Only the sandbox knows this. Chart's guess: colours trades the way an investigator would see them from the blockchain alone. Switch between the two to see how good the guess is.")}
    <tr><td colspan="2" class="mute" style="padding-top:10px">The chart's guess (3 groups)</td></tr>
    ${row(READ_COLORS.insider, READ_NAMES.insider, READ_HELP.insider)}
    ${row(READ_COLORS.bot, READ_NAMES.bot, READ_HELP.bot)}
    ${row(READ_COLORS.other, READ_NAMES.other, READ_HELP.other)}
    <tr><td colspan="2" class="mute" style="padding-top:10px">The coloured band above the chart: what's happening</td></tr>
    ${Object.keys(PHASE_NAMES).map(k => row(PHASE_COLORS[k], PHASE_NAMES[k], PHASE_HELP[k])).join("")}
    <tr><td colspan="2" class="mute" style="padding-top:10px">The little flags under the band</td></tr>
    ${row(MARK_COLORS.bundle, "Bought at launch", "Wallets bought in the moment the coin was created. Only the launch team can do that.")}
    ${row(MARK_COLORS.burst, "Bought together", "3+ new wallets bought in the same block (0.2 s): one script.")}
    ${row(MARK_COLORS.grid, "Buys on a timer", "New wallets buying at a steady beat: a bot with a buy delay.")}
    ${row(MARK_COLORS.sell, "Team sold", "Suspected team wallets sold 1%+ of the coin within seconds.")}
    ${row(MARK_COLORS.sweep, "Money collected", "Many wallets sent their SOL to one address at once: cashing out.")}
    <tr><td colspan="2" class="mute" style="padding-top:10px">Under the chart</td></tr>
    ${row(READ_COLORS.insider, "Team's share of the coin", "The orange line: how much of the coin the suspected team holds. The dashed line (sandbox only): how much your wallets really hold. If the orange line falls fast, the team is selling.")}
    ${row("#9aa3b2", "The line above the chart", "A one-line summary: how many wallets are in the suspected team and how much they hold, how many other bots, what's happening right now, and (sandbox) how good the guess was.")}
    </tbody></table>
    <p class="help" style="margin-top:10px">In your sandbox launch, the team really is: Dev, Front MEV, Back MEV, Temp holders, Holders, plus any Volume Bot / Cleanup wallets. Snipers, copy traders and normal traders are the outside market.</p>` });
}

// ================================================================ Guide: the whole simulator in plain words
function renderGuide() {
  const el = $("guide-page"); if (!el) return;
  const sec = (id, title, body) => `<section class="g-sec" id="g-${id}"><h2>${title}</h2>${body}</section>`;
  const steps = a => `<ol class="g-steps">${a.map(x => `<li>${x}</li>`).join("")}</ol>`;
  const tbl = rows => `<table class="g-tbl"><tbody>${rows.map(([a, b, c]) => `<tr><td><b>${a}</b></td><td>${b}</td>${c !== undefined ? `<td class="mute">${c}</td>` : ""}</tr>`).join("")}</tbody></table>`;
  const toc = [["what", "What this is"], ["launch", "1. Plan a launch"], ["fund", "2. Funding page"], ["live", "3. Watch it live"], ["tools", "4. The tools and how they show on the chart"], ["market", "The outside market"], ["read", "5. Reading the chart"], ["money", "6. Money: P&L and fees"], ["recreate", "7. Recreate a real chart (SHARDS)"], ["save", "8. Save, compare, export"], ["limits", "What the sandbox can't do"]];
  el.innerHTML = `<div class="guide"><aside class="g-toc">${toc.map(([k, n]) => `<a onclick="document.getElementById('g-${k}').scrollIntoView({behavior:'smooth'})">${n}</a>`).join("")}</aside><div class="g-body">
  ${sec("what", "What this is", `<p>Launch Control is a <b>sandbox copy of a real Solana launch tool</b> (same screens, buttons and numbers). Nothing touches a real chain and all SOL is pretend (the Funder starts with 1,000). You plan and run a launch exactly the way a scam team would, then watch what it does to the chart, so you learn to recognise it on real pump.fun charts.</p>
    <p>Everything a "team" does is simulated: the dev buy, the wallets that buy in the first block, bots that make fake volume, automatic selling, and the final cash-out. So is the outside market: sniper bots, copy-trading bots and normal traders.</p>`)}
  ${sec("launch", "1. Plan a launch (Create Launch)", steps([
    "<b>Chain & launchpad.</b> Pick PumpFun (pump.fun's curve, moves to PumpSwap at ~85 SOL) or Meteora DBC (the curve SHARDS used, measured from its real pool).",
    "<b>Token details.</b> Name, ticker, picture. Only cosmetic.",
    "<b>Launch settings.</b> Choose a mode. <b>Block-0</b> = the team buys in the same moment the coin is created (the usual scam setup). <b>Organic</b> = holders buy one by one after launch. <b>Manual</b> = you press Buy yourself. In Block-0, pick a preset: <b>Quick</b> (fast, cheap, easiest to spot), <b>Clean</b> (slower, harder to spot), <b>Full</b> (adds 'temp holder' wallets that pass coins along), or <b>Custom</b>. The right-hand panel shows cost, expected market cap and how detectable it is.",
    "<b>Advanced</b> holds the extras: funding through exchanges (hides who paid the wallets), Generate Activity (makes new wallets look used), fee target, empty holders, Streamflow."]))}
  ${sec("fund", "2. Funding page", `<p>This is where the plan becomes wallets. Each row is one wallet: its role (Dev, Front MEV, Back MEV, Holder…), how much of the coin it will buy, and how much SOL it still needs.</p>
    ${steps(["<b>Deposit</b> puts pretend SOL in the Funder (you start with 1,000).", "Plan the automations with the icons on the right: <b>Auto Sell</b>, <b>Sniper Guard</b>, <b>Volume Bot</b>, <b>Auto Buy</b>. They show as 'scheduled' and start by themselves after launch.", "<b>1. Distribute</b> sends SOL to every wallet (each transfer costs a small fee).", "<b>2. Launch</b> creates the coin. The chart starts."])}
    <p class="help">Row ⋯ menu: Replace by Fresh (new wallet address), Import Wallet (use one from My Wallets), Export Private Key (sandbox wallets have none), Add to Folder. Footer ⋯: tracker exports. Delete = delete the whole plan.</p>`)}
  ${sec("live", "3. Watch it live (Workspace)", `<p>The chart in the middle, your wallets underneath, the tools on the right. The clock buttons run the sandbox: pause, 1×, 5×, 20×, or jump 10 s.</p>
    <p>The right rail shows every tool's state: <b>at 2:48</b> (scheduled), <b>Running</b>, <b>Done</b>, <b>Triggered</b>. A notice pops up when one stops. Under it: Buy/Sell for your own wallets, Nuke (sell everything), Claim Rewards (the creator's cut of every trade), the organic market switch, and your P&L.</p>`)}
  ${sec("tools", "4. The tools and how they show on the chart", tbl([
    ["Dev buy + Front MEV", "Buy in the exact moment the coin is created (one bundle).", "One tall green candle at 0:00, flagged 'Bought at launch'."],
    ["Back MEV / Temp / Holders", "Front MEV wallets sell to new wallets so the supply looks spread out (each sell is matched by a buy).", "Pairs of red+green bubbles of the same size; price barely moves."],
    ["Volume Bot", "The same wallets buy, then sell the same tokens. Adds volume, not price. Wave Intensity = longer runs of buys then sells.", "Lots of small green/red bubbles; volume up, price flat or slowly down (fees)."],
    ["Auto Buy · DCA", "Buys a set amount every interval. This is what actually pushes the price up.", "Green bubbles on a steady beat; price climbs."],
    ["Auto Buy · Counter", "Buys back part of every outside sell (Replication %).", "Dips get absorbed: a green bubble right after each red one."],
    ["Auto Sell · Counter", "Sells part of every outside buy into it. Drains buyers.", "A red bubble 0.2–0.6 s after each green one; rallies fade."],
    ["Auto Sell · Limit Orders", "Sells set amounts when the market cap reaches set levels.", "Red bubbles at round market-cap levels."],
    ["Sniper Guard", "If outside wallets buy more than X SOL during launch, it sells everything (Nuke) or stops the buys (Complete Early).", "A wall of red bubbles at one moment; 'Sniper Guard triggered' on the timeline."],
    ["Cleanup", "Sells from some wallets and buys with new ones, so holders look fresh and spread out.", "Sell + buy pairs a few seconds apart."],
    ["Nuke", "Sells every included wallet at once.", "A big red candle: the dump."],
    ["Generate Activity", "Before launch, makes wallets trade other coins so they don't look new.", "Not on this chart (other coins). Reported in the rail: loops, wallets, cost."],
    ["Withdraw", "Collects SOL from every wallet into one 'hop' wallet, then to a payout wallet.", "No trades; flagged 'Money collected' when wallets sweep into one address."],
    ["Snipers / copy traders / organic", "The outside market: bots that buy new coins in the first seconds and dump fast, bots that copy big buyers, and normal traders.", "Snipers = the early spike and fast drop; organic = the random trades in between."]]))}
  ${sec("market", "The outside market (who else trades your coin)", `<p>Set it on the Funding page under the flask icon (Simulation settings). The organic level can also be switched live from the right rail. The levels follow real pump.fun numbers measured in October 2026.</p>${tbl([
    ["Snipers: Typical launch", "Usually about 4 bots buy in the first 5 seconds; about 1 launch in 5 gets none, a few get 20 or more. Small buys (~0.4 SOL). Most sell within a minute, a few hold for minutes.", "The default. A Block-0 launch with these snipers does not fill the curve on its own."],
    ["Snipers: Busy / Hot", "Busy: about 15. Hot: 37 plus one wallet taking 9.8% in the launch block, like SHARDS.", "Hot snipers alone put ~50 SOL in during the first seconds: the curve fills almost at once."],
    ["Organic: Dead", "A handful of trades in the first minute, then nothing. Common on real pump.fun.", ""],
    ["Organic: Very low", "Like the median real launch: about 20 trades in the first minute, almost nothing after.", ""],
    ["Organic: Mid", "Hundreds of trades in 5 minutes: only about the top 2% of real coins get this.", ""],
    ["Organic: Bullish", "A real runner: fills the curve after ~5-10 minutes and ~500-900 trades, then interest fades after the move to the pool.", "Only about 1 in 100 real coins ever fill the curve."],
    ["Copy-trade bots", "Copy big buyers' buys (and sells) 1-2 seconds later, usually with a fixed amount (default 0.25 SOL).", ""]])}`)}
  ${sec("read", "5. Reading the chart", `<p>Press <b>?</b> on the chart for the full key. In short:</p>${tbl([
    ["Who it was / Chart's guess", "Who it was colours every trade by who really made it (the sandbox knows). Chart's guess colours it the way an investigator would see it from the blockchain alone. Switch between them to see how good the guess is."],
    ["Suspected team", "Wallets that bought in the launch moment, plus wallets paid by the same money. In a Block-0 launch that is the Dev and Front MEV, and the later layers if money links them. It's a guess, not proof."],
    ["Other bots", "Acting like bots but not tied to the launch: buying together, on a timer, selling straight after others, or fake-volume pairs."],
    ["The coloured band", "What's happening: Launch moment → Team buying → Fake trading → Team selling → Team dump."],
    ["Team's share of the coin", "The orange line under the chart. Falling fast = the team is selling. The dashed line is what your wallets really hold (sandbox only)."],
    ["Warning signs tab", "The signs anyone could see on the public blockchain, each with Strong / Some / None and a one-line explanation."]])}`)}
  ${sec("money", "6. Money: P&L and fees", tbl([
    ["Money you put in", "All SOL put into the Funder."], ["SOL in your wallets now", "What sits in all your wallets right now."],
    ["Up / down so far", "SOL now minus SOL put in (ignores coins you still hold)."], ["Your coins if you sold all now", "What your coins would really bring in, selling one wallet after another (each sale lowers the price for the next)."],
    ["Your coins at today's price", "Coins × price. Not reachable: selling pushes the price down."], ["Result if you sold everything now", "The honest result: up/down so far + what the coins would really bring in."],
    ["Fees", "Network fee (every transaction), speed fee (priority), trading fee (pump.fun 1.25% on the curve), tips (Jito bundles), account deposits (rent), exchange cuts, and the tool's 5% on its sells. Click Fees in the rail or status bar for min / average / max per kind."]]))}
  ${sec("recreate", "7. Recreate a real chart (SHARDS)", steps([
    "<b>Look at the real thing.</b> Import & match → Research cases → SHARDS. Press Play: every real trade replays in order, coloured by who made it (network wallets, creator, snipers, other linked groups, no link found). Click any wallet for its evidence and Solscan links.",
    "<b>Read what happened.</b> The cards above the chart list it step by step: staged at launch, planned rotation through one-use escrows, run-up buying, the dump, who absorbed it.",
    "<b>Rebuild it in the sandbox.</b> Lab → Configurations → 'SHARDS (fitted to the real chart)' → Open in Create launch, or Clone a Configuration. It uses the Meteora curve, 4 Front MEV wallets buying 55%, the network's rotation (Cleanup), and the dump at 6:45, with an outside market tuned to SHARDS' real volume.",
    "<b>Compare.</b> Import & match → Match: the closest configurations and where they differ. Change one setting at a time (e.g. organic level, rotation speed) and see which one makes the sandbox chart look like the real one: that is how you back out what the team did."]))}
  ${sec("save", "8. Save, compare, export", `<p>Right-click a launch in the left column → <b>Archive</b> saves the whole run (every trade, the chart's read, fees, P&L) and removes it from the list. Find it under <b>Archived</b> (See Launch) and on the <b>Dashboard</b>. <b>Export</b> downloads a file you can keep or share; browser storage alone can be lost if browser data is cleared. Drafts stay in the left column until you delete them (right-click → Delete).</p>`)}
  ${sec("limits", "What the sandbox can't do", `<ul class="g-steps"><li>Real wallets, keys or chains: none. Every address is made up.</li><li>The tool's Marketplace purchases, Shield, Alternative Routing and Market Maker are not modelled.</li><li>The outside market is a model: it reacts to price and momentum, but it is not real people.</li><li>Pump.fun numbers (curve, fees) follow the published values; Meteora's were measured from one launch (SHARDS).</li></ul>`)}
  </div></div>`;
}
