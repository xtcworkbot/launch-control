"""Outside participants (adjustable): sniper bots, organic traders, copy-traders. Sandbox only."""
import math
from chain import SUPPLY, sec, SLOT_S


def poisson(r, lam):
    if lam <= 0:
        return 0
    L, k, p = math.exp(-min(lam, 30)), 0, 1.0
    while True:
        p *= r.random()
        if p <= L:
            return k
        k += 1


def snipers(c, cfg, cx):
    r = c.rng
    hot = list(cx.values())
    if cfg["sn_big_pct"] > 0:   # a large outsider in the deploy slot, after the bundle (SHARDS: B5fm5V)
        big = c.wallet("sniper")
        c.at(-sec(7200), lambda: (c.send(r.choice(hot), big, 60.0), [c.pad(big, 0.1) for _ in range(30)]))
        c.at(0, lambda: c.buy(big, c.sol_for(cfg["sn_big_pct"] / 100 * SUPPLY), "sniper"))
        for s in range(20, 32, 3):
            c.at(s, lambda: c.sell(big, c.tok[big] * 0.2, "sniper"))
        c.at(sec(r.uniform(60, 600)), lambda: c.sell(big, c.tok[big], "sniper"))
    made = 0
    window = max(1, sec(cfg["sn_window_s"]))
    while made < cfg["sn_count"]:
        size = min(cfg["sn_cluster"], cfg["sn_count"] - made)
        boss = c.wallet("sniper_funder")
        c.at(-sec(r.uniform(5, 40) * 3600), lambda b=boss, n=size: c.send(r.choice(hot), b, 6.0 * n))
        slot = r.randint(1, window)
        for _ in range(size):
            w = c.wallet("sniper")
            amt = min(5.0, r.lognormvariate(math.log(max(0.01, cfg["sn_size"])), 0.5))
            c.at(-sec(r.uniform(1, 4) * 3600), lambda b=boss, w=w, a=amt: (c.send(b, w, a + 0.3), [c.pad(w, 0.05) for _ in range(20)]))
            c.at(slot, lambda w=w, a=amt: c.buy(w, a, "sniper"))
            c.at(slot + sec(r.uniform(cfg["sn_hold_min"], cfg["sn_hold_max"])), lambda w=w: c.sell(w, c.tok[w], "sniper"))
        made += size


def organic(c, cfg, cx):
    """Arrive with attention that peaks then fades, chase momentum, panic on drawdowns, take profit."""
    r = c.rng
    hot = list(cx.values())
    pool = []
    for _ in range(cfg["org_n"]):
        w = c.wallet("organic")
        amt = min(30.0, r.lognormvariate(math.log(2.0), 0.8))
        when = -sec(r.uniform(0.5, 48) * 3600)
        if r.random() < 0.8:
            c.at(when, lambda w=w, a=amt: (c.send(r.choice(hot), w, a), [c.pad(w, r.uniform(0.02, 0.5)) for _ in range(r.randint(0, 20))]))
        else:
            main = c.wallet("organic_main")
            c.at(when - sec(3600), lambda m=main, a=amt: c.send(r.choice(hot), m, a + 1))
            c.at(when, lambda m=main, w=w, a=amt: c.send(m, w, a))
        pool.append(w)
    held, hist = {}, {}
    T = max(1.0, cfg["org_peak_s"])
    per_slot = cfg["org_peak_rate"] * SLOT_S
    base_hazard = 1 / max(1, sec(cfg["org_hold_s"]))

    def tick(s):
        hist[s] = c.mc()
        if s < 1 or not pool or not c.tradable():
            return
        t = s * SLOT_S
        ref = hist.get(s - sec(30), hist[0])
        mom = max(-0.9, min(3.0, c.mc() / ref - 1))
        lam = per_slot * (t / T) * math.exp(1 - t / T) * max(0.2, 1 + cfg["org_fomo"] * mom)
        for _ in range(poisson(r, lam)):
            w = r.choice(list(held)) if held and r.random() < cfg["org_rebuy_pct"] / 100 else r.choice(pool)
            got = c.buy(w, min(r.lognormvariate(math.log(max(0.01, cfg["org_size"])), 0.9), c.sol[w] * 0.5), "organic")
            if got and w not in held:
                held[w] = {"entry": c.mc(), "flip": s + sec(r.uniform(5, 60)) if r.random() < cfg["org_flip_pct"] / 100 else None}
        for w, h in list(held.items()):
            if c.tok[w] <= 1:
                del held[w]
                continue
            ratio = c.mc() / h["entry"]
            p = base_hazard
            if h["flip"] and s >= h["flip"]:
                p = 1.0
            elif ratio < cfg["org_panic"]:
                p = 1 / 40
            elif ratio > cfg["org_tp"]:
                p = 1 / 150
            if r.random() < p:
                c.sell(w, c.tok[w] if r.random() < 0.7 else c.tok[w] / 2, "organic")
    return tick


def copy_traders(c, cfg, cx):
    """Bots that mirror large early buys (and optionally the leader's sells) after a delay."""
    r = c.rng
    hot = list(cx.values())
    bots = []
    for _ in range(cfg["ct_count"]):
        b = c.wallet("copy")
        c.at(-sec(r.uniform(2, 72) * 3600), lambda b=b: (c.send(r.choice(hot), b, r.uniform(5, 25)), [c.pad(b, r.uniform(0.1, 1)) for _ in range(40)]))
        bots.append(b)
    if not bots:
        return
    bset = set(bots)
    follows = {}            # leader -> list of (bot, leader tokens at copy time)
    delay = max(1, sec(cfg["ct_delay_s"]))
    window = sec(cfg["ct_window_s"])

    def on(tx):
        if tx.get("mint") != "TOKEN" or tx["signer"] in bset:
            return
        lead = tx["signer"]
        if tx["side"] == "buy" and tx["slot"] <= window and tx["sol"] >= cfg["ct_trigger_sol"]:
            for b in bots:
                if r.random() < cfg["ct_follow_pct"] / 100:
                    amt = tx["sol"] * cfg["ct_ratio_pct"] / 100
                    c.at(c.slot + delay + r.randint(0, 2), lambda b=b, amt=amt: c.buy(b, amt, "copy_trade"))
                    follows.setdefault(lead, []).append(b)
        elif tx["side"] == "sell" and cfg["ct_copy_sells"] and lead in follows:
            before = c.tok[lead] + tx["tok"]
            frac = tx["tok"] / before if before > 0 else 1
            for b in set(follows[lead]):
                c.at(c.slot + delay + r.randint(0, 2), lambda b=b, f=frac: c.sell(b, c.tok[b] * min(1, f + 0.05), "copy_trade"))
    c.hooks.append(on)
