"""Saved configurations, imported real launches, and configuration matching."""
import json
import math
import pathlib
import random
import re
import time
import analysis
import runner
from config import normalise, shards_preset, defaults

ROOT = pathlib.Path(__file__).parent
CONFIGS, IMPORTS = ROOT / "configs", ROOT / "imports"
CONFIGS.mkdir(exist_ok=True)
IMPORTS.mkdir(exist_ok=True)


def slug(name):
    return re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")[:60] or "untitled"


def builtins():
    base = shards_preset()
    lib = {"SHARDS reconstruction": base}

    def var(name, **kw):
        c = dict(base)
        c.update(name=name, **kw)
        lib[name] = normalise(c)
    var("Block-0 Quick Build", preset="quick", back_tuning=5)
    var("Block-0 Full Build (temp holders)", preset="full", back_tuning=4)
    var("Block-0 + Streamflow airdrop", alloc_method="streamflow", back_tuning=0)
    var("Quick mode, no automations", mode="quick", vb_enabled=False, as_enabled=False, holder_supply_pct=40)
    var("Organic mode + Bundle volume", mode="organic", buy_delay_s=3, vb_exec="bundle", vb_wallets="dedicated", as_enabled=False)
    var("Manual mode + AutoBuy DCA", mode="manual", ab_enabled=True, ab_dca=True, ab_counter=False, as_enabled=False, vb_enabled=False)
    var("Block-0 + Sniper Guard nuke", sg_enabled=True, sg_threshold=40, sg_response="nuke_all")
    return lib


def list_configs():
    out = [{"name": n, "builtin": True} for n in builtins()]
    for p in sorted(CONFIGS.glob("*.json")):
        try:
            out.append({"name": json.loads(p.read_text())["name"], "builtin": False, "saved": p.stat().st_mtime})
        except (ValueError, KeyError):
            pass
    return out


def get_config(name):
    b = builtins()
    if name in b:
        return b[name]
    p = CONFIGS / f"{slug(name)}.json"
    if not p.exists():
        raise ValueError(f"No configuration named {name!r}")
    return normalise(json.loads(p.read_text()))


def save_config(cfg):
    cfg = normalise(cfg)
    if cfg["name"] in builtins():
        raise ValueError("That name belongs to a built-in configuration. Pick another name.")
    (CONFIGS / f"{slug(cfg['name'])}.json").write_text(json.dumps(cfg, indent=1))
    return cfg


def delete_config(name):
    p = CONFIGS / f"{slug(name)}.json"
    if p.exists():
        p.unlink()


# ------------------------------------------------------------------ imports
def save_import(name, trades_csv, holders_csv=""):
    trades = analysis.parse_trades_csv(trades_csv)
    holders = analysis.parse_holders_csv(holders_csv) if holders_csv.strip() else None
    dur = max(60.0, trades[-1]["t"])
    rec = {"name": name or f"import-{int(time.time())}", "trades": trades, "holders": holders,
           "duration_s": dur, "fingerprint": analysis.fingerprint(trades, dur),
           "candles": analysis.candles(trades, dur)}
    (IMPORTS / f"{slug(rec['name'])}.json").write_text(json.dumps(rec))
    return {k: v for k, v in rec.items() if k != "trades"} | {"n_trades": len(trades)}


def list_imports():
    out = []
    for p in sorted(IMPORTS.glob("*.json")):
        try:
            r = json.loads(p.read_text())
            out.append({"name": r["name"], "n_trades": len(r["trades"]), "duration_s": r["duration_s"]})
        except (ValueError, KeyError):
            pass
    return out


def get_import(name):
    p = IMPORTS / f"{slug(name)}.json"
    if not p.exists():
        raise ValueError(f"No import named {name!r}")
    return json.loads(p.read_text())


# ------------------------------------------------------------------ matching
SEARCH = {
    "mode": ("choice", ["block0", "quick", "organic", "manual"]),
    "preset": ("choice", ["quick", "clean", "full"]),
    "target_supply_pct": ("float", 15, 70), "back_tuning": ("int", 0, 8), "wallets": ("int", 4, 60),
    "dev_buy_pct": ("float", 0, 5), "holder_supply_pct": ("float", 10, 60), "buy_delay_s": ("float", 0.5, 8),
    "alloc_method": ("choice", ["buyback", "streamflow"]),
    "vb_enabled": ("bool",), "vb_target": ("float", 5, 80), "vb_exec": ("choice", ["organic", "bundle"]),
    "as_enabled": ("bool",), "as_rate": ("float", 10, 80), "as_replication": ("float", 5, 60),
    "exit_start_s": ("float", 60, 900), "exit_window_s": ("float", 120, 1500),
    "org_peak_rate": ("float", 0.5, 5), "org_peak_s": ("float", 60, 600), "org_fomo": ("float", 0.3, 3),
    "sn_count": ("int", 0, 60), "sn_big_pct": ("float", 0, 12),
}


def perturb(cfg, rng, strength=1.0):
    c = dict(cfg)
    keys = rng.sample(list(SEARCH), k=max(2, int(len(SEARCH) * 0.35 * strength)))
    for k in keys:
        spec = SEARCH[k]
        if spec[0] == "choice":
            c[k] = rng.choice(spec[1])
        elif spec[0] == "bool":
            c[k] = rng.random() < 0.5
        else:
            lo, hi = spec[1], spec[2]
            if strength < 1 and isinstance(c.get(k), (int, float)):
                v = c[k] + rng.gauss(0, (hi - lo) * 0.15 * strength)
            else:
                v = rng.uniform(lo, hi)
            v = min(hi, max(lo, v))
            c[k] = int(round(v)) if spec[0] == "int" else v
    return normalise(c)


def match(import_name, extra=40, seeds=(1, 2), names=None):
    rec = get_import(import_name)
    target = rec["fingerprint"]
    minutes = max(2, min(60, math.ceil(rec["duration_s"] / 60)))
    rng = random.Random(7)
    pool = [get_config(n) for n in (names or [x["name"] for x in list_configs()])]
    scored = []

    def evaluate(cfg, origin):
        cfg = dict(cfg)
        cfg["duration_min"] = minutes
        f = runner.features(cfg, seeds)
        d, parts = analysis.distance(target, f)
        scored.append({"distance": d, "config": normalise(cfg), "origin": origin, "features": f, "parts": parts})
    for cfg in pool:
        evaluate(cfg, "library")
    scored.sort(key=lambda x: x["distance"])
    for i in range(extra // 2):   # broad random search seeded from the library's best
        evaluate(perturb(scored[min(i % 3, len(scored) - 1)]["config"], rng, 1.0), "search")
    scored.sort(key=lambda x: x["distance"])
    for i in range(extra - extra // 2):   # local refinement around the leaders
        evaluate(perturb(scored[i % 2]["config"], rng, 0.4), "refine")
    scored.sort(key=lambda x: x["distance"])
    best = scored[0]
    run = runner.run(best["config"], light=True)
    top = []
    for k, s in enumerate(scored[:8]):
        cfg = s["config"]
        name = cfg["name"] if s["origin"] == "library" else f"{s['origin']} #{k + 1} (from {cfg['name']})"
        worst = sorted(s["parts"].items(), key=lambda x: -x[1])[:4]
        top.append({"name": name, "distance": s["distance"], "origin": s["origin"], "config": cfg,
                    "mismatch": [[k2, round(target.get(k2, 0), 3), round(s["features"].get(k2, 0), 3)] for k2, _ in worst]})
    return {"import": {"name": rec["name"], "fingerprint": target, "candles": rec["candles"], "holders": rec["holders"],
                       "duration_s": rec["duration_s"]},
            "evaluated": len(scored), "top": top, "best_run": run}
