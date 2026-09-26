# FortunaTrade — Business Plan & Go-Live Runbook

**Version:** 1.0 · **Date:** 2026-09-26 · **Repo:** https://github.com/VidiBuzz/vidifund
**Author:** automated audit of the codebase as it stands today

---

## 0. Read This First

This document is a complete orientation. You said you hadn't looked at the app
in two months, so Part 1 explains what actually exists, Part 2 explains what
does not, Part 3 is the broker research you asked for, and Part 4 is the plan
to go live.

**One thing must be said plainly, before anything else.**

The application as it stands **cannot safely execute a single live trade**, and
the reason is not a missing feature — it is a defect that has been present since
the original commit and that I documented rather than quietly patched.

`POST /api/trades` in `server.js` writes a row to the `trades` blotter and then
**stops**. It never updates `positions`, never debits `portfolios.cash_balance`,
and never recalculates `total_value`. Meanwhile `POST /api/simulate` mutates
live prices using `Math.random()` and has no guard preventing it from running
against a funded account.

There is also **no authentication anywhere** — every route implicitly serves
`user_id = 'default'`, and `cors()` allows all origins.

These are the reasons the timeline in Part 4 is measured in weeks and not in the
days the plan title suggests. The good news is that all of it is fixable, the
fixes are small, and the analytics engine you now have is genuinely solid — the
Greeks match textbooks to 1e-6. It is specifically the *money-handling path*
that is not ready.

I am not going to tell you the system is nearly ready when it is not. The rest
of this document is the honest version, plus the fastest credible path.

---


## 1. What We Actually Have

### 1.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser — src/ui (vanilla ES2020, no framework)             │
│  9 views · design system · WCAG AA · offline fallback       │
└──────────────────────────┬──────────────────────────────────┘
                           │  REST / JSON
┌──────────────────────────┴──────────────────────────────────┐
│  Express — server.js + src/routes/analytics.js               │
│  19 routes total                                              │
├─────────────────────────────────────────────────────────────┤
│  Analytics engine — src/lib (pure, unit-tested)             │
│  indicators · options · risk · execution                     │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL — 8 tables                                       │
└─────────────────────────────────────────────────────────────┘
```

**Runtime dependencies: 3** (`express`, `pg`, `cors`). That is genuinely lean and
is a real strength worth protecting.

### 1.2 The analytics engine — the part that is finished

This is the asset worth protecting. Every function is pure and was validated
against a reference value, not eyeballed.

| Module | Contents | Evidence |
|---|---|---|
| `indicators.js` | 21 functions: SMA, EMA, Wilder, RSI, stochastic, MACD, Bollinger, ATR, ADX, PSAR, OBV, VWAP, Sharpe, Sortino, max drawdown, VaR, CVaR, correlation, composite score | RSI = **100.0000** on a monotonic uptrend, **0.0000** downtrend; correlation of a series with itself = 1.0 |
| `options.js` | Black-Scholes + dividends, CRR American binomial, Newton-Raphson implied vol, portfolio Greeks, expected move | Call **10.4506** / put **5.5735** — exact textbook. Put-call parity exact. Greeks match finite differences to **~1e-6** |
| `risk.js` | 11 pre-trade rules, Kelly + fixed-fraction sizing, portfolio exposure/concentration/VaR | All 11 circuit breakers verified to fire, including daily-loss and drawdown halts |
| `execution.js` | Order state machine, spread + square-root market-impact cost model, paper broker with partial fills | Account invariant `cash + market value = equity` passes; market impact scales correctly with size |

**Why this matters commercially:** this engine is the part a competitor cannot
copy in an afternoon, and it is the part that would be needed whether you trade
your own money or white-label the platform. It is done.

### 1.3 The interface

10 navigation targets, 9 rendered views: Command Center, Markets, Portfolio,
Orders, Screener, Agent Swarm, Options Lab (live calculator), Risk Engine,
Architecture, Data Sources.

The redesign replaced a 3,256-line monolith that loaded four chart libraries
(~1.2 MB) to draw two charts, used runtime Tailwind compilation, and had a
palette that **failed WCAG AA** on body text. The new build is a 205-rule static
stylesheet, one deferred chart library, and every text role verified ≥4.5:1. The
bull/bear colours are colour-vision-deficiency safe — the classic neon
green/red pair is indistinguishable to roughly 8% of men, which in a trading app
is not acceptable.

---

## 2. What Is Not Ready — Honest Status

### 2.1 Blocking defects

| # | Severity | Defect | Location |
|---|---|---|---|
| B1 | **Critical** | Trade blotter does not reconcile. `POST /api/trades` never updates `positions`, `cash_balance` or `total_value`. The book and the cash disagree permanently. | `server.js` |
| B2 | **Critical** | `POST /api/simulate` mutates prices with `Math.random()` and has **no guard** against a funded account. | `server.js` |
| B3 | **Critical** | No authentication anywhere; every route serves `user_id = 'default'`. `cors()` allows all origins. | all routes |
| B4 | **High** | Orders are never persisted. `PaperBroker` is in-process and volatile — a restart loses the book. | `execution.js` |
| B5 | **High** | No kill switch. There is no way to flatten all positions or halt trading remotely. | — |
| B6 | **High** | `stock_prices` has no index on `(stock_id, timestamp)`, and no `interval` column. Every analytics query is a sequential scan. | schema |
| B7 | **Medium** | SQL injection surface: `interval` is interpolated into a query in the history route. | `server.js` |
| B8 | **Medium** | No rate limiting on any endpoint. | all routes |

### 2.2 Simulated, and labelled as such

Nothing in the interface pretends otherwise. The topbar shows a `Live`/`Offline`
badge, the equity chart is labelled "illustrative", and the sidebar reports
`Engine: Paper`.

| Element | Current state |
|---|---|
| Prices | Seed data; a random-walk simulator |
| Equity curve | Seeded illustrative walk, anchored to real mark-to-market |
| Agent swarm | Static definitions — 20 named agents with no runtime loop |
| Approval queue | UI only, not wired to the order engine |
| Execution | In-process paper broker, never persists |

### 2.3 Readiness verdict

| Area | Ready? |
|---|---|
| Analytics & pricing math | **Yes** — validated, production-quality |

## 3. Broker Research — What Else Can We Use?

Alpaca is a good default but it is genuinely not the only option, and for
options specifically it is arguably the **wrong** default.

### 3.1 The comparison

| Broker | Commission | Options | Rate limit | Paper | MCP server | Idempotent | Asset classes |
|---|---|---|---|---|---|---|---|
| **Alpaca** | $0 (PFOF) | $99/mo tier (Algo Trader Plus); free tier is equities only, IEX feed | 200/min published | Free, full parity | **Official, V2, grade A** | Yes | Stocks, options, crypto, forex |
| **Interactive Brokers** | Tiered, lowest at scale | Yes, full global | Per-contract, published | Free, complete | Community CLI, grade B | Yes | **Stocks, options, futures, forex, bonds, funds, 30+ countries** |
| **Tradier** | $0 (PFOF) | **Core strength** — real-time chains, multileg | Cited inconsistently; verify | Yes | No | **No** | Stocks, options |
| **Public.com** | $0 | Stocks, ETFs, options, index options, bonds, crypto | Published | No sandbox noted | **MCP** | Not stated | Stocks, options, bonds, crypto, prediction markets |
| **tastytrade** | **$1/contract flat** | Core strength | 120/60 per min | Yes (24h) | None | Partial | Options-focused, stocks |
| **Schwab** | Standard retail tiers | Deeper chain than most | OAuth, 7-day refresh | Yes | Varies | Partial | Stocks, options, futures, forex |
| **Robinhood** | $0 | Yes | Undocumented | No | **None** | **No** | Stocks, options, crypto |

### 3.2 What this means for us

**Tradier is the one to look at seriously.** Our entire options engine —
Black-Scholes, Greeks, American binomial — is built and validated. Tradier is
built options-first: real-time chains, streaming quotes, and strong multi-leg
order support (iron condors, OCO, OTO, OTOCO) with **no API fee** for account
holders. Alpaca's options surface is newer and still growing, and options
require the $99/month tier.

The catch: **Tradier has no order idempotency.** Any agent running a retry loop
can submit a duplicate order when it fails to receive confirmation. If the agent
swarm ever gains retry autonomy, that is a real hazard. Mitigation is a client
side de-duplication table keyed on our own `clientOrderId` — which our order
model already generates, so the work is small.

**Public.com is the most interesting new entrant.** Official MCP server, trades
bonds and prediction markets (Polymarket is already in your scope), and no
commissions on stocks and ETFs with options rebates. But it is US-only,
personal/non-commercial API use, and the zerohash crypto custody layer adds a
counterparty you do not control. Worth watching, not worth betting the roadmap on.

**Interactive Brokers is the coverage answer.** Nothing else comes close on
asset classes — futures, forex, bonds, genuine international access. The cost is
a real setup tax: IBKR requires TWS or IB Gateway running locally, the API is
TCP to that gateway process rather than HTTPS to a vendor endpoint, and headless
gateway operation is under-documented. For cloud deployment that is an
operational burden. If you ever need futures or non-US markets, this is where
you go — and the commission advantage becomes real above ~$10k notional.

### 3.3 The recommendation

**Build the broker layer as a real abstraction, not an Alpaca adapter.**

Whichever broker you pick today, you may want to switch when options volume
grows, or add IBKR for futures, or add crypto via CCXT. The `PaperBroker`
interface already written in `src/lib/execution.js` is the right shape.
Implement it for Alpaca first (simplest auth, free paper with live API parity),
and keep Tradier as the options-specialist second.

This costs roughly one extra day of design discipline now and saves a rewrite

---

## 4. Go-Live Plan

### 4.1 A note on the timeline

Your note said **$100,000 in a week**. I want to be straight about why I
believe that timeline is a mistake, because the reasoning is specific rather
than general caution.

Consider what has to be true for it to work. The system must be able to
(a) authenticate, (b) enforce a kill switch, (c) persist and reconcile its book,
(d) have been paper-trading a strategy for a meaningful period, and
(e) survive a restart without losing state. Right now it can do **none** of
those. The analytics engine being excellent does not help — a perfectly computed
position size is worthless if the cash balance is fiction and there is no way to
stop the bleeding at 3am.

There is a second, more practical point. A strategy that has not been
walk-forward validated has no *known* edge. Deploying capital before that work
is done is not "risky but potentially profitable" — it is a coin flip with
commissions. The expected value of waiting one month and *knowing* whether the
strategy has an edge is far higher than finding out faster with real money.

**The fastest credible path to live capital is 4 to 6 weeks, not one.** What
follows is how to compress it.

### 4.2 Phase 0 — Safety (Days 1–3) · *before anything else*

Nothing else matters until these land.

1. **Fix B1.** One transaction: insert the trade, upsert the position, recompute
   average cost, debit cash, recalculate `total_value`. Add a test asserting
   `cash + market_value = equity` after every order type.
2. **Delete or hard-gate B2.** `/api/simulate` must refuse to run unless
   `SIMULATION=true` **and** the account is not live.
3. **Add authentication.** Even a single-user API key in middleware. Remove
   wildcard CORS.
4. **Add a kill switch.** `POST /api/admin/halt` — cancels open orders, sets a
   persistent halt flag every order path checks, optionally flattens.
5. **Add `ALLOW_LIVE_TRADING` guard.** Server refuses to start in live mode
   without it.
6. **Parameterise SQL** (B7) and add rate limiting (B8).

**Gate: do not proceed until all six are merged and tested.**

### 4.3 Phase 1 — Data & Infrastructure (Days 3–8)

Run these in parallel:

- **SEC EDGAR client** → real fundamentals, no key required
- **Alpaca adapter** implementing the `PaperBroker` interface → real quotes
- **Migration framework + index on `stock_prices`** → analytics that scale

**Gate:** real historical data flowing, `EXPLAIN ANALYZE` shows index scans, and
the same paper suite passes against both paper and Alpaca with no strategy changes.

### 4.4 Phase 2 — Paper Trading (Weeks 2–4) · *the phase that decides everything*

This is the phase people skip, and it is the only one that tells you whether
there is anything worth trading.

- Run the paper engine continuously against live market data
- Log every agent proposal with its reasoning and decision

---

## 5. Strategy — What Should Actually Be Traded

The platform is asset-agnostic, but the *first* strategy should not be. Pick the
one where the tooling gives a real edge and the risk is bounded.

### 5.1 Recommendation: start with equities, systematic, risk-first

| Criterion | Why |
|---|---|
| Execution is simple | Market/limit on liquid names; no leg risk |
| Costs are knowable | Spread + impact model already built and verified |
| Data is genuinely free | SEC EDGAR + Stooq + Alpaca EOD |
| Risk is measurable | VaR, CVaR, drawdown, HHI all implemented |
| Failure is survivable | A bad equity position loses a bounded amount |

**Avoid starting with options.** The Greeks engine is ready, but undefined-risk
option selling is where money is actually lost. Build defined-risk only:
covered calls, cash-secured puts, verticals.

**Avoid starting with leverage.** The risk engine enforces 200% gross, but
enforcement is not understanding. Earn the right to lever.

### 5.2 Candidate strategies to validate

1. **Volatility-regime rotation** — the VIX regime engine already exists; scale
   exposure by regime. Fits the existing agent design exactly.
2. **Cross-sectional momentum with risk overlay** — the composite technical score
   ranks the universe; the risk engine sizes and constrains it.
3. **Mean reversion on short-horizon ETFs** — liquid, cheap, low slippage.
4. **Sector rotation** — sector exposure and HHI code already written.

**Not recommended first:** day trading (spread costs dominate at small size),
illiquid small-caps (the impact model becomes fiction), crypto (24/7 breaks the
risk engine's session assumptions).

### 5.3 The agent swarm, honestly assessed

There are 20 named agents in the interface. **None of them run.** They are
static definitions, stated as such in the docs and the UI.

When built, the value is *structured disagreement* — a bull and a bear analyst,
a risk agent with veto, and a quant that disagrees with both. But the same
structure produces confident nonsense if the underlying data is fabricated,
which is exactly today's state. **Build the agents after real data.** An agent
swarm on invented fundamentals is a machine for losing money efficiently.

---

## 6. Economics

### 6.1 Cost to operate

| Item | Monthly | Notes |
|---|---|---|
| Hosting (Railway) | $5–25 | Current deployment |
| Database | $0–25 | Postgres; TimescaleDB on the same instance initially |
| Broker data (Alpaca free) | $0 | IEX only |
| Options data (Tradier/IBKR) | $0–50 | Tradier charges no API fee |
| SEC EDGAR | $0 | No key |
| FRED / CoinGecko | $0 | Free tiers |
| LLM API (if agents run) | $20–200 | The one variable cost that scales |
| **Total** | **$25–300** | Excluding capital |

Unusually cheap to operate. The dominant cost is engineering time, not
infrastructure.

### 6.2 Trading costs at $100k

Using the verified cost model (`η=0.05`, `σ=2%`, 10% volume participation):

| Turnover | Est. round-trip | Annualised at 4x daily turnover |
|---|---|---|
| Low (monthly rebalance) | ~5 bps | **0.6%/yr** |

---

## 7. Key Decisions Needed

| Decision | Recommendation | Blocks |
|---|---|---|
| **Broker** | Alpaca first, Tradier for options | Adapter work |
| **First asset class** | US equities, systematic | Strategy research |
| **First strategy** | Volatility-regime rotation | Phase 2 |
| **Live ramp** | $5k → $25k → $100k | Phase 3 |
| **Agent autonomy** | Human approval on every trade at first | Risk posture |
| **EU access** | Decide early — it constrains broker and data choice | Broker choice |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Blotter defect (B1) reaches live | Was certain | Severe | Phase 0 gate |
| No kill switch when needed | Was certain | Severe | Phase 0 gate |
| Strategy has no real edge | Moderate | Severe | Walk-forward + negative control |
| Costs exceed edge | **High at high turnover** | Severe | Enforce low turnover |
| Broker API outage mid-position | Moderate | Moderate | Reconcile + halt on mismatch |
| Data vendor silently changes schema | Moderate | Moderate | Schema validation at ingest |
| Colour-blind users misread P&L | Certain without fix | Moderate | Already fixed in v2 palette |
| Overconfidence in the agent swarm | Moderate | Severe | Human approval until proven |
| Single-person bus factor | High | High | Document everything as we go |

---

## 9. Document Map

| Document | Contents |
|---|---|
| `BUSINESS_PLAN.md` | **This document** — orientation, broker research, go-live plan |
| `docs/FEATURE-INVENTORY.md` | Every function, table and route, plus known defects |
| `docs/LIBRARY-RESEARCH.md` | Free/open additions and licence traps |
| `docs/AGENTS.md` | Four scoped agent briefs with acceptance criteria |
| `docs/verify-ui.mjs` | Playwright harness — run before any UI change ships |
| `docs/screenshots/` | Visual evidence of all 9 views, desktop and mobile |
| `FORTUNATRADE_COMPLETE_PLAN.md` | The original vision document |

---

## 10. The Short Version

**What is done:** a validated analytics engine (Greeks accurate to 1e-6, 21
indicators, 11 risk rules), a redesigned interface that passes accessibility
checks, and 19 API routes.

**What is not done:** the book does not reconcile, there is no authentication,
no kill switch, and the agents do not run.

**What to do first:** the six Phase 0 safety items. They are small, and they
are the difference between a platform and a liability.

**On the timeline:** four to six weeks to live capital, staged at $5k, then
$25k, then $100k. Not one week. The reason is not caution — it is that the work
which determines whether this makes money has not been done yet, and no amount
of engineering speed substitutes for it.

---

*Prepared from an automated audit of the repository at commit `913e797`.
All figures marked verified were checked against reference values; all
statements about the interface were confirmed in a real browser.*

| Medium (weekly) | ~8 bps | **8%/yr** |
| High (daily) | ~12 bps | **144%/yr — the edge is gone** |

**This is the most important number in this document.** At daily turnover on
$100k, transaction costs consume more than almost any realistic strategy edge.
Any plan that trades intraday needs far more capital, lower-cost execution, or
a much larger edge than is typical.

**Corollary: lower turnover is not timidity, it is arithmetic.** A monthly
rebalance with a modest edge beats a daily rebalance with the same edge.

### 6.3 Productisation (optional, later)

If others ever want this, the natural product is the analytics engine plus the
risk layer as a service — the parts that are finished and expensive to rebuild.
The agent swarm is not a product; it is a research tool.

- **Walk-forward validation** on every strategy before it is considered
- **Negative control:** confirm a deliberately random strategy is reported as
  unprofitable. If the harness calls random profitable, the harness is broken.
- Bootstrap confidence intervals, not point estimates
- Log every fill, slippage figure and rejection

**Gate:** a strategy with positive out-of-sample Sharpe, a confidence interval
on returns that excludes zero, and acceptable drawdown. No exceptions.

### 4.5 Phase 3 — Live Capital (Weeks 4–6)

Ramp deliberately. Do not deploy $100k on day one.

| Stage | Capital | Duration | Purpose |
|---|---|---|---|
| 1 | $5,000 | 1 week | Prove fills, slippage and reconciliation match paper |
| 2 | $25,000 | 2 weeks | Prove risk limits bite under real conditions |
| 3 | $100,000 | ongoing | Scale only if stages 1–2 were clean |

**Operational requirements before stage 1:**
- The broker API is the *only* path to real orders; no UI control bypasses risk
- Every order passes `checkOrder()` server-side, not client-side
- Kill switch tested by actually pulling it
- Alerts on: halt, drawdown breach, reconciliation mismatch, connection loss
- Reconcile broker positions against internal positions on a schedule and
  **halt automatically on mismatch**
- Broker-side price alerts as a second, independent layer

### 4.6 What would make this faster

Honestly: not more engineers. The three things that would compress the timeline
are (a) deciding now between Alpaca and Tradier so the adapter is built once,
(b) running Phase 0 items in parallel across multiple people, and (c) accepting
a smaller stage-1 number so the ramp is shorter.

---

later. It is the same argument that keeps us broker-neutral in backtesting
rather than vendor-locked.

### 3.4 Non-broker data sources worth adding now

| Source | Cost | Use |
|---|---|---|
| **SEC EDGAR** | Free, **no API key** | Authoritative filings and XBRL company facts. Only needs a User-Agent header. |
| **FRED** | Free, key required | Rates, CPI, yield curves. **Attribution required.** |
| **CoinGecko** | Free tier | Crypto spot. Attribution required. |
| **Stooq** | Free, no key | Long EOD history for backtests |
| **Massive/Polygon** | Free tier | 5 calls/min, 2 years EOD — useful for backfills |
| **OCC** | Free public | Option contract specs and symbology |
| **CCXT** | Open source | 100+ crypto exchanges behind one interface |

SEC EDGAR is the standout: free, no key, authoritative, and it closes the
largest data gap in the platform today — all fundamentals are currently invented.

| Interface | **Yes** — verified in a real browser, no console errors |
| Data integrity | **No** — B1, B2, B6 |
| Security | **No** — B3, B7, B8 |
| Live execution | **No** — B4, B5 |
| Agent autonomy | **No** — nothing actually runs |

**Overall: a strong research platform with a tested core, and a money-handling
layer that must be rewritten before it is allowed near real capital.**

---
