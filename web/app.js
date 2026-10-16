/* Launch Control: app shell, create-launch flow, live workspace (chart, tape, wallets, trade + automation rail).
   All simulation runs in the engine worker (engine.js) via eng() from lab.js. */
"use strict";
const ICON = (n, cls = "i") => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
// Sidebar order follows the launch tool: Features list, then our research Lab.
const ROUTES = [
  ["", [["wallets", "My Wallets", "wallet"], ["live", "Workspace", "chart"], ["archived", "Archived", "archive"], ["dashboard", "Dashboard", "grid"], ["activity", "Activity", "clock"], ["guide", "Guide", "doc"]]],
  ["Lab", [["config", "Configurations", "sliders"], ["results", "Run results", "flask"], ["compare", "Compare", "columns"], ["import", "Import & match", "upload"]]],
];
const TITLES = { guide: "Guide", dashboard: "Dashboard", archived: "Archived", live: "Workspace", create: "Create launch", wallets: "Wallets", activity: "Activity", config: "Configurations", results: "Run results", compare: "Compare", import: "Import & match" };
let ROUTE = "live";
function show(k) {
  if (k === "work") k = "live";
  if (k !== "import") { MCUSD = null; if (typeof rpStop === "function") rpStop() }
  document.querySelectorAll(".ctx-menu").forEach(x => x.remove());
  // which settings are on screen: the live launch's on the Workspace, the open draft's on Create
  if (k !== "create") useLiveCfg();
  if (k === "create" && DRAFTS.length !== undefined) { const d = draftOf(DRAFT_ID); if (d) WCFG = d.config; else if (WCFG !== null) draftFresh() }
  if (k !== "create" && k !== "live" && !LST) { const d = draftOf(DRAFT_ID); if (d) WCFG = d.config }
  ROUTE = k; if (WCFG) saveDrafts(); setTimeout(funderBar);
  $("nav").innerHTML = ROUTES.map(([h, items]) => (h ? `<div class="sub">${h}</div>` : "") + items.map(([key, name, ic]) =>
    `<a class="${key === k ? "on" : ""}" data-r="${key}" onclick="show('${key}')">${ICON(ic)}<span>${name}</span>${key === "archived" ? `<span class="badge">${ARCH.length}</span>` : ""}${key === "live" && LST && LSPEED ? '<span class="live-dot"></span>' : ""}</a>`).join("")).join("");
  document.querySelectorAll(".tab").forEach(e => e.classList.toggle("on", e.id === "t-" + k));
  $("title").textContent = TITLES[k] || ""; $("title").hidden = k === "create" || (k === "live" && !!LST); if ($("hdr")) $("hdr").hidden = !(k === "live" && LST); $("stepper").hidden = k !== "create"; if (k !== "create" && $("top-token")) $("top-token").hidden = true;
  $("side").classList.remove("open");
  try { localStorage.setItem("lc-route", k) } catch (e) { }
  if (k === "results" && RUN) requestAnimationFrame(() => { GC = { src: () => RUN && RUN.graph, cv: "cv-graph", mode: "gmode", lg: "lg-graph", org: "gorg", tab: "t-results", h: 560 }; G = null; drawResult(); relayout() });
  if (k === "compare") renderPick();
  if (k === "import") loadImports();
  if (k === "live") requestAnimationFrame(() => { if (CH) CH.resize(); renderBottom(true) });
  if (k === "create") wRender();
  if (k === "wallets") renderWalletsPage();
  if (k === "activity") renderActivity();
  if (k === "archived") renderArchived();
  if (k === "dashboard") renderDashboard();
  if (k === "guide") renderGuide();
  renderLaunchList();
}
// SOL price: status-bar chip, a dialog to pin your own (e.g. the price on a real launch's day), redraw on change.
window.solPriceChanged = () => {
  const a = $("st-sol"); if (a) { a.innerHTML = `<span class="mark">${MARKS.Solana}</span>` + (SOLUSD ? `$${SOLUSD.toFixed(SOLUSD >= 100 ? 0 : 2)}` : "n/a"); a.title = SOLUSD ? `SOL price from ${SOLSRC}. Market caps show in USD. Click to change.` : "No SOL price yet: market caps show in SOL. Click to set one." }
  if (LST) { renderHeader(); statusBar(); renderLaunchList(); if (CH) CH.dirty = true; rebuildTape() }
  if (ROUTE === "create" && WCFG) wRender();
  if (ROUTE === "results" && RUN) drawResult(); if (ROUTE === "compare" && CMP) drawCompare(); if (ROUTE === "import" && MATCH) drawMatch();
};
function solPriceDialog() {
  const man = lsGet("lc-solusd-manual", null);
  modal("SOL price", `<p class="help" style="margin:0 0 10px">Market caps show in USD at this price. The simulation itself runs in SOL. ${man ? "You pinned this price." : SOLUSD ? `Live from ${esc(SOLSRC)}, refreshed every 5 minutes.` : "No live price could be fetched."}</p>
    <label>Your SOL price (USD)<input id="sol-man" type="number" step="0.01" min="0" value="${man || (SOLUSD ? SOLUSD.toFixed(2) : "")}"></label><p class="help" style="margin:0">Pin the SOL price from the day of a real launch you're comparing against.</p>`,
    [["Use live price", "", () => { lsSet("lc-solusd-manual", null); refreshSolPrice(true).then(() => toast(SOLUSD ? `Live SOL price: $${SOLUSD.toFixed(2)}` : "Couldn't fetch a live price", SOLUSD ? "ok" : "warn")) }],
     ["Pin this price", "primary", d => { const v = +d.querySelector("#sol-man").value; if (!(v > 0)) { toast("Enter a price above 0", "warn"); return false } lsSet("lc-solusd-manual", v); refreshSolPrice(); toast(`SOL pinned at $${v.toFixed(2)}`) }]]);
}
function newLaunch() { draftFresh(); W_STEP = 0; PRE = PRE_NEW(); show("create") }
function renderLaunchList() {
  const el = $("launch-list"); if (!el) return;
  // the tool's sidebar list: the running launch, then every saved draft. Right-click (or ⋯) for Archive / Clone / Delete.
  const more = (kind, id) => `<button class="li-more" aria-label="Launch options" onclick="launchMenu(event,'${kind}','${id}')">⋯</button>`;
  const lc = LIVE_CFG || WCFG;
  const live = LST && lc ? `<div class="li ${ROUTE === "live" ? "on" : ""}" onclick="show('live')" oncontextmenu="launchMenu(event,'live','')"><div class="avatar">${esc((lc.name || "T").slice(0, 2).toUpperCase())}</div><div><b>$${cfgTick(lc)}</b><small>${mcFmt(LST.mc_sol)} · ${mmss(LST.t)}</small></div>${LSPEED ? '<span class="live-dot"></span>' : '<span class="draft live">Live</span>'}${more("live", "")}</div>` : "";
  const drafts = DRAFTS.map(d => `<div class="li ${ROUTE === "create" && d.id === DRAFT_ID ? "on" : ""}" data-draft="${d.id}" onclick="draftOpen('${d.id}')" oncontextmenu="launchMenu(event,'draft','${d.id}')">${d.id === DRAFT_ID && ROUTE === "create" ? avatar() : cfgAvatar(d.config)}<div><b>$${cfgTick(d.config)}</b><small>${esc(d.config.name || "")}</small></div><span class="draft">Draft</span>${more("draft", d.id)}</div>`).join("");
  el.innerHTML = live + drafts || `<div class="none">No launches yet.<br>Create one, or <a style="color:var(--signal);cursor:pointer" onclick="quickStart()">quick-start SHARDS</a>.</div>`;
}
function statusBar(ms) {
  if (ms != null) $("st-engine").textContent = `Sim engine live • ${Math.max(1, Math.round(ms))}ms`;
  $("st-mid").textContent = LST ? `${WCFG.name} · ${mcFmt(LST.mc_sol)} MC · ${LST.migrated ? (LST.venue || "PumpSwap") : f2(LST.curve_pct, 1) + "% curve"} · ${mmss(LST.t)}` : "No live launch";
}
// ⌘K palette: jump to a page, a configuration or the live launch.
function openSearch() {
  if (document.querySelector(".palette")) return;
  // actions are functions, not strings, so names with quotes or symbols can't break them
  const items = [...ROUTES.flatMap(([, it]) => it.map(([k, n]) => [n, "Page", () => show(k)])), ["Create launch", "Page", () => newLaunch()],
    ...(LST ? [[(LIVE_CFG || WCFG).name + " (live)", "Launch", () => show("live")]] : []),
    ...DRAFTS.map(x => [(x.config && x.config.name) || "Untitled", "Draft", () => draftOpen(x.id)]),
    ...ARCH.map(x => [x.name || "Untitled", "Archived", () => { AVIEW = x.id; show("archived") }]),
    ...Object.keys(BUILTIN).concat(Object.keys(SAVED)).map(n => [n, "Configuration", () => { loadCfg(n); show("config") }])];
  const d = document.createElement("div"); d.className = "palette";
  d.innerHTML = `<div class="box" role="dialog" aria-label="Search"><input placeholder="Search pages, launches, configurations…" aria-label="Search"><div class="res"></div></div>`;
  document.body.append(d);
  const inp = d.querySelector("input"), res = d.querySelector(".res"); let sel = 0, hits = items;
  const draw = () => { res.innerHTML = hits.slice(0, 40).map(([n, k], i) => `<button class="${i === sel ? "on" : ""}" data-i="${i}">${esc(n)}<small>${k}</small></button>`).join("") || `<p class="help" style="padding:8px 10px">Nothing found.</p>` };
  const close = () => d.remove(), go = f => { close(); f() };
  inp.oninput = () => { const q = inp.value.toLowerCase(); hits = items.filter(x => x[0].toLowerCase().includes(q)); sel = 0; draw() };
  inp.onkeydown = e => { if (e.key === "Escape") close(); else if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); draw() } else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); draw() } else if (e.key === "Enter" && hits[sel]) go(hits[sel][2]) };
  res.onclick = e => { const b = e.target.closest("button"); if (b) go(hits[+b.dataset.i][2]) };
  d.onclick = e => { if (e.target === d) close() };
  draw(); inp.focus();
}
addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch() } });
// sidebar: on a phone it slides over the page; on a desktop the collapse button hides it (remembered) and the top-left button brings it back
function toggleSide(e) {
  if (e) e.stopPropagation();
  if (matchMedia("(max-width: 860px)").matches) { $("side").classList.toggle("open"); return }
  lsSet("lc-side-mini", document.querySelector(".app").classList.toggle("mini"));
}
// one Funder figure in the sidebar: the draft's Funder while you're on a draft's create pages, otherwise the live launch's
let LIVE_FUNDER = 0;
function funderBar() {
  const el = $("simbal"); if (!el) return; const draft = !LST || (ROUTE === "create" && WCFG !== LIVE_CFG), lab = el.parentElement.querySelector("span:not(.mark)");
  el.textContent = f2(draft ? PRE.funder || 0 : LIVE_FUNDER, 2); if (lab) lab.textContent = LST ? (draft ? "Funder · draft" : "Funder · live") : "Funder";
}
function copyText(t, msg) { try { navigator.clipboard && navigator.clipboard.writeText(t) } catch (e) { } toast(msg) }
function toast(msg, kind = "ok") {
  const t = $("toast"); t.innerHTML = (kind === "ok" ? ICON("check") : ICON("zap")) + `<span>${esc(msg)}</span>`;
  t.style.color = kind === "ok" ? "var(--text)" : "var(--signal)"; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2200);
}
const f2 = (x, d = 2) => fmt(x, d);
const solFmt = x => (Math.abs(x) >= 100 ? fmt(x, 0) : Math.abs(x) >= 1 ? fmt(x, 2) : fmt(x, 3));
const TOOL_NAMES = { dev_buy: "Dev buy", front_mev: "Front MEV", back_mev: "Back MEV", holder_buy: "Holder buy", manual_buy: "Manual buy", manual_sell: "Manual sell", cleanup: "Cleanup", streamflow: "Streamflow",
  volume_bot: "Volume Bot", autobuy: "AutoBuy", autosell: "AutoSell", sniper_guard: "Sniper Guard", instant_trade: "Instant trade", nuke: "Nuke", sniper: "Sniper bot", organic: "Organic", copy_trade: "Copy trader", real: "Real",
  crew_launch: "Network: launch wallets", crew: "Network: rotation wallets", creator: "Creator (dev)", linked_other: "Other linked group", outside_pattern: "Unlinked, pattern only", outside: "No link found" };
TOOL_COLORS.instant_trade = "#f4b23e"; TOOL_COLORS.nuke = "#ff2d55";
// research labels on real imports (CSV "label" column)
Object.assign(TOOL_COLORS, { crew_launch: "#e5484d", crew: "#f76b15", creator: "#f0b429", linked_other: "#d6409f", outside_pattern: "#12a594", outside: "#5f9cff" });

// ======================================================= create launch (wizard)
let W_STEP = 0, WCFG = null, WPLAN = null;
// The tool's three create tabs, then its pre-launch page (Distribute, Launch).
const W_STEPS = ["Chain & launchpad", "Token details", "Launch settings", "Pre-launch"];
const W_TOP = [["Chain & Launchpad", 0], ["Token Details", 1], ["Launch Settings", 2]], W_LAST = W_STEPS.length - 1;
let W_ADV = false, SLOT = 0.2;   // seconds per Solana slot (the engine's value, 200 ms since Oct 2026)
// Small chain / launchpad marks (simple drawings for recognition; generic badge for the rest)
const MARKS = {
  Solana: `<svg viewBox="0 0 24 24"><defs><linearGradient id="mk-sol" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><g fill="url(#mk-sol)"><path d="M6 6.5h14l-3 3H3z"/><path d="M3 10.5h14l3 3H6z"/><path d="M6 14.5h14l-3 3H3z"/></g></svg>`,
  PumpFun: `<svg viewBox="0 0 24 24"><g transform="rotate(-45 12 12)"><rect x="3" y="8" width="18" height="8" rx="4" fill="#fff" stroke="#1d3b2a" stroke-width="1.4"/><path d="M12 8h5a4 4 0 0 1 0 8h-5z" fill="#5fcb7b" stroke="#1d3b2a" stroke-width="1.4"/></g></svg>`,
  "Meteora DBC": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#f5683c"/><path d="M7 15l5-7 5 7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  Ethereum: `<svg viewBox="0 0 24 24"><path d="M12 2l6 10-6 3.6L6 12z" fill="#627eea"/><path d="M12 16.8l6-3.6-6 8.8-6-8.8z" fill="#8aa0f0"/></svg>`,
  Base: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#0052ff"/><path d="M12 7.5a4.5 4.5 0 1 1-4.47 5H14v-1H7.53A4.5 4.5 0 0 1 12 7.5z" fill="#fff"/></svg>`,
  "BNB Smart Chain": `<svg viewBox="0 0 24 24"><g fill="#f0b90b"><path d="M12 4l2.5 2.5L12 9 9.5 6.5z"/><path d="M12 15l2.5 2.5L12 20l-2.5-2.5z"/><path d="M4 12l2.5-2.5L9 12l-2.5 2.5z"/><path d="M15 12l2.5-2.5L20 12l-2.5 2.5z"/><path d="M12 10l2 2-2 2-2-2z"/></g></svg>`,
};
const PAD_COLORS = { StonkFun: "#2bb3a3", LetsBonk: "#f2711c", Bags: "#2ecc40", Anoncoin: "#7b61ff", Surge: "#3a3f4a", Printr: "#111", Stoxes: "#16a34a", Lesgo: "#f5c400", "meme.fun": "#222", Robinhood: "#c3f53c", Arc: "#222" };
const mark = n => `<span class="mark" aria-hidden="true">${MARKS[n] || `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="${PAD_COLORS[n] || "#8a93a1"}"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family="Figtree, Arial">${esc(n[0])}</text></svg>`}</span>`;
// chains and launchpad counts as the tool lists them; only Solana / PumpFun is simulated
const CHAINS = [["Solana", 11, true], ["Robinhood", 15], ["BNB Smart Chain", 4], ["Arc", 5, false, true], ["Ethereum", 1], ["Base", 2]];
const CEX_LIST = ["Binance", "KuCoin", "Bitget", "Gate", "Husher", "Bybit"];   // the tool's six CEX funding sources (minimums: 0.012 / 0.027 / 0.114 / 0.111 / 0.012 / 0.036 SOL)
const PAD_KEY = { PumpFun: "pumpfun", "Meteora DBC": "meteora" };
const PAD_TIP = { pumpfun: "pump.fun bonding curve (30 SOL / 1.073B virtual), completes at ~85 SOL, then moves to PumpSwap.", meteora: "Meteora bonding curve fitted to the real SHARDS launch (completes at 800M tokens sold, ~88 SOL), then a Meteora DAMM v2 pool (~0.25% fee)." };
const PADS = ["PumpFun", "StonkFun", "LetsBonk", "Bags", "Anoncoin", "Surge", "Printr", "Meteora DBC", "Stoxes", "Lesgo", "meme.fun"];
const FIELD = {};
function fieldDef(k) { if (!Object.keys(FIELD).length) for (const [, fs] of SCHEMA) for (const f of fs) FIELD[f[0]] = f; return FIELD[k] }
function wVisible(k) {
  const f = fieldDef(k); if (!f) return false; const sh = f[4].show; if (!sh) return true; const neg = sh.includes("!="); const [a, v] = sh.split(neg ? "!=" : "=");
  if (v === undefined) return !!WCFG[a] && wVisible(a); const ok = String(WCFG[a]) == v; return (neg ? !ok : ok) && wVisible(a);
}
function wFields(keys) {
  return `<div class="fields">${keys.filter(wVisible).map(k => {
    const [, label, typ, , ex] = fieldDef(k), v = WCFG[k], h = ex.help ? `<span class="help">${esc(ex.help)}</span>` : "", id = `wf-${k}`;
    if (typ === "bool") return `<div><label class="chk"><input type="checkbox" id="${id}" data-w="${k}" ${v ? "checked" : ""}> ${esc(label)}</label>${h}</div>`;
    if (typ === "select") return `<div><label for="${id}">${esc(label)}<select id="${id}" data-w="${k}">${ex.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${ov}" ${ov == v ? "selected" : ""}>${esc(ol)}</option>` }).join("")}</select>${h}</label></div>`;
    if (typ === "multi") return `<div><label>${esc(label)}<div class="chips" style="margin-top:2px">${ex.options.map(o => `<label class="chk" style="font-size:12px"><input type="checkbox" data-wm="${k}" value="${o}" ${(v || []).includes(o) ? "checked" : ""}> ${o}</label>`).join("")}</div></label></div>`;
    return `<div><label for="${id}">${esc(label)}<input id="${id}" data-w="${k}" type="${typ === "text" ? "text" : "number"}" step="any" value="${esc(v ?? "")}">${h}</label></div>`;
  }).join("")}</div>`;
}
function wBind() {
  $("step").querySelectorAll("[data-w]").forEach(el => el.addEventListener("change", () => { const k = el.dataset.w, t = fieldDef(k)[2]; WCFG[k] = t === "bool" ? el.checked : (t === "int" || t === "float") ? +el.value : el.value; WPLAN = null; wRender(); wPlan() }));
  $("step").querySelectorAll("[data-wm]").forEach(el => el.addEventListener("change", () => { const k = el.dataset.wm; WCFG[k] = [...$("step").querySelectorAll(`[data-wm="${k}"]:checked`)].map(x => x.value); WPLAN = null; wPlan() }));
  $("step").querySelectorAll(".adv-line").forEach(l => { const b = l.nextElementSibling; if (b && b.classList.contains("adv-body")) b.hidden = !l.classList.contains("open"); l.addEventListener("click", () => { b.hidden = !l.classList.contains("open") }) });
}
// SOL that buys the holders' % on the curve after the dev buy (pump.fun or Meteora DBC numbers, with the curve fee)
function holderSolFor(c) {
  const [vs, vt, fee] = c.launchpad === "meteora" ? [28.74, 1061.5e6, 0.01] : [30, 1073e6, 0.0125], k = vs * vt, t1 = (+c.dev_buy_pct || 0) * 1e7, t2 = t1 + (+c.holder_supply_pct || 0) * 1e7;
  return t2 < vt ? (k / (vt - t2) - k / (vt - t1)) / (1 - fee) : 0;
}
function wSet(k, v) {
  WCFG[k] = v;
  if (k === "mode" && v === "organic" && !(+WCFG.holder_buy_sol > 0)) WCFG.holder_buy_sol = +holderSolFor(WCFG).toFixed(2);   // the field shows what the % costs, not 0
  WPLAN = null; wRender(); wPlan();
}
function wGo(d) {
  if (d > 0) { const errs = wStepErrors(W_STEP); if (errs.length) {   // mark every problem on the page and stay
    for (const [k, e] of errs) { const el = $(k) || $("step").querySelector(`[data-rule="${k}"]`); if (el) wFieldErr(el, e) }
    toast(errs[0][1], "warn"); const f = $(errs[0][0]) || $("step").querySelector(`[data-rule="${errs[0][0]}"]`); if (f) f.focus(); return } }
  const i = W_STEP + d; if (i < 0 || i > W_LAST) return; if (i === W_LAST && PRE.phase === "ready") PRE = PRE_NEW(); W_STEP = i; wRender(); document.querySelector(".page").scrollTo({ top: 0 }) }
let _wpT = null;
function wPlan() { clearTimeout(_wpT); _wpT = setTimeout(async () => { try { const r = await eng("live_plan", { config: WCFG }, null, true); WPLAN = r; renderSummary() } catch (e) { } }, 120) }
const OPT = (on, click, icon, title, sub, dis) => `<button class="opt ${on ? "on" : ""}" ${dis ? "disabled" : `onclick="${click}"`}><b>${ICON(icon)}${title}</b><small>${sub}</small></button>`;
// ---- Create launch, laid out like the tool's three create tabs: a centred column, and on Launch Settings its side panel.
const TOOL_DOCS = "https://docs.proxima.tools/create-launch/launch-settings/";
let W_SIM = false, W_ADVOPEN = false;
const W_MODES = [["block0", "target", "Block-0"], ["organic", "sprout", "Organic"], ["manual", "hand", "Manual"]];
const W_PRESETS = [["quick", "zap", "Quick Build", "Fast, low cost"], ["clean", "shield", "Clean Build", "Balanced stealth"], ["full", "shield-fill", "Full Build", "Max stealth"], ["custom", "gear", "Custom", "Manual inputs"]];
const MODE_PANEL = {
  block0: ["target", "Block-0 Mode", "Block-0 Mode prioritizes execution certainty and sniper resistance over organic price action, making it ideal for competitive launches.",
    [["+++", "High Pressure Launches"], ["+++", "Guaranteed supply"], ["+++", "Can't Get Frontrun"]], [["---", "Less natural price action"], ["--", "More Expensive"], ["-", "Overkill for Small Launch"]]],
  organic: ["sprout", "Organic Mode", "Organic Mode spreads buys across multiple blocks, mimicking human behavior and making activity look natural. Best for low-key launches.",
    [["+++", "Natural price action"], ["+++", "Lower cost"], ["++", "Better for small launches"]], [["---", "Can be frontrun"], ["--", "No guaranteed supply"], ["-", "Slower execution"]]],
  manual: ["hand", "Manual Mode", "Manual Mode deploys the token on-chain and distributes SOL to wallets. No automatic buying — you buy and sell manually whenever you want.",
    [["+++", "Full control over timing"], ["+++", "No snipe or MEV needed"], ["++", "Cheapest option"]], [["---", "No automatic buying"], ["--", "Requires manual execution"], ["-", "No guaranteed supply"]]],
  quick: ["zap", "Quick Mode", "Quick Mode buys from every holder wallet straight after deploy (Buy Delay 0). The tool offers it on other launchpads, not on PumpFun.",
    [["+++", "Fast"], ["++", "Simple"], ["++", "Cheap"]], [["---", "Easy to cluster"], ["--", "Can be frontrun"], ["-", "Not on PumpFun"]]],
};
const tick = () => esc(WCFG.ticker || (WCFG.name || "TOKEN").slice(0, 6).toUpperCase());
const avatar = (cls = "") => WCFG && WCFG.img ? `<img class="avatar ${cls}" src="${WCFG.img}" alt="">` : `<div class="avatar ${cls}">${esc((WCFG.name || "T").slice(0, 2).toUpperCase())}</div>`;
// a labelled field as the tool draws it: label row (icon, *, (optional), hint), then a 36px input box with an optional suffix
function pf(label, inner, { icon, req, opt, hint, help, full, id } = {}) {
  return `<div class="pf ${full ? "full" : ""}"${id ? ` id="${id}"` : ""}><div class="pf-l">${icon ? `<span class="pf-ic">${icon}</span>` : ""}<span>${label}</span>${req ? '<span class="req">*</span>' : ""}${opt ? '<span class="pf-o">(optional)</span>' : ""}${hint ? `<span class="pf-o">${hint}</span>` : ""}${help ? `<span class="q" title="${esc(help)}">?</span>` : ""}</div><div class="pf-i">${inner}</div></div>`;
}
const pin = (k, v, suf, attrs = "") => `<input type="number" step="any" value="${v ?? ""}" data-rule="${k}" onchange="wSetNum('${k}',this)" ${attrs}>${suf ? `<span class="suf">${suf}</span>` : ""}`;
// Launch Settings limits, as the tool enforces them: an out-of-range value shows an error under its field and isn't saved
const W_RULES = { wallets: [1, 200, "Holders Count"], front_count: [1, 12, "Front MEV Count"], back_count: [0, 100, "Back MEV Count"], temp_count: [0, 200, "Temp Holders Count"],
  dev_buy_pct: [0, 79, "Developer Buy %"], target_supply_pct: [1, 79, "Holders Buy %"], holder_supply_pct: [0, 79, "Holders Buy %"], holder_buy_sol: [0.01, 5000, "Holders Buy"],
  holder_deviation_pct: [0, 99, "Holders Buy Distribution"], empty_holders: [0, 199, "Empty Holders"], buy_delay_s: [0, 600, "Buy Delay"] };
function wRuleErr(k, v) {
  const r = W_RULES[k]; if (!r) return null; let [lo, hi, n] = r;
  if (k === "wallets" && WCFG.mode === "manual") lo = 0;
  if (!isFinite(v)) return `${n}: enter a number`;
  return v < lo || v > hi ? `${n} must be between ${lo} and ${hi}` : null;
}
function wFieldErr(el, e) {
  el.classList.toggle("bad", !!e); const box = el.closest(".pf"); if (!box) return; let n = box.querySelector(".pf-err");
  if (e) { if (!n) { n = document.createElement("p"); n.className = "pf-err"; box.append(n) } n.textContent = e } else if (n) n.remove();
}
function wSetNum(k, el) { const v = el.value === "" ? NaN : +el.value, e = wRuleErr(k, v); wFieldErr(el, e); if (e) { toast(e, "warn"); return } wSet(k, v) }
// what blocks leaving a create step (the tool disables Create until these are fixed)
function wStepErrors(step) {
  const c = WCFG, out = [];
  if (step === 1) { if (!(c.name || "").trim()) out.push(["w-name", "Project Name is required"]); if (!tick().trim()) out.push(["w-tick", "Symbol is required"]) }
  if (step === 2) {
    const keys = ["wallets", "dev_buy_pct", "holder_deviation_pct", "empty_holders", c.mode === "organic" ? "holder_buy_sol" : c.mode === "block0" ? "target_supply_pct" : "holder_supply_pct"].concat(c.mode === "block0" && c.preset === "custom" ? ["front_count", "back_count", "temp_count"] : []);
    for (const k of keys) { const e = wRuleErr(k, +c[k]); if (e) out.push([k, e]) }
    const max = c.launchpad === "meteora" ? 80 : 79.31, sup = c.mode === "block0" ? +c.target_supply_pct : c.mode === "organic" ? 0 : +c.holder_supply_pct;
    if ((+c.dev_buy_pct || 0) + (sup || 0) > max) out.push(["target_supply_pct", `Developer Buy + Holders Buy can't pass ${max}% (all the coins the curve sells)`]);
  }
  return out;
}
// SEC : MS (delays) and MIN : SEC (funding delay) pairs, stored as seconds / minutes
function ptime(k, unit) {
  const v = +WCFG[k] || 0;
  if (unit === "ms") { const sec = Math.floor(v + 1e-9), ms = Math.round((v - sec) * 1000); return `<div class="pt"><input type="number" min="0" value="${String(sec).padStart(2, "0")}" aria-label="seconds" onchange="wSet('${k}',+this.value+(+this.parentNode.querySelectorAll('input')[1].value||0)/1000)"><label>SEC</label></div><span class="pt-sep">:</span><div class="pt"><input type="number" min="0" max="999" value="${String(ms).padStart(2, "0")}" aria-label="milliseconds" onchange="wSet('${k}',(+this.parentNode.parentNode.querySelector('input').value||0)+(+this.value)/1000)"><label>MS</label></div>` }
  const min = Math.floor(v + 1e-9), sec = Math.round((v - min) * 60);
  return `<div class="pt"><input type="number" min="0" value="${min || ""}" placeholder="" aria-label="minutes" onchange="wSet('${k}',+this.value+(+this.parentNode.parentNode.querySelectorAll('input')[1].value||0)/60)"><label>MIN</label></div><span class="pt-sep">:</span><div class="pt"><input type="number" min="0" max="59" value="${sec || ""}" aria-label="seconds" onchange="wSet('${k}',(+this.parentNode.parentNode.querySelector('input').value||0)+(+this.value)/60)"><label>SEC</label></div>`;
}
const colHead = (title, sub, deco) => `<div class="cr-head"><h1>${title}</h1><p>${sub}</p><span class="cr-deco" aria-hidden="true">${ICON(deco)}</span></div>`;
// Role counts the plan needs (filled from the preset as soon as the plan is calculated)
function roleCounts() {
  const L = WPLAN && WPLAN.layers, b0 = WCFG.mode === "block0";
  return [["Deployer", 1, "dev"], ...(b0 ? [["Front MEV", L ? L.front : "…", "front"], ["Back MEV", L ? L.back : "…", "back"], ...(L && L.temp ? [["Temp Holders", L.temp, "temp"]] : [])] : []),
    ["Holders", L ? L.holders : WCFG.wallets, "holder"], ...(WCFG.empty_holders ? [["Empty Holders", WCFG.empty_holders, "empty"]] : [])];
}
function renderRoles() {
  const el = $("w-roles"); if (!el) return;
  const rc = roleCounts(), total = rc.reduce((a, [, v]) => a + (+v || 0), 0);
  el.innerHTML = WCFG.w_imported
    ? `<div class="iw-done"><div class="iw-top"><b>${ICON("wallet")}${total} wallets ready</b><span class="opt">${WCFG.wallet_source === "marketplace" ? "Recommended wallets (aged)" : "Fresh sandbox wallets"}</span><button class="link" onclick="openImportWallets()">Change</button></div>
        <div class="role-row">${rc.map(([n, v, k]) => `<span class="role r-${k}"><b>${v}</b>${n}</span>`).join("")}</div></div>`
    : `<button class="iw-drop" onclick="openImportWallets()"><span class="iw-ic">${ICON("wallet")}</span><b>Import Wallets</b><small>Generate sandbox wallets or pick from My Wallets</small>
        <span class="role-row">${rc.map(([n, v, k]) => `<span class="role r-${k}"><b>${v}</b>${n}</span>`).join("")}</span></button>`;
}
function openImportWallets() {
  const rc = roleCounts(), rec = WCFG.wallet_source === "marketplace";
  modal("Import Wallets", `<p class="help" style="margin:0 0 12px">The plan needs these wallets. In the simulator they are sandbox wallets: no private keys, nothing on-chain.</p>
    <div class="iw-table">${rc.map(([n, v, k]) => `<div><span class="role r-${k}"><b>${v}</b></span><span>${n}</span><span class="opt">${k === "dev" ? "Deploys and makes the Dev Buy" : k === "front" ? "Buys in the deploy block" : k === "back" ? "Buyback layer after Front MEV" : k === "temp" ? "Receives supply by transfer" : k === "empty" ? "Funded, no launch buy" : "Final holder wallets"}</span></div>`).join("")}</div>
    <div class="iw-opts"><label class="iw-opt"><input type="radio" name="iw-src" value="fresh" ${rec ? "" : "checked"}><div><b>Generate fresh wallets</b><small>New wallets made for this launch, funded by the plan.</small></div></label>
      <label class="iw-opt"><input type="radio" name="iw-src" value="marketplace" ${rec ? "checked" : ""}><div><b>Recommended Wallets</b><small>Aged wallets: funded 24 h+ before launch, at least 25 min apart, with prior activity.</small></div></label></div>`,
    [["Cancel", ""], ["Import " + rc.reduce((a, [, v]) => a + (+v || 0), 0) + " wallets", "primary", d => {
      const src = d.querySelector("input[name=iw-src]:checked").value; WCFG.wallet_source = src; if (src === "marketplace") WCFG.mkt_age_min_h = Math.max(24, WCFG.mkt_age_min_h);
      WCFG.w_imported = true; WPLAN = null; wRender(); wPlan(); toast("Wallets imported (sandbox)") }]]);
}
function wRender() {
  if (!WCFG) return;
  const stage = W_STEP === W_LAST, st = $("stepper");
  st.hidden = stage || ROUTE !== "create"; $("title").hidden = !stage && ROUTE === "create";
  st.innerHTML = W_TOP.map(([n, i]) => `<a class="${i === W_STEP ? "on" : ""}" onclick="W_STEP=${i};wRender()">${esc(n.toUpperCase())}</a>`).join("");
  $("t-create").classList.toggle("staging", stage); $("t-create").classList.toggle("with-panel", W_STEP === 2);
  renderTopToken();
  let h = "";
  if (W_STEP === 0) h = colHead("Create a new launch", "Choose where your token will be launched<br>and associated settings.", "pill") + `<div class="cr-body">
    <div class="sec-label">Blockchain</div><div class="chain-grid">${CHAINS.map(([n, cnt, ok, isNew]) => `<button class="tile ${ok ? "on" : "nm"}" ${ok ? "" : 'aria-disabled="true" title="Not modelled yet: only Solana / PumpFun is simulated"'}><span class="tl">${mark(n)}${esc(n)}${isNew ? '<span class="new">NEW</span>' : ""}</span><small><span class="marks">${(ok ? ["PumpFun", "StonkFun", "LetsBonk"] : [n]).map(mark).join("")}</span>${cnt} LAUNCHPADS</small></button>`).join("")}</div>
    <div class="sec-label">Launchpad</div><div class="pad-grid">${PADS.map(n => { const k = PAD_KEY[n], on = k && (WCFG.launchpad || "pumpfun") === k; return `<button class="tile ${on ? "on" : k ? "" : "nm"}" ${k ? `onclick="wSet('launchpad','${k}')" data-tip="${esc(PAD_TIP[k])}"` : 'aria-disabled="true" data-tip="Not modelled: only PumpFun and Meteora DBC are simulated"'}>${mark(n)}${esc(n)}</button>` }).join("")}</div>
    <div class="sec-label">Launch currency</div><div class="pad-grid cur"><button class="tile on"><span class="tl">${mark("Solana")}Solana</span><small>SOL</small></button><button class="tile" disabled title="Not modelled: the sandbox launches in SOL only"><span class="tl">USDC</span><small>USDC</small></button><button class="tile" disabled title="Not modelled: the sandbox launches in SOL only"><span class="tl">+ Custom</span></button></div>
    <div class="cr-actions"><button class="btn primary w164" onclick="wGo(1)">Configure Token</button></div>
    <div class="or"><span>OR</span></div><div class="cr-actions"><button class="btn" onclick="show('config')">${ICON("copy")}Clone a Configuration</button><button class="btn" onclick="show('import')">${ICON("upload")}Import a Real Launch</button></div></div>`;
  if (W_STEP === 1) h = colHead("Token Details", "Define how your token will appear on<br>explorers, wallets, and launchpads.", "palette") + `<div class="cr-body"><div class="pf-grid td">
    ${pf("Project Name", `<input id="w-name" maxlength="32" value="${esc(WCFG.name)}" oninput="WCFG.name=this.value;this.closest('.pf').querySelector('.cnt').textContent='('+this.value.length+'/32)';renderTopToken();wFieldErr(this,null)">`, { req: true, hint: `<span class="cnt">(${(WCFG.name || "").length}/32)</span>` })}
    ${pf("Symbol", `<input id="w-tick" maxlength="10" value="${tick()}" oninput="WCFG.ticker=this.value.toUpperCase();renderTopToken();wFieldErr(this,null)">`, { req: true, hint: `(${tick().length}/10)` })}
    ${pf("Description", `<input id="w-desc" value="${esc(WCFG.desc || "")}" placeholder="Enter a description..." oninput="WCFG.desc=this.value">`, { opt: true, full: true })}
    <div class="pf full"><div class="pf-l"><span>Image or video</span><span class="req">*</span></div><div class="td-img"><label class="drop" for="w-img">${ICON("upload")}<span>Drag &amp; Drop or <u>Choose file</u> to upload</span><small>.jpg, .png or .gif · saved with this draft in your browser</small></label><input id="w-img" type="file" accept="image/*" hidden onchange="wImg(this)"><div class="td-prev"><small>PREVIEW</small>${WCFG.img ? `<img src="${WCFG.img}" alt="Token image">` : ""}</div></div></div>
    </div><div class="pf-grid socials">${[["x", "X/Twitter"], ["tg", "Telegram"], ["web", "Website"]].map(([k, n], i) => pf(n, `<input placeholder="${["x.com/launchcontrol", "t.me/launchcontrol", "example.com"][i]}" value="${esc((WCFG.socials || {})[k] || "")}" oninput="(WCFG.socials=WCFG.socials||{}).${k}=this.value;saveDrafts()">`, { opt: true })).join("")}</div>
    <div class="adv-line" onclick="this.classList.toggle('open')">${ICON("gear")}<span>ADVANCED SETTINGS (OPTIONAL)</span><i></i>${ICON("chev", "i chev")}</div>
    <div class="adv-body">${pf("Start from a configuration", `<select onchange="wFrom(this.value)"><option value="">Keep current settings</option>${Object.keys(BUILTIN).concat(Object.keys(SAVED)).map(n => `<option>${esc(n)}</option>`).join("")}</select>`, { full: true })}</div>
    <div class="cr-actions"><button class="btn btn-create w164" onclick="wGo(1)">Create</button></div></div>`;
  if (W_STEP === 2) {
    const m = WCFG.mode, b0 = m === "block0", custom = b0 && WCFG.preset === "custom";
    const recent = [...Object.keys(SAVED).reverse(), "SHARDS reconstruction", "Block-0 Clean Build", "Block-0 Full Build (temp holders)"].filter((n, i, a) => (BUILTIN[n] || SAVED[n]) && a.indexOf(n) === i).slice(0, 3);
    h = colHead("Launch Settings", "Define how your launch behaves on-chain.<br><span>These settings control execution patterns.</span>", "rocket") + `<div class="cr-body">
    <div class="recent">${recent.map(n => `<button class="rc" onclick="wFrom(${esc(JSON.stringify(n))})" title="Reuse ${esc(n)}"><span class="avatar">${esc(n.replace(/^Block-0 /, "").slice(0, 2).toUpperCase())}</span><span><b>$${esc(n.replace(/^Block-0 /, "").replace(/\W+/g, "").slice(0, 8).toUpperCase())}...</b><small>${esc(n.slice(0, 14))}</small></span>${mark(((BUILTIN[n] || SAVED[n] || {}).launchpad) === "meteora" ? "Meteora DBC" : "PumpFun")}</button>`).join("")}<button class="btn sel-preset" onclick="openPresetPicker()">Select a<br>Preset</button></div>
    <div class="or"><span>OR</span></div>
    <div class="mode-tiles">${W_MODES.map(([k, ic, n]) => `<button class="mt m-${k} ${m === k ? "on" : ""}" onclick="wSet('mode','${k}')">${ICON(ic)}<b>${n}</b><span>Mode</span></button>`).join("")}</div>
    ${m === "quick" ? `<p class="note warn">Quick mode isn't offered on PumpFun. It stays available for configurations that model other launchpads. <a onclick="wSet('mode','block0')">Switch to Block-0</a></p>` : ""}
    <div class="pf-grid">
      ${pf("Developer Buy %", pin("dev_buy_pct", WCFG.dev_buy_pct, "%"), { icon: `<span class="dot dev"></span>`, opt: true })}
      ${m === "manual" ? pf("Holders Funding", pin("holder_buy_sol", WCFG.holder_buy_sol || 0, "SOL"), { icon: mark("Solana"), opt: true }) :
        m === "organic" ? pf("Holders Buy", pin("holder_buy_sol", WCFG.holder_buy_sol || 0, "SOL"), { icon: `<span class="dot hold"></span>`, req: true, hint: "(Excluding Developer)" }) :
        pf("Holders Buy", pin(b0 ? "target_supply_pct" : "holder_supply_pct", b0 ? WCFG.target_supply_pct : WCFG.holder_supply_pct, "%"), { icon: `<span class="dot hold"></span>`, req: true, hint: "(Excluding Developer)" })}
      ${pf("Holders Buy Distribution", pin("holder_deviation_pct", WCFG.holder_deviation_pct ?? 40, "%", 'min="0" max="99"'), { icon: ICON("sliders"), opt: true, hint: "Deviation from average", help: `How randomly the holders' total buy is split across wallets. Range per wallet: ${f2(1 - (WCFG.holder_deviation_pct ?? 40) / 100, 2)}× – ${f2(1 + (WCFG.holder_deviation_pct ?? 40) / 100, 2)}× the average.`, full: true })}
      ${pf("Holders Count", pin("wallets", WCFG.wallets, "", 'min="1" max="200"'), { icon: ICON("users"), req: m !== "manual", opt: m === "manual", hint: "(1-200)", help: "Number of holder wallets that buy at launch.", full: true })}
      ${m === "organic" ? pf("Buy Delay", ptime("buy_delay_s", "ms"), { opt: true, full: true }) : ""}
    </div>
    ${b0 ? `<div class="pf-l sec">${ICON("layers")}<span>Block-0 Preset</span></div>
      <div class="preset-tiles">${W_PRESETS.map(([p, ic, n, sub]) => `<button class="${WCFG.preset === p ? "on" : ""}" onclick="wSet('preset','${p}')"><b>${ICON(ic)}${n}</b><small>${sub}</small></button>`).join("")}</div>
      ${WCFG.preset === "quick" ? `<div class="note warn">${ICON("alert")}<span>This preset won't bypass BubbleMaps and InsightX clusters.<br>Clusters may show up after ~10 minutes.</span></div>` : ""}
      ${custom ? `<div class="pf-grid">${pf("Front MEV Count", pin("front_count", WCFG.front_count, "", 'min="1" max="12"'), { icon: ICON("layers"), req: true, hint: "(1-12)", help: "Wallets that buy in the deploy block." })}
        ${pf("Back MEV Count", pin("back_count", WCFG.back_count, "", 'min="0" max="100"'), { icon: ICON("layers"), opt: true, hint: "(0-100)" })}
        ${pf("Temp Holder Count", pin("temp_count", WCFG.temp_count, "", 'min="0" max="200"'), { icon: ICON("layers"), opt: true, hint: "(0-200)", full: true })}
        ${pf("Front→Back Delay", ptime("front_back_delay_s", "ms"), { icon: ICON("clock"), opt: true })}${pf("Back→Temp Delay", ptime("back_temp_delay_s", "ms"), { icon: ICON("clock"), opt: true })}
        ${pf("Buy Delay", ptime("buy_delay_s", "ms"), { icon: ICON("clock"), opt: true, full: true })}</div>`
      : `<div class="pf-l sec">${ICON("layers")}<span>Back MEV Tuning</span></div>
        <input type="range" class="tune" min="0.4" max="1.6" step="0.05" value="${WCFG.back_tuning}" style="--p:${(WCFG.back_tuning - 0.4) / 1.2 * 100}%" oninput="this.style.setProperty('--p',(this.value-0.4)/1.2*100+'%')" onchange="wSet('back_tuning',+this.value)" aria-label="Back MEV Tuning">
        <div class="slider-ends"><span>Less Sniper</span><span>Less Top Trader</span></div>`}` : ""}
    <div id="w-roles" class="iw"></div>
    <div class="cex-card"><label class="cex-row"><input type="checkbox" ${WCFG.funding_source === "cex" ? "checked" : ""} onchange="wSet('funding_source',this.checked?'cex':'funder')"><div><b><span class="marks">${["Binance", "KuCoin", "Gate"].map(n => `<span class="mark cex c-${n}">${n[0]}</span>`).join("")}</span>CEX Funding</b><small>Fund wallets through CEXs. Service fees may vary from .25% to 2%.</small></div></label>
      ${WCFG.funding_source === "cex" ? `<div class="chips cex-pick">${CEX_LIST.map(n => `<label class="chk"${n === "Husher" ? ` data-tip="Husher: the service the tool routes exchange funding through (it also appears as a source)"` : ""}><input type="checkbox" data-wm="cex_sources" value="${n}" ${(WCFG.cex_sources || []).includes(n) ? "checked" : ""}> ${n}</label>`).join("")}</div>` : ""}
      ${pf("Funding Delay", ptime("funding_delay_min", "min"), { opt: true, full: true })}
      <div class="note info">${ICON("info")}<span>A 30-minute funding delay is recommended.</span></div></div>
    <div class="adv-line ${W_ADVOPEN ? "open" : ""}" onclick="W_ADVOPEN=!W_ADVOPEN;this.classList.toggle('open')">${ICON("gear")}<span>ADVANCED SETTINGS (OPTIONAL)</span><i></i>${ICON("chev", "i chev")}</div>
    <div class="adv-body"><div class="pf-grid">
      ${pf("Slippage", pin("slippage_pct", WCFG.slippage_pct ?? 100, "%", 'min="0" max="100" disabled data-tip="Not modelled in the sandbox"'), { opt: true, hint: "(0-100)", help: "Not modelled: the simulator fills every buy at the curve price." })}
      ${pf("Funding Delay", ptime("funding_delay_min", "min"), { opt: true })}
      ${pf("Alternative Routing", pin("alt_routing_pct", WCFG.alt_routing_pct ?? 0, "%", 'min="0" max="100" disabled data-tip="Not modelled in the sandbox"'), { opt: true, hint: "(0-100)", help: "Share of wallets routed through trading-platform activity. Not modelled yet." })}
      ${pf("Empty Holders", pin("empty_holders", WCFG.empty_holders, "", 'min="0" max="200"'), { opt: true, hint: "(0-200)" })}
      ${pf("Fee Target", pin("fee_target", WCFG.fee_target, "SOL"), { icon: mark("Solana"), opt: true, full: true })}
      ${m !== "manual" ? `<label class="sched full"><span class="sw"><input type="checkbox" ${WCFG.scheduled ? "checked" : ""} onchange="wSet('scheduled',this.checked)"><i></i></span><div><b>Scheduled Mode</b><small>Deploy and dev buy execute at launch. Holder buys wait until you click Snipe on the live page.</small></div></label>` : ""}
    </div></div>
    <div class="cr-actions"><button class="btn btn-create w164" onclick="wGo(1)">Create</button></div></div>`;
  }
  if (stage) { $("step").innerHTML = renderStaging(); $("summary").hidden = true; wBind(); return }
  $("summary").hidden = W_STEP !== 2;
  $("step").innerHTML = h; wBind(); renderRoles(); renderSummary();
  if (!WPLAN) wPlan();
}
// Simulation settings (sandbox only): the market around the launch, fees, wallet prep. Not part of the tool, so it lives behind
// the flask icon on the Funding page instead of in Launch Settings.
function simSettingsHTML() {
  const m = WCFG.mode, b0 = m === "block0";
  return `<p class="help lead">These shape the sandbox around your launch. The real tool has no such settings: they describe the market and costs your launch meets.</p>
    <div class="sec-h">${ICON("bot")}Sniper bots</div><p class="help" style="margin:-4px 0 10px">Outside bots that buy in the first seconds and sell soon after. Typical is what most real launches get: about 4 in the first 5 seconds, often none, sometimes many.</p>
    <div class="opts">${[["none", "eye", "None", "No snipers"], ["typical", "bot", "Typical launch", "0-20, usually a few, small buys"], ["busy", "bot", "Busy", "About 15, mid-size buys"], ["hot", "zap", "Hot (SHARDS-like)", "37 plus one 9.8% buyer at launch"], ["custom", "sliders", "Custom", "Set the numbers yourself"]].map(([k, ic, n, sub]) =>
      OPT(WCFG.sn_level === k, `wSet('sn_level','${k}')`, ic, n, sub)).join("")}</div>
    ${WCFG.sn_level === "custom" ? wFields(["sn_count", "sn_vary", "sn_cluster", "sn_window_s", "sn_size", "sn_hold_min", "sn_hold_max", "sn_big_pct"]) : ""}
    <div class="sec-h">${ICON("users")}Organic market</div><p class="help" style="margin:-4px 0 10px">Real outside buyers and sellers. Off by default: most launches never see organic flow. You can also switch this live from the workspace.</p>
    <div class="opts">${OPT(!WCFG.org_enabled, "wSet('org_enabled',false)", "eye", "No organic traders", "Only bots and your own wallets trade")}${[["dead", "Dead", "A handful of trades in the first minute, then nothing"], ["verylow", "Very low", "Like a typical launch: ~25 trades, nearly all in minute one"], ["mid", "Mid", "Top ~2% of coins: hundreds of trades in 5 minutes"], ["bullish", "Bullish", "A real runner: fills the curve in ~5-10 minutes"]].map(([k, n, sub]) =>
      OPT(WCFG.org_enabled && WCFG.org_level === k, `WCFG.org_enabled=true;wSet('org_level','${k}')`, "chart", n + " organic", sub)).join("")}</div>
    <div class="sec-h">${ICON("coin")}Fees</div>${wFields(["prio_median"])}
    <div class="sec-h">${ICON("coins")}Funding &amp; wallet prep</div>${wFields(["funding_source", "cex_sources", "funding_extra_mode", "funding_extra", "funding_extra_min", "funding_extra_max", "wallet_source", "mkt_age_min_h", "mkt_age_max_h", "mkt_cex_pct", "ga_enabled", "ga_amount_min", "ga_amount_max", "ga_loops", "ga_delay_s"])}
    ${b0 ? `<div class="sec-h">${ICON("layers")}Holder allocation</div>${wFields(["alloc_method"])}` : ""}
    ${m === "manual" ? `<div class="sec-h">${ICON("hand")}Manual buys (stand-in for your clicks)</div>${wFields(["manual_buy_at_s", "manual_style"])}` : ""}
    ${WCFG.scheduled ? `<div class="sec-h">${ICON("clock")}Snipe timing</div>${wFields(["snipe_manual", "snipe_at_s"])}` : ""}
    <div class="sec-h">${ICON("copy")}Copy-trade bots</div>${wFields(["ct_count", "ct_mode", "ct_fixed_sol", "ct_ratio_pct"])}`;
}
// token block in the top bar, right side (Launch Settings), as the tool shows the draft token there
function renderTopToken() {
  const el = $("top-token"); if (!el) return;
  const stage = ROUTE === "create" && WCFG && W_STEP === W_LAST;
  if (stage && WPLAN) {   // Funding page: token, Est. Market Cap, Required Funding on the left; mint and Archive on the right
    const pn = WPLAN.panel; el.hidden = false; el.classList.add("stage-top"); $("title").hidden = true;
    el.innerHTML = `${avatar("tt")}<div><div class="tt-1"><b>$${tick()}</b><span>${esc(WCFG.name || "")}</span><button class="ic" title="Copy" onclick="navigator.clipboard&&navigator.clipboard.writeText('${tick()}')">${ICON("copy")}</button><button class="ic" title="Edit token details" onclick="W_STEP=1;wRender()">${ICON("pen")}</button></div><div class="tt-2"><span class="marks">${mark("PumpFun")}</span><span class="pill">SIM${tick().slice(0, 3)}...pump</span></div></div>
      <div class="st-m"><small>Est. Market Cap <span class="q">?</span></small><span>${usd(pn.mc_high_sol)} <span class="mute">/ ${usd(pn.grad_mc_sol)}</span></span></div><div class="st-m"><small>Required Funding <span class="q">?</span></small><span class="mute">${f2(preRequired(), 3)} SOL</span></div>
      <span class="sp"></span><a class="mint">SIM${tick().slice(0, 3)}...pump</a><button class="btn arch" onclick="openArchive()">Archive ${ICON("archive")}</button>`;
    return;
  }
  el.classList.remove("stage-top");
  const on = ROUTE === "create" && WCFG && W_STEP === 2; el.hidden = !on; if (!on) return;
  el.innerHTML = `${avatar("tt")}<div><div class="tt-1"><b>$${tick()}</b><span>${esc(WCFG.name || "")}</span><button class="ic" title="Copy name" onclick="navigator.clipboard&&navigator.clipboard.writeText('${tick()}')">${ICON("copy")}</button><button class="ic" title="Edit token details" onclick="W_STEP=1;wRender()">${ICON("pen")}</button></div><div class="tt-2"><span class="pill">SIM${tick().slice(0, 3)}...pump</span><span class="pill">draft</span></div></div>
    <span class="sp"></span><button class="btn arch" onclick="openPresetPicker()">Presets ${ICON("sliders")}</button>`;
}
function openPresetPicker() {
  const names = Object.keys(BUILTIN).concat(Object.keys(SAVED).filter(n => !BUILTIN[n]));
  modal("Select a Preset", `<p class="help" style="margin:0 0 10px">Start from a saved configuration. Every value is copied; recheck them before you create.</p><div class="preset-list">${names.map(n => `<button data-n="${esc(n)}"><b>${esc(n)}</b><small>${esc((BUILTIN[n] || SAVED[n]).mode)}${(BUILTIN[n] || SAVED[n]).mode === "block0" ? " · " + esc((BUILTIN[n] || SAVED[n]).preset) : ""}</small></button>`).join("")}</div>`, [["Close", ""]])
    .querySelector(".preset-list").addEventListener("click", e => { const b = e.target.closest("button[data-n]"); if (!b) return; wFrom(b.dataset.n); b.closest(".palette").remove(); toast(`Loaded ${b.dataset.n}`) });
}
// the token image is shrunk to a 128 px square and kept with the draft, so it survives a reload without filling browser storage
function wImg(inp) {
  const f = inp.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"), s = Math.min(im.width, im.height); c.width = c.height = 128;
    c.getContext("2d").drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 128, 128); WCFG.img = c.toDataURL("image/png"); saveDrafts(); wRender(); renderLaunchList() };
    im.onerror = () => toast("That file isn't an image this browser can read", "warn"); im.src = r.result };
  r.readAsDataURL(f);
}
const MODE_INFO = { block0: ["Block-0 mode"], quick: ["Quick mode"], organic: ["Organic mode"], manual: ["Manual mode"] };
const fmtDur = s => { s = Math.ceil(s - 1e-9); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s` };
const usd = sol => SOLUSD ? "$" + fmtK(sol * SOLUSD) : f2(sol, 1) + " SOL";
const fmtK = x => x >= 1e6 ? (x / 1e6).toFixed(x >= 1e7 ? 1 : 2).replace(/\.0+$/, "") + "M" : x >= 1e3 ? (x / 1e3).toFixed(x >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K" : x.toFixed(0);
// the Launch Settings side panel, laid out as the tool's: mode block, preset meters, then estimate boxes and Create
function renderSummary() {
  renderRoles();
  const el = $("summary"); if (!el || !WCFG || W_STEP !== 2) return;
  const p = WPLAN && WPLAN.panel, m = WCFG.mode, [mic, mt, md, pros, cons] = MODE_PANEL[m] || MODE_PANEL.block0;
  const meter = (ic, label, val, fill, lo, hi, help, split) => `<div class="mtr"><div class="mtr-h">${ICON(ic)}<span>${label}</span><span class="q" title="${esc(help)}">?</span><b>${val}</b></div>
    ${split ? `<div class="mtr-b split"><i style="opacity:1"></i><i style="opacity:${fill >= 1 ? 1 : 0}"></i></div>` : `<div class="mtr-b"><i style="width:${Math.max(0, Math.min(1, fill)) * 100}%"></i></div>`}<div class="mtr-e"><span>${lo}</span><span>${hi}</span></div></div>`;
  const preset = W_PRESETS.find(x => x[0] === WCFG.preset) || W_PRESETS[0];
  el.innerHTML = `<div class="mp m-${m}"><div class="mp-h">${ICON(mic)}<b>${mt}</b><a href="${TOOL_DOCS}launch-modes/" target="_blank" rel="noopener">View in documentation</a></div><p>${md}</p>
      <div class="mp-l"><div>${pros.map(([a, b]) => `<span><i>${a}</i>${b}</span>`).join("")}</div><div class="cons">${cons.map(([a, b]) => `<span><i>${a}</i>${b}</span>`).join("")}</div></div></div>
    ${m === "block0" ? `<details class="pp" open><summary>${ICON(preset[1])}<b>${preset[2]}</b>${ICON("chev", "i chev")}</summary><div class="mtrs">
      ${meter("bubbles", "Bubble Maps", p ? p.bubble_maps : "—", p && p.bubble_maps !== "Uncertain" ? 1 : 0.5, "Uncertain", "Likely clean", "The tool's own label for this preset. It doesn't test anything; launch it here and read the detector to see what a chain reader finds.", true)}
      ${meter("coin", "Supply Cost", p && p.supply_cost_pct != null ? f2(p.supply_cost_pct, p.supply_cost_pct < 10 ? 1 : 0).replace(/\.0$/, "") + "%" : "—", p && p.supply_cost_pct != null ? p.supply_cost_pct / 5.5 : 0, "Low", "High", "As the tool rates it: holder buy x a preset factor.")}
      ${meter("flag", "Detection Mode", "", p ? p.detection_mode : 0.5, "Less Sniper", "Less Top Traders", "The Back MEV Tuning slider: 0.4x to 1.6x Back MEV wallets.")}
      ${meter("broom", "Cleanup Time", p ? fmtDur(p.cleanup_time_s) : "0s", p ? Math.min(1, p.cleanup_time_s / 1800) : 0, "Fastest", "Longest", "Back x Front→Back + Temps x Back→Temp + (Holders - 1) x Buy Delay.")}</div></details>` : ""}
    <div class="pnl-sp"></div>
    ${p ? `<div class="est">
      <div class="eb row1"><span class="k">Est. Market Cap <span class="q" title="Market cap after the launch buys. After / is the migration market cap.">?</span></span><span class="v">${m === "manual" || !(p.supply_cost_sol > 0) ? usd(p.mc_high_sol) : `${usd(p.mc_low_sol)} - ${usd(p.mc_high_sol)}`} <span class="k">/ ${usd(p.grad_mc_sol)}</span></span></div>
      ${m === "manual" ? "" : `<div class="eb"><div class="r"><b>Expected Supply <span class="q" title="Final holder allocation can come in lower than planned.">?</span></b><b>${f2(p.supply_low, 1)}% - ${f2(p.supply_high, 1)}%</b></div>
        <div class="r"><span class="k">Deployer <span class="q">?</span></span><span class="k">${f2(WCFG.dev_buy_pct, 1)}%</span></div><div class="r"><span class="k">Holders <span class="q">?</span></span><span class="k">${f2(p.holders_low, 1)}% - ${f2(p.holders_high, 1)}%</span></div></div>`}
      <div class="eb"><div class="r"><b>Funding Estimation</b><b>${f2(p.funding_sol, 2)} SOL</b></div>
        ${p.supply_cost_sol > 0 ? `<div class="r"><span class="k">Supply Cost <span class="q">?</span></span><span class="k">${f2(p.supply_cost_sol, 2)} SOL</span></div>` : ""}
        <div class="r"><span class="k">Extra Funding <span class="q" title="Slippage and fee buffers the tool adds per wallet.">?</span></span><span class="k">${f2(p.extra_sol, 2)} SOL</span></div>
        <div class="r down"><span>Maximum Loss <span class="q" title="Before / after migration. An estimate, not a limit.">?</span></span><span>${f2(p.loss_pre_sol, 2)} SOL${p.loss_post_sol ? ` / ${f2(p.loss_post_sol, 2)} SOL` : ""}</span></div></div></div>` : `<p class="help" style="padding:0 24px">Calculating…</p>`}
    <div class="pnl-foot"><button class="btn btn-create w164" onclick="wGo(1)">Create</button></div>`;
}
// Pre-launch Funding page, laid out like the tool's: Funding Wallet / Auto Sell / Sniper Guard panels, the wallet table with
// per-wallet distribution, then Rescue · 1. Distribute · 2. Launch. The Funder starts empty: Deposit (sandbox SOL), Distribute
// spends it in table order (partly, if it runs short), and Launch unlocks once every wallet is funded.
let PRE = { phase: "draft", prog: 0, funder: 1000, deposited: 1000, fees: 0, dist: {} };
const PRE_NEW = () => ({ phase: "draft", prog: 0, funder: 1000, deposited: 1000, fees: 0, dist: {} });   // the sandbox Funder starts with 1,000 SOL
const preTotal = () => WPLAN ? WPLAN.wallets.reduce((a, w) => a + w.fund, 0) : 0;
const preDistributed = () => WPLAN ? WPLAN.wallets.reduce((a, w) => a + Math.min(w.fund, PRE.dist[w.id] || 0), 0) : 0;
const preRequired = () => Math.max(0, preTotal() - preDistributed() - (PRE.funder || 0));
const preDone = () => WPLAN && WPLAN.wallets.every(w => (PRE.dist[w.id] || 0) >= w.fund - 1e-9);
function rerenderStage() { funderBar(); if (ROUTE === "create" && W_STEP === W_LAST) { if (!WPLAN) { wPlan(); setTimeout(rerenderStage, 300); return } $("step").innerHTML = renderStaging(); renderTopToken() } }
const trimZ = x => { const t = (+x || 0).toFixed(3).replace(/\.?0+$/, ""); return t || "0" };
const shortA = a => a.length > 12 ? a.slice(0, 5) + "..." + a.slice(-4) : a;
const ROLE_IC = { op_dev: "crown", op_front: "layers", op_back: "layers", op_temp: "repeat", op_holder: "user", op_empty: "user", op_relay: "send", op_volume: "chart" };
function renderStaging() {
  funderBar();
  const p = WPLAN; if (!p) { wPlan(); setTimeout(rerenderStage, 300); return `<p class="help" style="padding:24px">Building the plan…</p>` }
  const ws = planOrder(p.wallets), n = { dev: 0, mev: 0, hold: 0, other: 0 }; ws.forEach(w => w.role === "op_dev" ? n.dev++ : /front|back|temp/.test(w.role) ? n.mev++ : /holder|empty/.test(w.role) ? n.hold++ : n.other++);
  const tokTotal = ws.reduce((a, w) => a + (w.tokens || 0), 0), total = preTotal(), dist = preDistributed(), done = preDone(), busy = PRE.phase === "distributing", sm = `<span class="mark">${MARKS.Solana}</span>`;
  const panel = (title, k, on, sum, add, ic) => `<div class="fp"><div class="fp-h"><b>${title}</b><button class="ic dot ${on ? "on" : ""}" title="${on ? "On" : "Off"}" onclick="${k}"></button></div>
    ${on ? `<button class="fp-set" onclick="${k}"><span>${ICON(ic)}${sum}</span><span class="sp"></span><span class="pill on">On</span></button>` : `<button class="fp-add" onclick="${k}">${ICON(ic)}<span>${add}</span></button>`}</div>`;
  const asSum = () => { const c = WCFG, m = [c.as_counter && `Counter ${f2(c.as_replication, 0)}%`, c.as_dca && "DCA", c.as_limits && "Limit"].filter(Boolean).join(" · "); return m || "Auto-Sell" };
  const sgSum = () => `${f2(WCFG.sg_threshold, 1)} SOL → ${({ nuke_all: "Nuke All", nuke_holders: "Nuke Holders", nuke_dev: "Nuke Dev", complete_early: "Complete Early" })[WCFG.sg_response]}`;
  const row = (w, i) => { const got = Math.min(w.fund, PRE.dist[w.id] || 0), f = w.fund ? got / w.fund : 1, full = f >= 1 - 1e-9, tok = w.tokens ? f2(w.tokens / 1e7, 2).replace(/\.00$/, "") + "%" : "-";
    const editable = /op_(dev|front|holder)/.test(w.role) && w.key;   // a wallet set to 0% keeps its pen
    const tp = walletTip(w.name, w.role, `<br>Funding ${trimZ(w.fund)} SOL${w.tokens ? ` · buys ${f2(w.tokens / 1e7, 2)}% of supply` : ""}<br><span class="mute">${esc(w.id)}</span>`);
    return `<tr><td class="w" data-tip="${tp}"><span class="drag" draggable="true" data-drag="${i}" title="Drag to reorder">⠿</span><span class="ix">${i + 1}.</span><span class="ri2 r-${w.role}">${ICON(ROLE_IC[w.role] || "wallet")}</span><span>${shortA(aliasOf(w.id))}</span>${isImported(w.id) ? `<span class="imp-b" data-tip="Imported">${ICON("download")}</span>` : ""}<span class="fi" style="color:${folderColor(folderOf(w.id, w.role))}">${ICON("folder")}</span><button class="ic more" aria-label="Wallet options" onclick="openRowMenu(event,${i})">⋯</button></td>
      <td class="tb">${tok}${editable ? `<button class="ic pen" title="Edit token buy %" onclick="tbEdit(this,${i})">${ICON("pen")}</button>` : ""}</td>
      <td class="dist2"><div><span>${sm}${trimZ(got)}${full ? "" : ` <span class="mute">/ ${trimZ(w.fund)}</span>`}</span><i class="sdot ${full ? "ok" : got > 0 ? "part" : ""}">${full ? ICON("check") : ""}</i></div><div class="pbar2"><i style="width:${f * 100}%;${full ? "" : "background:#ffc421"}"></i></div></td>
      <td class="acts">${w.role === "op_dev" ? `<button class="btn exp" onclick="openExport('${esc(w.name)}')">${ICON("key")}Export</button>` : ""}<button class="ic sq2" title="Add to folder" onclick="folderMenu(event,['${w.id}'])">${ICON("folder")}</button><button class="ic sq2" title="${w.role === "op_dev" ? "The deployer can't be removed" : /op_(holder|empty)/.test(w.role) ? "Remove from launch" : "MEV, temp and relay wallets come from the preset: change their counts in Launch Settings"}" ${/op_(holder|empty)/.test(w.role) ? `onclick='removeFromPlan([${JSON.stringify({ role: w.role })}])'` : "disabled"}>${ICON("trash")}</button></td></tr>` };
  return `<div class="fund-pg">
    <div class="fp-row">
      <div class="fp"><div class="fp-h"><b>Funding Wallet</b><span class="q" title="The sandbox Funder pays every wallet in this plan.">?</span></div>
        <div class="fw-pill" onclick="openFunderMenu(event)" style="cursor:pointer"><span>${funderAddr().slice(0, 15)}...${funderAddr().slice(-12)}</span><button class="ic" title="Copy" onclick="event.stopPropagation();navigator.clipboard&&navigator.clipboard.writeText('${funderAddr()}');toast('Address copied (sandbox)')">${ICON("copy")}</button><span class="sp"></span><b>${sm}${f2(PRE.funder || 0, 2)}<span>/${f2(Math.max(0, total - dist), 2)}</span></b>${ICON("chev", "i chev")}</div>
        <div class="fw-btns"><button class="btn" onclick="openDeposit()">${ICON("qr")}Deposit</button><button class="btn" onclick="openWithdraw()">${ICON("out")}Withdraw • ${sm}${f2(PRE.funder || 0, 2)}</button></div></div>
      ${panel("Auto Sell", "openAuto('sell')", WCFG.as_enabled, WCFG.as_enabled ? asSum() : "", "Add Auto-Sell", "repeat")}
      ${panel("Sniper Guard", "openSniperGuard()", WCFG.sg_enabled, WCFG.sg_enabled ? sgSum() : "", "Add Sniper Guard", "shield")}
      <div class="fp-strip"><button class="ic ${WCFG.vb_enabled ? "on" : ""}" onclick="openVolumeBotPlan()" aria-label="Volume Bot" data-tip="${esc(`<b>Volume Bot</b><br>${WCFG.vb_enabled ? `${WCFG.vb_target} SOL from +${WCFG.vb_start_s}s, ${WCFG.vb_exec}` : "Off"}`)}">${ICON("chart")}</button>
        <button class="ic ${WCFG.ab_enabled ? "on" : ""}" onclick="openAuto('buy')" aria-label="Auto Buy" data-tip="${esc(`<b>Auto Buy</b><br>${WCFG.ab_enabled ? "On" : "Off"}`)}">${ICON("repeat")}</button>
        <button class="ic" onclick="openSimSettings()" aria-label="Simulation settings" data-tip="${esc(`<b>Simulation settings</b><br>Snipers: ${({ none: "None", typical: "Typical", busy: "Busy", hot: "Hot", custom: "Custom" })[WCFG.sn_level] || "Custom"}<br>Organic market: ${WCFG.org_enabled ? ORG_NAMES[WCFG.org_level] || "custom" : "off"}<br>Priority fee ~${WCFG.prio_median ?? 0.0003} SOL`)}">${ICON("flask")}</button></div>
    </div>
    <div class="fw-bar"><span class="md m-${WCFG.mode}">${ICON(({ block0: "target", organic: "sprout", manual: "hand", quick: "zap" })[WCFG.mode])}<b>${({ block0: "Block-0", organic: "Organic", manual: "Manual", quick: "Quick" })[WCFG.mode]}</b> Mode</span><span class="sp"></span>
      <button class="btn tb2" onclick="openAddWallets('create')">+ Create Wallets</button><button class="btn tb2" onclick="openAddWallets('import')">+ Import Wallets</button><button class="btn tb2" onclick="openDeletePlan()">${ICON("trash")}Delete</button></div>
    <div class="fw-table"><div class="scroll"><table><thead><tr><th>Wallet</th><th>Token Buy %</th><th>Distributed</th><th class="acts">Actions</th></tr></thead><tbody>${ws.map(row).join("")}</tbody></table></div>
      <div class="fw-foot"><span>${n.hold} Wallets, ${n.mev} Mev, ${n.dev} Dev${n.other ? `, ${n.other} relay` : ""} <button class="ic more" aria-label="All wallets options" onclick="openAllMenu(event)">⋯</button></span><span>${ICON("coin")}${f2(tokTotal / 1e7, 2).replace(/\.00$/, "")}%</span><span>${sm}<b>${f2(dist, 2)}</b> <span class="mute">/ ${f2(total, 2)}</span><i class="sdot ${done ? "ok" : dist > 0 ? "part" : ""}">${done ? ICON("check") : ""}</i></span><span class="fees-sm" title="Network + priority fees paid by the Funder for distribution transfers">${PRE.fees ? `fees −${f2(PRE.fees, 4)} SOL` : ""}</span></div></div>
    ${done ? "" : `<div class="note warn">${ICON("alert")}<span>${busy ? "Distributing…" : (PRE.funder || 0) + 1e-9 < total - dist ? "Funding is not complete. Please send some SOL to the funder wallet and distribute funds to continue." : "The Funder holds enough SOL. Press 1. Distribute to fund every wallet."}</span></div>`}
    <div class="stage-foot"><button class="btn" ${PRE.rescuing || busy ? "disabled" : ""} onclick="doRescue()">${PRE.rescuing ? "Rescuing…" : "Rescue"}</button><span class="sp"></span>
      <button class="btn dist-btn" id="pre-dist" ${done || busy || PRE.rescuing ? "disabled" : ""} onclick="wDistribute()">1. Distribute ${ICON("share")}</button>
      <button class="btn primary launch-btn" id="pre-launch" ${done && !busy ? "" : "disabled"} onclick="wConfirmLaunch()">2. Launch ${ICON("rocket")}</button></div></div>`;
}
async function wDistribute() {
  if (PRE.rescuing) { toast("Wait for the Rescue to finish", "warn"); return }
  const ws = WPLAN.wallets; let budget = PRE.funder || 0;
  if (budget <= 1e-9) { toast("The Funder is empty. Deposit sandbox SOL first.", "warn"); openDeposit(); return }
  PRE.phase = "distributing"; rerenderStage();
  const plan = []; for (const w of ws) { const need = w.fund - (PRE.dist[w.id] || 0); if (need <= 1e-9) continue; const give = Math.min(need, budget - 0.0004); if (give <= 0) break; plan.push([w.id, give]); budget -= give + 0.0004 }
  const txFee = 0.000005 + (WCFG.prio_median || 0.0003);   // each distribution transfer pays the base fee + a priority fee
  for (let i = 0; i < plan.length; i++) { const [id, give] = plan[i]; PRE.dist[id] = (PRE.dist[id] || 0) + give; PRE.funder = Math.max(0, (PRE.funder || 0) - give - txFee); PRE.fees = (PRE.fees || 0) + txFee; if (i % 3 === 2 || i === plan.length - 1) { rerenderStage(); await new Promise(r => setTimeout(r, 60)) } }
  if (preDone()) { WCFG.funder_deposit = PRE.deposited; await eng("live_create", { config: WCFG }); const st = await eng("live_fund");
    if (st && st.funder_sol > 0) { PRE.funder = st.funder_sol; if (st.fees) PRE.fees = st.fees.total }   // the engine's own books: funding history, gas, rent, CEX cuts
    PRE.phase = "ready"; toast(`${ws.length} wallets funded · fees ${f2(PRE.fees, 4)} SOL`) }
  else { PRE.phase = "draft"; toast("Funder ran out: some wallets are only partly funded. Deposit more and distribute again.", "warn") }
  rerenderStage();
}
function wConfirmLaunch() {
  const p = WPLAN;
  modal("Important notice", `<p style="margin:0 0 10px">You're about to launch <b>$${esc(tick())}</b> (${esc(WCFG.name || "")}) in the simulator.</p><p class="help" style="margin:0">This buys ${f2(p.supply_pct, 2)}% of the supply across ${p.wallets.filter(w => w.tokens).length} sandbox wallets. No chain, no real SOL.</p>`,
    [["Cancel", ""], ["Launch", "primary", async () => { await wGoLive() }]]);
}
// Shared small dialog: actions are [label, class, fn?]; the last one is the default.
function modal(title, body, actions) {
  const d = document.createElement("div"); d.className = "palette modal";
  d.innerHTML = `<div class="box" role="dialog" aria-label="${esc(title)}"><div class="m-h"><b>${esc(title)}</b><button class="btn sm ghost" aria-label="Close" data-i="-1">✕</button></div><div class="m-b">${body}</div><div class="m-f">${actions.map(([n, c], i) => `<button class="btn ${c}" data-i="${i}">${n}</button>`).join("")}</div></div>`;
  document.body.append(d);
  d.onclick = async e => { const b = e.target.closest("[data-i]"); if (e.target !== d && !b) return; const a = b ? actions[+b.dataset.i] : null; if (a && a[2]) { if (await a[2](d) === false) return } d.remove() };
  // like popup(): Escape closes only the topmost layer, Enter presses the main (last) button, which gets focus on open
  const k = e => { if (!d.isConnected) { removeEventListener("keydown", k); return } const all = document.querySelectorAll(".palette"); if (all[all.length - 1] !== d) return;
    if (e.key === "Escape") { d.remove(); removeEventListener("keydown", k) }
    else if (e.key === "Enter" && !(e.target.matches && e.target.matches("button, textarea"))) { const b = d.querySelectorAll(".m-f [data-i]"); if (b.length) { e.preventDefault(); b[b.length - 1].click() } } };
  addEventListener("keydown", k);
  setTimeout(() => { const b = d.querySelectorAll(".m-f [data-i]"); if (b.length && d.isConnected) b[b.length - 1].focus({ preventScroll: true }) });
  return d;
}
// Reusing a configuration copies its launch settings only. Automations (Volume Bot, Auto Buy/Sell, Sniper Guard, Cleanup) and the
// sandbox's scripted dump are never carried over: you plan those yourself on the Funding page, so nothing runs that you didn't set.
const AUTO_OFF = { vb_enabled: false, vb_planned: false, vb_start_s: 0, as_enabled: false, as_extra: [], ab_enabled: false, ab_extra: [], sg_enabled: false, cl_enabled: false, exit_enabled: false };
function wFrom(n) {
  if (!n) return; const c = BUILTIN[n] || SAVED[n]; if (!c) return;
  const keep = { name: ($("w-name") && $("w-name").value) || WCFG.name || c.name, ticker: WCFG.ticker, img: WCFG.img, socials: WCFG.socials, desc: WCFG.desc };
  WCFG = Object.assign(JSON.parse(JSON.stringify(c)), AUTO_OFF, keep); WPLAN = null; wRender();
  toast(`Launch settings copied from ${n}. No automations were copied: plan them on the Funding page.`);
}
async function quickStart() { WCFG = JSON.parse(JSON.stringify(BUILTIN["SHARDS reconstruction"])); WCFG.name = "SHARDS"; await wLaunch() }

// ======================================================= live workspace
const AUTO_ST = new Map();
let BMEV = false, LST = null, LSPEED = 0, LTIMER = null, LBUSY = false, LCUR = 0, LSEL = new Set(), CH = null, BTAB = "wallets", TAPE = "all", SIDE = "buy", _lastBottom = 0, _lastRail = 0, TRADES = [];
async function wLaunch() { lSpeed(0); await eng("live_create", { config: WCFG }); await eng("live_fund"); await wGoLive() }
async function wGoLive() {
  LIVE_CFG = WCFG; LIVE_RUN = "R" + Date.now().toString(36); const used = DRAFTS.find(d => d.config === WCFG); if (used) { DRAFTS = DRAFTS.filter(d => d !== used); if (DRAFT_ID === used.id) DRAFT_ID = null; saveDrafts() }   // the draft became this launch
  lSpeed(0); LST = await eng("live_launch"); LCUR = 0; TRADES = []; LSEL.clear(); PRE = PRE_NEW();
  if (!CH) CH = new LiveChart($("chart"), $("chartwrap")); CH.clear();
  ACT.length = 0; ACT_SEEN.clear(); $("live-empty").hidden = true; $("ws").hidden = false; buildRail(); show("live");
  await lStep(0.4); lSpeed(1); toast(`${WCFG.name} deployed`);
}
function lSpeed(x) { LSPEED = x; clearInterval(LTIMER); if (x > 0) LTIMER = setInterval(() => lStep(x * 0.25), 250); renderHeader(); if (ROUTE === "live") show("live") }
async function lStep(sec) {
  if (LBUSY || !LST) return; LBUSY = true;
  try { const t0 = performance.now(), s = await eng("live_step", { slots: Math.round(sec / SLOT), cursor: LCUR, light: true }, null, true); ingest(s); statusBar(performance.now() - t0) } finally { LBUSY = false }
}
async function lAct(name, params = {}) {
  if (!LST) return;
  try { const s = await eng("live_action", { name, params, cursor: LCUR }); ingest(s); _lastRail = 0; _lastBottom = 0; renderRail(); renderBottom(true); return true } catch (e) { return false }
}
function ingest(s) {
  const prevSnipe = LST && LST.snipe_pending; LST = s;
  if (s.inc) { LCUR = s.inc.cursor; if (s.inc.trades.length) { TRADES.push(...s.inc.trades); CH.add(s.inc.trades); pushTape(s.inc.trades) } }
  if (s.read) CH.setRead(s.read);
  CH.setNow(s.t, s.timeline); renderHeader(); renderTapeAges();
  const now = performance.now();
  const paused = !LSPEED;   // paused or stepping (+10s): refresh everything at once; while playing, throttle the heavy panels
  if (paused || now - _lastRail > 500) { renderRail(); _lastRail = now }
  if (paused || now - _lastBottom > 1000) { renderBottom(); _lastBottom = now }
  clearTimeout(ingest.trail); ingest.trail = setTimeout(() => { renderRail(); renderBottom(); _lastRail = _lastBottom = performance.now() }, 1100);   // throttled panels always catch up
  LIVE_FUNDER = +s.funder_sol || 0; funderBar();
  if (s.fees && $("st-fees")) $("st-fees").innerHTML = `${ICON("coin")}Fees −${f2(s.fees.total, 3)} SOL`;
  logEvents(s.timeline); statusBar(); renderLaunchList(); if (ROUTE === "activity" && now - (ingest.ll || 0) > 1000) { renderActivity(); ingest.ll = now }
  if (prevSnipe !== s.snipe_pending) renderRail();
}
let MKT = { n: -1, nb: 0, ns: 0, vb: 0, vs: 0 };
// The workspace header sits in the top bar, as in the tool: token, metric cells, buys / volume / sells, then the rail's top (clock, Withdraw).
function renderHeader() {
  const s = LST, el = $("hdr"); if (!s || !el) return;
  const on = ROUTE === "live"; el.hidden = !on; if (on) $("title").hidden = true;
  if (MKT.n !== TRADES.length) { MKT = TRADES.reduce((m, t) => (t[2] ? (m.nb++, m.vb += t[3]) : (m.ns++, m.vs += t[3]), m), { nb: 0, ns: 0, vb: 0, vs: 0 }); MKT.n = TRADES.length }
  const solIn = (s.wallets || []).reduce((a, w) => a + w.sol, 0), tot = MKT.vb + MKT.vs || 1;
  el.innerHTML = `<div class="tw-token">${avatar("tt")}<div><div class="tt-1"><b>$${tick()}</b><span>${esc(WCFG.name)}</span><button class="ic" title="Copy ticker" onclick="copyText('$${tick()}','Ticker copied')">${ICON("copy")}</button></div>
      <div class="tt-2"><span class="marks">${mark(s.launchpad === "Meteora DBC" ? "Meteora DBC" : "PumpFun")}${mark("Solana")}</span><button class="pill" onclick="copyText('SIM${tick().slice(0, 3)}...pump','Mint address copied (made-up sandbox address)')" title="Copy the mint address">SIM${tick().slice(0, 3)}...pump</button><span class="pill">${ICON("clock")}${mmss(s.t)}</span></div></div></div>
    <div class="metric"><span>${mcFmt(s.mc_sol)}</span><small>Mcap</small></div>
    <div class="metric"><span>${SOLUSD ? "$" + subPrice(s.mc_sol / 1e9 * SOLUSD) : subPrice(s.mc_sol / 1e9) + " SOL"}</span><small>Price</small></div>
    <div class="metric"><span>${s.migrated ? "Migrated" : f2(s.curve_pct, 1) + "%"}</span><small>${s.migrated ? (s.venue || "PumpSwap") : "Bonding curve"}</small></div>
    <div class="metric"><span>${s.holders ? fmt(s.holders.count, 0) : "–"}</span><small>Holders</small></div>
    <div class="metric"><span>${s.holders ? f2(s.holders.top10, 1) + "%" : "–"}</span><small>Top 10</small></div>
    <span class="sp"></span>
    <div class="tw-bvs"><div><small>Buys</small> <b class="up">${MKT.nb} / ${solFmt(MKT.vb)}</b><i class="up" style="width:${MKT.vb / tot * 100}%"></i></div><div class="mid"><small>Volume</small><b>${solFmt(MKT.vb + MKT.vs)} SOL</b></div><div class="r"><small>Sells</small> <b class="down">${MKT.ns} / ${solFmt(MKT.vs)}</b><i class="down" style="width:${MKT.vs / tot * 100}%"></i></div></div>
    <div class="tw-right clock"><span class="pill sim-t">${ICON("clock")}sim ${mmss(s.t)}</span><button class="btn wd" onclick="openWithdraw()">${ICON("out")}Withdraw · <span class="mark">${MARKS.Solana}</span>${f2(solIn, 1)}</button><button class="btn ar-btn" title="Archive this launch (keeps chart, read, fees, P&L)" aria-label="Archive this launch" onclick="archiveLive()">${ICON("archive")}</button></div>`;
  const ck = $("ck"); if (ck) ck.innerHTML = `<span class="t">${mmss(s.t)}</span><div class="seg">${[[0, "pause"], [1, "1×"], [5, "5×"], [20, "20×"]].map(([v, n]) => `<button class="${LSPEED === v ? "on" : ""}" onclick="lSpeed(${v})" aria-label="${v ? n + " speed" : "Pause"}">${v ? n : ICON("pause")}</button>`).join("")}</div><button class="btn sm" onclick="lStep(10)" title="Advance 10 s">${ICON("skip")}10s</button>`;
}
// tiny prices the way charting sites print them: $0.0₄123 = 0.0000123
function subPrice(x) {
  if (!(x > 0)) return "0"; if (x >= 0.01) return x.toFixed(x >= 1 ? 2 : 4);
  const z = Math.ceil(-Math.log10(x) - 1e-9) - 1, sig = String(Math.round(x * 10 ** (z + 3))).replace(/0+$/, "") || "0";   // z zeros after the point
  return `0.0<sub>${z}</sub>${sig}`;
}
function ownTotals(ids) {
  const set = ids ? new Set(ids) : null, out = { bought: 0, sold: 0, tok: 0 };
  for (const t of TRADES) if (t[7] && (!set || set.has(t[7]))) { if (t[2]) out.bought += t[3]; else out.sold += t[3] }
  for (const w of (LST && LST.wallets) || []) if (!set || set.has(w.id)) out.tok += w.tok;
  out.holdPct = out.tok / 1e7; out.upnl = out.sold - out.bought + out.tok * (LST ? LST.mc_sol / 1e9 : 0);
  return out;
}
// ---- trade tape
function pushTape(arr) {
  const box = $("tape"); if (!box) return;
  const frag = document.createDocumentFragment();
  for (let i = arr.length - 1; i >= Math.max(0, arr.length - 60); i--) {
    const t = arr[i]; if (TAPE === "mine" && !t[7]) continue; if (TAPE === "dev" && !(t[5] === "dev_buy" || /^Dev/.test(t[6]))) continue;
    const r = document.createElement("div"); r.className = "tape-row fresh"; r.dataset.t = t[0];
    r.innerHTML = `<span class="${t[2] ? "up" : "down"}"><span class="tdot" style="background:${TOOL_COLORS[t[5]] || "#777"}"></span>${solFmt(t[3])}</span><span>${mcFmt(t[1])}</span><span class="who ${t[7] ? "own" : ""}" title="${esc(TOOL_NAMES[t[5]] || t[5])}">${esc(t[6])}</span><span class="age">0s</span>`;
    frag.appendChild(r);
  }
  box.insertBefore(frag, box.firstChild);
  while (box.children.length > 120) box.removeChild(box.lastChild);
}
function renderTapeAges() { const now = LST ? LST.t : 0; for (const r of $("tape").children) { const a = now - +r.dataset.t; r.lastChild.textContent = a < 60 ? Math.max(0, Math.round(a)) + "s" : Math.floor(a / 60) + "m" } }
function rebuildTape() { $("tape").innerHTML = ""; pushTape(TRADES.slice(-400)); renderTapeAges(); [...$("tape").children].forEach(r => r.classList.remove("fresh")) }
// ---- bottom panel
const ROLE = { op_dev: "dev", op_front: "front MEV", op_back: "back MEV", op_temp: "temp", op_holder: "holder", op_empty: "empty holder", op_relay: "relay", op_volume: "volume" };
function renderBottom(force) {
  const s = LST, el = $("bottom"); if (!s || !el || ROUTE !== "live") return;
  if (BTAB === "map" && !force && $("l-map")) return;
  const tabs = [["wallets", "My Wallets"], ["trades", "Latest Trades"], ["holders", "Holders"], ["activity", "History"], ["map", "Bubble Maps"], ["detector", "Warning signs"]];
  let h = `<div class="btabs">${tabs.map(([k, n]) => `<button class="${BTAB === k ? "on" : ""}" onclick="BTAB='${k}';renderBottom(true)">${k === "map" ? ICON("bubbles") : ""}${n}</button>`).join("")}<span class="sp"></span>
    <button class="pillbtn" onclick="openAddWallets('create')">+ Create Wallets</button><button class="pillbtn" onclick="openAddWallets('import')">${ICON("download")}Import Wallets</button><button class="pillbtn" onclick="openFundWallets()">${ICON("coins")}Fund Wallets</button></div>`;
  if (BTAB === "wallets" && s.wallets) {
    const price = s.mc_sol / 1e9, sm = `<span class="mark">${MARKS.Solana}</span>`, usdv = x => SOLUSD ? `<small>≈$${fmt(x * SOLUSD, 2)}</small>` : "";
    const sum = s.wallets.reduce((a, w) => (a.sol += w.sol, a.tok += w.tok, a), { sol: 0, tok: 0 });
    const roleIc = { op_dev: "dev", op_front: "mev", op_back: "bmev", op_temp: "temp", op_holder: "hold", op_empty: "hold", op_relay: "relay", op_volume: "vol" };
    const acts = w => `<div class="qa">${[25, 50, 75, 100].map(v => `<button class="qb" title="Buy with ${v}% of this wallet's SOL" onclick="qt('${w.id}','buy',${Math.max(0, w.sol * v / 100 - 0.01).toFixed(4)})">${v}%</button>`).join("")}${[25, 50, 75, 100].map(v => `<button class="qs" title="Sell ${v}% of this wallet's tokens" onclick="qt('${w.id}','sell',${v})">${v}%</button>`).join("")}</div>`;
    const rowOf = (w, i) => `<tr><td class="ix"><input type="checkbox" aria-label="select ${esc(w.name)}" ${LSEL.has(w.id) ? "checked" : ""} onchange="this.checked?LSEL.add('${w.id}'):LSEL.delete('${w.id}');renderRail()"><span>${i}</span></td><td data-tip="${walletTip(w.name, w.role, `<br>${f2(w.sol, 3)} SOL · ${f2(w.pct, 2)}% of supply`)}"><span class="wl"><i class="ri ${roleIc[w.role] || ""}"></i>${esc(w.name)}<span class="rolechip">${esc(ROLE[w.role] || w.role)}</span></span></td>
      <td class="num">${f2(w.pct, 2).replace(/\.00$/, "")}%</td><td class="num">${sm}${f2(w.sol, 3)} ${usdv(w.sol)}</td><td class="num">${f2(w.tok / 1e6, 2)}M <small>${f2(w.tok * price, 3)} SOL</small></td><td>${acts(w)}</td></tr>`;
    const isMev = w => /op_(front|back|temp)/.test(w.role), mev = s.wallets.filter(isMev), rest = s.wallets.filter(w => !isMev(w));
    const ms = mev.reduce((a, w) => (a.sol += w.sol, a.tok += w.tok, a), { sol: 0, tok: 0 }); let n = 0;
    h += `<div class="scroll wtable"><table><thead><tr><th class="ix">#</th><th>Wallet ⇅</th><th class="num">Supply ⇅</th><th class="num">Balance ⇅</th><th class="num">Tokens</th><th class="act">Actions</th></tr></thead><tbody>
      ${rest.filter(w => w.role === "op_dev").map(w => rowOf(w, ++n)).join("")}
      ${mev.length ? `<tr class="grp-row" onclick="BMEV=!BMEV;renderBottom(true)"><td class="ix"></td><td>${ICON("zap")}<b>MEV Wallets</b> <span class="mute">(${mev.length})</span></td><td class="num">${f2(ms.tok / 1e7, 2).replace(/\.00$/, "")}%</td><td class="num">${sm}${f2(ms.sol, 2)} ${usdv(ms.sol)}</td><td class="num">${f2(ms.tok / 1e6, 1)}M</td><td class="act">${ICON("chev", "i chev" + (BMEV ? " open" : ""))}</td></tr>${BMEV ? mev.map(w => rowOf(w, ++n)).join("") : (n += mev.length, "")}` : ""}
      ${rest.filter(w => w.role !== "op_dev").map(w => rowOf(w, ++n)).join("")}
      </tbody><tfoot><tr class="tfoot"><td></td><td>Total: ${s.wallets.length} Wallets</td><td class="num">${f2(sum.tok / 1e7, 2)}%</td><td class="num">${sm}${f2(sum.sol, 2)} ${usdv(sum.sol)}</td><td class="num">${f2(sum.tok / 1e6, 1)}M</td><td></td></tr></tfoot></table></div>`;
  } else if (BTAB === "trades") {
    h += `<div class="scroll" style="max-height:440px"><table><thead><tr><th>Age</th><th>Side</th><th style="text-align:right">SOL</th><th style="text-align:right">MCap</th><th>Trader</th><th>Tool (sandbox truth)</th></tr></thead><tbody>${TRADES.slice(-200).reverse().map(t => `<tr><td class="data mute">${mmss(Math.max(0, s.t - t[0]))}</td><td class="${t[2] ? "up" : "down"}">${t[2] ? "Buy" : "Sell"}</td><td class="data" style="text-align:right">${solFmt(t[3])}</td><td class="data" style="text-align:right">${mcFmt(t[1])}</td><td class="${t[7] ? "own" : ""}">${esc(t[6])}</td><td><span class="ctx"><i style="background:${TOOL_COLORS[t[5]] || "#777"}"></i>${esc(TOOL_NAMES[t[5]] || t[5])}</span></td></tr>`).join("") || `<tr><td class="mute">No trades yet.</td></tr>`}</tbody></table></div>`;
  } else if (BTAB === "holders" && s.holders) {
    h += `<div class="scroll" style="max-height:440px"><table><thead><tr><th>#</th><th>Holder</th><th style="text-align:right">% supply</th><th>Group (sandbox truth)</th></tr></thead><tbody>${s.holders.list.map((x, i) => `<tr><td class="mute">${i + 1}</td><td class="${x.own ? "own" : ""}">${esc(x.who)}${x.own ? ' <span class="pill own">yours</span>' : ""}</td><td class="data" style="text-align:right">${f2(x.pct, 2)}</td><td class="mute">${esc(x.group)}</td></tr>`).join("")}</tbody></table></div>`;
  } else if (BTAB === "activity") {
    h += `<div class="scroll" style="max-height:440px"><table><tbody>${s.timeline.slice().reverse().map(([t, m]) => `<tr><td class="data mute" style="width:60px">${mmss(t)}</td><td>${esc(m)}</td></tr>`).join("") || `<tr><td class="mute">Nothing yet.</td></tr>`}</tbody></table></div>`;
  } else if (BTAB === "detector") {
    h += `<p class="help" style="margin:0 0 6px">Warning signs anyone could spot from the public blockchain right now, without inside knowledge. Strong = clear sign, Some = worth a look, None = not seen.</p>` + (s.report || []).map(r => { const pl = SIG_PLAIN[r.id] || [r.name, r.detail || ""]; return `<div class="sigrow" data-tip="${esc(`<b>${pl[0]}</b><br>${pl[1]}`)}"><span class="lv ${r.level}">${({ high: "STRONG", med: "SOME", low: "WEAK", none: "NONE" })[r.level] || r.level.toUpperCase()}</span><b>${esc(pl[0])}</b><span class="v">${esc(r.value)}</span></div><p class="help sig-what">${esc(pl[1])}</p>` }).join("");
  } else if (BTAB === "map") {
    h += `<div class="row" style="margin-bottom:8px;align-items:center"><select id="l-gmode" style="width:auto" onchange="drawGraph()"><option value="cluster">Colour: linked clusters</option><option value="truth">Colour: sandbox truth</option></select><label class="chk"><input type="checkbox" id="l-gorg" onchange="relayout()"> Include unlinked organic</label><button class="btn sm" onclick="lMap()">Refresh</button></div><canvas id="l-map"></canvas><div class="legend" id="l-glg"></div>`;
    el.innerHTML = h; lMap(); return;
  }
  const sc = el.querySelector(".scroll"), top = sc ? sc.scrollTop : 0; el.innerHTML = h; const sc2 = el.querySelector(".scroll"); if (sc2) sc2.scrollTop = top;
}
function pick(r) { (LST.wallets || []).forEach(w => { if (r === "tok" ? w.tok > 1 : w.role === r) LSEL.add(w.id) }); renderBottom(true); renderRail() }
function qt(id, side, amt) { lAct("trade", { side, wallets: [id], amount: amt, style: "parallel" }).then(ok => ok && toast(LSPEED ? `${side === "buy" ? "Buy" : "Sell"} sent` : `${side === "buy" ? "Buy" : "Sell"} sent: it fills in the next block, and the clock is paused (press 1× or +10s)`)) }
async function lMap() { const g = await eng("live_graph"); GC = { src: () => g.graph, cv: "l-map", mode: "l-gmode", lg: "l-glg", org: "l-gorg", tab: "t-live", h: 460 }; relayout() }

// ---- right rail
const GROUPS = [["selected", "Selected wallets"], ["holders", "Holders"], ["front", "Front MEV"], ["back", "Back MEV"], ["dev", "Dev"], ["all", "All my wallets"]];
const GROUP_ROLE = { holders: "op_holder", front: "op_front", back: "op_back", dev: "op_dev" };
function groupIds() {
  const g = $("r-group") ? $("r-group").value : "holders", ws = (LST && LST.wallets) || [];
  if (g === "selected") return [...LSEL];
  if (g === "all") return ws.filter(w => w.role !== "op_relay").map(w => w.id);
  return ws.filter(w => w.role === GROUP_ROLE[g]).map(w => w.id);
}
const V = id => $(id).value;
function acc(id, icon, title, body) { return `<details class="acc" id="${id}"><summary>${ICON(icon)}<span>${title}</span><span class="pill" id="${id}-st">Off</span>${ICON("chev", "i chev")}</summary><div>${body}</div></details>` }
// Right rail, laid out like the tool's Market tab: Buy/Sell, a wallet-group block and a Deployer block (header, amount + action, quick chips),
// the Bought/Sold/Holding/uP&L strip, send / burn / lock, Claim Rewards, Nuke, then the automation rows.
let RAILTAB = "market";
function railTab(k) { RAILTAB = k; document.querySelectorAll("#rail-tabs [data-r]").forEach(b => b.classList.toggle("on", b.dataset.r === k)); $("rail").hidden = k !== "market"; $("rail-trades").hidden = k !== "trades"; if (k === "trades") rebuildTape() }
function buildRail() {
  const row = (id, icon, title, body) => `<details class="arow" id="${id}"><summary>${ICON(icon)}<span>${title}</span><span class="pill" id="${id}-st">Off</span>${ICON("plus", "i plus")}</summary><div class="arow-b">${body}</div></details>`;
  $("rail").innerHTML = `
  <div id="snipe-box" class="snipe" hidden><b>${ICON("zap")} Scheduled launch</b><span class="help" style="color:var(--text)">Holder buys are waiting. Snipe starts them now.</span><button class="btn primary block" onclick="lAct('snipe').then(ok=>ok&&toast('Snipe: holder buys started'))">Snipe now</button></div>
  <div class="bs-toggle"><button class="b-buy on" id="sb-buy" onclick="setSide('buy')">Buy</button><button class="b-sell" id="sb-sell" onclick="setSide('sell')">Sell</button></div>
  <div class="grp">
    <div class="grp-h"><select id="r-group" onchange="renderRail()" aria-label="Wallet group">${GROUPS.map(([k, n]) => `<option value="${k}" ${k === "holders" ? "selected" : ""}>${n}</option>`).join("")}</select><span id="r-gpct">0%</span></div>
    <div id="r-buy"><div class="grp-in"><span class="lbl">SOL / WALLET</span><input id="r-amt" type="number" value="0.5" step="0.1" min="0" aria-label="SOL per wallet"><button class="btn buy" onclick="doTrade('buy')"><span id="r-buy-l">Buy</span></button></div>
      <div class="qrow">${[0.1, 0.5, 1, 5].map(v => `<button class="chip-btn buyc" onclick="$('r-amt').value=${v}">${v}</button>`).join("")}<button class="chip-btn buyc" onclick="maxBuy()">MAX</button></div></div>
    <div id="r-sell" hidden><div class="grp-in"><span class="lbl">% OWNED</span><input id="r-pct" type="number" value="100" min="0" max="100" aria-label="Percent of tokens"><button class="btn sell" onclick="doTrade('sell')"><span id="r-sell-l">Sell</span></button></div>
      <div class="qrow">${[25, 50, 75, 100].map(v => `<button class="chip-btn sellc" onclick="$('r-pct').value=${v}">${v}%</button>`).join("")}</div></div>
    <div class="grp-f"><div class="seg" id="r-style"><button class="on" data-v="stagger" onclick="segPick(this)">Stagger</button><button data-v="parallel" onclick="segPick(this)">Parallel</button></div><span class="help" id="r-gsum"></span></div>
  </div>
  <div class="grp dep"><div class="grp-h"><span>Deployer</span><span id="r-dpct">0%</span></div>
    <div class="grp-in"><span class="lbl">% SUPPLY</span><input id="r-dsell" type="number" value="100" min="0" max="100" aria-label="Deployer percent to sell"><button class="btn sell" onclick="devSell()">Sell</button></div>
    <div class="qrow">${[25, 50, 75, 100].map(v => `<button class="chip-btn sellc" onclick="$('r-dsell').value=${v}">${v}%</button>`).join("")}</div></div>
  <div class="stat4" id="r-stats"></div>
  <button class="fee-line" id="r-fees" onclick="openFees()"></button>
  <div class="iconrow"><button class="btn" title="Fund wallets" aria-label="Fund wallets" onclick="openFundWallets()">${ICON("send")}</button><button class="btn" title="Burn supply" aria-label="Burn supply" onclick="openBurnLock('burn')">${ICON("flame")}</button><button class="btn" title="Lock supply (Streamflow)" aria-label="Lock supply" onclick="openBurnLock('lock')">${ICON("lock")}</button></div>
  <div id="r-sub" hidden></div>
  <div class="rail-sec"><button class="btn claim" onclick="lAct('claim').then(ok=>ok&&toast('Creator fees claimed'))">${ICON("coins")}<span id="r-claim">Claim Rewards</span></button></div>
  <div class="rail-sec"><button class="btn nuke" id="nk" onclick="nukeArm()">${ICON("bomb")}<span id="r-nuke">Nuke</span></button></div>
  <div class="arows">
  <button class="arow" id="a-sell" onclick="openAuto('sell')">${ICON("down")}<span>AutoSell</span><span class="pill" id="a-sell-st">Off</span>${ICON("plus", "i plus")}</button>
  <button class="arow" id="a-buy" onclick="openAuto('buy')">${ICON("up")}<span>AutoBuy</span><span class="pill" id="a-buy-st">Off</span>${ICON("plus", "i plus")}</button>
  <button class="arow" id="a-vb" onclick="openVolumeBot()">${ICON("chart")}<span>Volume Bot</span><span class="pill" id="a-vb-st">Off</span>${ICON("plus", "i plus")}</button>
  <button class="arow" id="a-cl" onclick="openCleanup()">${ICON("broom")}<span>Cleanup</span><span class="pill" id="a-cl-st">Off</span>${ICON("plus", "i plus")}</button>
  <button class="arow" id="a-sg" onclick="openSniperGuard()">${ICON("shield")}<span>Sniper Guard</span><span class="pill" id="a-sg-st">Off</span>${ICON("plus", "i plus")}</button>
  </div>
  <div class="rail-card"><div class="rc-h">${ICON("users")}Organic market <span class="pill">sandbox</span></div><div class="seg org-seg" id="r-org">${[["off", "Off"], ["dead", "Dead"], ["verylow", "Very low"], ["mid", "Mid"], ["bullish", "Bullish"]].map(([k, n]) => `<button data-v="${k}" onclick="setOrganic('${k}')">${n}</button>`).join("")}</div>
    <p class="help" style="margin:6px 0 0">Outside buyers and sellers. Real flow is irregular: clusters, lulls, sudden calls, a few whales.</p></div>
  <div class="rail-card"><div class="rc-h">${ICON("clock")}Running</div><div id="r-run" class="help">Nothing running.</div></div>
  <div class="rail-card"><div class="rc-h">${ICON("coins")}P&amp;L <span class="pill">sandbox</span></div><div id="r-pnl"></div></div>`;
  renderRail();
}
const ORG_NAMES = { dead: "Dead", verylow: "Very low", mid: "Mid", bullish: "Bullish" };
function setOrganic(k) { lAct("organic", { level: k }).then(ok => ok && toast(k === "off" ? "Organic market off" : `Organic market: ${ORG_NAMES[k]}`)) }
function devSell() { const d = (LST.wallets || []).find(w => w.role === "op_dev"); if (!d) return; lAct("trade", { side: "sell", wallets: [d.id], amount: +V("r-dsell"), style: "parallel" }).then(ok => ok && toast("Deployer sell sent")) }
function setSide(s) { SIDE = s; $("sb-buy").classList.toggle("on", s === "buy"); $("sb-sell").classList.toggle("on", s === "sell"); $("r-buy").hidden = s !== "buy"; $("r-sell").hidden = s !== "sell" }
function segPick(b) { b.parentNode.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)) }
function segVal(id) { const b = $(id).querySelector("button.on"); return b ? b.dataset.v : null }
function maxBuy() { const ids = groupIds(), ws = LST.wallets.filter(w => ids.includes(w.id)); if (!ws.length) return; $("r-amt").value = Math.max(0, Math.min(...ws.map(w => w.sol)) - 0.01).toFixed(3) }
async function doTrade(side) {
  const ids = groupIds(); if (!ids.length) return err("Choose wallets: pick a group or select rows in My wallets.");
  const amount = side === "buy" ? +V("r-amt") : +V("r-pct");
  if (await lAct("trade", { side, wallets: ids, amount, style: segVal("r-style") })) toast(`${side === "buy" ? "Buy" : "Sell"} sent from ${ids.length} wallet${ids.length > 1 ? "s" : ""}`);
}
function subPanel(k) {
  const el = $("r-sub"); if (!el.hidden && el.dataset.k === k) { el.hidden = true; return }
  el.dataset.k = k; el.hidden = false;
  el.innerHTML = k === "fund" ? `<div class="f2"><label>SOL per wallet<input id="sp-amt" type="number" value="2" step="0.5"></label><label>Route<select id="sp-route"><option value="direct">Direct from Funder</option><option value="cex">Via Binance (CEX)</option></select></label></div>
      <div class="row"><button class="btn primary" onclick="lAct('fund',{wallets:groupIds(),amount:+V('sp-amt'),method:V('sp-route'),cex:'Binance'}).then(ok=>ok&&toast('Wallets funded'))">Fund wallets</button><button class="btn" onclick="lAct('deposit',{amount:50}).then(ok=>ok&&toast('Deposited 50 simulated SOL'))">Deposit 50 SOL</button></div><span class="help">Live funding is instant here. The real tool spaces fundings 30+ minutes apart.</span>`
    : `<label>% of each wallet's tokens<input id="sp-pct" type="number" value="100"></label><button class="btn ${k === "burn" ? "danger" : "primary"}" onclick="lAct('${k}',{wallets:groupIds(),pct:+V('sp-pct')}).then(ok=>ok&&toast('${k === "burn" ? "Tokens burned" : "Tokens locked via Streamflow"}'))">${k === "burn" ? ICON("flame") + "Burn" : ICON("lock") + "Lock via Streamflow"}</button>`;
}
function startVB() { lAct("volume", { wallets: groupIds(), target: +V("vb-target"), exec: V("vb-exec"), mode: V("vb-mode"), duration: +V("vb-dur"), delay_min: +V("vb-dmin"), delay_max: +V("vb-dmax"), size_mode: V("vb-sm"), wave: +V("vb-wave"), size: +V("vb-smin"), size_min: +V("vb-smin"), size_max: +V("vb-smax"), fee_target: +V("vb-fee") }).then(ok => ok && toast("Volume Bot started")) }
function startAuto(side) {
  const q = k => $(`a${side}-${k}`);
  lAct("auto", { side, counter: q("ct").checked, rate: +q("rate").value, replication: +q("rep").value, min_trigger: +q("trig").value, min_per_trade: +q("mpt").value, dca: q("dca").checked, dca_interval_s: +q("int").value, dca_mode: "fixed",
    dca_amount: +q("amt").value, limits: q("lim").value.trim(), mc_min: +q("mcmin").value, mc_max: +q("mcmax").value, end_duration_s: +q("end").value, end_amount: 0, pool: q("pool").value }).then(ok => ok && toast(`Auto${side === "buy" ? "Buy" : "Sell"} started`));
}
function startCleanup() { lAct("cleanup", { wallets: groupIds(), outputs: +V("cl-out"), share: +V("cl-share"), delay_mode: V("cl-dm"), delay: +V("cl-d"), delay_min: +V("cl-dmin"), delay_max: +V("cl-dmax"), double_pct: +V("cl-dbl"), method: V("cl-m") }).then(ok => ok && toast("Cleanup started")) }
function nukeArm() {
  const held = LST.wallets.filter(w => w.tok > 1 && w.role !== "op_relay"), price = LST.mc_sol / 1e9;
  // the summary follows the ticks: all wallets, all but the dev, or the dev wallet alone
  const sum = scope => { const ws = held.filter(w => scope === "dev" ? w.role === "op_dev" : scope === "holders" ? w.role !== "op_dev" : true), v = ws.reduce((a, w) => a + w.tok * price, 0);
    return ws.length ? `Sells every token in ${ws.length} wallet${ws.length === 1 ? "" : "s"} (~${f2(v, 2)} SOL at the current price, before slippage). In the real tool this can't be undone; here it's a simulation.` : "None of the chosen wallets hold any tokens." };
  const scopeOf = d => d.querySelector("#nk-dev-only").checked ? "dev" : d.querySelector("#nk-dev").checked ? "all" : "holders";
  const d = modal("Nuke confirmation", `<label class="chk"><input type="checkbox" id="nk-dev" checked> Include dev wallet</label><label class="chk"><input type="checkbox" id="nk-dev-only"> Dev wallet only</label>
    <p class="help" id="nk-sum" style="margin:4px 0 0">${sum("all")}</p>`,
    [["Cancel", ""], ["Confirm nuke", "danger", d => { nuke(scopeOf(d)) }]]);
  d.addEventListener("change", () => { if (d.querySelector("#nk-dev-only").checked) d.querySelector("#nk-dev").checked = true; d.querySelector("#nk-sum").textContent = sum(scopeOf(d)) });
}
// Collecting → Hop funded → Completed, advanced by sim time (the hop pays out a few seconds after collecting).
function withdrawProgress() {
  const d = modal("Withdraw", `<div class="wd-steps" id="wd-steps"></div><p class="help" id="wd-txt" style="margin:12px 0 0"></p>`, [["Done", "primary"]]);
  const draw = () => { const w = LST && LST.withdraw; if (!w || !document.body.contains(d)) return false; const k = w.phase === "done" ? 3 : 2;
    $("wd-steps").innerHTML = ["Collecting", "Hop funded", "Completed"].map((n, i) => `<div class="${i < k ? "on" : ""}"><i>${i < k ? "✓" : ""}</i><span>${n}</span></div>`).join("");
    $("wd-txt").textContent = w.phase === "done" ? `${f2(w.sol, 2)} SOL paid out from ${w.n} wallets.` : `${f2(w.sol, 2)} SOL from ${w.n} wallets is in the hop wallet. It pays out a few seconds of sim time from now${LSPEED ? "" : " (press play)"}.`; return w.phase !== "done" };
  draw(); const t = setInterval(() => { if (!draw()) clearInterval(t) }, 250);
}
function nuke(scope) { lAct("nuke", { scope }).then(ok => ok && toast(`Nuked: ${scope}`, "warn")) }
function renderRail() {
  const s = LST; if (!s || !$("r-gsum")) return;
  const ids = groupIds(), ws = (s.wallets || []).filter(w => ids.includes(w.id)), sol = ws.reduce((a, w) => a + w.sol, 0), tok = ws.reduce((a, w) => a + w.tok, 0);
  $("r-gsum").innerHTML = `${ids.length} wallet${ids.length === 1 ? "" : "s"} · ${f2(sol, 2)} SOL`;
  $("r-gpct").textContent = f2(tok / 1e7, 2).replace(/\.00$/, "") + "%";
  const dev = (s.wallets || []).find(w => w.role === "op_dev"); $("r-dpct").textContent = dev ? f2(dev.pct, 2).replace(/\.00$/, "") + "%" : "0%";
  const price = s.mc_sol / 1e9, held = (s.wallets || []).reduce((a, w) => a + (w.role === "op_relay" ? 0 : w.tok * price), 0);
  $("r-claim").textContent = `Claim Rewards - ${f2(s.pnl ? s.pnl.creator_fees : 0, 3)} SOL`; $("r-nuke").textContent = `Nuke - ${f2(held, 2)} SOL`;
  $("r-buy-l").textContent = `Buy · ${ids.length} wallet${ids.length === 1 ? "" : "s"}`; $("r-sell-l").textContent = `Sell · ${ids.length} wallet${ids.length === 1 ? "" : "s"}`;
  const g = ownTotals(ids);
  const sm = `<span class="mark">${MARKS.Solana}</span>`;
  if (s.fees) $("r-fees").innerHTML = `${ICON("coin")}<span>Fees paid</span><b class="down">−${f2(s.fees.total, 4)} SOL</b><span class="mute">Funder ${f2(s.funder_sol, 2)} / ${f2(s.fees.funder_start, 0)}</span>${ICON("chev", "i chev")}`;
  $("r-stats").innerHTML = `<div><small>Bought</small><b class="up">${sm}${solFmt(g.bought)}</b></div><div><small>Sold</small><b class="down">${sm}${solFmt(g.sold)}</b></div><div><small>Holding</small><b>${sm}${f2(g.holdPct, 2)}%</b></div><div title="If you exit now (real exit value, after fees)"><small>uP&L</small><b class="${(s.pnl2 ? s.pnl2.if_exit : g.upnl) >= 0 ? "up" : "down"}">${sm}${(s.pnl2 ? s.pnl2.if_exit : g.upnl) >= 0 ? "+" : ""}${solFmt(s.pnl2 ? s.pnl2.if_exit : g.upnl)}</b></div>`;
  $("snipe-box").hidden = !s.snipe_pending;
  if (s.organic && $("r-org")) $("r-org").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === s.organic.level));
  const kindOf = { volume: "a-vb", autobuy: "a-buy", autosell: "a-sell", cleanup: "a-cl", guard: "a-sg" };
  for (const id of Object.values(kindOf)) { const p = $(id + "-st"); if (!p) continue; p.textContent = "Off"; p.className = "pill" }
  // tell the user when an automation stops, finishes or triggers (not only a status word in the rail)
  for (const a of s.autos) { const was = AUTO_ST.get(a.id); if (was !== undefined && was !== a.status && /^(stopped|triggered|done|cancelled)/.test(a.status) && !/^(done|cancelled)/.test(was)) toast(`${a.title}: ${a.status}`, /stopped|triggered/.test(a.status) ? "warn" : "ok"); AUTO_ST.set(a.id, a.status) }
  // rail pills: planned automations show when they start (scheduled), then Running / Armed / Done / Triggered
  const label = a => a.status === "scheduled" ? `at ${mmss(a.t)}` : a.status === "running" ? "Running" : a.status === "armed" ? "Armed" : a.status.startsWith("done") ? "Done" : a.status === "triggered" ? "Triggered" : a.status.split(":")[0];
  for (const a of s.autos) { if (/^(Generate|Scripted)/.test(a.title)) continue; const kind = a.title.startsWith("Volume") ? "volume" : a.title.startsWith("AutoBuy") ? "autobuy" : a.title.startsWith("AutoSell") ? "autosell" : a.title.startsWith("Cleanup") ? "cleanup" : "guard"; const p = $(kindOf[kind] + "-st"); if (!p) continue;
    if (a.status === "running" || a.status === "armed") { p.textContent = label(a); p.className = "pill run" } else if (p.textContent === "Off" || a.status === "scheduled") { p.textContent = label(a); p.className = "pill" + (a.status === "triggered" ? " bad" : a.status.startsWith("done") ? " ok" : a.status === "scheduled" ? " sched" : "") } }
  $("r-run").innerHTML = s.autos.length ? s.autos.slice().reverse().map(a => {
    const st = a.stats || {}, pct = st.of ? Math.min(100, ((st.volume_sol ?? st.buyers ?? st.claims ?? 0) / st.of) * 100) : null;
    return `<div class="run-item"><div class="top"><b title="${esc(a.title)}">${esc(a.title)}</b><span class="pill ${a.status === "running" || a.status === "armed" ? "run" : a.status.startsWith("done") ? "ok" : a.status === "triggered" ? "bad" : ""}">${esc(a.status === "scheduled" ? "starts " + mmss(a.t) : a.status)}</span>${a.status === "running" || a.status === "scheduled" ? `<button class="btn sm ghost" onclick="lAct('cancel',{id:${a.id}})">Cancel</button>` : ""}</div>
      ${pct !== null ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ""}<span class="help">${Object.entries(st).filter(([k]) => k !== "of").map(([k, v]) => `${k.replace("_", " ")} ${typeof v === "number" ? f2(v, 2) : v}`).join(" · ") || "starting"}</span></div>`;
  }).join("") : "Nothing running.";
  if (s.pnl2) {
    const p = s.pnl2, sg = v => `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${f2(v, 2)}</span>`;
    const q = t => ` data-tip="${esc(t)}"`;
    $("r-pnl").innerHTML = `<div class="kv"><span${q("All the SOL you put into the Funder for this launch.")}>Money you put in</span><span>${f2(p.deposited, 2)}</span><span${q("SOL sitting in all your wallets right now (Funder, dev, MEV, holders…).")}>SOL in your wallets now</span><span>${f2(p.sol_now, 2)}</span>
      <span class="tot"${q("SOL now minus SOL put in. Ignores the coins you still hold.")}>Up / down so far</span><span class="tot">${sg(p.realised)}</span>
      <span${q(`What your coins would really bring in if every wallet sold now, one after another, into the ${p.migrated ? (s.venue || "PumpSwap") + " pool" : "bonding curve"}. Each sale lowers the price for the next, and fees come off.`)}>Your coins if you sold all now</span><span>${f2(p.exit_sol, 2)}</span>
      <span${q("Coins × today's price. You can't actually get this: selling pushes the price down.")}>Your coins at today's price</span><span class="mute">${f2(p.paper_sol, 2)}</span>
      <span class="tot"${q("Up / down so far + what your coins would really bring in. This is the honest result.")}>Result if you sold everything now</span><span class="tot">${sg(p.if_exit)}</span>
      <span${q("Every fee your wallets paid: network, priority, trading, tips, account rent, exchange cuts.")}>Fees paid</span><span class="down">−${f2(p.fees, 3)}</span><span${q("The tool keeps 5% of the SOL from its sells (Sell, AutoSell, Nuke, Sniper Guard).")}>…of which the tool's 5%</span><span class="down">−${f2(p.platform, 3)}</span>
      <span${q("pump.fun pays the coin's creator a small cut of every trade. You can claim it with Claim Rewards.")}>Creator rewards waiting</span><span>${f2(p.claimable, 3)}</span><span${q(p.migrated ? "SOL in the trading pool. Every sell takes from this." : "SOL inside the bonding curve. Every sell takes from this.")}>${p.migrated ? "SOL in the trading pool" : "SOL in the bonding curve"}</span><span>${f2(p.liquidity_sol, 2)}</span>
      ${s.pnl.organic_n ? `<span${q("The simulated normal traders (organic market) together: how much they are up or down.")}>Normal traders (${s.pnl.organic_n})</span>${sg(s.pnl.organic)}` : ""}</div>
      <p class="help" style="margin:8px 0 0">Paper value assumes every token sells at today's price. The exit value is what the ${p.migrated ? "pool" : "curve"} would actually pay: the gap is what thin liquidity costs a dump.</p>`;
  }
}
// Wallets page laid out like the launch tool's My Wallets: folder column, toolbar, sortable table.
let WFOLD = "all", WQ = "", WSORT = ["bal", -1], WSUB = "";
const FOLDERS = [["all", "All launch wallets", null], ["op_front", "Front MEV", "op_front"], ["op_back", "Back MEV", "op_back"], ["op_temp", "Temp holders", "op_temp"], ["op_holder", "Holders", "op_holder"], ["op_empty", "Empty holders", "op_empty"], ["op_dev", "Dev", "op_dev"], ["op_volume", "Volume", "op_volume"], ["op_relay", "Relays", "op_relay"]];
function walletStats() {   // per-wallet volume and realised + open P&L from the trade feed
  const m = {}, px = LST ? LST.mc_sol / 1e9 : 0;
  for (const t of TRADES) { if (!t[7]) continue; const r = m[t[7]] || (m[t[7]] = { vol: 0, net: 0 }); r.vol += t[3]; r.net += t[2] ? -t[3] : t[3] }
  return id => { const r = m[id] || { vol: 0, net: 0 }, w = LST.wallets.find(x => x.id === id); return { vol: r.vol, pnl: r.net + (w ? w.tok * px : 0) } };
}
let WSEL = new Set();
function renderWalletsPage() {
  const el = $("wallets-page"), s = LST, live = !!(s && s.wallets);
  if (!live && WCFG && !WPLAN) { wPlan(); setTimeout(() => { if (ROUTE === "wallets") renderWalletsPage() }, 350) }
  const st = live ? walletStats() : () => ({ vol: 0, pnl: 0 }), cnt = {}; if (live) for (const t of TRADES) if (t[8]) cnt[t[8]] = (cnt[t[8]] || 0) + 1;
  const src = WCFG ? (WCFG.funding_source === "cex" ? (WCFG.cex_sources || ["Binance"])[0] : "Funder") : "Funder";
  const launch = live ? s.wallets.filter(w => w.role !== "op_relay").map(w => ({ id: w.id, key: w.id, name: w.name, role: w.role, bal: w.sol, n: cnt[w.id] || 0, ...st(w.id), launches: 1, src, at: Date.now(), inLaunch: true }))
    : (WPLAN ? planOrder(WPLAN.wallets).filter(w => w.role !== "op_relay").map(w => ({ id: aliasOf(w.id), key: w.id, name: w.name, role: w.role, bal: PRE.dist[w.id] || 0, vol: 0, pnl: null, n: 0, launches: 1, src: isImported(w.id) ? "Imported" : src, at: Date.now(), inLaunch: true })) : []);
  const lib = MYW.map(w => ({ id: w.id, key: w.id, name: "My wallet", role: null, bal: w.bal, vol: 0, pnl: null, n: 0, launches: w.launches || 0, src: w.src || "Wallet", at: w.at, lib: true }));
  const all = launch.concat(lib), fo = w => folderOf(w.key, w.role);
  const rows = all.filter(w => (!WFOLD || WFOLD === "all" || fo(w) === WFOLD) && (!WQ || w.id.toLowerCase().includes(WQ) || (w.name || "").toLowerCase().includes(WQ)));
  const [sk, sd] = WSORT; rows.sort((x, y) => sk === "name" ? sd * x.id.localeCompare(y.id) : sd * ((x[sk] || 0) - (y[sk] || 0)));
  for (const k of [...WSEL]) if (!all.some(w => w.key === k)) WSEL.delete(k);
  const nsel = WSEL.size, sm = `<span class="mark">${MARKS.Solana}</span>`, usd = v => SOLUSD ? `≈${usdFmt(v * SOLUSD)}` : "";
  const th = (k, n) => `<th><button class="th" onclick="WSORT=['${k}',WSORT[0]==='${k}'?-WSORT[1]:-1];renderWalletsPage()">${n}<span class="srt">${WSORT[0] === k ? (WSORT[1] < 0 ? "↓" : "↑") : "⇅"}</span></button></th>`;
  const tot = { bal: rows.reduce((a, w) => a + (w.bal || 0), 0), vol: rows.reduce((a, w) => a + (w.vol || 0), 0), pnl: rows.reduce((a, w) => a + (w.pnl || 0), 0) };
  el.innerHTML = `<div class="wl">
    <div class="folders"><div class="chain"><span>SOLANA</span><span class="badge-sim" style="padding:1px 6px">SIM</span></div>
      <button class="fd-root ${!WFOLD || WFOLD === "all" ? "on" : ""}" onclick="WFOLD='all';renderWalletsPage()">Solana Wallets</button>
      ${FOLD.map(f => `<div class="fd ${WFOLD === f.id ? "on" : ""}" onclick="WFOLD='${f.id}';renderWalletsPage()"><span class="fi" style="color:${f.color}">${ICON("folder")}</span><span>${esc(f.name)}</span><small>(${all.filter(w => fo(w) === f.id).length})</small><span class="sp"></span><button class="ic more" aria-label="Folder options" onclick="event.stopPropagation();openFolderOpts(event,'${f.id}')">⋯</button></div>`).join("")}
      <button class="btn newf" onclick="openNewFolder()">+ Create New Folder</button>
      <div class="mk-card" onclick="openMarketLib()"><b>${ICON("cart")}Marketplace <span class="pill">NEW</span></b><p>Launch-ready wallets. Skip the warm-up and buy aged wallets ready to launch.</p></div></div>
    <div class="wl-main">
      <div class="wl-bar"><span class="count">${rows.length} Wallets</span><div class="pf-i sm srch"><span class="ic">${ICON("search")}</span><input placeholder="Search wallets" aria-label="Search wallets" value="${esc(WQ)}" oninput="WQ=this.value.toLowerCase();clearTimeout(this.t);this.t=setTimeout(()=>{renderWalletsPage();const i=document.querySelector('.wl-bar input');i.focus();i.setSelectionRange(i.value.length,i.value.length)},150)"></div><span class="sp"></span>
        <button class="btn sm" onclick="openCreateLib()">${ICON("plus")}Create</button>
        <button class="btn sm" onclick="openLibFund()">${ICON("coins")}Funding</button>
        <button class="btn sm" onclick="openWithdraw()">${ICON("out")}Withdraw</button>
        <button class="btn sm" ${nsel ? "" : 'disabled title="Select wallets first (tick the boxes in the list)"'} onclick="openGenerateActivity()">${ICON("repeat")}Generate Activity</button>
        <button class="btn sm" ${nsel ? "" : 'disabled title="Select wallets first (tick the boxes in the list)"'} onclick="openLibDelete()">${ICON("trash")}Delete</button>
        <button class="btn sm" ${nsel ? "" : 'disabled title="Select wallets first (tick the boxes in the list)"'} onclick="folderMenu(event,[...WSEL])">${ICON("sliders")}Manage</button>
        <button class="ic sq2" title="Columns" aria-label="Choose columns" onclick="openColsMenu(event)">${ICON("gear")}</button></div>
      ${all.length ? `<div class="scroll wl-table"><table class="${WCOLS.map(i => "hc" + i).join(" ")}"><thead><tr><th style="width:30px"><input type="checkbox" aria-label="Select all" ${nsel && nsel === rows.length ? "checked" : ""} onchange="this.checked?${JSON.stringify(rows.map(r => r.key)).replace(/"/g, "'")}.forEach(k=>WSEL.add(k)):WSEL.clear();renderWalletsPage()"></th>${th("name", "Wallet")}${th("bal", "Balance")}${th("vol", "Volume")}${th("pnl", "P&L")}${th("launches", "Launches")}<th>Funding</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${WSEL.has(r.key) ? "sel" : ""}"><td><input type="checkbox" ${WSEL.has(r.key) ? "checked" : ""} onchange="this.checked?WSEL.add('${r.key}'):WSEL.delete('${r.key}');renderWalletsPage()" aria-label="Select wallet"></td>
        <td data-tip="${r.role ? walletTip(r.name, r.role, `<br><span class='mute'>${esc(r.id)}</span>`) : esc(`<b>My wallet</b><br>Kept in My Wallets; import it into a launch from the Funding page.<br><span class='mute'>${esc(r.id)}</span>`)}"><span class="mono">${shortA(r.id)}</span>${r.inLaunch ? `<span class="ic-l" title="In ${esc(WCFG ? WCFG.name : "the launch")}">${ICON("rocket")}</span>` : ""}<span class="fi" style="color:${folderColor(fo(r))}">${ICON("folder")}</span>${r.role ? `<span class="rolechip">${esc(ROLE[r.role] || r.role)}</span>` : ""}</td>
        <td class="data">${sm}${f2(r.bal, 3)}<br><small class="mute">${usd(r.bal)}</small></td><td class="data">${r.vol ? `${sm}${f2(r.vol, 2)} <span class="pill">${r.n}</span>` : "–"}</td><td class="data ${r.pnl > 0 ? "up" : r.pnl < 0 ? "down" : ""}">${r.pnl ? `${sm}${r.pnl > 0 ? "+" : ""}${f2(r.pnl, 3)}` : "–"}</td><td>${r.launches || "–"}</td><td>${esc(r.src)}<br><small class="mute">${agoFmt(r.at)}</small></td></tr>`).join("")}</tbody></table></div>
      <div class="wl-foot"><span>${nsel}</span><button class="ic more" aria-label="All wallets options" onclick="openAllMenu(event,${JSON.stringify(rows.map(r => ({ id: r.id, name: r.name, key: r.key }))).replace(/"/g, "&quot;")})">⋯</button><span class="sp"></span><span>${sm}${f2(tot.bal, 3)} SOL <small class="mute">${usd(tot.bal)}</small></span><span>${sm}${f2(tot.vol, 2)} SOL</span><span class="${tot.pnl >= 0 ? "up" : "down"}">${sm}${tot.pnl >= 0 ? "+" : ""}${f2(tot.pnl, 3)}</span></div>`
      : `<div class="empty" style="padding:40px 10px">${ICON("wallet").replace('class="i"', 'class="i" style="width:30px;height:30px;color:var(--signal)"')}<h2>No Wallets Yet.</h2><p>Create wallets here to keep them in My Wallets, or start a launch: its plan creates Front MEV, Back MEV, temp and holder wallets.</p><div class="row" style="justify-content:center"><button class="btn" onclick="openCreateLib()">${ICON("plus")}Create wallets</button><button class="btn primary" onclick="newLaunch()">${ICON("plus")}Create launch</button></div></div>`}
    </div></div>`;
}
// My Wallets columns (the gear): hidden ones are remembered in this browser
let WCOLS = lsGet("lc-wcols", []);
const WCOL_NAMES = [[3, "Balance"], [4, "Volume"], [5, "P&L"], [6, "Launches"], [7, "Funding"]];
function openColsMenu(e) {
  menuAt(e, WCOL_NAMES.map(([i, n]) => `<button data-a="${i}">${WCOLS.includes(i) ? `<span style="width:14px"></span>` : ICON("check")}${esc(n)}</button>`).join(""), a => {
    const i = +a; WCOLS = WCOLS.includes(i) ? WCOLS.filter(x => x !== i) : WCOLS.concat(i); lsSet("lc-wcols", WCOLS); renderWalletsPage() });
}
// Activity log: everything the operator's tools did, like the launch tool's Activity page.
const ACT = [], ACT_SEEN = new Set(); let AFILT = "", ATAB = "all", ATIME = 0;   // ATIME: show only the last N sim seconds (0 = all time)
const ATIMES = [[0, "All-Time"], [600, "Last 10 min"], [60, "Last 1 min"]];
// First match wins, so specific tools come before the generic trade words.
const ACT_KINDS = [["Automations", /volume bot|autobuy|autosell|auto-|dca|limit order|counter/i, "var(--signal)"], ["Cleanup", /cleanup|buyback|airdrop|streamflow/i, "#5ad1c9"], ["Shield", /sniper|guard|snipe/i, "var(--down)"], ["Withdraw", /withdraw|claim/i, "var(--own)"], ["Launch Funding", /fund|deposit/i, "var(--info)"], ["Trades", /buy|sell|bought|sold|nuke|block-0/i, "var(--up)"]];
const ACT_ORDER = ["Trades", "Launch Funding", "Withdraw", "Shield", "Automations", "Cleanup"];
function actKind(m) { const k = ACT_KINDS.find(([, re]) => re.test(m)); return k || ["Launch", null, "var(--muted)"] }
function logEvents(tl) { for (const [t, m] of tl || []) { const key = t + "|" + m; if (ACT_SEEN.has(key)) continue; ACT_SEEN.add(key); ACT.push([t, m]) } }
function renderActivity() {
  const el = $("activity-page"); if (!el) return;
  const now = ACT.length ? ACT[ACT.length - 1][0] : 0, rows = ACT.slice().reverse().filter(([t, m]) => (!ATIME || t >= now - ATIME) && (!AFILT || actKind(m)[0] === AFILT) && (ATAB === "all" || (ATAB === "wallets") === /wallet|fund|withdraw|deposit/i.test(m)));
  el.innerHTML = `<div class="act-top"><div class="act-tabs">${[["all", "All"], ["launches", "Launches"], ["wallets", "Wallets"]].map(([k, n]) => `<button class="${ATAB === k ? "on" : ""}" onclick="ATAB='${k}';renderActivity()">${n}</button>`).join("")}</div><span class="sp"></span>
      <span class="act-meta">${LST ? esc(WCFG.name) + " · sim " + mmss(LST.t) : ""}</span><button class="btn act-time" onclick="ATIME=ATIMES[(ATIMES.findIndex(x=>x[0]===ATIME)+1)%ATIMES.length][0];renderActivity()" data-tip="Change the time range">${ATIMES.find(x => x[0] === ATIME)[1]} ${ICON("clock")}</button></div>
    <div class="chips2">${ACT_ORDER.map(k => `<button class="${AFILT === k ? "on" : ""}" onclick="AFILT=AFILT==='${k}'?'':'${k}';renderActivity()">${k}</button>`).join("")}</div>
    ${rows.length ? `<div class="scroll act-table"><table><thead><tr><th style="width:180px">Context</th><th>Details</th><th style="text-align:right;width:100px">Time</th></tr></thead><tbody>${rows.slice(0, 400).map(([t, m]) => { const [k, , c] = actKind(m); return `<tr><td><span class="ctx"><i style="background:${c}"></i>${k}</span></td><td>${esc(m)}${LST ? ` <span class="lpill">${esc(WCFG.name)}</span>` : ""}</td><td class="mute" style="text-align:right">${mmss(t)}</td></tr>` }).join("")}</tbody></table></div>`
      : `<p class="help" style="text-align:center;padding:30px 0">${LST ? "No events match the current filters." : "No activity yet. Launch something and every tool action shows up here."}</p>`}`;
}

// Chart reading: groups from the engine's readChart (live sim and imported launches use the same read)
const READ_COLORS = { insider: "#ff7a45", bot: "#b69cff", other: "#5f6b7c" };
// Plain words, used everywhere. "Team" = the people who launched the coin. The chart can only guess who they are ("suspected team").
const READ_NAMES = { insider: "Suspected team", bot: "Other bots", other: "Everyone else" };
const READ_HELP = { insider: "Wallets the chart thinks belong to whoever launched the coin: every wallet that bought in the launch moment, plus wallets paid by the same money. In a Block-0 launch that is the dev and Front MEV wallets, and Back MEV / holders too if money links them.",
  bot: "Wallets acting like bots but not tied to the launch: buying together in one moment, buying on a timer, selling straight after others buy, or buying and selling the same amount over and over.",
  other: "No bot signs found. Mostly normal traders, but a careful team can hide here too." };
// the chain-reading warning signs in plain words (by signal id)
const SIG_PLAIN = { same_block: ["Many wallets bought at the same moment", "Several wallets bought in the same block (a fifth of a second). Real people don't line up like that; one script or bundle does."],
  common_funding: ["Wallets paid by the same sender", "Different trading wallets got their SOL from the same private wallet, so one person probably controls them."],
  cex_funding: ["Fresh wallets paid from exchanges", "Brand-new wallets funded straight from an exchange just before buying. Hides who paid them, a common trick."],
  timing: ["Buys on a timer", "Buys arriving at a steady beat (every X seconds). People are random; timers are bots."],
  equal_pairs: ["Fake volume: buy then sell the same amount", "The same wallets buy and sell matching amounts over and over. Makes volume look high without new buyers (volume bot)."],
  counter: ["Selling into every buy", "Right after someone buys, a wallet sells a fixed share of it. That's an AutoSell bot draining buyers."],
  cleanup: ["Coins passed between their own wallets", "Coins or SOL moving from one of their wallets to another to make holders look spread out."],
  tips: ["Paid tips to go first", "Wallets paid Jito tips so their trades land together in one block (bundles)."],
  consolidation: ["Money collected into one wallet", "Many trading wallets sent their SOL to one address at the same time: the team cashing out."] };
const PHASE_COLORS = { bundle: "#f4b23e", accumulate: "#4f9dff", wash: "#b69cff", exit: "#f0525b", dump: "#ff2d55" };
const PHASE_NAMES = { bundle: "Launch moment", accumulate: "Team buying", wash: "Fake trading", exit: "Team selling", dump: "Team dump" };
const PHASE_HELP = { bundle: "The coin was just created. Wallets that buy in this exact moment had to be set up in advance, so they are almost always the team (plus a few snipers right after).",
  accumulate: "The suspected team's share of the coin is going up.",
  wash: "The suspected team is buying and selling about the same amount, so their share stays flat. Volume looks busy but nobody new is buying (volume bot, or coins passed between their own wallets).",
  exit: "The suspected team's share is going down: they are selling to whoever is buying.", dump: "The suspected team sold 10% or more of the coin within 2 minutes." };
let ICH = null;   // chart on the Import & match page
const MARK_COLORS = { bundle: "#f4b23e", burst: "#f4b23e", grid: "#4f9dff", sell: "#f0525b", sweep: "#ff2d55" };

// ======================================================= live chart (also the read-only chart for imported launches)
class LiveChart {
  constructor(cv, wrap, p = "", name = "CH") {
    this.cv = cv; this.wrap = wrap; this.p = p; this.name = name; this.ctx = cv.getContext("2d"); this.tf = 1; this.log = true; this.bubbles = true; this.hidden = new Set();
    this.color = "tool"; this.read = null; this.title = "";
    this.clear(); this.view = { x0: 0, x1: 60 }; this.followMode = true; this.yr = null; this.hover = null; this.drag = null; this.events = []; this.flash = 0;
    new ResizeObserver(() => this.resize()).observe(wrap);
    cv.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    cv.addEventListener("mousedown", e => { this.drag = { x: e.clientX, x0: this.view.x0, x1: this.view.x1, moved: false }; wrap.classList.add("panning") });
    addEventListener("mouseup", e => { const d = this.drag; this.drag = null; wrap.classList.remove("panning"); if (d && !d.moved && e.target === cv) this.inspect(e) });
    cv.addEventListener("mousemove", e => this.onMove(e));
    cv.addEventListener("mouseleave", () => { this.hover = null; tip(null, null) });
    cv.addEventListener("dblclick", () => this.reset());
    this.renderTf(); this.loop();
  }
  el(id) { return $(this.p + id) }
  clear() { this.trades = []; this.cand = []; this.now = 0; this.dispC = null; this.yr = null; this.view = { x0: 0, x1: 60 }; this.followMode = true; this.read = null; if (this.el("golive")) this.el("golive").hidden = true; if (this.el("insp")) this.el("insp").hidden = true; this.renderRead() }
  renderTf() { this.el("tf").innerHTML = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"]].map(([v, n]) => `<button class="${this.tf === v ? "on" : ""}" onclick="${this.name}.setTf(${v})">${n}</button>`).join("") }
  setTf(v) { this.tf = v; this.cand = []; this.addToCandles(this.trades); this.renderTf(); this.dirty = true }
  toggleBubbles() { this.bubbles = !this.bubbles; this.el("b-bubbles").querySelector("span").textContent = this.bubbles ? "Hide bubbles" : "Show bubbles" }
  toggleLog() { this.log = !this.log; this.el("b-log").classList.toggle("on", this.log); this.yr = null }
  setColor(m) { this.color = m; this.renderLegend(); this.renderRead() }
  group(t) { const w = this.read && this.read.wallets[t[8]]; return w ? w[2] : "other" }
  add(arr) { this.trades.push(...arr); this.addToCandles(arr); this.flash = 1; this.renderLegend() }
  setRead(r) {   // regroup candle volume whenever the read changes (wallets can be flagged later)
    if (!r || (this.read && r.stamp != null && r.stamp === this.read.stamp)) return; this.read = r;
    for (const c of this.cand) c.g = { insider: [0, 0], bot: [0, 0], other: [0, 0] };
    const tf = this.tf, idx = new Map(this.cand.map(c => [c.b, c]));
    for (const t of this.trades) { const c = idx.get(Math.floor(t[0] / tf)); if (c) c.g[this.group(t)][t[2] ? 0 : 1] += t[3] }
    this.renderLegend(); this.renderRead();
  }
  addToCandles(arr) {
    const tf = this.tf, C = this.cand, G = () => ({ insider: [0, 0], bot: [0, 0], other: [0, 0] });
    for (const t of arr) {
      const b = Math.floor(t[0] / tf), m = t[1];
      let last = C[C.length - 1];
      if (last && b > last.b + 1) for (let k = last.b + 1; k < b && C.length < 20000; k++) C.push({ b: k, o: last.c, h: last.c, l: last.c, c: last.c, vb: 0, vs: 0, g: G() });
      last = C[C.length - 1];
      if (!last || last.b < b) { const o = last ? last.c : m; C.push({ b, o, h: Math.max(o, m), l: Math.min(o, m), c: m, vb: 0, vs: 0, g: G() }); last = C[C.length - 1] }
      else if (last.b > b) { last = C.find(x => x.b === b) || last }   // a late trade inside an already-carried flat candle
      last.h = Math.max(last.h, m); last.l = Math.min(last.l, m); last.c = m; if (t[2]) last.vb += t[3]; else last.vs += t[3];
      last.g[this.group(t)][t[2] ? 0 : 1] += t[3];
    }
  }
  renderLegend() {
    const lg = this.el("tool-legend"); if (!lg) return;
    if (this.color === "read") { lg.innerHTML = ["insider", "bot", "other"].map(g => `<span class="${this.hidden.has(g) ? "off" : ""}" onclick="${this.name}.toggleTool('${g}')"><i style="background:${READ_COLORS[g]}"></i>${READ_NAMES[g]}</span>`).join(""); return }
    const tools = [...new Set(this.trades.map(t => t[5]))];
    lg.innerHTML = tools.map(t => `<span class="${this.hidden.has(t) ? "off" : ""}" onclick="${this.name}.toggleTool('${t}')"><i style="background:${TOOL_COLORS[t] || "#777"}"></i>${esc(TOOL_NAMES[t] || t)}</span>`).join("");
  }
  toggleTool(t) { this.hidden.has(t) ? this.hidden.delete(t) : this.hidden.add(t); this.renderLegend() }
  // one line above the chart: what the read says right now (and, in the sim, how it compares to the truth)
  renderRead() {
    const box = this.el("readbar"); if (!box) return; const r = this.read;
    const seg = this.el("b-color"); if (seg) seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === this.color));
    if (!r) { box.innerHTML = `<span class="mute">The chart's read appears after the first trades.</span>`; return }
    const ph = r.phases[r.phases.length - 1], ans = r.answer;
    box.innerHTML = `<span data-tip="${esc(READ_HELP.insider)}"><i style="background:${READ_COLORS.insider}"></i>Suspected team: <b>${r.insiders}</b> wallet${r.insiders === 1 ? "" : "s"} holding <b>${f2(r.held_now, 1)}%</b> of the coin <span class="mute">(most: ${f2(r.held_peak, 1)}%)</span></span>`
      + `<span data-tip="${esc(READ_HELP.bot)}"><i style="background:${READ_COLORS.bot}"></i>Other bots: <b>${r.bots}</b></span><span class="mute">All traders: ${r.traders}</span>`
      + (ph ? `<span data-tip="${esc(PHASE_HELP[ph.kind])}">Right now: <b style="color:${PHASE_COLORS[ph.kind]}">${PHASE_NAMES[ph.kind]}</b></span>` : "")
      + (ans && ans.source === "labels" ? `<span class="key" data-tip="${esc("The research knows which wallets were the network (from money links on chain). This compares that with what the chart could guess from trades alone.")}">Check vs research: the chart found <b>${ans.caught} of ${ans.operator_traders}</b> network wallets from trades alone · ${ans.false_flags} other wallet${ans.false_flags === 1 ? "" : "s"} wrongly flagged · the network really held <b>${f2(r.truth_now || 0, 1)}%</b></span>` : "")
      + (ans && ans.source !== "labels" ? `<span class="key" data-tip="${esc("Only the simulator knows which wallets are really yours. This checks the chart's guess against that real answer.")}">Real answer (sandbox only): the chart found <b>${ans.caught} of your ${ans.operator_traders}</b> wallets · ${ans.false_flags} other wallet${ans.false_flags === 1 ? "" : "s"} wrongly flagged${ans.missed_as_bot ? ` · ${ans.missed_as_bot} of yours filed as "other bots"` : ""} · you really hold <b>${f2(r.truth_now, 1)}%</b></span>` : "")
      + (!r.marks.some(m => m.kind === "bundle") ? `<span class="mute">This data starts after the launch moment, so the team can't be spotted from it.</span>`
        : !r.linked ? `<span class="mute" data-tip="${esc("Add a SOL transfers CSV to link wallets by who paid them.")}">No money links loaded: the suspected team is only the wallets that bought at launch</span>` : "");
  }
  setNow(t, events) {
    this.now = t; this.events = events || [];
    const C = this.cand, last = C[C.length - 1], b = Math.floor(t / this.tf);   // no trades: carry the last price forward as flat candles, as charts do
    if (last && b > last.b) for (let k = last.b + 1; k <= b && C.length < 20000; k++) C.push({ b: k, o: last.c, h: last.c, l: last.c, c: last.c, vb: 0, vs: 0, g: { insider: [0, 0], bot: [0, 0], other: [0, 0] } });
    const q = this.el("quiet"), lt = this.trades.length ? this.trades[this.trades.length - 1][0] : null;
    if (q) { const idle = lt == null ? 0 : t - lt; q.hidden = !(idle >= 15 && this.p === ""); if (!q.hidden) q.innerHTML = `${ICON("clock")}No trades for ${Math.round(idle)}s${LST && LST.organic && !LST.organic.on ? ` · organic market is off <button class="link" onclick="setOrganic('mid')">Turn on Mid</button>` : ""}` }
  }
  follow() { this.followMode = true; this.el("golive").hidden = true }
  reset() { this.view = { x0: 0, x1: Math.max(60, this.now * 1.04) }; this.followMode = true; this.el("golive").hidden = true; this.yr = null }
  resize() { const r = this.wrap.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return; this.W = r.width; this.H = r.height; this.cv.width = r.width * d; this.cv.height = r.height * d; this.ctx.setTransform(d, 0, 0, d, 0, 0) }
  geom() {
    const L = 8, R = 70, T = 30, B = 24, W = this.W, H = this.H, rd = !!this.read, band = rd ? 16 : 0;
    const sh = rd ? Math.round((H - T - B) * 0.17) : 0, vh = Math.round((H - T - B) * (rd ? 0.13 : 0.16));
    const sb = H - B, st = sb - sh, vb = rd ? st - 8 : sb, vt = vb - vh;
    return { L, R, T, B, W, H, band, pt: T + band, pb: vt - 6, vt, vb, st, sb, rd };
  }
  onWheel(e) {
    e.preventDefault(); const g = this.geom(), r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left;
    const tAt = this.view.x0 + (mx - g.L) / (g.W - g.L - g.R) * (this.view.x1 - this.view.x0), k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    let x0 = tAt - (tAt - this.view.x0) * k, x1 = tAt + (this.view.x1 - tAt) * k;
    if (x1 - x0 < this.tf * 12) return; if (x1 - x0 > Math.max(120, this.now * 3)) return;
    this.view = { x0, x1 }; if (x1 < this.now) { this.followMode = false; this.el("golive").hidden = false }
  }
  onMove(e) {
    const r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (this.drag) { if (Math.abs(e.clientX - this.drag.x) > 3) this.drag.moved = true; if (!this.drag.moved) return; const g = this.geom(), span = this.drag.x1 - this.drag.x0, dt = (e.clientX - this.drag.x) / (g.W - g.L - g.R) * span; this.view = { x0: this.drag.x0 - dt, x1: this.drag.x1 - dt }; this.followMode = false; this.el("golive").hidden = false; return }
    this.hover = { x: mx, y: my, cx: e.clientX, cy: e.clientY };
  }
  // click a candle: who traded inside it
  inspect(e) {
    const box = this.el("insp"); if (!box) return;
    const g = this.geom(), r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left; if (mx < g.L || mx > g.W - g.R) return;
    const tAt = this.view.x0 + (mx - g.L) / (g.W - g.L - g.R) * (this.view.x1 - this.view.x0), b = Math.floor(tAt / this.tf), c = this.cand.find(x => x.b === b);
    if (!c) { box.hidden = true; return }
    const ts = this.trades.filter(t => Math.floor(t[0] / this.tf) === b), by = {};
    const byTool = this.color === "tool", gk = t => byTool ? t[5] : this.group(t);   // labels mode groups by who it was, read mode by the detector's groups
    const ev = this.p === "i-" && RP && RP.imp.wallets;   // research case: wallet rows open the evidence
    for (const t of ts) { const k = gk(t); const o = by[k] || (by[k] = { b: 0, s: 0, n: 0, w: new Map() }); o[t[2] ? "b" : "s"] += t[3]; o.n++; const key = t[8] || t[6]; o.w.set(key, (o.w.get(key) || 0) + (t[2] ? t[3] : -t[3])) }
    const nm = id => { const t = ts.find(x => (x[8] || x[6]) === id); return t ? t[6] : String(id).slice(0, 6) };
    const why = id => { const w = this.read && this.read.wallets[id]; return w ? w[1].map(f => this.read.info[f] || f).join("; ") : "" };
    box.innerHTML = `<div class="insp-h"><b>${mmss(c.b * this.tf)}–${mmss((c.b + 1) * this.tf)}</b><span class="mute">${ts.length} trades · MC ${mcFmt(c.o)} → ${mcFmt(c.c)}</span><button class="btn sm ghost" onclick="this.closest('.insp').hidden=true" aria-label="Close">✕</button></div>`
      + ((byTool ? Object.keys(by) : ["insider", "bot", "other"]).filter(k => by[k]).map(k => { const o = by[k], top = [...o.w].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 4);
        return `<div class="insp-g"><div><i style="background:${byTool ? TOOL_COLORS[k] || "#777" : READ_COLORS[k]}"></i><b>${esc(byTool ? TOOL_NAMES[k] || k : READ_NAMES[k])}</b><span class="up">+${solFmt(o.b)}</span><span class="down">−${solFmt(o.s)}</span><span class="mute">${o.n} trades</span></div>`
          + top.map(([id, v]) => `<div class="insp-w${ev && ev[id] ? " link" : ""}" title="${esc(why(id))}"${ev && ev[id] ? ` onclick="openCaseWallet('${esc(id)}')"` : ""}><span>${esc(nm(id))}</span><span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}${solFmt(Math.abs(v))} SOL</span>${ev && ev[id] ? `<span class="mute">${esc(LEVEL_NAMES[ev[id][1]] || "")} ›</span>` : k !== "other" && !byTool ? `<span class="mute">${esc(why(id).split(";")[0])}</span>` : ""}</div>`).join("") + `</div>` }).join("") || `<p class="mute">No trades in this candle.</p>`);
    box.hidden = false;
  }
  loop() { const f = () => { if (!this.cv.isConnected) return; try { this.frame() } catch (e) { } requestAnimationFrame(f) }; requestAnimationFrame(f) }   // stops once its canvas is gone
  frame() {
    if (!this.W || this.wrap.offsetParent === null) return;
    const g = this.geom(), ctx = this.ctx, C = this.cand, tf = this.tf, RD = this.read, byRead = this.color === "read" && RD;
    if (this.followMode) { const span = Math.max(30 * tf, this.view.x1 - this.view.x0), x1 = this.now + span * 0.08 + tf; this.view.x0 += (x1 - span - this.view.x0) * 0.18; this.view.x1 += (x1 - this.view.x1) * 0.18 }
    const { x0, x1 } = this.view, PW = g.W - g.L - g.R, X = t => g.L + (t - x0) / (x1 - x0) * PW;
    const vis = C.filter(c => (c.b + 1) * tf >= x0 && c.b * tf <= x1);
    let lo = Infinity, hi = 0; for (const c of vis) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h) }
    if (!isFinite(lo)) { lo = 20; hi = 200 }
    if (this.log) { lo *= 0.88; hi *= 1.12 } else { const p = (hi - lo) * 0.08 || hi * 0.1; lo = Math.max(0, lo - p); hi += p }
    if (!this.yr) this.yr = [lo, hi]; else { this.yr[0] += (lo - this.yr[0]) * 0.15; this.yr[1] += (hi - this.yr[1]) * 0.15 }
    const [ylo, yhi] = this.yr, Y = this.log ? v => g.pb - (Math.log(Math.max(v, 1e-6)) - Math.log(ylo)) / (Math.log(yhi) - Math.log(ylo)) * (g.pb - g.pt) : v => g.pb - (v - ylo) / (yhi - ylo) * (g.pb - g.pt);
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace"; ctx.lineWidth = 1;
    let hit = null;
    // phases: a band across the top, and a faint wash over the price pane
    if (RD) for (const p of RD.phases) {
      const a = Math.max(g.L, X(p.t0)), b = Math.min(g.W - g.R, X(p.t1)); if (b <= a) continue;
      ctx.fillStyle = PHASE_COLORS[p.kind]; ctx.globalAlpha = .06; ctx.fillRect(a, g.pt, b - a, g.pb - g.pt); ctx.globalAlpha = .75; ctx.fillRect(a, g.T, b - a, g.band - 3); ctx.globalAlpha = 1;
      const lab = PHASE_NAMES[p.kind] + (p.drop ? ` −${p.drop.toFixed(1)}%` : "");
      ctx.font = "600 10px 'Figtree', system-ui, sans-serif"; if (ctx.measureText(lab).width + 8 < b - a) { ctx.fillStyle = "#0c0f14"; ctx.fillText(lab, a + 4, g.T + 10) }
      ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      if (this.hover && this.hover.y >= g.T && this.hover.y < g.T + g.band && this.hover.x >= a && this.hover.x <= b) hit = ["phase", p];
    }
    // grid + price axis
    ctx.strokeStyle = TH.grid; ctx.fillStyle = TH.dim;
    for (const v of ticks(ylo, yhi, this.log)) { const y = Math.round(Y(v)) + .5; if (y < g.pt || y > g.pb) continue; ctx.beginPath(); ctx.moveTo(g.L, y); ctx.lineTo(g.W - g.R, y); ctx.stroke(); ctx.fillText(mcFmt(v), g.W - g.R + 8, y + 4) }
    // time axis
    const span = x1 - x0, steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600], step = steps.find(s => PW / (span / s) >= 80) || 3600;
    for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) { const x = Math.round(X(t)) + .5; ctx.strokeStyle = TH.grid2; ctx.beginPath(); ctx.moveTo(x, g.pt); ctx.lineTo(x, g.sb); ctx.stroke(); if (t >= 0) { ctx.fillStyle = TH.dim; ctx.fillText(mmss(t), x - 14, g.H - 7) } }
    // volume: buy/sell, or stacked by who traded
    const bw = Math.max(1, PW / (span / tf) * 0.72), vmax = Math.max(1e-6, ...vis.map(c => c.vb + c.vs)), vH = g.vb - g.vt;
    for (const c of vis) {
      const x = X(c.b * tf + tf / 2);
      if (byRead) { let y = g.vb; for (const k of ["insider", "bot", "other"]) for (const s of [0, 1]) { const h = c.g[k][s] / vmax * vH; if (!h) continue; ctx.fillStyle = READ_COLORS[k]; ctx.globalAlpha = s ? .4 : .85; ctx.fillRect(x - bw / 2, y - h, bw, h); y -= h } ctx.globalAlpha = 1 }
      else { const hb = c.vb / vmax * vH, hs = c.vs / vmax * vH; ctx.fillStyle = "rgba(34,194,125,.45)"; ctx.fillRect(x - bw / 2, g.vb - hb, bw, hb); ctx.fillStyle = "rgba(240,82,91,.45)"; ctx.fillRect(x - bw / 2, g.vb - hb - hs, bw, hs) }
    }
    // supply pane: what the flagged wallets hold (and, in the sim, what the operator really holds)
    if (RD && g.rd) {
      const S = RD.series, top = Math.max(5, ...S.map(b => Math.max(b.held, b.bheld, b.truth || 0))) * 1.12, SY = v => g.sb - v / top * (g.sb - g.st);
      ctx.strokeStyle = TH.line2; ctx.beginPath(); ctx.moveTo(g.L, g.st - 4.5); ctx.lineTo(g.W - g.R, g.st - 4.5); ctx.stroke();
      ctx.fillStyle = TH.dim; ctx.fillText(Math.round(top / 1.12) + "%", g.W - g.R + 8, SY(top / 1.12) + 4); ctx.fillText("0%", g.W - g.R + 8, g.sb);
      ctx.font = "600 10px 'Figtree', system-ui, sans-serif"; ctx.fillText("TEAM'S SHARE OF THE COIN", g.L + 4, g.st + 8); ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
      const line = (key, col, w, dash) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); let on = true; ctx.moveTo(X(S[0].t), SY(0));
        for (const b of S) { const v = b[key]; if (v == null) continue; const x = X(b.t + RD.step); if (x < g.L - 20 || x > g.W - g.R + 20) continue; on ? ctx.lineTo(x, SY(v)) : ctx.moveTo(x, SY(v)); on = true }
        ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1 };
      ctx.save(); ctx.beginPath(); ctx.rect(g.L, g.st - 2, PW, g.sb - g.st + 2); ctx.clip();
      line("bheld", READ_COLORS.bot, 1.2); line("held", READ_COLORS.insider, 2); if (S[0].truth != null) line("truth", TH.truth, 1.2, [4, 3]);
      ctx.restore();
      if (this.hover && this.hover.y >= g.st && this.hover.y <= g.sb) { const tAt = x0 + (this.hover.x - g.L) / PW * span, b = S.find(b => tAt >= b.t && tAt < b.t + RD.step); if (b) hit = ["supply", b] }
    }
    // candles (last one eases toward its live close)
    const last = C[C.length - 1];
    if (last) { if (this.dispC === null) this.dispC = last.c; this.dispC += (last.c - this.dispC) * 0.25 }
    for (const c of vis) {
      const cl = c === last ? this.dispC : c.c, up = cl >= c.o, x = X(c.b * tf + tf / 2), col = up ? "#22c27d" : "#f0525b";
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, Y(Math.max(c.h, cl))); ctx.lineTo(Math.round(x) + .5, Y(Math.min(c.l, cl))); ctx.stroke();
      const ya = Y(Math.max(c.o, cl)), yb = Y(Math.min(c.o, cl)); ctx.fillRect(x - bw / 2, ya, bw, Math.max(1, yb - ya));
    }
    // trade bubbles; trades closer than ~7 px with the same colour and side merge into one bubble with a count
    if (this.bubbles) {
      const agg = new Map(); let n = 0;
      for (let i = this.trades.length - 1; i >= 0 && n < 6000; i--) {
        const t = this.trades[i]; if (t[0] < x0) break; if (t[0] > x1) continue;
        const key0 = byRead ? this.group(t) : t[5]; if (this.hidden.has(key0)) continue; n++;
        const x = X(t[0]), y = Y(t[1]), k = key0 + (t[2] ? "b" : "s") + Math.round(x / 7) + ":" + Math.round(y / 7);
        let a = agg.get(k); if (!a) agg.set(k, a = { x: 0, y: 0, sol: 0, n: 0, t, col: byRead ? READ_COLORS[key0] : TOOL_COLORS[t[5]] || "#888", buy: t[2], own: false, list: [] });
        a.x += x; a.y += y; a.sol += t[3]; a.n++; a.own = a.own || !!t[7]; if (a.list.length < 6) a.list.push(t);
      }
      for (const a of agg.values()) {
        const x = a.x / a.n, y = a.y / a.n, r = Math.min(16, 2 + Math.sqrt(a.sol) * 3.2);
        ctx.globalAlpha = a.own ? .9 : .6; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
        if (a.buy) { ctx.fillStyle = a.col; ctx.fill() } else { ctx.strokeStyle = a.col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1 }
        if (a.own && !byRead) { ctx.globalAlpha = 1; ctx.strokeStyle = "#b69cff"; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.283); ctx.stroke() }
        ctx.globalAlpha = 1;
        if (a.n > 1 && r >= 7) { ctx.fillStyle = a.buy ? "#0c0f14" : a.col; ctx.font = "600 9px 'JetBrains Mono', monospace"; const s = String(a.n); ctx.fillText(s, x - ctx.measureText(s).width / 2, y + 3); ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace" }
        if (this.hover && !hit && (this.hover.x - x) ** 2 + (this.hover.y - y) ** 2 < (r + 3) ** 2) hit = ["bubble", a];
      }
    }
    // signal marks: flags hanging under the phase band
    if (RD) for (const m of RD.marks) {
      if (m.t < x0 || m.t > x1) continue; const x = X(m.t), col = MARK_COLORS[m.kind] || "#f4b23e", y = g.pt + 2;
      if (m.t1 && m.t1 > m.t) { ctx.strokeStyle = col; ctx.globalAlpha = .7; ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(X(m.t1), y + 4); ctx.stroke(); ctx.globalAlpha = 1 }
      ctx.strokeStyle = col; ctx.globalAlpha = .35; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x + .5, y); ctx.lineTo(x + .5, g.pb); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x, y + 8); ctx.lineTo(x - 5, y + 4); ctx.fill();
      if (this.hover && !hit && Math.abs(this.hover.x - x) < 7 && this.hover.y >= y - 2 && this.hover.y <= y + 12) hit = ["mark", m];
    }
    // tool-event flags on the time axis (sim)
    for (const [t, msg] of this.events) { if (t < x0 || t > x1) continue; const x = X(t); ctx.fillStyle = "#f4b23e"; ctx.beginPath(); ctx.moveTo(x, g.sb + 2); ctx.lineTo(x - 4, g.sb + 9); ctx.lineTo(x + 4, g.sb + 9); ctx.fill();
      if (this.hover && !hit && Math.abs(this.hover.x - x) < 6 && this.hover.y > g.sb - 4) hit = ["event", msg, t] }
    // last price line + label
    if (last) {
      const y = Math.round(Y(this.dispC)) + .5, up = this.dispC >= last.o; ctx.setLineDash([3, 4]); ctx.strokeStyle = up ? "rgba(34,194,125,.8)" : "rgba(240,82,91,.8)"; ctx.beginPath(); ctx.moveTo(g.L, y); ctx.lineTo(g.W - g.R, y); ctx.stroke(); ctx.setLineDash([]);
      this.flash *= 0.94; ctx.fillStyle = up ? "#22c27d" : "#f0525b"; ctx.globalAlpha = 0.85 + this.flash * 0.15; roundRect(ctx, g.W - g.R + 3, y - 10, g.R - 6, 20, 4); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = "#06120c"; ctx.font = "600 11px 'JetBrains Mono', ui-monospace, monospace"; ctx.fillText(mcFmt(this.dispC), g.W - g.R + 8, y + 4);
      if (this.followMode) { const x = X(last.b * tf + tf / 2); ctx.fillStyle = "rgba(244,178,62," + (0.35 + 0.35 * Math.sin(performance.now() / 300)) + ")"; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.283); ctx.fill() }
    }
    // crosshair + tooltips + OHLC line
    let hc = last;
    if (this.hover && !this.drag && this.hover.x > g.L && this.hover.x < g.W - g.R) {
      const hx = this.hover.x, hy = this.hover.y, tAt = x0 + (hx - g.L) / PW * span; hc = C.find(c => tAt >= c.b * tf && tAt < (c.b + 1) * tf) || hc;
      ctx.strokeStyle = TH.cross; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hx + .5, g.T); ctx.lineTo(hx + .5, g.sb); ctx.moveTo(g.L, hy + .5); ctx.lineTo(g.W - g.R, hy + .5); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = "11px 'JetBrains Mono', monospace";
      if (hy < g.pb && hy > g.pt) { const v = this.log ? Math.exp(Math.log(ylo) + (g.pb - hy) / (g.pb - g.pt) * (Math.log(yhi) - Math.log(ylo))) : ylo + (g.pb - hy) / (g.pb - g.pt) * (yhi - ylo); ctx.fillStyle = TH.line2; roundRect(ctx, g.W - g.R + 3, hy - 9, g.R - 6, 18, 4); ctx.fill(); ctx.fillStyle = TH.text; ctx.fillText(mcFmt(v), g.W - g.R + 8, hy + 4) }
      ctx.fillStyle = TH.line2; roundRect(ctx, hx - 24, g.sb + 3, 48, 16, 4); ctx.fill(); ctx.fillStyle = TH.text; ctx.fillText(mmss(Math.max(0, tAt)), hx - 16, g.sb + 15);
      const at = { clientX: this.hover.cx, clientY: this.hover.cy };
      if (!hit) tip(null, null);
      else if (hit[0] === "event") tip(at, `<b>${mmss(hit[2])}</b><br>${esc(hit[1])}`);
      else if (hit[0] === "mark") tip(at, `<b style="color:${MARK_COLORS[hit[1].kind] || "#f4b23e"}">${esc(hit[1].label)}</b> <span class="mute">${mmss(hit[1].t)}</span><br>${esc(hit[1].text)}`);
      else if (hit[0] === "phase") { const p = hit[1]; tip(at, `<b style="color:${PHASE_COLORS[p.kind]}">${PHASE_NAMES[p.kind]}</b> <span class="mute">${mmss(p.t0)}–${mmss(p.t1)}</span>${p.drop ? `<br>Insider-held supply fell ${p.drop.toFixed(1)} points` : ""}<br><span class="mute">${esc(PHASE_HELP[p.kind])}</span>`) }
      else if (hit[0] === "supply") { const b = hit[1]; tip(at, `<b>${mmss(b.t)}</b><br><span style="color:${READ_COLORS.insider}">Insiders hold ${b.held.toFixed(1)}%</span><br><span style="color:${READ_COLORS.bot}">Other coordinated ${b.bheld.toFixed(1)}%</span>${b.truth != null ? `<br>Operator truly holds ${b.truth.toFixed(1)}% <span class="mute">(answer key)</span>` : ""}`) }
      else if (hit[0] === "bubble") { const a = hit[1], t = a.t, gr = this.group(t), why = this.read && this.read.wallets[t[8]];
        tip(at, a.n > 1
          ? `<b>${a.n} ${a.buy ? "buys" : "sells"}</b> · ${solFmt(a.sol)} SOL<br>${a.list.map(x => `${esc(x[6])} ${solFmt(x[3])}`).join("<br>")}${a.n > a.list.length ? `<br><span class="mute">+${a.n - a.list.length} more · click to inspect the candle</span>` : ""}`
          : `<b style="color:${TOOL_COLORS[t[5]] || "#999"}">${esc(TOOL_NAMES[t[5]] || t[5])}</b>${t[7] ? ' <span class="pill own">yours</span>' : ""}<br>${esc(t[6])} ${t[2] ? '<span class="up">bought</span>' : '<span class="down">sold</span>'} ${solFmt(t[3])} SOL<br><span class="mute">MC ${mcFmt(t[1])} · ${mmss(t[0])}</span>${RD ? `<br><span style="color:${READ_COLORS[gr]}">${READ_NAMES[gr]}</span>${why ? `<span class="mute">: ${esc(why[1].map(f => RD.info[f] || f).join("; "))}</span>` : ""}` : ""}`) }
    }
    if (hc) { const cl = hc === last ? this.dispC : hc.c, up = cl >= hc.o, d = (cl / hc.o - 1) * 100;
      this.el("ohlc").innerHTML = `<span><b>${esc(this.title || (WCFG ? WCFG.name : ""))}</b> · ${this.tf < 60 ? this.tf + "s" : "1m"} · MC in ${mcUnit()}</span><span>O <b>${mcFmt(hc.o)}</b></span><span>H <b>${mcFmt(hc.h)}</b></span><span>L <b>${mcFmt(hc.l)}</b></span><span>C <b class="${up ? "up" : "down"}">${mcFmt(cl)}</b></span><span class="${up ? "up" : "down"}">${d >= 0 ? "+" : ""}${d.toFixed(2)}%</span><span>Vol <b>${solFmt(hc.vb + hc.vs)} SOL</b></span>` }
  }
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }

// ======================================================= boot
addEventListener("resize", () => { clearTimeout(window._rz); window._rz = setTimeout(() => { if (ROUTE === "results") { drawResult(); drawGraph() } if (CMP && ROUTE === "compare") drawCompare(); if (MATCH && ROUTE === "import") drawMatch(); if (ROUTE === "live" && BTAB === "map") drawGraph() }, 150) });
document.addEventListener("click", e => { const b = e.target.closest("#tape-tabs button"); if (b) { TAPE = b.dataset.k; segPick(b); rebuildTape() } });
(async () => {
  setTheme(document.documentElement.dataset.theme || null);
  if (lsGet("lc-side-mini", false)) document.querySelector(".app").classList.add("mini");
  document.querySelectorAll(".sm-sol").forEach(e => e.innerHTML = MARKS.Solana);
  funderBar();
  window.redrawCharts = () => { if (ROUTE === "results" && RUN) { drawResult(); drawGraph() } if (CMP && ROUTE === "compare") drawCompare(); if (MATCH && ROUTE === "import") drawMatch(); if (ROUTE === "live" && BTAB === "map") drawGraph() };
  const s = await eng("init"); SLOT = s.slot_s || 0.2; SCHEMA = s.schema; DEFAULTS = s.defaults; BUILTIN = s.builtins; SAVED = ls.get("lab-configs", {}); IMPORTS = ls.get("lab-imports", {}); libMode();
  await loadLib(); await loadCfg("SHARDS reconstruction"); draftsBoot();
  let r = "dashboard"; try { r = localStorage.getItem("lc-route") || "dashboard" } catch (e) { }
  if (r === "results") r = "config";
  show(r); connectDb(); $("st-engine").textContent = "Sim engine ready"; window.solPriceChanged();   // price may have loaded before the app was ready
  const h = location.hash.slice(1);
  if (h === "demo") { await quickStart(); lSpeed(0); await lStep(300); renderBottom(true); renderRail() }
  else if (h === "demo-tools") { await quickStart(); lSpeed(0); await lStep(120); document.querySelectorAll(".acc").forEach(d => d.open = true); setSide("sell"); renderRail() }
  else if (h && TITLES[h]) show(h);
})();
