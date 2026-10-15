"""Run one configuration end to end and return everything the UI and the matcher need."""
from chain import Chain, sec, SLOT_S, MINT, SUPPLY
from config import normalise, CEXES
from operator_tools import Operator
from crowd import snipers, organic, copy_traders
import analysis


def simulate(cfg, seed=None):
    cfg = normalise(cfg)
    c = Chain(cfg["seed"] if seed is None else seed)
    cx = {name: c.exchange(name) for name in CEXES}
    op = Operator(c, cfg, cx)
    op.prepare()
    op.schedule_launch()
    snipers(c, cfg, cx)
    tick = organic(c, cfg, cx)
    copy_traders(c, cfg, cx)
    c.run(sec(cfg["duration_min"] * 60), (tick,))
    return c, op, cfg


def trades_of(c):
    return [{"t": t["slot"] * SLOT_S, "slot": t["slot"], "idx": t["idx"], "wallet": t["signer"], "side": t["side"],
             "sol": t["sol"], "tok": t["tok"], "mc": t["mc"], "tool": t["tool"]}
            for t in c.ledger if t["kind"] == "swap" and t.get("mint") == MINT]


def run(cfg, light=False):
    c, op, cfg = simulate(cfg)
    trades = trades_of(c)
    out = {
        "config": cfg,
        "summary": analysis.summary(c, op, trades),
        "candles": analysis.candles(trades, cfg["duration_min"] * 60),
        "holders": analysis.holders_over_time(c, cfg["duration_min"] * 60),
        "report": analysis.report(c, trades),
        "fingerprint": analysis.fingerprint(trades, cfg["duration_min"] * 60),
        "timeline": op.events,
    }
    if not light:
        out["markers"] = analysis.markers(trades)
        out["graph"] = analysis.funding_graph(c, trades)
    return out


def features(cfg, seeds=(1, 2)):
    """Average fingerprint across seeds (used by the matcher)."""
    fps = []
    for s in seeds:
        c, op, ncfg = simulate(cfg, seed=s)
        fps.append(analysis.fingerprint(trades_of(c), ncfg["duration_min"] * 60))
    keys = fps[0].keys()
    return {k: sum(f[k] for f in fps) / len(fps) for k in keys}
