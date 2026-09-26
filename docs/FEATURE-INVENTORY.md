# FortunaTrade — Feature & Function Inventory

**Date:** 2026-09-26 · **Scope:** everything that exists in the repository today, plus
what was added in the v2 rebuild. This is the reference the redesign and the
agent workstream are built against.

---

## 1. System Map

```
server.js                 Express API, 8 Postgres tables, 13 original + 6 new routes
src/lib/indicators.js     21 pure technical + risk analytics functions
src/lib/options.js        Black-Scholes, CRR binomial, implied vol, portfolio Greeks
src/lib/risk.js           Pre-trade checks, position sizing, portfolio risk
src/lib/execution.js      Order state machine, cost model, paper broker
src/routes/analytics.js   6 REST routes backed by src/lib
src/ui/theme.css          Design system — 205 rules, WCAG AA verified
src/ui/app.js             Vanilla ES2020 app, 9 views, no framework
src/ui/index.html         Interface shell
docs/verify-ui.mjs        Playwright visual + interaction regression harness
```

**Dependency footprint:** express, pg, cors, nodemon (dev), playwright (dev).
No CDN at runtime except Google Fonts and one deferred chart library.

---

## 2. Backend — Database Schema

Eight tables, created idempotently at boot by `initDB()`:

| Table | Purpose | Key columns |
|---|---|---|
| `stocks` | Instrument master | symbol (unique), name, sector, industry, price, change_percent, volume, market_cap, pe_ratio, dividend_yield, 52w high/low, logo_url |
| `stock_prices` | OHLCV history | stock_id → stocks, price, open, high, low, volume, timestamp |
| `portfolios` | Account | name, user_id, total_value, cash_balance |
| `positions` | Holdings | portfolio_id, stock_id, shares, avg_cost, current_value, unrealized_pnl |
| `trades` | Blotter | portfolio_id, stock_id, action (BUY/SELL check), shares, price, total, notes, executed_at |
| `watchlists` | Named lists | name, user_id |
| `watchlist_items` | Membership | watchlist_id, stock_id, unique(watchlist_id, stock_id) |
| `market_indicators` | Macro + equity curve | name, value, timestamp |

**Known schema gaps** (fix in the data-engine agent's scope):
- `stock_prices` has no index on `(stock_id, timestamp)` — every history read is a seq scan.
- No OHLCV `interval` column, so intraday and daily bars cannot coexist.
- `positions.current_value` and `unrealized_pnl` are stored *and* derivable — they
  will drift. They should be computed on read.
- No audit table; order state changes are not persisted anywhere.

---

## 3. Backend — API Surface

### 3.1 Pre-existing routes

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness probe used by Railway |
| GET | `/api/stocks` | list with `limit` / `search` / `sector` filters |
| GET | `/api/stocks/:symbol` | single instrument |
| GET | `/api/stocks/:symbol/history` | OHLCV rows, `limit` param |
| GET | `/api/market` | macro indicators incl. VIX |
| GET | `/api/portfolio` | portfolio + positions join |
| GET | `/api/sectors` | sector aggregation |
| GET | `/api/watchlist` | default user's watchlist |
| POST | `/api/watchlist` | add symbol |
| DELETE | `/api/watchlist/:symbol` | remove symbol |
| GET | `/api/trades` | blotter, newest first |
| POST | `/api/trades` | record a trade |
| POST | `/api/simulate` | **random-walk price simulator — demo only** |
| GET | `/v1` | legacy v1 monolith UI (kept for comparison) |

### 3.2 New analytics routes (`src/routes/analytics.js`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stocks/:symbol/indicators` | SMA/EMA/RSI/MACD/Bollinger/ATR/ADX/PSAR/OBV/VWAP + composite score |
| GET | `/api/options/price` | Black-Scholes price + full Greeks + American binomial + expected move |
| POST | `/api/risk/size` | fixed-fraction and Kelly position sizing |
| POST | `/api/risk/check` | pre-trade limit check, returns violations |
| GET | `/api/risk/report` | exposure, sector, HHI, VaR/CVaR/drawdown |

---

## 4. `src/lib/indicators.js` — 21 verified functions

Every function is pure and was validated against known reference values.

| Group | Functions | Validation |
|---|---|---|
| Moving averages | `sma`, `ema`, `wilderSmooth` | SMA of a flat series returns the constant exactly |
| Oscillators | `rsi`, `stochastic`, `macd` | RSI = 100.0000 on a monotonic uptrend, 0.0000 on a downtrend |
| Volatility | `bollinger`, `atr`, `historicalVolatility` | band ordering upper ≥ mid ≥ lower |
| Trend | `adx`, `psar` | flips side on trend reversal |
| Volume | `obv`, `vwap` | monotone accumulation |
| Risk analytics | `sharpe`, `sortino`, `maxDrawdown`, `valueAtRisk`, `conditionalVaR`, `correlationMatrix` | `correlationMatrix({A:r,B:r})` = 1.0 |
| Composite | `technicalScore` (−100…+100) | weights trend, momentum, stochastic, MACD, volatility penalty |
| Utility | `returnsFromPrices` | — |

---

## 5. `src/lib/options.js` — pricing and Greeks

| Function | Purpose | Verified against |
|---|---|---|
| `blackScholes` | European price + Δ Γ Θ V ρ, dividend yield | **10.4506 call / 5.5735 put** — exact textbook match |
| put-call parity check | `C − P = S − K·e^(−rT)` | 4.8771 — exact |
| `binomialAmerican` | CRR lattice, early exercise | American put 6.0888 ≥ European 5.5735 (premium 0.5153) |
| `impliedVol` | Newton-Raphson with bisection fallback | recovers 0.200000 from a 0.20 price |
| `greeks` | one-call convenience wrapper | Δ 0.6368, Γ 0.018762, V 0.3752, ρ 0.5323, Θ −0.0176 |
| `portfolioGreeks` | aggregates signed positions ×100 | — |
| `expectedMove` | 1σ range over horizon | S=100, σ=25%, 1m → 97.11–102.89 |

Analytic Greeks were cross-checked against central finite differences and agree
to ~1e-6 (delta, vega, theta).

**Convention notes:** theta is per calendar day (÷365); vega and rho are per
1 percentage point (÷100); contract multiplier defaults to 100.

---

## 6. `src/lib/risk.js` — limits and sizing

**Default limits** (`DEFAULT_LIMITS`): 10% single name, 30% sector, 200% gross,
3% daily-loss halt, 10% drawdown halt, 25 open positions, 1% risk per trade,
0.35 HHI ceiling, quarter-Kelly, warn at 75% of any limit.

| Function | Purpose |
|---|---|
| `kellySize(winRate, winLossRatio, fraction)` | Kelly fraction; returns 0 on a negative edge |
| `sizeByRisk(equity, riskPct, entry, stop, maxPosPct)` | shares = risk budget ÷ per-share risk, capped by position limit |
| `portfolioRisk(positions, equity, priceHistory)` | gross/net exposure, leverage, sector %, HHI, VaR95, CVaR95, max drawdown, correlation |
| `checkOrder(order, limits)` | returns `{allowed, severity, violations[]}` |
| `screenSignals(universe, limit)` | ranks by \|technical score\| into trade ideas |
| `setEquityHistory(curve)` | injects the equity curve so VaR/CVaR/drawdown become computable |

**Enforced rules** (each verified to fire): QUANTITY, PRICE, BUYING_POWER,
POSITION (no naked short), MAX_POSITION, MAX_POSITION_WARN, MAX_SECTOR,
MAX_GROSS, MAX_POSITIONS, DAILY_LOSS_HALT, DRAWDOWN_HALT.

---

## 7. `src/lib/execution.js` — order lifecycle

**States:** `PENDING_RISK → APPROVED → WORKING → PARTIALLY_FILLED → FILLED`,
with `REJECTED` and `CANCELLED` as terminal exits. Terminal states reject

---

## 8. Frontend — v2 interface

**10 navigation targets, 9 rendered views:**

| View | Contents |
|---|---|
| Command Center | 4 stat tiles, equity chart, risk meters, approval queue, positions table, agent preview, top movers |
| Markets | full instrument table: sector, last, change, volume, market cap, P/E |
| Portfolio | sector allocation meters + account summary |
| Orders | order blotter with fill status |
| Screener | ranked by technical score with signal badges |
| Agent Swarm | all 20 agents with role, status, latency |
| Options Lab | **live** Black-Scholes calculator, call and put Greeks, 1σ expected move |
| Risk Engine | metric table + limit utilisation |
| Architecture | layer-by-layer system description |
| Data Sources | free/open providers and what each is used for |

**Design system** (`theme.css`, 205 rules): layered dark surfaces, 4px spacing
scale, Inter + JetBrains Mono. Every text colour verified ≥4.5:1 WCAG AA on both
`--bg-surface` and `--bg-sunken`. Bull/bear colours chosen to stay distinguishable
under deuteranopia and protanopia rather than the usual neon pair.

**Behaviour:** single state store, all panels re-render from it; API failures
degrade to a labelled offline snapshot instead of a blank screen; every
interpolated value passes through `esc()`; `prefers-reduced-motion` respected;
mobile off-canvas navigation; print stylesheet.

**Charts:** one library (Lightweight Charts, deferred). v1 shipped four
libraries (~1.2 MB) to draw two charts.

---

## 9. What is still simulated

Stated plainly, because it matters:

| Item | State |
|---|---|
| Prices | Snapshot seed data; `POST /api/simulate` is a random walk |
| Equity curve | Seeded illustrative walk, labelled "illustrative" in the UI |
| Agent status | Static definitions, no runtime loop |
| Approvals | UI-only queue, not wired to the order engine |
| Execution | Paper broker in-process; never persists orders |

Nothing in the interface presents simulated data as live: the topbar shows a
`Live` / `Offline` badge, the equity chart is labelled illustrative, and the
sidebar reports `Engine: Paper`.

---

## 10. Verification Evidence

| Check | Result |
|---|---|
| `node --check` on all JS | pass |
| Black-Scholes vs textbook | exact |
| Put-call parity | exact |
| Greeks vs finite difference | agree to ~1e-6 |
| RSI on monotonic trend | 100.0000 / 0.0000 |
| Account invariant after fills | pass |
| All 11 risk circuit breakers | fire correctly |
| CSS rules parsed by the browser | 205 / 205 |
| WCAG AA contrast on all text roles | pass |
| All 9 views render | pass |
| Options calculator recalculation | pass |
| Mobile nav off-canvas → open | pass |
| Console / page errors | none (500s are the absent local Postgres) |

further fills and cancellations.

**Order types:** `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`. Sides: `BUY`, `SELL`,
`SELL_SHORT`, `BUY_TO_COVER`.

**Cost model** — half the quoted spread plus square-root market impact:

```
impact_pct = η · σ · √(Q / ADV)        η = 0.05, σ = 2% daily, capped at 2%
totalCost  = spread·(0.5 + urgency) + impact·urgency + commission
```

Verified size dependence at ADV = 1M shares: 10 sh → 0.0003% impact;
100,000 sh → 0.0316%.

**`PaperBroker`** — deterministic matcher. Limit orders fill only when
marketable; stop orders only when triggered; fills respect a 10% bar-volume
participation cap; weighted-average fill price is maintained across partials;
account invariant `cash + position market value = equity` verified to pass.

The class is the seam for a real broker: implement `submit` / `tryFill` /
`cancel` / `account` against Alpaca, IBKR or CCXT and no strategy code changes.

| GET | `/api/system/health` | dependency health + engine mode |

### 3.3 Known backend defects

| Severity | Issue | Where |
|---|---|---|
| **High** | `POST /api/trades` writes to the blotter but never updates `positions`, `portfolios.cash_balance`, or `total_value` — the book does not reconcile | `server.js` |
| **High** | `POST /api/simulate` mutates live prices with `Math.random()`; if ever called against a real account it corrupts marks | `server.js` |
| **Medium** | No authentication; every route implicitly serves `user_id = 'default'` | all |
| **Medium** | `GET /api/stocks/:symbol/history` interpolates `interval` into SQL | `server.js` |
| **Medium** | Schema is created with `CREATE TABLE IF NOT EXISTS` only — no migration path once columns change | `initDB()` |
| **Low** | `cors()` allows all origins | `server.js` |
