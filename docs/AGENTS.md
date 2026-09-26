# FortunaTrade — Agent Workstream

Four agents, ordered by dependency. Each brief is self-contained: goal, scope,
definition of done, and the verification an agent must run before declaring
itself finished.

Shared rules for every agent:

1. Read `docs/FEATURE-INVENTORY.md` first — it describes the current state exactly.
2. Never remove or weaken a risk limit to make a test pass.
3. Any new dependency must be listed with its licence in the PR description.
4. Every new numeric function needs a test against a hand-computed or textbook value.
5. Do not commit secrets. Use `.env` and reference it in `.gitignore`.
6. Add or update `docs/verify-ui.mjs` if UI is touched; run it before finishing.

Dependency graph:

```
sec-edgar ──────────────┐
                        ├──> alpaca-adapter ──> pybroker-research
timescale-migration ────┘
```

Agents 1, 2 and 3 can run in parallel. Agent 4 starts once 2 and 3 land.

---

## Agent 1 — `sec-edgar` (no dependencies — start here)

**Goal:** a fundamentals provider backed by SEC EDGAR — free, no API key, authoritative.

**Why:** the platform currently invents its fundamentals. EDGAR closes that gap.

**Deliverables**
- `src/providers/secEdgar.js`
  - `companyFacts(cikOrTicker)` → normalised income/balance/cash-flow from XBRL `companyfacts`
  - `filings(cikOrTicker, {form, from, to})` → filing index
  - `companyTickers()` → ticker → CIK map, cached to disk with a TTL
  - User-Agent header is **mandatory** (`Company Name admin@domain`); SEC throttles anonymous clients
- `src/providers/index.js` — provider registry so data sources are swappable
- `GET /api/fundamentals/:symbol` route
- Disk cache in `.cache/edgar/` (gitignored), 24h TTL, respects SEC 10 req/s

**Definition of done**
- `companyFacts('AAPL')` returns revenue, net income, assets, equity, EPS by fiscal year
- Handles the CIK path-padding trap: `AAPL` → `0000320193`, not `320193`

---

## Agent 2 — `alpaca-adapter`

**Goal:** replace simulated prices with real market data, and give the paper
broker a real-broker sibling.

**Why:** the largest single upgrade available. `src/lib/execution.js` already
defines the seam, so no strategy code changes.

**Deliverables**
- `src/providers/alpaca.js`
  - REST: latest quote, historical bars, trades, snapshots
  - WebSocket (IEX feed, free tier) for streaming quotes into `/api/market`
  - Rate limiter honouring 200 req/min
- `src/brokers/alpacaPaper.js` implementing the `PaperBroker` interface exactly:
  `submit`, `tryFill`, `cancel`, `account`
- Broker selection by env var: `TRADING_BROKER=paper|alpaca`
- Reconnection with exponential backoff; dead-letter on sustained failure

**Definition of done**
- Switching `TRADING_BROKER=alpaca` changes quotes from seed data to live IEX
  **with no strategy or UI code change**
- The existing paper-trading test suite passes against both brokers — the interface
  is genuinely swappable, not paper with a live veneer
- WebSocket drop/reconnect does not crash the process or leak listeners
- Rate limiter provably caps at 200 req/min under a burst test
- A `TRADING_MODE=live` guard exists and **refuses to start** unless
  `ALLOW_LIVE_TRADING=true` is set

**Watch out:** Alpaca's free tier is IEX-only, so quotes are partial-market and
must be labelled as such in the UI. Never let the system present IEX-only data
as consolidated.

---

## Agent 3 — `timescale-migration` (runs parallel to 1 and 2)

**Goal:** make the OHLCV store actually queryable.

**Why:** `stock_prices` has no index and no interval column. Every analytics
route is bottlenecked on it.

**Deliverables**
- Migration framework: numbered SQL files in `db/migrations/`, applied in order,
  recorded in a `schema_migrations` table. Replaces `CREATE TABLE IF NOT EXISTS`
- Index `(stock_id, timestamp DESC)`
- `interval` column (`1m`, `1h`, `1d`) plus a composite index
- TimescaleDB hypertable on `stock_prices`, 7-day chunks, behind a feature flag
  so plain Postgres still works (`DB_TSDB=1`)
- Continuous aggregates for 1-minute and 1-hour OHLCV
- Backfill script from existing data

**Definition of done**
- `EXPLAIN ANALYZE` on a 90-day, 10-symbol history query shows an index scan,
  not a sequential scan
- Migration runs cleanly on an empty database **and** on the current one
- Migrations are re-runnable; a partially applied run rolls back
- Works with TimescaleDB enabled and disabled

**Watch out:** the existing `positions.current_value` and `unrealized_pnl` are
stored *and* derivable — they will drift. Either delete them and compute on read,
or add a trigger. Pick one and write down which.

---

## Agent 4 — `pybroker-research` (after 2 and 3)

**Goal:** a walk-forward research harness so strategies are validated before they
touch the paper engine.

**Why:** the single largest source of lost money in a system like this is
overfitting. Walk-forward validation is the cheapest defence.

**Deliverables**
- `research/` — separate Python project, own `requirements.txt` (PyBroker, pandas,
  optuna, scikit-learn, empyrical)
- A Python port of the JS `technicalScore` signal so both engines agree
- Walk-forward harness: rolling train window → validation → out-of-sample test
- Bootstrap confidence intervals on the equity curve (not just point estimates)
- Optuna parameter search with a hard trial budget
- Emits `research/results/<strategy>.json`, consumed by the JS engine
- `GET /api/backtest/:strategy` surfacing results in the UI

**Definition of done**
- Reports out-of-sample Sharpe, Sortino, max drawdown, Calmar, hit rate and
  turnover — with bootstrap confidence intervals
- Contains a **negative control**: a deliberately random strategy that the
  harness must report as non-profitable. If the harness calls random money
  profitable, the harness is broken — that is a failure, not a pass
- A strategy that looked good in-sample and bad out-of-sample is reported as such
- Parameter search cannot silently optimise on the test set

**Watch out:** the biggest risk is a harness that always says "profitable". The
negative control is the acceptance test. Do not remove it.

- Ticker→CIK resolution is cached; a cold start fetches the mapping once
- Handles a ticker that does not exist (404, not a stack trace)
- Unit test comparing two known FY figures against EDGAR's own rendered statement

**Watch out:** XBRL tags are inconsistent across filers and restated over time.
Do not silently pick the first tag — prefer the most recently filed, and expose
the `as-filed` date so callers can reason about restatements.
