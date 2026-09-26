# FortunaTrade — Open-Source & Free-Tier Expansion Research

**Date:** 2026-09-26 · **Purpose:** identify what to add next, prioritised by
(value delivered) ÷ (integration cost), restricted to genuinely free and
permissively licensed options.

The existing plan already covers the heavyweight engines (Lean, NautilusTrader,
Freqtrade, Hummingbot, hftbacktest, Qlib, FinRL, OpenBB). This document focuses
on the **gaps** — what a working system needs that the current list omits.

---

## 1. Gaps in the current stack

| Gap | Why it matters | Recommendation |
|---|---|---|
| No ML-first strategy framework | Plan lists Qlib/FinRL (research-scale). PyBroker is lighter and has walk-forward + Optuna built in | **add PyBroker** |
| No unified broker abstraction with paper→live | Every engine has a different broker API; strategies get rewritten | **add Lumibot** |
| No free option chain data | Greeks are computable but the IV surface is not sourced | **add Massive + Finnhub options** |
| No LLM trading-agent framework | Plan mentions FinGPT (models) but no orchestration layer | **add TradingAgents** |
| No visual no-code platform | Plan assumes a developer builds every strategy | **add OpenAlgo as reference** |

---

## 2. Backtesting & Strategy Frameworks (add)

| Project | Stars | Licence | Why add it | Cost |
|---|---|---|---|---|
| **PyBroker** | 3.5k | MIT | ML-first; Numba/NumPy speed, walk-forward, Optuna tuning, model registry, bootstrap metrics. `backtesting.py` is effectively unmaintained — this is its successor | Low — pip install, no daemon |
| **Lumibot** | 2.1k | GPL-3.0 | 12 brokers; stocks/options/futures/forex/crypto/**prediction markets** (Polymarket already in scope). One API for backtest *and* live; remote parquet cache | Medium — its own backtester, but the broker abstraction is the prize |
| **TradingAgents** | 108k | Apache-2.0 | Multi-agent LLM trading: analyst/researcher/trader/risk debate, bull-vs-bear, decision log. The plan's "20 agent swarm" has no orchestrator; this is one | Medium — needs LLM keys, research-grade not execution-grade |
| **OpenAlgo** | 2.7k | AGPL-3.0 | Full self-hosted platform: broker adapters, risk, strategy marketplace, shadcn/ui admin, MCP server for AI agents. Best reference for admin UX and the agent tool surface | Reference only — AGPL, do not copy code in |

**Still the right core (already in plan):** Lean, NautilusTrader, hftbacktest,
Freqtrade, Hummingbot, vectorbt, backtesting.py, zipline-reloaded.

---

## 3. Data — Free and Open

### 3.1 Equity & fundamentals

| Source | Cost | What it gives | Notes |
|---|---|---|---|
| **SEC EDGAR** | free, **no API key** | 10-K/10-Q/8-K, XBRL company facts, filing history | Authoritative. Needs entity mapping, tag normalisation, restatement handling. Respect fair-access. |
| **Alpaca** | free tier | US equities + options, real-time IEX quotes, **paper trading**, WebSocket | The practical free backbone: market data *and* a broker sandbox in one |
| **Finnhub** | free tier | quotes, profiles, fundamentals, news, economic calendar, insider transactions | ~60 calls/min free |
| **Alpha Vantage** | free tier | OHLCV, indicators, FX, news, earnings | 25 calls/day — fine for backfills, not live |
| **Financial Modeling Prep** | limited dev tier | normalised statements, ratios, profiles | Endpoint access varies by plan |
| **Tiingo** | free tier | EOD/intraday, fundamentals, news, IEX | Generous for a free tier |
| **Twelve Data** | free tier | quotes, time series, indicators, WebSocket | 8 credits/min |
| **Nasdaq Data Link** | free subset | broad dataset catalogue | uneven quality |
| **Yahoo Finance** | unofficial | quotes, history, fundamentals | Endpoints break without notice — never build on it alone |
| **Stooq** | free, no key | long EOD history | Great for long-horizon research, no intraday |

### 3.2 Macro

| Source | Cost | Notes |
|---|---|---|
| **FRED** | free, key required | Rates, CPI, employment, yield curves. **Attribution required** — must state the product uses the FRED API and is not endorsed by the St. Louis Fed |
| **World Bank Indicators** | free, no key | Long-horizon macro |
| **Nasdaq Data Link / CFDB** | free subset | Alternative macro series |


### 3.3 Crypto

| Source | Cost | Notes |
|---|---|---|
| **CoinGecko** | free tier | Spot prices, market caps, history. Attribution required |
| **CCXT** | open source | 100+ exchange REST + WebSocket — the abstraction layer, not a data source |
| **Binance / Kraken public REST** | free | Deep order books; rate-limit and ToS sensitive |

### 3.4 Futures & options

| Source | Cost | Notes |
|---|---|---|
| **Nasdaq Data Link continuous futures** | free subset | Continuous contracts for backtests |
| **CME delayed quotes** | free w/ registration | Delayed but official |
| **OCC** | free public | Option contract specs and symbology |
| **ThetaData** | paid, cheap | The honest answer for real IV surfaces — not free, but cheap |

---

## 4. Libraries to add

| Library | Language | Use | Licence |
|---|---|---|---|
| **quantjs** | JS | Black-Scholes + Greeks client-side; would replace the hand-rolled copy in `app.js` | MIT |
| **simple-statistics** | JS | Descriptive stats, regression, distributions | ISC |
| **d3-scale**, **d3-shape** | JS | Correlation heatmaps, sector treemap | ISC |
| **chroma-js** | JS | Perceptually uniform colour scales — pairs with the CVD-safe palette | Apache-2.0 |
| **decimal.js** | JS | Money arithmetic; removes float drift from cash and P&L | MIT |
| **zod** | JS | Validate every API response at the boundary | MIT |
| **date-fns** | JS | Session/calendar maths | MIT |
| **exchange_calendars** | Python | Real trading calendars (pandas variant too) | Apache-2.0 |
| **arch** | Python | ARCH/EGARCH volatility models for the VIX agent | NCSA |
| **scikit-learn** | Python | Supervised models behind the agent swarm | BSD-3 |
| **optuna** | Python | Hyperparameter search | MIT |
| **riskfolio-lib** | Python | Modern portfolio optimisation (HRP, CVaR) | MIT |
| **empyrical** / **quantstats** | Python | Tear sheets: Sharpe, Sortino, max DD, benchmark | Apache-2.0 / MIT |

---

## 5. Infrastructure that removes real work

| Component | Licence | Why |
|---|---|---|
| **TimescaleDB** | Apache-2.0 | Drop-in Postgres extension; hypertables + continuous aggregates make OHLCV fast. `stock_prices` has no index and will not scale |
| **Redis** | RSALv2/SSPL | Idempotency keys, rate limiting, job queues |
| **BullMQ** | MIT | Job queue on Redis |
| **n8n** | Sustainable Use | Self-hosted workflow automation for agent triggers |
| **Grafana + Prometheus** | AGPL / Apache-2.0 | Dashboards and alerting |
| **OpenTelemetry** | Apache-2.0 | Distributed tracing across the agent swarm |
| **DuckDB** | MIT | Analytical scans over Parquet without a server |

---

## 6. Agent tooling

| Component | Licence | Use |
|---|---|---|
| **MCP servers** | MIT | Standard tool interface so agents reach market data, risk and execution through one contract |
| **LiteLLM** | MIT | One interface across every LLM provider — needed for the multi-model plan |
| **LangGraph** | MIT | Stateful agent graphs with cycles and human-in-the-loop approval |
| **CrewAI** | MIT | Role-based agent teams (analyst / critic / risk) |

---

## 7. Licence traps to avoid

| Trap | Detail |
|---|---|
| **AGPL-3.0** | OpenAlgo, Grafana. Network use triggers source disclosure. Fine to *run* as a separate service, not to vendor into a proprietary product |
| **GPL-3.0** | Lumibot. Same family of obligation — safe as a separately deployed service, awkward to link |
| **Research-only** | QuantConnect Lean (live), Hummingbot, NautilusTrader, Freqtrade (live), FinRL/FinGPT weights, Qlib datasets |
| **TradingView logo** | Lightweight Charts requires attribution unless you buy a licence. The logo in the chart is deliberate — do not strip it |
| **Yahoo Finance** | Unofficial; ToS grey area, endpoints break silently |
| **FRED / CoinGecko** | Free but require attribution text — cheap to comply, must not skip |

---

## 8. Recommended first four additions

Ranked. Each is independently valuable and blocks none of the others.

1. **SEC EDGAR client** — free, no key, authoritative fundamentals. Closes the
   biggest data gap; needs only a User-Agent header. *Low cost, high value.*
2. **Alpaca market-data + paper-trading adapter** — implements the `PaperBroker`
   interface already built, so it drops straight in. Moves the platform from
   simulated to real data without touching strategy code. *Low cost, highest value.*
3. **TimescaleDB migration** — `stock_prices` has no index and no interval column.
   Every analytics route depends on it. *Medium cost, unblocks scale.*
4. **PyBroker research harness** — walk-forward validation and Optuna tuning in
   Python, feeding validated parameters back to the JS engine. *Medium cost,
   prevents strategy overfitting.*

Matching agent briefs are in `docs/AGENTS/`.
