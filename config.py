"""Configuration schema: every Proxima setting the simulator understands, named as in docs.proxima.tools.

One configuration = one dict of these keys. The UI form is generated from SCHEMA, so the backend and
the page stay in sync. Values Proxima only shows in its UI (preset layer counts, delays) are our
assumptions and are marked [assumed] in the help text.
"""

CEXES = ["Binance", "KuCoin", "Gate", "Bybit", "HTX", "MEXC", "Bitget"]

# (key, label, type, default, extra)  extra: options for select/multi, (min, max) for numbers, help text
SCHEMA = [
    ("Run", [
        ("name", "Configuration name", "text", "Untitled", {}),
        ("seed", "Random seed", "int", 1, {"help": "Same seed + same settings = identical run."}),
        ("duration_min", "Simulated minutes", "int", 30, {"range": (2, 180)}),
    ]),
    ("Wallet preparation", [
        ("wallets", "Number of wallets (holders)", "int", 20, {"range": (0, 300), "help": "Holder wallets. Block-0 adds its MEV/temp layers on top."}),
        ("funding_source", "Funding source", "select", "funder", {"options": [["funder", "Single Funder (direct)"], ["classic", "Funder via proxy hops (Classic)"], ["cex", "CEX Funding (Husher)"]]}),
        ("cex_sources", "CEX sources", "multi", ["Binance", "KuCoin"], {"options": CEXES, "show": "funding_source=cex"}),
        ("funding_delay_min", "Funding Delay (min between wallets)", "float", 30, {"range": (0, 600), "help": "Proxima enforces 30+ min."}),
        ("funding_extra_mode", "Extra SOL per wallet", "select", "fixed", {"options": ["fixed", "range"]}),
        ("funding_extra", "Extra SOL (fixed)", "float", 0.3, {"show": "funding_extra_mode=fixed"}),
        ("funding_extra_min", "Extra SOL min", "float", 0.1, {"show": "funding_extra_mode=range"}),
        ("funding_extra_max", "Extra SOL max", "float", 0.6, {"show": "funding_extra_mode=range"}),
        ("ga_enabled", "Generate Activity (pre-age wallets)", "bool", False, {}),
        ("ga_amount_min", "GA amount per tx min (SOL)", "float", 0.01, {"show": "ga_enabled"}),
        ("ga_amount_max", "GA amount per tx max (SOL)", "float", 0.05, {"show": "ga_enabled"}),
        ("ga_loops", "GA loop count", "int", 10, {"show": "ga_enabled", "range": (1, 500)}),
        ("ga_delay_s", "GA delay between loops (s)", "float", 60, {"show": "ga_enabled"}),
    ]),
    ("Launch", [
        ("mode", "Launch mode", "select", "block0", {"options": [["block0", "Block-0"], ["quick", "Quick"], ["organic", "Organic"], ["manual", "Manual"]]}),
        ("dev_buy_pct", "Dev Buy (% supply)", "float", 1.5, {"range": (0, 20)}),
        ("holder_supply_pct", "Holders target % supply (Quick/Organic/Manual)", "float", 40, {"range": (0, 75), "show": "mode!=block0"}),
        ("buy_delay_s", "Buy Delay (s between holder buys)", "float", 2, {"help": "Organic mode and Block-0 final holders. Quick = 0."}),
        ("scheduled", "Scheduled Mode (hold holder buys until Snipe)", "bool", False, {}),
        ("snipe_at_s", "Snipe at (s after deploy)", "float", 60, {"show": "scheduled"}),
        ("manual_buy_at_s", "Manual: holders buy at (s)", "float", 20, {"show": "mode=manual"}),
        ("manual_style", "Manual: multi-wallet style", "select", "stagger", {"options": ["stagger", "parallel"], "show": "mode=manual"}),
        ("exit_enabled", "Manual sells (operator exit)", "bool", True, {"help": "Holder wallets sell out over a window, via Sell in the Live Workspace."}),
        ("exit_start_s", "Exit starts at (s)", "float", 300, {"show": "exit_enabled"}),
        ("exit_window_s", "Exit window (s)", "float", 900, {"show": "exit_enabled"}),
        ("exit_pct", "Exit sells % of holdings", "float", 100, {"show": "exit_enabled"}),
        ("exit_wallets", "Exit wallets", "select", "holders", {"options": ["holders", "all"], "show": "exit_enabled"}),
        ("exit_withdraw", "Withdraw SOL to Funder after exit", "bool", True, {"show": "exit_enabled"}),
    ]),
    ("Block-0 layers", [
        ("preset", "Preset", "select", "clean", {"options": [["quick", "Quick Build"], ["clean", "Clean Build"], ["full", "Full Build"], ["custom", "Custom"]], "show": "mode=block0"}),
        ("target_supply_pct", "Target % of supply (Front MEV)", "float", 55, {"range": (1, 75), "show": "mode=block0"}),
        ("back_tuning", "Back MEV Tuning slider", "int", 5, {"range": (0, 12), "show": "mode=block0", "help": "More Back MEV wallets = sniper sells harder to see, top traders easier to see."}),
        ("front_count", "Front MEV count", "int", 4, {"range": (1, 24), "show": "preset=custom"}),
        ("back_count", "Back MEV count", "int", 5, {"range": (0, 24), "show": "preset=custom"}),
        ("temp_count", "Temp Holders count", "int", 0, {"range": (0, 100), "show": "preset=custom"}),
        ("front_back_delay_s", "Front->Back delay (s)", "float", 1, {"show": "preset=custom"}),
        ("back_temp_delay_s", "Back->Temp delay (s)", "float", 3, {"show": "preset=custom"}),
        ("alloc_method", "Holder allocation method", "select", "buyback", {"options": [["buyback", "Buyback (sell -> relay -> buy)"], ["streamflow", "Streamflow Airdrop (transfer + claim)"]], "show": "mode=block0"}),
    ]),
    ("Sniper Guard", [
        ("sg_enabled", "Enable Sniper Guard", "bool", False, {}),
        ("sg_threshold", "Threshold: outside buys (SOL)", "float", 5, {"show": "sg_enabled"}),
        ("sg_response", "Response", "select", "nuke_all", {"options": [["nuke_all", "Nuke - All"], ["nuke_holders", "Nuke - Holders Only"], ["nuke_dev", "Nuke - Dev Only"], ["complete_early", "Complete Early"]], "show": "sg_enabled"}),
        ("sg_complete_early", "Dev Only: also Complete Early", "bool", True, {"show": "sg_response=nuke_dev"}),
        ("sg_end", "End condition", "select", "until_complete", {"options": [["until_complete", "Until Complete"], ["timed", "Timed"]], "show": "sg_enabled"}),
        ("sg_timed_s", "Timed duration (s)", "float", 30, {"show": "sg_end=timed"}),
    ]),
    ("Volume Bot", [
        ("vb_enabled", "Enable Volume Bot", "bool", True, {}),
        ("vb_start_s", "Start at (s)", "float", 168, {"show": "vb_enabled"}),
        ("vb_target", "Target volume (SOL, both sides)", "float", 32, {"show": "vb_enabled"}),
        ("vb_mode", "Timing mode", "select", "delay", {"options": [["duration", "Duration mode"], ["delay", "Delay mode"]], "show": "vb_enabled"}),
        ("vb_duration_s", "Duration (s)", "float", 240, {"show": "vb_mode=duration"}),
        ("vb_delay_min", "Delay min (s)", "float", 15, {"show": "vb_mode=delay"}),
        ("vb_delay_max", "Delay max (s)", "float", 35, {"show": "vb_mode=delay"}),
        ("vb_exec", "Execution", "select", "organic", {"options": [["organic", "Organic (separate txs)"], ["bundle", "Bundle (same-block buy+sell)"]], "show": "vb_enabled"}),
        ("vb_wave", "Wave Intensity (0 Tight -> 1 Big waves)", "float", 0.3, {"range": (0, 1), "show": "vb_exec=organic"}),
        ("vb_size_mode", "Trade sizes", "select", "random", {"options": [["auto", "Auto (Duration mode)"], ["fixed", "Fixed"], ["random", "Random"]], "show": "vb_enabled"}),
        ("vb_size", "Fixed size (SOL)", "float", 1.0, {"show": "vb_size_mode=fixed"}),
        ("vb_size_min", "Random size min (SOL)", "float", 0.3, {"show": "vb_size_mode=random"}),
        ("vb_size_max", "Random size max (SOL)", "float", 3.0, {"show": "vb_size_mode=random"}),
        ("vb_wallets", "Wallets used", "select", "front", {"options": [["front", "Front MEV wallets"], ["back", "Back MEV wallets"], ["holders", "Holder wallets"], ["dedicated", "Dedicated new wallets"]], "show": "vb_enabled"}),
        ("vb_dedicated_n", "Dedicated wallets", "int", 6, {"show": "vb_wallets=dedicated"}),
        ("vb_fee_target", "Fee Target (tip budget, SOL)", "float", 0.05, {"show": "vb_enabled"}),
    ]),
]


def _auto(prefix, side):
    unit = "SOL" if side == "buy" else "M tokens"
    react = "outside sells" if side == "buy" else "outside buys"
    return [
        (f"{prefix}_enabled", f"Enable Auto{side.capitalize()}", "bool", side == "sell", {}),
        (f"{prefix}_wallets", "Wallets used", "select", "holders", {"options": ["holders", "front", "back", "all"], "show": f"{prefix}_enabled"}),
        (f"{prefix}_start_delay_s", "Start Delay (s)", "float", 60, {"show": f"{prefix}_enabled"}),
        (f"{prefix}_counter", f"Counter Trading (react to {react})", "bool", True, {"show": f"{prefix}_enabled"}),
        (f"{prefix}_rate", "Rate (%)", "float", 40, {"range": (0, 100), "show": f"{prefix}_counter"}),
        (f"{prefix}_min_trigger", f"Min. trigger size ({'SOL' if side == 'buy' else 'SOL of the outside buy'})", "float", 0.05, {"show": f"{prefix}_counter"}),
        (f"{prefix}_replication", "Replication Factor (%)", "float", 20, {"show": f"{prefix}_counter"}),
        (f"{prefix}_min_per_trade", f"Minimum per trade (accumulate, {unit})", "float", 0, {"show": f"{prefix}_counter"}),
        (f"{prefix}_dca", "DCA", "bool", False, {"show": f"{prefix}_enabled"}),
        (f"{prefix}_dca_interval_s", "DCA interval (s)", "float", 30, {"range": (1, 86400), "show": f"{prefix}_dca"}),
        (f"{prefix}_dca_mode", "DCA amount", "select", "fixed", {"options": ["fixed", "random"], "show": f"{prefix}_dca"}),
        (f"{prefix}_dca_amount", f"DCA fixed amount ({unit})", "float", 0.2 if side == "buy" else 2, {"show": f"{prefix}_dca_mode=fixed"}),
        (f"{prefix}_dca_min", f"DCA min ({unit})", "float", 0.1 if side == "buy" else 1, {"show": f"{prefix}_dca_mode=random"}),
        (f"{prefix}_dca_max", f"DCA max ({unit})", "float", 0.4 if side == "buy" else 4, {"show": f"{prefix}_dca_mode=random"}),
        (f"{prefix}_limits", f"Limit Orders (MC SOL:amount {unit}, comma-sep)", "text", "", {"show": f"{prefix}_enabled",
            "help": "AutoBuy targets must decrease; AutoSell targets must increase. e.g. 300:2, 200:3"}),
        (f"{prefix}_mc_min", "Market Cap Range min (SOL, 0 = none)", "float", 0, {"show": f"{prefix}_enabled"}),
        (f"{prefix}_mc_max", "Market Cap Range max (SOL, 0 = none)", "float", 0, {"show": f"{prefix}_enabled"}),
        (f"{prefix}_end_amount", f"End after amount ({unit}, 0 = none)", "float", 0, {"show": f"{prefix}_enabled"}),
        (f"{prefix}_end_duration_s", "End after duration (s, 0 = none)", "float", 240, {"show": f"{prefix}_enabled"}),
    ]


SCHEMA += [
    ("AutoBuy", _auto("ab", "buy")),
    ("AutoSell", _auto("as", "sell")),
    ("Cleanup", [
        ("cl_enabled", "Enable live Cleanup", "bool", False, {"help": "Block-0 layer moves already run their own Cleanup; this is an extra run from the Live Workspace."}),
        ("cl_start_s", "Start at (s)", "float", 120, {"show": "cl_enabled"}),
        ("cl_inputs", "Sellers (input wallets)", "select", "holders", {"options": ["holders", "front", "back", "temp"], "show": "cl_enabled"}),
        ("cl_outputs", "Buyers (new output wallets)", "int", 10, {"range": (1, 200), "show": "cl_enabled"}),
        ("cl_share_pct", "% of sellers' holdings moved", "float", 100, {"range": (1, 100), "show": "cl_enabled"}),
        ("cl_delay_mode", "Delay Between Rounds", "select", "random", {"options": ["fixed", "random"], "show": "cl_enabled"}),
        ("cl_delay", "Fixed delay (s)", "float", 15, {"range": (0.5, 300), "show": "cl_delay_mode=fixed"}),
        ("cl_delay_min", "Random delay min (s)", "float", 0.5, {"range": (0.5, 300), "show": "cl_delay_mode=random"}),
        ("cl_delay_max", "Random delay max (s)", "float", 5.5, {"range": (0.5, 300), "show": "cl_delay_mode=random"}),
        ("cl_double_pct", "Double Buy %", "float", 50, {"range": (0, 100), "show": "cl_enabled"}),
        ("cl_method", "Method", "select", "buyback", {"options": [["buyback", "Buyback"], ["streamflow", "Streamflow Airdrop"]], "show": "cl_enabled"}),
    ]),
    ("Outside traders: snipers", [
        ("sn_count", "Sniper bot wallets", "int", 37, {"range": (0, 300)}),
        ("sn_cluster", "Wallets per cluster (same slot, shared funder)", "int", 4, {"range": (1, 10)}),
        ("sn_window_s", "Entry window (s after deploy)", "float", 6.4, {}),
        ("sn_size", "Median buy (SOL)", "float", 1.0, {}),
        ("sn_hold_min", "Hold min (s)", "float", 2, {}),
        ("sn_hold_max", "Hold max (s)", "float", 20, {}),
        ("sn_big_pct", "Large same-slot outsider (% supply, 0 = none)", "float", 9.8, {"range": (0, 20)}),
    ]),
    ("Outside traders: organic", [
        ("org_n", "Organic wallets available", "int", 600, {"range": (0, 3000)}),
        ("org_peak_rate", "Peak arrivals per second", "float", 2.5, {}),
        ("org_peak_s", "Attention peaks at (s)", "float", 250, {}),
        ("org_fomo", "Momentum chasing (FOMO)", "float", 1.5, {"range": (0, 5)}),
        ("org_size", "Median buy (SOL)", "float", 0.35, {}),
        ("org_rebuy_pct", "Re-buy share of arrivals (%)", "float", 30, {"range": (0, 100)}),
        ("org_panic", "Panic sell below x entry MC", "float", 0.6, {"range": (0.05, 1)}),
        ("org_tp", "Take profit above x entry MC", "float", 2.5, {}),
        ("org_flip_pct", "Fast flippers (%)", "float", 25, {"range": (0, 100)}),
        ("org_hold_s", "Typical hold otherwise (s)", "float", 600, {}),
    ]),
    ("Outside traders: copy-traders", [
        ("ct_count", "Copy-trade bots", "int", 6, {"range": (0, 200)}),
        ("ct_trigger_sol", "Copy buys of at least (SOL)", "float", 2.0, {}),
        ("ct_window_s", "Only during first (s)", "float", 600, {}),
        ("ct_delay_s", "Copy delay (s)", "float", 1.2, {}),
        ("ct_ratio_pct", "Copy size (% of leader's buy)", "float", 30, {}),
        ("ct_follow_pct", "Each bot copies a given buy with prob (%)", "float", 15, {"range": (0, 100)}),
        ("ct_copy_sells", "Also copy the leader's sells", "bool", True, {}),
    ]),
]

FIELDS = {k: (label, typ, default, extra) for _, fs in SCHEMA for k, label, typ, default, extra in fs}

# Preset layer logic. Proxima computes counts and delays from the holder count; its formulas are UI-only.
# [assumed] values below are our stand-ins, chosen so Clean Build at 4 Front MEV reproduces SHARDS.
PRESETS = {
    "quick": dict(front_back_delay_s=1.0, back_temp_delay_s=0.0, buy_delay_s=0.8, temp=False),
    "clean": dict(front_back_delay_s=1.0, back_temp_delay_s=0.0, buy_delay_s=2.5, temp=False),
    "full": dict(front_back_delay_s=1.0, back_temp_delay_s=3.0, buy_delay_s=2.5, temp=True),
}


def defaults():
    return {k: v[2] if not isinstance(v[2], list) else list(v[2]) for k, v in FIELDS.items()}


def normalise(cfg):
    """Fill missing keys, coerce types, clamp ranges and derive Block-0 layers from the preset."""
    out = defaults()
    for k, v in (cfg or {}).items():
        if k not in FIELDS:
            continue
        typ, extra = FIELDS[k][1], FIELDS[k][3]
        try:
            if typ == "int":
                v = int(float(v))
            elif typ == "float":
                v = float(v)
            elif typ == "bool":
                v = v in (True, "true", "on", 1, "1")
            elif typ == "multi":
                v = [x for x in (v if isinstance(v, list) else str(v).split(",")) if x]
            else:
                v = str(v)
        except (TypeError, ValueError):
            continue
        if "range" in extra and typ in ("int", "float"):
            lo, hi = extra["range"]
            v = max(lo, min(hi, v))
        out[k] = v
    if out["mode"] == "block0" and out["preset"] != "custom":
        p = PRESETS[out["preset"]]
        h = max(1, out["wallets"])
        out["front_count"] = max(2, min(12, round(h / 5)))
        out["back_count"] = out["back_tuning"]
        out["temp_count"] = max(2, h // 2) if p["temp"] else 0
        out["front_back_delay_s"] = p["front_back_delay_s"]
        out["back_temp_delay_s"] = p["back_temp_delay_s"]
        out["buy_delay_s"] = p["buy_delay_s"]
    if not out["cex_sources"]:
        out["cex_sources"] = ["Binance"]
    return out


def shards_preset():
    """The SHARDS launch as best we can reconstruct it (Research/case-shards/README.md)."""
    c = defaults()
    c.update(name="SHARDS reconstruction", wallets=20, mode="block0", preset="clean", target_supply_pct=55,
             dev_buy_pct=1.5, back_tuning=0, funding_source="cex", cex_sources=["Binance"], ga_enabled=True,
             ga_loops=40, vb_enabled=True, vb_start_s=168, vb_target=32, vb_mode="delay", vb_wallets="front",
             as_enabled=True, as_start_delay_s=60, as_end_duration_s=240, exit_enabled=True, exit_start_s=300,
             exit_window_s=900)
    return normalise(c)
