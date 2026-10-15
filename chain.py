"""Offline market model: pump.fun bonding curve -> PumpSwap, slot clock, balances, public ledger.

Parameters from pump.fun's public docs (Research/proxima/pumpfun-params.md). Pure simulation:
no keys, no RPC, nothing leaves this process. `truth` (roles) is hidden from analysis that
claims to be ledger-only; `tool` on each trade is the sandbox label of what produced it.
"""
import random

SLOT_S = 0.4
SUPPLY = 1_000_000_000.0
V_SOL0, V_TOK0 = 30.0, 1_073_000_000.0
REAL_TOK0 = 793_100_000.0
MIGRATION_FEE = 0.015
CURVE_FEES = (0.0030, 0.0095, 0.0)           # creator, protocol, LP
# PumpSwap canonical-pool tiers: (upper MC bound in SOL, creator, protocol, LP)
SWAP_TIERS = [(420, .0030, .0093, .0002), (1470, .0095, .0005, .0020), (2460, .0090, .0005, .0020),
              (3440, .0085, .0005, .0020), (4420, .0080, .0005, .0020), (9820, .0075, .0005, .0020),
              (14740, .0070, .0005, .0020), (19650, .0065, .0005, .0020), (24560, .0060, .0005, .0020),
              (29470, .0055, .0005, .0020), (34380, .0050, .0005, .0020), (39300, .0045, .0005, .0020),
              (44210, .0040, .0005, .0020), (49120, .0035, .0005, .0020), (54030, .0030, .0005, .0020),
              (58940, .00275, .0005, .0020), (63860, .0025, .0005, .0020), (68770, .00225, .0005, .0020),
              (73681, .0020, .0005, .0020), (78590, .00175, .0005, .0020), (83500, .0015, .0005, .0020),
              (88400, .00125, .0005, .0020), (93330, .0010, .0005, .0020), (98240, .00075, .0005, .0020),
              (float("inf"), .0005, .0005, .0020)]
GAS = 0.000005 + 0.0001                       # base fee + small priority fee per tx
KEEP = 0.003                                  # SOL a wallet keeps back for fees/rent
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
MINT = "TOKEN"


def sec(s):
    return int(round(float(s) / SLOT_S))


class Chain:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.vs, self.vt, self.real_sol, self.real_tok = V_SOL0, V_TOK0, 0.0, REAL_TOK0
        self.complete = False
        self.pool = None                      # [sol_reserve, token_reserve] after migration
        self.migrated_slot = None
        self.creator_fees = 0.0
        self.sol, self.tok = {}, {}
        self.truth, self.cex, self.cex_name = {}, set(), {}
        self.ledger, self.events, self.hooks = [], {}, []
        self.slot = self.idx = 0
        self.running = False
        self.mc_path = []

    # ---------- accounts / clock ----------
    def wallet(self, role, sol=0.0):
        a = "".join(self.rng.choices(B58, k=8))
        while a in self.truth:
            a = "".join(self.rng.choices(B58, k=8))
        self.truth[a], self.sol[a], self.tok[a] = role, sol, 0.0
        return a

    def exchange(self, name):
        a = self.wallet("cex", sol=1e12)
        self.cex.add(a)
        self.cex_name[a] = name
        return a

    def at(self, slot, fn):
        """Schedule fn; during the live run anything due now or earlier lands in the next slot."""
        slot = int(slot)
        if self.running and slot <= self.slot:
            slot = self.slot + 1
        self.events.setdefault(slot, []).append(fn)

    def log(self, **kw):
        kw.update(slot=self.slot, idx=self.idx)
        self.idx += 1
        self.ledger.append(kw)
        return kw

    def run(self, end_slot, per_slot=()):
        for s in sorted(k for k in self.events if k < 0):
            self.slot, self.idx = s, 0
            for fn in self.events.pop(s):
                fn()
        self.running = True
        for s in range(0, end_slot):
            self.slot, self.idx = s, 0
            if self.complete and self.pool is None:
                self._migrate()
            for fn in self.events.pop(s, []):
                fn()
            for f in per_slot:
                f(s)

    # ---------- market ----------
    def mc(self):
        if self.pool:
            return self.pool[0] / self.pool[1] * SUPPLY
        return self.vs / self.vt * SUPPLY

    def price(self):
        return self.mc() / SUPPLY

    def fees(self):
        if not self.pool:
            return CURVE_FEES
        m = self.mc()
        return next(t[1:] for t in SWAP_TIERS if m < t[0])

    def _migrate(self):
        self.pool = [self.real_sol - MIGRATION_FEE, SUPPLY - REAL_TOK0]
        self.migrated_slot = self.slot
        self.log(kind="migrate", sol=self.pool[0], tok=self.pool[1])

    def tradable(self):
        return not (self.complete and self.pool is None)

    def sol_for(self, tokens):
        """SOL to send now to receive `tokens` (fees included)."""
        fee = sum(self.fees())
        if self.pool:
            X, Y = self.pool
            tokens = min(tokens, Y * 0.95)
            return X * tokens / (Y - tokens) / (1 - fee)
        tokens = min(tokens, self.real_tok)
        return (self.vs * self.vt / (self.vt - tokens) - self.vs) / (1 - fee)

    def send(self, frm, to, amt, tool="transfer"):
        amt = min(amt, self.sol[frm] - GAS)
        if amt <= 0:
            return 0.0
        self.sol[frm] -= amt + GAS
        self.sol[to] = self.sol.get(to, 0.0) + amt
        self.log(kind="sol", frm=frm, to=to, sol=amt, tool=tool)
        return amt

    def send_tok(self, frm, to, tokens, tool="transfer", kind="tokx"):
        tokens = min(tokens, self.tok[frm])
        if tokens <= 0:
            return 0.0
        self.tok[frm] -= tokens
        self.tok[to] = self.tok.get(to, 0.0) + tokens
        self.sol[frm] -= GAS
        self.log(kind=kind, frm=frm, to=to, tok=tokens, tool=tool)
        return tokens

    def pad(self, w, sol_amt, tool="generate_activity"):
        """A buy+sell loop on some other token: real cost, no effect on this market."""
        for side in ("buy", "sell"):
            self.log(kind="swap", mint="OTHER", signer=w, side=side, sol=sol_amt, tok=0.0, tool=tool)
        self.sol[w] -= 2 * GAS + sol_amt * 0.025

    def buy(self, w, sol_in, tool):
        if not self.tradable():
            return 0.0
        sol_in = min(sol_in, self.sol[w] - KEEP)
        if sol_in <= 0.0005:
            return 0.0
        cf, pf, lf = self.fees()
        net = sol_in * (1 - cf - pf - lf)
        if self.pool:
            X, Y = self.pool
            out = Y * net / (X + net)
            self.pool = [X + sol_in * (1 - cf - pf), Y - out]
        else:
            out = self.vt - self.vs * self.vt / (self.vs + net)
            if out >= self.real_tok:
                out = self.real_tok
                net = self.vs * self.vt / (self.vt - out) - self.vs
                sol_in = net / (1 - cf - pf - lf)
                self.complete = True
            self.vs += net
            self.vt -= out
            self.real_sol += net
            self.real_tok -= out
        self.creator_fees += sol_in * cf
        self.sol[w] -= sol_in + GAS
        self.tok[w] += out
        tx = self.log(kind="swap", mint=MINT, signer=w, side="buy", sol=sol_in, tok=out, mc=self.mc(), tool=tool)
        self.mc_path.append((self.slot, self.mc()))
        for h in list(self.hooks):
            h(tx)
        return out

    def sell(self, w, tokens, tool):
        if not self.tradable():
            return 0.0
        tokens = min(tokens, self.tok[w])
        if tokens <= 1:
            return 0.0
        cf, pf, lf = self.fees()
        if self.pool:
            X, Y = self.pool
            gross = X * tokens / (Y + tokens)
            self.pool = [X - gross * (1 - lf), Y + tokens]
        else:
            gross = self.vs - self.vs * self.vt / (self.vt + tokens)
            self.vs -= gross
            self.vt += tokens
            self.real_sol -= gross
            self.real_tok += tokens
        out = gross * (1 - cf - pf - lf)
        self.creator_fees += gross * cf
        self.tok[w] -= tokens
        self.sol[w] += out - GAS
        tx = self.log(kind="swap", mint=MINT, signer=w, side="sell", sol=out, tok=tokens, mc=self.mc(), tool=tool)
        self.mc_path.append((self.slot, self.mc()))
        for h in list(self.hooks):
            h(tx)
        return out
