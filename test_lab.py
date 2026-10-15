"""Smoke tests: every configurable tool leaves the trace it should. python3 test_lab.py"""
from collections import Counter
import analysis
import lab
import runner
from config import shards_preset
from chain import SUPPLY, sec


def sim(**over):
    c = shards_preset()
    c.update(duration_min=12, **over)
    chain, op, cfg = runner.simulate(c)
    return chain, op, cfg, runner.trades_of(chain)


def tools(trades):
    return Counter(t["tool"] for t in trades)


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{info}]" if info else ""))
    return cond


ok = True
c, op, cfg, tr = sim()
ok &= check("Block-0 bundle in deploy slot ~56.5%", abs(sum(t["tok"] for t in tr if t["slot"] == 0 and t["tool"] in ("dev_buy", "front_mev")) / SUPPLY * 100 - 56.5) < 0.1)
ok &= check("graduates and migrates", c.migrated_slot is not None, f"slot {c.migrated_slot}")
done = next(t for t in tr if t["side"] == "buy" and c.ledger and sum(x["tok"] if x["side"] == "buy" else -x["tok"] for x in tr if (x["slot"], x["idx"]) <= (t["slot"], t["idx"])) >= 793_099_000)
ok &= check("curve frozen between completion and migration", not any(t["slot"] == done["slot"] and t["idx"] > done["idx"] for t in tr) and c.migrated_slot > done["slot"], f"completed slot {done['slot']}, migrated slot {c.migrated_slot}")

c, op, cfg, tr = sim(scheduled=True, snipe_at_s=90)
first_holder = min((t["t"] for t in tr if t["tool"] == "holder_buy"), default=None)
ok &= check("Scheduled Mode holds holder buys until Snipe", first_holder is not None and first_holder >= 90, f"first holder buy {first_holder}")

c, op, cfg, tr = sim(preset="custom", front_count=3, back_count=4, temp_count=6, front_back_delay_s=2, back_temp_delay_s=4)
tc = tools(tr)
tokx = sum(1 for r in c.ledger if r["kind"] == "tokx")
ok &= check("Custom layers: Front -> Back -> Temp -> Holders", tc["back_mev"] >= 8 and tokx >= 6 and tc["holder_buy"] >= 20, f"{dict(tc)} tokx={tokx}")

c, op, cfg, tr = sim(sg_enabled=True, sg_threshold=10, sg_response="nuke_all")
ok &= check("Sniper Guard Nuke All sells", tools(tr)["sniper_guard"] >= 3, str(tools(tr)["sniper_guard"]))
c, op, cfg, tr = sim(sg_enabled=True, sg_threshold=10, sg_response="complete_early")
ok &= check("Complete Early stops holder buys", tools(tr)["holder_buy"] < 40 and tools(tr)["sniper_guard"] == 0, str(tools(tr)["holder_buy"]))

c, op, cfg, tr = sim(vb_mode="duration", vb_duration_s=120, vb_size_mode="auto", vb_exec="bundle", vb_wallets="dedicated")
same = sum(1 for v in analysis.round_trips(tr).values() if v[1] > 0)
ok &= check("Volume Bot Duration + Bundle: same-block pairs + tips", same >= 1 and any(r.get("tool") == "jito_tip" and r["slot"] > 0 for r in c.ledger), f"wallets {same}")

c, op, cfg, tr = sim(as_enabled=True, as_counter=False, as_dca=True, as_dca_interval_s=20, as_end_duration_s=400)
ok &= check("AutoSell DCA sells on an interval", tools(tr)["autosell"] >= 8, str(tools(tr)["autosell"]))

c, op, cfg, tr = sim(as_enabled=False, ab_enabled=True, ab_counter=False, ab_limits="300:1, 150:2", ab_end_duration_s=0, ab_start_delay_s=10)
ok &= check("AutoBuy limit orders fire at MC targets", 1 <= tools(tr)["autobuy"] <= 2, str(tools(tr)["autobuy"]))

c, op, cfg, tr = sim(exit_enabled=False, cl_enabled=True, cl_start_s=120, cl_outputs=12, cl_double_pct=100, cl_delay_mode="fixed", cl_delay=3)
rep = {r["id"]: r for r in analysis.report(c, tr)}
ok &= check("live Cleanup buyback with Double Buy", tools(tr)["cleanup"] >= 12 and "with 2+ buyers" in rep["cleanup"]["value"], rep["cleanup"]["value"])
c, op, cfg, tr = sim(exit_enabled=False, cl_enabled=True, cl_start_s=120, cl_outputs=8, cl_method="streamflow")
ok &= check("live Cleanup via Streamflow claims", sum(1 for r in c.ledger if r["kind"] == "claim") >= 8)

c, op, cfg, tr = sim(mode="quick", as_enabled=False)
ok &= check("Quick: holder buys all at slot 1", {t["slot"] for t in tr if t["tool"] == "holder_buy"} == {1})
c, op, cfg, tr = sim(mode="organic", buy_delay_s=4, as_enabled=False)
g = analysis.grid_run(sorted(t["t"] for t in tr if t["tool"] == "holder_buy"))
ok &= check("Organic: holder buys on a 4 s grid", g is not None and abs(g[1] - 4) < 0.5, str(g))

c, op, cfg, tr = sim(funding_source="classic", funding_delay_min=45)
proxies = [a for a, r in c.truth.items() if r == "op_proxy"]
ok &= check("Classic funding uses proxy hops", len(proxies) >= 20)
ok &= check("deterministic per seed", runner.trades_of(runner.simulate(dict(shards_preset(), duration_min=3))[0])[:50] ==
            runner.trades_of(runner.simulate(dict(shards_preset(), duration_min=3))[0])[:50])
print("\nALL PASS" if ok else "\nSOME FAILED")
