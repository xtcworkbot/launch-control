"""Outputs for a run: candles, trade markers, holders over time, funding graph, detection report,
and a fingerprint that can be computed the same way from imported real-launch CSVs.

The detection report is ledger-only (what a public chain shows). Public labels it may use:
exchange hot wallets (cex), the Jito tip account and the Streamflow escrow. Sandbox truth is
reported separately and never feeds the signals.
"""
import csv
import io
import math
import statistics
from collections import defaultdict
from datetime import datetime
from chain import SUPPLY, SLOT_S, MINT

GROUPS = {"op_dev": "dev", "op_front": "front MEV", "op_back": "back MEV", "op_temp": "temp holders",
          "op_holder": "holders (plan)", "op_volume": "volume wallets", "sniper": "snipers", "organic": "organic",
          "copy": "copy-traders", "streamflow": "Streamflow escrow"}


# ------------------------------------------------------------------ basics
def summary(c, op, trades):
    price = c.mc() / SUPPLY
    own = [a for a, r in c.truth.items() if r.startswith("op_")]
    spent = sum(t["sol"] for t in trades if t["side"] == "buy" and c.truth[t["wallet"]].startswith("op_"))
    recv = sum(t["sol"] for t in trades if t["side"] == "sell" and c.truth[t["wallet"]].startswith("op_"))
    op_tok = sum(c.tok[a] for a in own)
    by = defaultdict(float)
    for t in trades:
        g = grp(c.truth[t["wallet"]])
        by[g] += (t["sol"] if t["side"] == "sell" else -t["sol"])
    for a, r in c.truth.items():
        if c.tok.get(a, 0) > 0:
            by[grp(r)] += c.tok[a] * price
    peak = max(c.mc_path, key=lambda x: x[1]) if c.mc_path else (0, 0)
    return {
        "final_mc_sol": c.mc(), "peak_mc_sol": peak[1], "peak_t": peak[0] * SLOT_S,
        "graduated_t": c.migrated_slot * SLOT_S if c.migrated_slot is not None else None,
        "trades": len(trades), "volume_sol": sum(t["sol"] for t in trades),
        "operator": {"bought_sol": spent, "sold_sol": recv, "tokens_left_pct": op_tok / SUPPLY * 100,
                     "proxima_fee_sol": 0.05 * recv, "creator_fees_sol": c.creator_fees,
                     "pnl_sol": recv - spent + op_tok * price - 0.05 * recv + c.creator_fees * 0.95},
        "pnl_by_group": dict(by), "plan": op.stats,
    }


def grp(role):
    return GROUPS.get(role, "other")


def candles(trades, duration_s, n_target=180):
    step = max(1, round(duration_s / n_target))
    out, prev = {}, None
    for t in trades:
        b = int(t["t"] // step)
        k = out.get(b)
        m = t["mc"]
        if k is None:
            o = prev if prev is not None else m
            k = out[b] = {"t": b * step, "o": o, "h": max(o, m), "l": min(o, m), "c": m, "v": 0.0, "tools": defaultdict(float)}
        k["h"], k["l"], k["c"] = max(k["h"], m), min(k["l"], m), m
        k["v"] += t["sol"]
        k["tools"][t["tool"]] += t["sol"]
        prev = m
    res = []
    for b in sorted(out):
        k = out[b]
        k["tools"] = {a: round(v, 3) for a, v in k["tools"].items()}
        res.append(k)
    return {"step": step, "bars": res}


def markers(trades, cap=5000):
    step = max(1, len(trades) // cap)
    return [[round(t["t"], 1), round(t["mc"], 2), t["side"][0], round(t["sol"], 3), t["tool"], t["wallet"][:6]]
            for t in trades[::step]]


def replay_balances(c):
    """Yield (time_s, balances) after every token-moving ledger row from launch on."""
    bal = defaultdict(float)
    for row in c.ledger:
        k = row["kind"]
        if k == "swap" and row.get("mint") == MINT:
            bal[row["signer"]] += row["tok"] if row["side"] == "buy" else -row["tok"]
        elif k in ("tokx", "stream", "claim"):
            bal[row["frm"]] -= row["tok"]
            bal[row["to"]] += row["tok"]
        else:
            continue
        yield row["slot"] * SLOT_S, bal


def holders_over_time(c, duration_s, n=150):
    step = max(1.0, duration_s / n)
    snaps, nxt = [], 0.0
    peak = defaultdict(float)

    def snap(t, bal):
        live = [(a, v) for a, v in bal.items() if v > 1]
        live.sort(key=lambda x: -x[1])
        by = defaultdict(float)
        for a, v in live:
            by[grp(c.truth[a])] += v
        snaps.append({"t": round(t, 1), "holders": len(live),
                      "top10": sum(v for _, v in live[:10]) / SUPPLY * 100,
                      "groups": {g: round(v / SUPPLY * 100, 3) for g, v in by.items()}})
    last = None
    for t, bal in replay_balances(c):
        for a, v in bal.items():
            if v > peak[a]:
                peak[a] = v
        while t >= nxt and nxt <= duration_s:
            snap(nxt, bal)
            nxt += step
        last = bal
    if last is not None:
        while nxt <= duration_s:
            snap(nxt, last)
            nxt += step
        final = sorted(((a, v) for a, v in last.items() if v > 1), key=lambda x: -x[1])[:20]
    else:
        final = []
    return {"series": snaps, "peak": dict(peak),
            "top": [{"wallet": a[:6], "pct": v / SUPPLY * 100, "group": grp(c.truth[a])} for a, v in final]}


# ------------------------------------------------------------------ links
class UF:
    def __init__(self):
        self.p = {}

    def find(self, a):
        self.p.setdefault(a, a)
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        self.p[self.find(a)] = self.find(b)


PUBLIC_HUBS = ("cex", "jito_tip", "streamflow")


def public_label(c, a):
    r = c.truth.get(a, "")
    return r if r in PUBLIC_HUBS else None


def link_clusters(c):
    uf = UF()
    for row in c.ledger:
        if row["kind"] in ("sol", "tokx") and not public_label(c, row["frm"]) and not public_label(c, row["to"]):
            uf.union(row["frm"], row["to"])
    return uf


def funding_graph(c, trades, max_nodes=900):
    traders = {t["wallet"] for t in trades}
    peak = holders_over_time(c, 1, n=1)["peak"]
    inbound, outbound = defaultdict(list), defaultdict(list)
    for row in c.ledger:
        if row["kind"] in ("sol", "tokx", "stream", "claim"):
            inbound[row["to"]].append(row)
            outbound[row["frm"]].append(row)
    nodes = set(traders)
    frontier = set(traders)
    for _ in range(3):   # walk funding back up to 3 hops, stopping at public hubs
        nxt = set()
        for a in frontier:
            if public_label(c, a):
                continue
            for row in inbound[a]:
                if row["frm"] not in nodes:
                    nxt.add(row["frm"])
        nodes |= nxt
        frontier = nxt
    for a in list(nodes):   # where SOL went afterwards (relays, withdrawals)
        if not public_label(c, a):
            for row in outbound[a]:
                nodes.add(row["to"])
    uf = link_clusters(c)
    comp = defaultdict(set)
    for a in nodes:
        if not public_label(c, a):
            comp[uf.find(a)].add(a)
    cluster_id, k = {}, 0
    for root, members in sorted(comp.items(), key=lambda x: -len(x[1] & traders)):
        if len(members & traders) >= 2:
            k += 1
            for a in members:
                cluster_id[a] = k
    if len(nodes) > max_nodes:   # drop small unlinked organic traders first
        drop = sorted((a for a in nodes if a not in cluster_id and not public_label(c, a)), key=lambda a: peak.get(a, 0))
        for a in drop[:len(nodes) - max_nodes]:
            nodes.discard(a)
    edges = defaultdict(lambda: [0.0, 0, ""])
    for row in c.ledger:
        if row["kind"] in ("sol", "tokx", "stream", "claim") and row["frm"] in nodes and row["to"] in nodes:
            e = edges[(row["frm"], row["to"], "sol" if row["kind"] == "sol" else "tok")]
            e[0] += row.get("sol") or row.get("tok", 0)
            e[1] += 1
    return {
        "nodes": [{"id": a, "label": c.cex_name.get(a) or public_label(c, a) or a[:6],
                   "hub": bool(public_label(c, a)), "trader": a in traders,
                   "size": peak.get(a, 0) / SUPPLY * 100, "cluster": cluster_id.get(a, 0),
                   "truth": grp(c.truth.get(a, "")) if c.truth.get(a, "") in GROUPS else c.truth.get(a, "")}
                  for a in nodes],
        "edges": [[f, t, typ, round(v[0], 4), v[1]] for (f, t, typ), v in edges.items()],
    }



# ------------------------------------------------------------------ trade-only pattern helpers (shared by report + fingerprint)
def slot_of(t):
    return t["slot"] if t.get("slot") is not None else int(round(t["t"] / SLOT_S))


def grid_run(times):
    """Longest run of events on t0 + k*gap (other events allowed in between), with its chance level."""
    best = None
    for i in range(len(times)):
        for j in range(i + 1, min(i + 12, len(times))):
            g = times[j] - times[i]
            if g < 0.8:
                continue
            n, nxt, k = 2, times[j] + g, j + 1
            while k < len(times) and times[k] <= nxt + 0.25:
                if abs(times[k] - nxt) <= 0.25 and (k + 1 >= len(times) or abs(times[k + 1] - nxt) > abs(times[k] - nxt)):
                    n += 1
                    nxt += g
                k += 1
            if n >= 6:
                span = [x for x in times if times[i] <= x <= nxt]
                lam = len(span) / max(1.0, nxt - times[i])
                p = 1 - math.exp(-lam * 0.5)
                chance = (n - 2) * math.log10(max(p, 1e-12)) + math.log10(len(times) * 11)
                if chance < -2 and (best is None or n > best[0]):
                    best = (n, g, chance, times[i])
    return best


def counter_peak(trades, trigger_side, resp_side):
    """Counter Trading answers outside trades at one fixed Replication Factor, so response/trigger
    ratios pile up in one narrow band across many wallets. Chance responses spread out."""
    key = "sol" if resp_side == "buy" else "tok"
    idx = defaultdict(list)
    for t in trades:
        idx[slot_of(t)].append(t)
    bins, who = defaultdict(int), defaultdict(set)
    for t in trades:
        if t["side"] != trigger_side or t["sol"] < 0.05 or t[key] <= 0:
            continue
        s0 = slot_of(t)
        for s in (s0 + 1, s0 + 2):
            for u in idx.get(s, []):
                if u["side"] == resp_side and u["wallet"] != t["wallet"]:
                    r = u[key] / t[key]
                    if 0.01 <= r <= 10:
                        b = round(math.log(r) / math.log(1.02))
                        bins[b] += 1
                        who[b].add(u["wallet"])
    if not bins:
        return None

    def score(b):
        peak = bins.get(b, 0) + bins.get(b - 1, 0) + bins.get(b + 1, 0)
        side = [bins.get(x, 0) for x in range(b - 20, b + 21) if abs(x - b) > 2]
        base = 3 * sum(side) / len(side)
        return (peak - base) / math.sqrt(base + 1), peak, base
    lo_b, hi_b = math.log(0.02) / math.log(1.02), math.log(4.0) / math.log(1.02)
    cand = [b for b in bins if lo_b <= b <= hi_b]
    if not cand:
        return None
    best = max(cand, key=lambda b: score(b)[0])
    z, peak, base = score(best)
    return {"ratio": 1.02 ** best, "n": peak, "z": z, "base": base, "detected": peak >= 20 and z >= 6,
            "wallets": len(who[best] | who.get(best - 1, set()) | who.get(best + 1, set())), "ws": sorted(who[best])}


def round_trips(trades):
    """Matched buy/sell pairs per wallet (sell of exactly a prior buy's tokens)."""
    per = defaultdict(list)
    for t in trades:
        per[t["wallet"]].append(t)
    out = {}
    for w, ts in per.items():
        open_b, n, same = [], 0, 0
        for t in ts:
            if t["side"] == "buy":
                open_b.append(t)
            else:
                hit = next((b for b in open_b if b["tok"] and abs(b["tok"] - t["tok"]) <= 0.005 * b["tok"]), None)
                if hit:
                    open_b.remove(hit)
                    n += 1
                    same += slot_of(hit) == slot_of(t)
        if n:
            out[w] = (n, same, sum(t["sol"] for t in ts))
    return out


def sell_then_fresh_buy(trades):
    """Trade-only trace of a Buyback round: a sell, then in the same block a wallet's first-ever buy
    spending roughly the sell's proceeds (split 1-3 ways)."""
    seen, n = set(), 0
    by_slot = defaultdict(list)
    for t in trades:
        by_slot[slot_of(t)].append(t)
    first = {}
    for t in trades:
        first.setdefault(t["wallet"], t)
    for s, ts in by_slot.items():
        for i, t in enumerate(ts):
            if t["side"] != "sell" or t["sol"] < 0.05:
                continue
            buys = [u for u in ts[i + 1:] if u["side"] == "buy" and first[u["wallet"]] is u]
            tot = sum(u["sol"] for u in buys[:3])
            if buys and 0.8 <= tot / t["sol"] <= 1.05:
                n += 1
    return n

# ------------------------------------------------------------------ detection report
def level(x, med, high):
    return "high" if x >= high else "med" if x >= med else "low" if x > 0 else "none"


def cv(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = statistics.mean(xs)
    return statistics.pstdev(xs) / m if m > 0 else None


def report(c, trades):
    sig = []
    creator = next((r["signer"] for r in c.ledger if r["kind"] == "create"), None)
    traders = {t["wallet"] for t in trades}
    first_trade = {}
    for t in trades:
        first_trade.setdefault(t["wallet"], t)
    history = defaultdict(int)
    first_in = {}
    for row in c.ledger:
        if row["kind"] == "swap" and row.get("mint") == "OTHER" and row["slot"] < 0:
            history[row["signer"]] += 1
        if row["kind"] == "sol" and row["to"] not in first_in:
            first_in[row["to"]] = row
    by_slot = defaultdict(list)
    for row in c.ledger:
        if row["slot"] >= 0:
            by_slot[row["slot"]].append(row)

    # 1 same-block buys
    d0 = [t for t in trades if t["slot"] == 0 and t["side"] == "buy"]
    d0_supply = sum(t["tok"] for t in d0) / SUPPLY * 100
    busy = []
    for s in range(1, 150):
        fresh = {t["signer"] for t in by_slot.get(s, []) if t["kind"] == "swap" and t.get("mint") == MINT
                 and t["side"] == "buy" and first_trade[t["signer"]]["slot"] == s}
        if len(fresh) >= 3:
            busy.append((s, len(fresh)))
    sig.append({"id": "same_block", "name": "Same-block buys", "level": level(d0_supply, 5, 20),
                "value": f"{len({t['wallet'] for t in d0})} wallets bought {d0_supply:.1f}% of supply in the deploy block",
                "detail": f"{len(busy)} later blocks in the first minute had 3+ first-time buyers together",
                "evidence": [f"slot {s}: {n} new buyers" for s, n in busy[:8]]})

    # 2 common funding (non-exchange links)
    uf = link_clusters(c)
    comp = defaultdict(set)
    for a in traders:
        comp[uf.find(a)].add(a)
    clusters = [m for m in comp.values() if len(m) >= 2]
    peak_share = 0.0
    if clusters:
        clustered = set().union(*clusters)
        for _, bal in replay_balances(c):
            peak_share = max(peak_share, sum(bal[a] for a in clustered) / SUPPLY * 100)
    fan = defaultdict(list)
    for row in c.ledger:
        if row["kind"] == "sol" and row["to"] in traders and not public_label(c, row["frm"]):
            fan[row["frm"]].append(row)
    fan_out = {f: rows for f, rows in fan.items() if len({r["to"] for r in rows}) >= 3}
    grid = []
    for f, rows in fan_out.items():
        gaps = [b["slot"] - a["slot"] for a, b in zip(rows, rows[1:])]
        v = cv(gaps)
        if v is not None:
            grid.append((f, len(rows), v, statistics.mean(gaps) * SLOT_S / 60))
    biggest = max((len(m) for m in clusters), default=0)
    sig.append({"id": "common_funding", "name": "Common funding (non-exchange links)",
                "level": level(max(peak_share, 0.01 * biggest), 2, 10),
                "value": f"{len(clusters)} linked clusters, largest has {biggest} traders; clustered wallets peaked at {peak_share:.1f}% of supply",
                "detail": f"{len(fan_out)} wallets funded 3+ traders directly",
                "evidence": [f"{f[:6]} funded {n} traders, gaps {gm:.1f} min, regularity CV {v:.2f}" for f, n, v, gm in grid[:6]]
                + [f"cluster of {len(m)} traders: {', '.join(sorted(a[:6] for a in m)[:6])}" for m in sorted(clusters, key=len, reverse=True)[:4]]})

    # 3 CEX funding
    cex_first = {a: first_in[a]["frm"] for a in traders if a in first_in and public_label(c, first_in[a]["frm"]) == "cex"}
    early = [a for a in traders if first_trade[a]["t"] <= 60]
    early_cex = [a for a in early if a in cex_first]
    fresh_early = [a for a in early if a in first_in and first_in[a]["slot"] > -int(24 * 3600 / SLOT_S) and history[a] < 5]
    amt_groups = defaultdict(list)
    for a, hot in cex_first.items():
        amt_groups[(hot, round(math.log(max(first_in[a]["sol"], 1e-9)) * 50))].append(a)
    same_amt = [g for g in amt_groups.values() if len(g) >= 3]
    by_ex = defaultdict(int)
    for a, hot in cex_first.items():
        by_ex[c.cex_name[hot]] += 1
    sig.append({"id": "cex_funding", "name": "CEX funding sources",
                "level": level(len(fresh_early) / max(1, len(early)) * 100, 15, 35),
                "value": f"{len(cex_first)} of {len(traders)} traders first funded from an exchange; early buyers (first 60 s): {len(early_cex)} of {len(early)}",
                "detail": f"{len(fresh_early)} early buyers were funded <24 h before launch with little history; {len(same_amt)} groups of 3+ near-equal exchange withdrawals",
                "evidence": [f"{k}: {v} traders" for k, v in sorted(by_ex.items(), key=lambda x: -x[1])]})

    # 4 buy-timing regularity
    # Scheduled buys land on t0 + k*gap even when other traders' buys fall in between.
    firsts = sorted((t for t in first_trade.values() if t["side"] == "buy" and 0 < t["slot"] <= 1500), key=lambda t: (t["slot"], t["idx"]))
    best = grid_run([t["t"] for t in firsts])
    sig.append({"id": "timing", "name": "Buy-timing regularity",
                "level": "high" if best and best[0] >= 10 else "med" if best else "none",  # chance grids rarely exceed 6
                "value": (f"{best[0]} first-time buys land on a {best[1]:.1f} s grid from +{best[3]:.0f} s (chance ~1 in {10 ** -best[2]:,.0f})"
                          if best else "No run of 6+ first-time buys on a fixed time grid"),
                "detail": "Organic arrivals are bursty (CV ~1). A steady interval points to a scheduled Buy Delay.",
                "evidence": []})

    # 5 equal-size buy/sell pairs
    per = defaultdict(list)
    for t in trades:
        per[t["wallet"]].append(t)
    pairs, same_slot, pair_wallets, pair_vol, pair_vol_rep = 0, 0, 0, 0.0, [0.0]
    uf_pairs = link_clusters(c)
    linked_n = defaultdict(int)
    for a in traders:
        linked_n[uf_pairs.find(a)] += 1
    ev = []
    for w, ts in per.items():
        open_b, n = [], 0
        for t in ts:
            if t["side"] == "buy":
                open_b.append(t)
            else:
                hit = next((b for b in open_b if abs(b["tok"] - t["tok"]) <= 0.005 * b["tok"]), None)
                if hit:
                    open_b.remove(hit)
                    n += 1
                    pair_vol += hit["sol"] + t["sol"]
                    same_slot += hit["slot"] == t["slot"]
        pairs += n
        if n >= 3 and linked_n[uf_pairs.find(w)] >= 2:
            pair_wallets += 1
            rep_vol = sum(t["sol"] for t in ts)
            pair_vol_rep[0] += rep_vol
            ev.append(f"{w[:6]}: {n} matched round trips")
    vol = sum(t["sol"] for t in trades) or 1
    sig.append({"id": "equal_pairs", "name": "Equal-size buy/sell pairs",
                "level": level(pair_vol_rep[0] / vol * 100, 0.5, 2) if pair_wallets or same_slot >= 2 else "none",
                "value": f"{pair_wallets} linked wallets did 3+ matched round trips ({pair_vol_rep[0] / vol * 100:.1f}% of volume); {same_slot} pairs inside one block; {pairs} matched pairs in total",
                "detail": "Buying then selling everything is normal, so an honest flipper can look the same. Counted only for wallets linked to other traders by funding, or pairs inside one block.",
                "evidence": ev[:8]})

    # 6 counter-trade responses
    def responders(trigger_side, resp_side):
        x = counter_peak(trades, trigger_side, resp_side)
        return x if x and x["detected"] else None
    ab, as_ = responders("sell", "buy"), responders("buy", "sell")
    ev = []
    for name, x, what in (("AutoBuy", ab, "buys after outside sells"), ("AutoSell", as_, "sells after outside buys")):
        if x:
            ev.append(f"{x['n']} {what} at {x['ratio'] * 100:.0f}% of the trigger size from {x['wallets']} wallets (chance level ~{x['base']:.0f})")
            ev += [f"{w[:6]} responder" for w in x["ws"][:4]]
    n_resp = (ab or {}).get("n", 0) + (as_ or {}).get("n", 0)
    sig.append({"id": "counter", "name": "Counter-trade responses",
                "level": level(n_resp, 8, 25),
                "value": (f"Counter-buys: {'~%.0f%% replication, %d responses' % (ab['ratio'] * 100, ab['n']) if ab else 'none'}; "
                          f"counter-sells: {'~%.0f%% replication, %d responses' % (as_['ratio'] * 100, as_['n']) if as_ else 'none'}"),
                "detail": "The median ratio estimates the Replication Factor.",
                "evidence": ev})

    # 7 supply moving between wallets (Cleanup)
    rounds, moved, doubles = 0, 0.0, 0
    for txs in by_slot.values():
        for i, t in enumerate(txs):
            if t["kind"] != "swap" or t.get("mint") != MINT or t["side"] != "sell":
                continue
            pay = next((p for p in txs[i + 1:i + 3] if p["kind"] == "sol" and p["frm"] == t["signer"]), None)
            if not pay:
                continue
            buyers = set()
            for p in txs[i + 2:]:
                if p["kind"] == "sol" and p["frm"] == pay["to"]:
                    if any(q["kind"] == "swap" and q.get("mint") == MINT and q["side"] == "buy" and q["signer"] == p["to"] and q["idx"] > p["idx"] for q in txs):
                        buyers.add(p["to"])
            if buyers:
                rounds += 1
                moved += t["tok"]
                doubles += len(buyers) >= 2
    tokx = [r for r in c.ledger if r["kind"] in ("tokx", "claim") and not public_label(c, r["to"])]
    tok_moved = sum(r["tok"] for r in tokx)
    sig.append({"id": "cleanup", "name": "Supply moving between wallets (Cleanup)",
                "level": level((moved + tok_moved) / SUPPLY * 100, 2, 10),
                "value": f"{rounds} sell -> relay -> buy rounds moved {moved / SUPPLY * 100:.1f}% ({doubles} with 2+ buyers); "
                         f"{len(tokx)} direct token transfers/claims moved {tok_moved / SUPPLY * 100:.1f}%",
                "detail": "A sell whose SOL pays for a different wallet's buy in the same block links seller and buyer.",
                "evidence": []})

    # 8 bundle tips + concentration
    tips = [r for r in c.ledger if r["kind"] == "sol" and public_label(c, r["to"]) == "jito_tip" and r["slot"] >= 0]
    sig.append({"id": "tips", "name": "Jito-tipped bundles", "level": level(len(tips), 1, 10),
                "value": f"{len(tips)} tips from {len({r['frm'] for r in tips})} wallets",
                "detail": "Tipped same-block buy+sell is Volume Bot Bundle mode; a tip at deploy is the Block-0 bundle.", "evidence": []})
    return sig


# ------------------------------------------------------------------ fingerprint (sim and imported data)
TIMES = [10, 30, 60, 120, 300, 600, 900, 1200, 1800]
SCALE = {"b0_supply": 10, "b0_buyers": 3, "early_supply": 10, "lpeak": 0.25, "ltpeak": 0.4, "end_ratio": 0.3,
         "buy_frac": 0.1, "pair_frac": 0.05, "same_sec_pairs": 0.05, "lwallets": 0.25,
         "top10_60": 10, "top10_300": 10, "top10_900": 10, "lgrad": 0.5}
SCALE.update({f"lmc_{t}": 0.5 for t in TIMES})
SCALE.update({f"tpm_{i}": 0.6 for i in range(4)})
# Configuration signatures weigh more than crowd-driven price/activity (smaller scale = more weight).
SCALE.update({"grid": 0.15, "bundle_pairs": 0.15, "rt_wallets": 0.15, "cb_z": 0.3, "cs_z": 0.3, "cb_ratio": 0.15,
              "cs_ratio": 0.15, "buyback": 0.2, "fresh_10s": 0.2})
for k in ("lpeak", "ltpeak", "end_ratio", "lwallets", "buy_frac"):
    SCALE[k] *= 2


def fingerprint(trades, duration_s):
    trades = sorted(trades, key=lambda t: t["t"])
    if not trades:
        return {k: 0.0 for k in SCALE}
    f = {}
    mcs = []
    for t in trades:
        p = t.get("mc") or (t["sol"] / t["tok"] * SUPPLY if t["tok"] else None)
        if p:
            mcs.append((t["t"], p))
    first = [t for t in trades if t["t"] < 1.0 and t["side"] == "buy"]
    f["b0_supply"] = sum(t["tok"] for t in first) / SUPPLY * 100
    f["b0_buyers"] = len({t["wallet"] for t in first})
    f["early_supply"] = sum(t["tok"] if t["side"] == "buy" else -t["tok"] for t in trades if t["t"] <= 10) / SUPPLY * 100
    i = 0
    for T in TIMES:
        while i + 1 < len(mcs) and mcs[i + 1][0] <= T:
            i += 1
        f[f"lmc_{T}"] = math.log10(max(1e-3, mcs[i][1])) if mcs else 0
    pk = max(mcs, key=lambda x: x[1]) if mcs else (0, 1)
    f["lpeak"] = math.log10(max(1e-3, pk[1]))
    f["ltpeak"] = math.log10(1 + pk[0])
    f["end_ratio"] = math.log10(max(1e-3, mcs[-1][1] / pk[1])) if mcs else 0
    net, grad = 0.0, None
    for t in trades:
        net += t["tok"] if t["side"] == "buy" else -t["tok"]
        if net >= 793_100_000 * 0.999 and grad is None:
            grad = t["t"]
    f["lgrad"] = math.log10(1 + (grad if grad is not None else 3 * duration_s))
    edges = [0, 60, 300, 900, 1800]
    for k in range(4):
        n = sum(1 for t in trades if edges[k] <= t["t"] < edges[k + 1])
        f[f"tpm_{k}"] = math.log10(1 + n / ((edges[k + 1] - edges[k]) / 60))
    f["buy_frac"] = sum(1 for t in trades if t["side"] == "buy") / len(trades)
    per = defaultdict(list)
    for t in trades:
        per[t["wallet"]].append(t)
    pairs, ss = 0, 0
    for ts in per.values():
        open_b = []
        for t in ts:
            if t["side"] == "buy":
                open_b.append(t)
            else:
                hit = next((b for b in open_b if b["tok"] and abs(b["tok"] - t["tok"]) <= 0.005 * b["tok"]), None)
                if hit:
                    open_b.remove(hit)
                    pairs += 1
                    ss += abs(hit["t"] - t["t"]) < 1.0
    f["pair_frac"] = pairs / len(trades)
    f["same_sec_pairs"] = ss / len(trades)
    f["lwallets"] = math.log10(1 + len(per))
    firsts = {}
    for t in trades:
        firsts.setdefault(t["wallet"], t)
    fb = sorted(t["t"] for t in firsts.values() if t["side"] == "buy" and 0.5 < t["t"] <= 600)
    g = grid_run(fb)
    f["grid"] = math.log10(1 + (g[0] if g else 0))
    rt = round_trips(trades)
    f["bundle_pairs"] = math.log10(1 + sum(v[1] for v in rt.values()))
    f["rt_wallets"] = math.log10(1 + sum(1 for v in rt.values() if v[0] >= 3))
    for side, (a, b) in (("cb", ("sell", "buy")), ("cs", ("buy", "sell"))):
        x = counter_peak(trades, a, b)
        f[side + "_z"] = math.log10(1 + max(0.0, x["z"])) if x else 0.0
        f[side + "_ratio"] = math.log10(x["ratio"]) if x and x["detected"] else 0.0
    f["buyback"] = math.log10(1 + sell_then_fresh_buy(trades))
    f["fresh_10s"] = math.log10(1 + sum(1 for t in firsts.values() if t["side"] == "buy" and 0.5 < t["t"] <= 10))
    bal = defaultdict(float)
    j = 0
    for T in (60, 300, 900):
        while j < len(trades) and trades[j]["t"] <= T:
            t = trades[j]
            bal[t["wallet"]] += t["tok"] if t["side"] == "buy" else -t["tok"]
            j += 1
        f[f"top10_{T}"] = sum(sorted((v for v in bal.values() if v > 0), reverse=True)[:10]) / SUPPLY * 100
    return f


def distance(a, b):
    parts = {k: ((a.get(k, 0) - b.get(k, 0)) / s) ** 2 for k, s in SCALE.items()}
    return math.sqrt(sum(parts.values()) / len(parts)), parts


# ------------------------------------------------------------------ CSV import
ALIASES = {
    "t": ["time", "timestamp", "block_time", "blocktime", "date", "datetime", "ts", "unix", "t"],
    "wallet": ["wallet", "owner", "trader", "maker", "signer", "address", "account", "user", "from"],
    "side": ["side", "type", "direction", "action", "trade_type", "is_buy"],
    "sol": ["sol", "sol_amount", "amount_sol", "quote", "quote_amount", "value_sol", "native", "sol_value", "total_sol"],
    "tok": ["tokens", "token_amount", "amount_token", "base", "base_amount", "qty", "quantity", "amount"],
    "slot": ["slot", "block", "block_number"],
    "balance": ["balance", "amount", "tokens", "token_balance", "holding"],
    "pct": ["pct", "percent", "percentage", "share", "supply_pct"],
}


def _pick(header, key):
    low = {h.lower().strip(): h for h in header}
    for a in ALIASES[key]:
        if a in low:
            return low[a]
    return None


def _time(v):
    v = str(v).strip()
    try:
        x = float(v)
        return x / 1000 if x > 1e12 else x
    except ValueError:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()


def parse_trades_csv(text):
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ValueError("Trades CSV is empty")
    h = rows[0].keys()
    col = {k: _pick(h, k) for k in ("t", "wallet", "side", "sol", "tok", "slot")}
    missing = [k for k in ("t", "wallet", "side", "sol", "tok") if not col[k]]
    if missing:
        raise ValueError(f"Trades CSV needs columns for {missing}; found {list(h)}")
    out = []
    for r in rows:
        try:
            side = str(r[col["side"]]).strip().lower()
            side = "buy" if side in ("buy", "b", "true", "1", "bid") else "sell" if side in ("sell", "s", "false", "0", "ask") else None
            if not side:
                continue
            out.append({"t": _time(r[col["t"]]), "wallet": r[col["wallet"]].strip(), "side": side,
                        "sol": abs(float(r[col["sol"]])), "tok": abs(float(r[col["tok"]])),
                        "slot": int(float(r[col["slot"]])) if col["slot"] and r[col["slot"]] else None})
        except (ValueError, TypeError, KeyError):
            continue
    if not out:
        raise ValueError("No usable trade rows")
    out.sort(key=lambda t: (t["slot"] if t["slot"] is not None else 0, t["t"]))
    t0 = out[0]["t"]
    s0 = out[0]["slot"]
    for t in out:
        t["t"] = (t["slot"] - s0) * SLOT_S if s0 is not None and t["slot"] is not None else t["t"] - t0
        t["mc"] = t["sol"] / t["tok"] * SUPPLY if t["tok"] else None
        t["tool"] = "real"
    tok_total = sum(t["tok"] for t in out if t["side"] == "buy")
    if tok_total > 5 * SUPPLY:   # raw units with 6 decimals
        for t in out:
            t["tok"] /= 1e6
            t["mc"] = t["sol"] / t["tok"] * SUPPLY if t["tok"] else None
    return out


def parse_holders_csv(text, t0=None):
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return None
    h = rows[0].keys()
    ct, cw, cb, cp = _pick(h, "t"), _pick(h, "wallet"), _pick(h, "balance"), _pick(h, "pct")
    if not ct or not cw or not (cb or cp):
        raise ValueError(f"Holders CSV needs time, wallet and balance or pct columns; found {list(h)}")
    snaps = defaultdict(dict)
    for r in rows:
        try:
            t = _time(r[ct])
            v = float(r[cp]) if cp else float(r[cb]) / SUPPLY * 100
            snaps[t][r[cw]] = v
        except (ValueError, TypeError):
            continue
    base = t0 if t0 is not None else min(snaps)
    return [{"t": round(t - base, 1), "holders": sum(1 for v in s.values() if v > 0),
             "top10": sum(sorted(s.values(), reverse=True)[:10])} for t, s in sorted(snaps.items())]
