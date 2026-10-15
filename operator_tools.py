"""The launch operator: Proxima's tools, driven by one configuration (config.py).

Every trade is labelled with the tool that produced it (dev_buy, front_mev, back_mev, temp_transfer,
holder_buy, cleanup, streamflow, volume_bot, autobuy, autosell, sniper_guard, manual_sell, ...).
Layer mechanics follow docs.proxima.tools; where the docs are silent the choice is noted.
"""
import math
from chain import SUPPLY, V_SOL0, V_TOK0, CURVE_FEES, sec, SLOT_S

OWN_PREFIX = "op_"


def est_costs(token_amounts):
    """SOL cost of sequential buys on a fresh curve (for the funding plan)."""
    vs, vt, fee, out = V_SOL0, V_TOK0, sum(CURVE_FEES), []
    for tok in token_amounts:
        x = vs * vt / (vt - tok) - vs
        out.append(x / (1 - fee))
        vs, vt = vs + x, vt - tok
    return out


def parse_limits(text):
    rows = []
    for part in (text or "").replace(";", ",").split(","):
        if ":" in part:
            try:
                mc, amt = part.split(":")
                rows.append([float(mc), float(amt), False])
            except ValueError:
                pass
    return rows


class Operator:
    def __init__(self, c, cfg, cex_wallets):
        self.c, self.cfg, self.r = c, cfg, c.rng
        self.cx = cex_wallets                 # name -> hot wallet
        self.halted = False                   # Sniper Guard stop / Complete Early
        self.done_launch_buys = False
        self.events = []                      # human-readable timeline for the report
        self.stats = {}
        cf = cfg
        w = c.wallet
        self.funder = w("op_funder")
        self.dev = w("op_dev")
        b0 = cf["mode"] == "block0"
        self.fronts = [w("op_front") for _ in range(cf["front_count"])] if b0 else []
        self.backs = [w("op_back") for _ in range(cf["back_count"])] if b0 else []
        self.temps = [w("op_temp") for _ in range(cf["temp_count"])] if b0 else []
        self.holders = [w("op_holder") for _ in range(cf["wallets"])]
        self.relays = [w("op_relay") for _ in range(3)]
        self.escrow = w("streamflow")         # Streamflow program escrow (third-party program account)
        self.tip = w("jito_tip")              # a public Jito tip account
        self.dedicated = [w("op_volume") for _ in range(cf["vb_dedicated_n"])] \
            if cf["vb_enabled"] and cf["vb_wallets"] == "dedicated" else []
        self.cleanup_out = []
        self.targets = {}
        c.hooks.append(self._hook)
        self.listeners = []

    def own(self, a):
        return self.c.truth.get(a, "").startswith(OWN_PREFIX)

    def note(self, msg):
        self.events.append((round(max(self.c.slot, 0) * SLOT_S, 1), msg))

    def _hook(self, tx):
        for f in list(self.listeners):
            f(tx)

    # ------------------------------------------------------------------ preparation
    def plan(self):
        cf, r = self.cfg, self.r
        dev_tok = cf["dev_buy_pct"] / 100 * SUPPLY
        seq = [(self.dev, dev_tok)]
        if cf["mode"] == "block0":
            ws = [r.uniform(0.8, 1.2) for _ in self.fronts]
            seq += [(f, cf["target_supply_pct"] / 100 * SUPPLY * x / sum(ws)) for f, x in zip(self.fronts, ws)]
        elif self.holders:
            ws = [r.uniform(0.6, 1.4) for _ in self.holders]
            seq += [(h, cf["holder_supply_pct"] / 100 * SUPPLY * x / sum(ws)) for h, x in zip(self.holders, ws)]
        total = sum(t for _, t in seq)
        if total > 0.78 * SUPPLY:          # the curve only sells 79.31%
            k = 0.78 * SUPPLY / total
            seq = [(a, t * k) for a, t in seq]
        costs = est_costs([t for _, t in seq])
        self.targets = {a: t for a, t in seq}
        extra = (lambda: cf["funding_extra"]) if cf["funding_extra_mode"] == "fixed" else \
            (lambda: r.uniform(cf["funding_extra_min"], cf["funding_extra_max"]))
        vb_budget = cf["vb_size_max"] if cf["vb_size_mode"] == "random" else cf["vb_size"]
        vb_budget = vb_budget * 1.3 + 0.05 if cf["vb_enabled"] else 0
        fund = []
        for (a, _), cost in zip(seq, costs):
            amt = cost * 1.03 + extra() + 0.01
            if cf["vb_enabled"] and a in self.fronts and cf["vb_wallets"] == "front":
                amt += vb_budget
            fund.append((a, amt))
        for a in self.relays:   # relays also pay claim fees / fund Cleanup outputs
            fund.append((a, 0.05 + 0.006 * (len(self.holders) + cf["cl_outputs"])))
        for a in self.temps + self.backs:
            fund.append((a, 0.02 + extra() + (vb_budget if cf["vb_wallets"] == "back" else 0)))
        if cf["mode"] == "block0":
            for a in self.holders:   # buyback holders get SOL from relays; claim fees still need a little
                fund.append((a, 0.01 + extra()))
        for a in self.dedicated:
            fund.append((a, vb_budget + 0.1))
        ab_budget = 0.0
        if cf["ab_enabled"]:
            ab_budget = max(cf["ab_dca_amount"], cf["ab_dca_max"]) * 4 + 1.0
            for a in self._auto_pool("ab")[:5]:
                fund.append((a, ab_budget))
        self.funding = fund
        self.stats["plan_supply_pct"] = sum(self.targets.values()) / SUPPLY * 100
        self.stats["plan_cost_sol"] = sum(costs)
        self.stats["funding_total_sol"] = sum(x for _, x in fund)

    def prepare(self):
        """Funding (+ Generate Activity) before launch, on the negative-slot clock."""
        c, cf, r = self.c, self.cfg, self.r
        self.plan()
        n = len(self.funding)
        gap = sec(cf["funding_delay_min"] * 60)
        ga_span = sec(cf["ga_loops"] * cf["ga_delay_s"]) if cf["ga_enabled"] else 0
        start = -(n * gap + ga_span + sec(1800))
        total = self.stats["funding_total_sol"] * 1.02 + 1
        src = self.cx[cf["cex_sources"][0]] if cf["cex_sources"][0] in self.cx else next(iter(self.cx.values()))
        c.at(start - sec(600), lambda: c.send(src, self.funder, total, tool="funding"))
        if cf["funding_source"] == "cex":
            for k, name in enumerate(cf["cex_sources"]):    # deposit into each exchange used
                hot = self.cx.get(name)
                c.at(start - sec(300) + k, lambda hot=hot: c.send(self.funder, hot, total / len(cf["cex_sources"]), tool="funding"))
        for k, (a, amt) in enumerate(self.funding):
            slot = start + k * gap
            if cf["funding_source"] == "funder":
                c.at(slot, lambda a=a, amt=amt: c.send(self.funder, a, amt, tool="funding"))
            elif cf["funding_source"] == "classic":
                p = c.wallet("op_proxy")
                c.at(slot, lambda p=p, amt=amt: c.send(self.funder, p, amt + 0.002, tool="funding"))
                c.at(slot + sec(r.uniform(60, 600)), lambda p=p, a=a, amt=amt: c.send(p, a, amt, tool="funding"))
            else:
                name = cf["cex_sources"][k % len(cf["cex_sources"])]
                hot = self.cx.get(name, src)
                c.at(slot, lambda hot=hot, a=a, amt=amt: c.send(hot, a, amt * (1 - r.uniform(0.0025, 0.005)), tool="funding"))
            if cf["ga_enabled"] and self.c.truth[a] not in ("op_relay",):
                for j in range(cf["ga_loops"]):
                    t = slot + sec(900) + sec(j * cf["ga_delay_s"]) + r.randint(0, 3)
                    c.at(min(t, -sec(60)), lambda a=a: c.pad(a, r.uniform(cf["ga_amount_min"], cf["ga_amount_max"])))
        self.stats["funding_hours_before_launch"] = -start * SLOT_S / 3600

    # ------------------------------------------------------------------ launch
    def schedule_launch(self):
        self.c.at(0, self.launch)

    def launch(self):
        c, cf = self.c, self.cfg
        c.log(kind="create", signer=self.dev, mint="TOKEN", tool="deploy")
        if self.targets.get(self.dev, 0) > 0:
            c.buy(self.dev, c.sol_for(self.targets[self.dev]), "dev_buy")
        if cf["mode"] == "block0":
            for f in self.fronts:
                c.buy(f, c.sol_for(self.targets[f]), "front_mev")
            c.send(self.fronts[0], self.tip, 0.001, tool="jito_tip") if self.fronts else None
            self.note(f"Block-0: dev + {len(self.fronts)} Front MEV bought "
                      f"{sum(c.tok[a] for a in [self.dev, *self.fronts]) / SUPPLY * 100:.1f}% in the deploy slot")
        start = sec(cf["snipe_at_s"]) if cf["scheduled"] else 1
        if cf["scheduled"]:
            self.note(f"Scheduled Mode: holder buys held until Snipe at +{cf['snipe_at_s']:g}s")
        if cf["mode"] == "block0":
            c.at(max(start, sec(cf["front_back_delay_s"])), self._layers)
        elif cf["mode"] in ("quick", "organic"):
            gap = 0 if cf["mode"] == "quick" else sec(cf["buy_delay_s"])
            for i, h in enumerate(self.holders):
                c.at(start + i * gap, lambda h=h: self._holder_buy(h, "holder_buy"))
            c.at(start + len(self.holders) * gap + 1, self._launch_done)
        else:   # manual
            t0 = max(start, sec(cf["manual_buy_at_s"]))
            for i, h in enumerate(self.holders):
                c.at(t0 + (i if cf["manual_style"] == "stagger" else 0), lambda h=h: self._holder_buy(h, "manual_buy"))
            c.at(t0 + len(self.holders) + 1, self._launch_done)
        self._start_automations()

    def _launch_done(self):
        if not self.done_launch_buys:
            self.done_launch_buys = True
            self.note("All launch buy orders completed")

    def _holder_buy(self, h, tool):
        if self.halted:
            return
        c = self.c
        want = self.targets.get(h, 0)
        spend = c.sol_for(want) if want else c.sol[h] * 0.9
        c.buy(h, min(spend, c.sol[h] - 0.005), tool)

    # Block-0 layers: Front -> (Back) -> (Temp) -> Holders
    def _layers(self):
        cf = self.cfg
        phases = []
        src = self.fronts
        if self.backs:
            phases.append(("buyback", src, self.backs, 1, "back_mev"))
            src = self.backs
        if self.temps:
            phases.append(("transfer", src, self.temps, sec(cf["back_temp_delay_s"]), "temp_transfer"))
            src = self.temps
        method = "streamflow" if cf["alloc_method"] == "streamflow" else "buyback"
        if self.holders:
            phases.append((method, src, self.holders, sec(cf["buy_delay_s"]), "holder_buy" if method == "buyback" else "streamflow"))
        self._run_phases(phases)

    def _run_phases(self, phases):
        if not phases or self.halted:
            self._launch_done()
            return
        kind, src, dst, gap, tool = phases[0]
        rest = phases[1:]
        c = self.c
        if kind == "transfer":
            def go():
                total = sum(c.tok[s] for s in src)
                for i, d in enumerate(dst):
                    s = max(src, key=lambda x: c.tok[x])
                    c.send_tok(s, d, min(c.tok[s], total / len(dst)), tool=tool)
                self.note(f"Temp Holders: {len(dst)} wallets received {total / SUPPLY * 100:.1f}% by transfer")
                c.at(c.slot + max(1, gap), lambda: self._run_phases(rest))
            c.at(c.slot + max(1, gap), go)
            return
        self._move(kind, src, dst, gap, tool, then=lambda: self._run_phases(rest))

    def _move(self, kind, src, dst, gap, tool, then=None, double_pct=0.0, share=1.0, new_wallets=False):
        """Buyback: seller sells, proceeds -> relay -> buyer(s) buy, same slot. Streamflow: escrow + claims."""
        c, r = self.c, self.r
        dst = list(dst)
        to_move = sum(c.tok[s] for s in src) * share
        st = {"left": to_move, "i": 0, "rounds": 0}
        gapf = gap if callable(gap) else (lambda: gap)
        if kind == "streamflow":
            for s in src:
                c.send_tok(s, self.escrow, c.tok[s] * share, tool="streamflow", kind="stream")
            per = to_move / max(1, len(dst))

            def claim():
                if st["i"] >= len(dst) or self.halted:
                    if then:
                        then()
                    return
                d = dst[st["i"]]
                st["i"] += 1
                c.send(self.relays[0], d, 0.004, tool="streamflow")   # claim cost paid by the plan
                c.send_tok(self.escrow, d, min(per, c.tok[self.escrow]), tool="streamflow", kind="claim")
                c.at(c.slot + max(1, gapf()), claim)
            c.at(c.slot + 1, claim)
            self.note(f"Streamflow Airdrop: {to_move / SUPPLY * 100:.1f}% escrowed for {len(dst)} claimants")
            return

        def rnd():
            if self.halted or st["i"] >= len(dst) or st["left"] < 1 or not c.tradable():
                if not c.tradable() and st["i"] < len(dst) and not self.halted:
                    c.at(c.slot + 1, rnd)      # curve frozen until migration
                    return
                if then:
                    then()
                return
            n_left = len(dst) - st["i"]
            nb = 2 if (n_left >= 2 and r.random() < double_pct / 100) else 1
            rounds_left = max(1, math.ceil(n_left / (1 + double_pct / 100)))
            chunk = st["left"] / rounds_left
            seller = max(src, key=lambda x: c.tok[x])
            chunk = min(chunk, c.tok[seller])
            got = c.sell(seller, chunk, tool)
            st["left"] -= chunk
            relay = r.choice(self.relays)
            got = c.send(seller, relay, got, tool=tool)
            for _ in range(nb):
                b = dst[st["i"]]
                st["i"] += 1
                c.send(relay, b, got / nb, tool=tool)
                c.buy(b, got / nb - 0.002, tool)
            st["rounds"] += 1
            c.at(c.slot + max(1, gapf()), rnd)
        c.at(c.slot + 1, rnd)

    # ------------------------------------------------------------------ automations
    def _start_automations(self):
        cf, c = self.cfg, self.c
        if cf["sg_enabled"]:
            self._sniper_guard()
        if cf["vb_enabled"]:
            c.at(sec(cf["vb_start_s"]), self._volume_bot)
        for p in ("ab", "as"):
            if cf[p + "_enabled"]:
                c.at(sec(cf[p + "_start_delay_s"]), lambda p=p: self._auto(p))
        if cf["cl_enabled"]:
            c.at(sec(cf["cl_start_s"]), self._cleanup)
        if cf["exit_enabled"]:
            c.at(sec(cf["exit_start_s"]), self._exit)

    def _sniper_guard(self):
        cf, c = self.cfg, self.c
        st = {"sum": 0.0, "on": True}
        end = sec(cf["sg_timed_s"]) if cf["sg_end"] == "timed" else None

        def on(tx):
            if not st["on"] or tx["side"] != "buy" or self.own(tx["signer"]):
                return
            if (end is not None and c.slot > end) or (end is None and self.done_launch_buys):
                st["on"] = False
                return
            st["sum"] += tx["sol"]
            if st["sum"] > cf["sg_threshold"]:
                st["on"] = False
                resp = cf["sg_response"]
                self.note(f"Sniper Guard triggered at {st['sum']:.2f} SOL of outside buys -> {resp}")
                if resp == "complete_early":
                    self.halted = True
                    return
                kinds = {"nuke_all": ("op_dev", "op_front", "op_back", "op_temp", "op_holder"),
                         "nuke_holders": ("op_front", "op_back", "op_temp", "op_holder"),
                         "nuke_dev": ("op_dev",)}[resp]
                if resp != "nuke_dev" or cf["sg_complete_early"]:
                    self.halted = True
                ws = [a for a, role in c.truth.items() if role in kinds and c.tok.get(a, 0) > 1]
                c.at(c.slot + 1, lambda: [c.sell(a, c.tok[a], "sniper_guard") for a in ws])
        self.listeners.append(on)

    def _volume_bot(self):
        cf, c, r = self.cfg, self.c, self.r
        pool = {"front": self.fronts, "back": self.backs, "holders": self.holders, "dedicated": self.dedicated}[cf["vb_wallets"]]
        pool = pool or self.holders or [self.dev]
        target = cf["vb_target"]
        if cf["vb_mode"] == "duration":
            trips = max(4, int(cf["vb_duration_s"] / 10))
            interval = lambda: sec(cf["vb_duration_s"] / trips * r.uniform(0.6, 1.4))
        else:
            trips = None
            interval = lambda: sec(r.uniform(cf["vb_delay_min"], cf["vb_delay_max"]))
        if cf["vb_size_mode"] == "fixed":
            size = lambda: cf["vb_size"]
        elif cf["vb_size_mode"] == "random":
            size = lambda: r.uniform(cf["vb_size_min"], cf["vb_size_max"])
        else:
            size = lambda: target / 2 / (trips or 10) * r.uniform(0.5, 1.5)
        bundle = cf["vb_exec"] == "bundle"
        streak = max(1, round(1 + cf["vb_wave"] * 6))
        st = {"vol": 0.0, "trades": 0, "inv": [], "buying": True, "run": 0, "tips": 0}
        n_bundles = max(1, int(target / 2 / max(0.05, (cf["vb_size_min"] + cf["vb_size_max"]) / 2)))
        end_slot = sec(cf["vb_start_s"] + (cf["vb_duration_s"] if cf["vb_mode"] == "duration" else 3600))
        self.note(f"Volume Bot started: {target:g} SOL target, {cf['vb_mode']} mode, {cf['vb_exec']}")

        def step():
            if st["vol"] >= target or c.slot > end_slot + sec(300) or self.halted:
                for w, tok in st["inv"]:
                    c.sell(w, tok, "volume_bot")
                st["inv"] = []
                self.stats["volume_bot"] = {"volume_sol": round(st["vol"], 2), "trades": st["trades"]}
                return
            w = r.choice(pool)
            if bundle:
                got = c.buy(w, size(), "volume_bot")
                if got:
                    st["vol"] += c.ledger[-1]["sol"]
                    st["vol"] += c.sell(w, got, "volume_bot")
                    st["trades"] += 2
                    c.send(w, self.tip, cf["vb_fee_target"] / n_bundles, tool="jito_tip")
            else:
                if st["buying"] or not st["inv"]:
                    got = c.buy(w, size(), "volume_bot")
                    if got:
                        st["vol"] += c.ledger[-1]["sol"]
                        st["trades"] += 1
                        st["inv"].append((w, got))
                    st["run"] += 1
                    if st["run"] >= max(1, round(streak * r.uniform(0.6, 1.4))):
                        st["buying"], st["run"] = False, 0
                else:
                    w0, tok = st["inv"].pop(0)
                    st["vol"] += c.sell(w0, tok, "volume_bot")
                    st["trades"] += 1
                    if not st["inv"]:
                        st["buying"] = True
            c.at(c.slot + max(1, interval()), step)
        step()

    def _auto_pool(self, p):
        sel = self.cfg[p + "_wallets"]
        if sel == "all":
            return [self.dev, *self.fronts, *self.backs, *self.temps, *self.holders, *self.cleanup_out]
        return {"holders": self.holders + self.cleanup_out, "front": self.fronts, "back": self.backs}[sel] or self.holders

    def _auto(self, p):
        """AutoBuy (p='ab') / AutoSell (p='as'): Counter Trading, DCA, Limit Orders."""
        cf, c, r = self.cfg, self.c, self.r
        side = "buy" if p == "ab" else "sell"
        tool = "autobuy" if side == "buy" else "autosell"
        st = {"amount": 0.0, "acc": 0.0, "on": True, "n": 0}
        end = c.slot + sec(cf[p + "_end_duration_s"]) if cf[p + "_end_duration_s"] > 0 else None
        limits = parse_limits(cf[p + "_limits"])
        self.note(f"{tool} started")

        def in_range():
            m = c.mc()
            lo, hi = cf[p + "_mc_min"], cf[p + "_mc_max"]
            return (lo <= 0 or m >= lo) and (hi <= 0 or m <= hi)

        def alive():
            if not st["on"] or self.halted:
                return False
            if (end is not None and c.slot > end) or (cf[p + "_end_amount"] > 0 and st["amount"] >= cf[p + "_end_amount"]):
                st["on"] = False
                self.stats[tool] = {"trades": st["n"], "amount": round(st["amount"], 3)}
                return False
            return True

        def act(amount):
            """amount: SOL for buys, tokens for sells."""
            pool = self._auto_pool(p)
            if side == "buy":
                ws = [a for a in pool if c.sol[a] > amount + 0.01] or pool
                if c.buy(r.choice(ws), amount, tool):
                    st["amount"] += amount
                    st["n"] += 1
            else:
                ws = [a for a in pool if c.tok[a] > 1]
                if ws:
                    a = r.choice(ws)
                    sold = min(amount, c.tok[a])
                    if c.sell(a, sold, tool):
                        st["amount"] += sold / 1e6
                        st["n"] += 1

        if cf[p + "_counter"]:
            def on(tx):
                if not alive() or self.own(tx["signer"]) or not in_range():
                    return
                if side == "buy" and tx["side"] != "sell":
                    return
                if side == "sell" and tx["side"] != "buy":
                    return
                if tx["sol"] < cf[p + "_min_trigger"] or r.random() > cf[p + "_rate"] / 100:
                    return
                amt = (tx["sol"] if side == "buy" else tx["tok"]) * cf[p + "_replication"] / 100
                st["acc"] += amt
                need = cf[p + "_min_per_trade"] * (1 if side == "buy" else 1e6)
                if st["acc"] >= need:
                    a, st["acc"] = st["acc"], 0.0
                    c.at(c.slot + 1, lambda: alive() and act(a))
            self.listeners.append(on)

        if cf[p + "_dca"]:
            def dca():
                if not alive():
                    return
                if in_range():
                    amt = cf[p + "_dca_amount"] if cf[p + "_dca_mode"] == "fixed" else r.uniform(cf[p + "_dca_min"], cf[p + "_dca_max"])
                    act(amt if side == "buy" else amt * 1e6)
                c.at(c.slot + max(1, sec(cf[p + "_dca_interval_s"])), dca)
            c.at(c.slot + 1, dca)

        if limits:
            def watch(tx):
                if not alive():
                    return
                m = c.mc()
                for row in limits:
                    if row[2]:
                        continue
                    if (side == "buy" and m <= row[0]) or (side == "sell" and m >= row[0]):
                        row[2] = True
                        amt = row[1] if side == "buy" else row[1] * 1e6
                        c.at(c.slot + 1, lambda amt=amt: act(amt))
            self.listeners.append(watch)

    def _cleanup(self):
        cf, r = self.cfg, self.r
        src = {"holders": self.holders, "front": self.fronts, "back": self.backs, "temp": self.temps}[cf["cl_inputs"]]
        src = [a for a in src if self.c.tok[a] > 1]
        if not src:
            self.note("Cleanup: no input wallets hold tokens, skipped")
            return
        outs = [self.c.wallet("op_holder") for _ in range(cf["cl_outputs"])]
        self.cleanup_out += outs
        for a in outs:
            self.c.send(self.relays[0], a, 0.005, tool="cleanup")   # outputs must be funded
        if cf["cl_delay_mode"] == "fixed":
            gap = sec(cf["cl_delay"])
        else:
            lo, hi = sorted((cf["cl_delay_min"], cf["cl_delay_max"]))
            gap = lambda: sec(r.uniform(lo, hi))
        self.note(f"Cleanup ({cf['cl_method']}): {len(src)} sellers -> {len(outs)} new wallets")
        self._move(cf["cl_method"], src, outs, gap, "cleanup" if cf["cl_method"] == "buyback" else "streamflow",
                   double_pct=cf["cl_double_pct"], share=cf["cl_share_pct"] / 100)

    def _exit(self):
        cf, c, r = self.cfg, self.c, self.r
        if cf["exit_wallets"] == "holders":
            ws = self.holders + self.cleanup_out
        else:
            ws = [self.dev, *self.fronts, *self.backs, *self.temps, *self.holders, *self.cleanup_out]
        self.note(f"Manual sells: {len(ws)} wallets exit over {cf['exit_window_s']:g}s")
        for a in ws:
            n = r.randint(1, 3)
            times = sorted(r.uniform(0, cf["exit_window_s"]) for _ in range(n))
            for k, t in enumerate(times):
                last = k == n - 1

                def piece(a=a, last=last, k=k, n=n):
                    want = c.tok[a] * cf["exit_pct"] / 100
                    c.sell(a, want / (n - k) if not last else want, "manual_sell")
                c.at(c.slot + sec(t), piece)
        if cf["exit_withdraw"]:
            def withdraw():
                for a in ws + [self.dev, *self.fronts, *self.backs, *self.relays, *self.dedicated]:
                    if c.sol.get(a, 0) > 0.01:
                        c.send(a, self.funder, c.sol[a] - 0.003, tool="withdraw")
                self.note("Withdraw: SOL swept back to the Funder")
            c.at(c.slot + sec(cf["exit_window_s"] + 60), withdraw)
