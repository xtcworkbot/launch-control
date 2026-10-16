# Launch Control (Proxima Config Lab)

An offline simulator that recreates Proxima launch configurations and shows the fingerprint each one leaves (chart, wallet links, holders, detector signals), so real launches can be matched back to the configuration that produced them. Pure simulation: no wallets, keys, RPC or chain. All SOL in it is fake.

## Quick start

**Use it:** run it on your own computer (below, about a minute). Saved configurations, drafts, runs and notes stay in your own browser.

**Run it locally** (needs Node 18+, nothing else):
```
git clone https://github.com/xtcworkbot/launch-control.git
cd launch-control
node web/build.js                    # builds dist/
node ui-tests/serve.js dist 8772     # then open http://127.0.0.1:8772
```

**Test after changing anything:**
```
node web/test_engine.js              # engine, detector, import
node web/test_live.js                # live workspace actions
node ui-tests/fit-popups.js           # every pop-up fits the window on 6 desktop sizes, buttons clickable (120 checks)
node web/test_features.js            # every feature leaves its own trades + timeline note on the chart; outside-market realism (41 checks)
cd ui-tests && npm install           # once; uses your installed Google Chrome (or set CHROME=/path/to/chrome)
npm run e2e                          # 105 click-through checks (needs the server above running)
node ui-tests/ui-fixes.js             # 35 checks that the click-through audit's findings (and fresh launches) stay fixed
node ui-tests/notes.js                # 30 checks of the Notes panel (save, tags, reload, tabs, archive, export/import, fit)
npm run shots                        # screenshots + overlap/overflow/console checks at 1440 and 390 px
```

**Ship a change:** Vercel is connected to this repo: every push to `main` deploys the website, and other branches get a preview build. Vercel only builds commits from the owner's account (cbotmini); commits from other accounts show "Deployment was blocked" and the website stays as it was.

## How it's laid out
Same layout, sizing and click paths as Proxima's app (sizes and theme values measured off the app on 2026-10-15: 310px sidebar, 70px top bar, 36px status bar, Launch Settings side panel 564px, workspace rail 349px), with its own name and logo. Light/dark toggle in the status bar (blue accent on light, lime on dark):
- **Sidebar:** search (Cmd/Ctrl+K), live launch, My Wallets, Workspace, Activity, then the Lab (Configurations, Run results, Compare, Import & match), the Funder (simulated SOL), Import and Create Launch.
- **Create Launch:** Chain & Launchpad -> Token Details -> Launch Settings (mode tabs, dev/holders %, Block-0 presets, Back MEV slider, wallet roles, CEX funding, Advanced) -> pre-launch page (Auto Sell, Sniper Guard, 1. Distribute, 2. Launch).
- **Workspace:** live chart (trade bubbles by tool, zoom/pan, timeframes), trades tape (All/Dev/My wallets), bottom tabs (My Wallets, Latest Trades, Holders, History, Bubble Maps, What the chain shows), right rail (Buy/Sell, Volume Bot, AutoBuy, AutoSell, Cleanup, Sniper Guard, P&L, Nuke), Withdraw (via a hop wallet, optional leave-dust).
- **Import & match:** trades CSV, optional holders CSV and optional SOL transfers CSV -> fingerprint, detector signals and the closest configurations. Column formats are listed on the page.

Code: `web/engine.js` (simulation + detector, runs in a Web Worker), `web/app.js` + `web/app.css` + `web/index.html` (app), `web/lab.js` (Lab pages), `ui-tests/` (Puppeteer checks). `node web/build.js` inlines everything into `dist/`.

## Status (2026-10-15)
- Network numbers are Solana's as of Oct 2026: 200 ms slots (SIMD-0525; the engine's SLOT_S), rent at 5,080 lamports/byte (a pump.fun Token-2022 coin account 0.00151384 SOL, plus 0.0013462 SOL for pump.fun's volume account on a wallet's first buy), base fee unchanged. Since 7 Oct a pump.fun buy that completes the curve carries its leftover SOL into the new pool ("synthetic migration").
- Outside market levels follow real pump.fun data (sample of 38 launches on 15 Oct 2026, plus published studies): Snipers None / Typical (default: ~4 in the first 5 s, about 1 launch in 5 none, a heavy tail) / Busy / Hot (SHARDS-like) / Custom; Organic Dead / Very low (median launch: ~25 trades, nearly all in minute one) / Mid / Bullish (fills the curve in ~5-10 min and ~600-800 trades, then fades after migration). Snipers hold for a log-spread time, a third sell in two parts, contested launches have failed attempts that still pay fees, and bots' sells that hit the curve-to-pool moment retry. Copy bots buy a fixed ~0.25 SOL by default.
- Notes (status bar, or press N): a notepad that floats over every page, saved in the browser as you type. Each note is tagged with the page, launch and sim time; it shows again on the run's Archived page, every open tab stays in sync, and Export / Import moves notes between people.
- A new launch starts clean: no Volume Bot, Auto Buy/Sell, Sniper Guard, Cleanup or scripted dump unless you plan it, and a Volume Bot planned on the Funding page starts at launch. "Start from a configuration" copies launch settings only; Lab → Configurations → "Open in Create launch" is the one path that brings a configuration's automations along (for recreating a case like SHARDS).
- The generic built-in presets launch on pump.fun with Typical snipers; only the two SHARDS presets use Meteora DBC and SHARDS' crowd. New launches start clean (Block-0 Quick, no automations).
- "SHARDS (fitted to the real chart)" reproduces the real chart in the Workspace: the crash lands at 6:48-6:50 in every seed (real 6:50), peaks 0.8-1.2k SOL (real 1.17k), mean |log MC ratio| ~0.49 over 18 checkpoints and 5 seeds.
- Market caps show in USD at the live SOL price (Coinbase, CoinGecko as backup, refreshed every 5 min). Click the SOL price in the status bar to pin your own, e.g. the price on a real launch's day. Trade sizes, funding and volume stay in SOL.
- Organic traders are off by default (most launches never get organic flow). Turn them on in Simulation settings (flask icon on the Funding page), live from the Workspace rail, or in Configurations.
- The detector's withdrawal-sweep signal is validated on real data (SHARDS: 87 operator wallets swept through a hop that forwarded 30 s later).
- Meteora DBC is modelled (fitted to SHARDS' own pool balances), and the Guide page (status bar) explains every tool, the chart read and the outside market in plain words.

## Website (Vercel)
The live site is the browser build in `web/` (engine ported to JavaScript, runs in a Web Worker; no backend). Vercel runs `node web/build.js` and serves `dist/` (see vercel.json). On the website, saved configurations and imports stay in each visitor's browser.
To work on it: edit `web/index.html` (page) or `web/engine.js` (simulation), run `node web/test_engine.js` and `node web/test_live.js`, preview with `node web/build.js` and open `dist/index.html` through any static server, then push to `main` (Vercel deploys it). Keep `web/engine.js` and the Python files in step when changing the model.

Run the Python version locally: `python3 server.py` -> http://127.0.0.1:8770 (localhost only, stdlib Python, no installs). Tests: `python3 test_lab.py` (16 checks, all pass).
Deep links: `#run=<config>`, `#compare=<a>|<b>`, `#match=<import>`.

## What's in it
- Market (chain.py): pump.fun's published curve (30 vSOL / 1.073B vTok, 793.1M real tokens). The curve completes when real tokens hit 0, freezes, then migrates to PumpSwap with a 0.015 SOL fee. Dynamic fees: 1.25% on the curve and PumpSwap's market-cap tiers (Research/proxima/pumpfun-params.md).
- Settings (config.py): every item in the brief, named as in Proxima's docs. Covers wallet prep (count, Funder / Classic proxies / CEX list, Funding Delay, Generate Activity), launch modes, Dev Buy, Scheduled/Snipe, Block-0 presets + Custom layers + delays + Back MEV slider, Sniper Guard, Volume Bot, AutoBuy/AutoSell (Counter, DCA, Limits, MC range, end conditions, start delay), Cleanup (Buyback/Streamflow, delay 0.5-300 s, Double Buy), and adjustable snipers, organic traders and copy-traders.
- Operator (operator_tools.py): every trade carries the tool that produced it.
- Outputs (analysis.py): labelled candlesticks with tool-stacked volume; holder distribution and top-10 share over time; funding bubble map (detector clusters vs sandbox truth); and a ledger-only detection report. The report covers same-block buys, common/CEX funding, buy-timing grid, equal-size pairs, counter-trade replication ratio, Cleanup supply moves and Jito tips.
- Library (lab.py): 8 built-in configurations; save, name, clone, delete; compare 2-4 side by side (charts, signal levels, fingerprint, differing settings).
- Import & Match: trades CSV (+ optional holders CSV) -> fingerprint -> ranked closest configurations (library + random search + local refinement, 2 seeds each), with the real chart overlaid on the best match.

## Proxima presets (measured, not assumed)
- Block-0 preset numbers were read off Proxima's Launch Settings (Solana/PumpFun, v0.9) on 2026-10-15 by switching each preset to Custom at 10-200 holders and moving the Back MEV Tuning slider (a 0.4x-1.6x multiplier). Front/Back = ceil(measured base x multiplier); Temp (Full Build) = ceil(2/3 x holders); Front->Back and Back->Temp 0.7 s per wallet; Buy Delay 0.7 s (Quick) / 16 s (Clean, Full). Organic takes the holder buy in SOL (Buy Delay default 0.7 s). `node web/test_engine.js` pins all 17 readings and the tool's Cleanup Time estimates. Re-measure if Proxima changes.
- The Launch Settings side panel (Bubble Maps label, Supply Cost %, Cleanup Time, Est. Market Cap and Expected Supply ranges, Funding Estimation, Maximum Loss) uses formulas fitted to the app's own readings: extra funding = 0.37 + 10% of supply cost + 0.4 per Front/Back wallet + 0.2 per temp + 0.13 per holder (exact on all 8 readings); maximum loss within ~0.03 SOL. New plans fund wallets with those same buffers (`funding_extra_mode: tool`).
- The SHARDS reconstruction is a Custom build (4 Front MEV, no Back layer, 2.5 s), as seen on-chain; it is not one of the stock presets.
- Not modelled yet: Alternative Routing, Slippage, Quick mode on other launchpads, StonkFun's Front-only Block-0.

## Money, fees and the market (sandbox)
- The Funder starts with 1,000 fake SOL (Deposit adds more, Withdraw takes it out). Distribute spends it, and the engine runs the funding history at that moment, so the Funding page shows the real balance and fees.
- Every operator transaction pays the 5,000-lamport base fee and a priority fee (log-normal around a median you set, x3 in the first 30 s); new coin accounts pay rent at Oct 2026 rates (above); pump.fun's 1.25% curve fee and PumpSwap's tiered fees apply; Jito tips and CEX cuts are recorded; the tool's documented platform fee (5% of SOL from its sells; buybacks exempt) is charged. Fees & costs (rail, status bar) lists each kind with min / avg / max and the top payers. Fee draws use their own random stream, so seeded runs stay comparable.
- P&L shows deposited, SOL now, real exit value (selling every token now, one after another, into the curve or PumpSwap pool, after fees) next to paper value, and "if you exit now".
- Organic market: Dead / Very low / Mid / Bullish, switchable live. Arrivals follow an attention curve with momentum, self-exciting herding (below 1 follow-on buy per buy), slow noise, attention shocks and whales; holders flip, panic or take profit in steps. Calibrated to real data: a median launch now has ~22 transactions in its first minute and ~28 in five (on-chain sample, Oct 2026); organic graduates take a median 4.4-9.8 min and 457-853 trades (arXiv 2602.14860, PumpFunData Apr 2026).
- Archived keeps launches (chart, read, report, fees, P&L) and drafts in the browser; Export writes a JSON file for outside analysis.
- Dashboard (home, as the tool's account page): total and average P&L across archived launches (and the running one), 24H/7D/30D/1Y/All time, cumulative or per-launch chart, P&L Calendar, Recent launches / Best P&L.
- Drafts sit in the left column like the tool's launch list and are saved in the browser. Right-click a launch (or its ⋯ button) for Archive / Clone, as in the tool, plus Delete.
- Research cases (Import & match): SHARDS replays every real swap from the chain with evidence-graded wallet labels (Confirmed / Likely / Pattern only / No link found).

## Chart read
The Workspace chart and every imported launch get the same read from trades alone (plus funding links when available): launch insiders (deploy-block bundle and wallets linked to it) vs other coordinated wallets (sniper/bot clusters) vs everyone else; supply held by insiders over time; phases (bundle, accumulate, churn, distribute, dump); signal flags; click a candle to see who traded in it. In the sim, an answer key shows how many operator wallets the read caught and the true operator holding.

## Assumptions (Proxima's UI-only values)
- Layer moves: Front->Back is a buyback, Back->Temp is a token transfer, last layer->Holders is a buyback spaced by Buy Delay. Buyback = sell -> relay -> buy in the same block, the pattern seen on SHARDS.
- "Manual sells" (operator exit) and "Withdraw" are explicit settings, because how fast an operator dumps is a configuration choice too.

## Validation so far (all inside the sim, so circular)
- The detector's counter-trade check: 0 false flags in 18 runs without AutoBuy/AutoSell; caught 12/12 with them. It recovers the Replication Factor (20% -> ~20%, 50% -> ~50%).
- Matching: 5/5 built-in configurations recovered from hidden-seed CSV exports (library-only search).
- Checked against one real launch so far (SHARDS: shape, crash timing, post-crash level, outside volume). Weak spots: the crowd is a model calibrated to aggregate data, not real people; copy-trader counts and triggers are assumptions (no public data); fingerprints from trades alone can't see funding links.

## Next test
Export SHARDS trades (Research/case-shards/data/win25m.jsonl) to the import CSV format and match. Pass: the top match is Block-0 with ~55% Front MEV and Cleanup rounds, and its distance is within the range seen for the sim's own hidden-seed tests (<1.0). Stop if the parsed trades miss the bundle (inner instructions).
