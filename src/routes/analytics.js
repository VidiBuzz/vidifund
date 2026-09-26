const indicators = require('../lib/indicators');
const optionsLib = require('../lib/options');
const riskLib = require('../lib/risk');

/**
 * Analytics routes backed by the pure libraries in src/lib.
 * @param {import('express').Express} app
 * @param {import('pg').Pool} pool
 */
function registerAnalyticsRoutes(app, pool) {

  // Technical indicators for a symbol over its stored history
  app.get('/api/stocks/:symbol/indicators', async (req, res) => {
    try {
      const stock = await pool.query('SELECT id FROM stocks WHERE symbol = $1', [req.params.symbol.toUpperCase()]);
      if (stock.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });

      const history = await pool.query(
        `SELECT close, high, low, volume FROM stock_prices
         WHERE stock_id = $1 ORDER BY timestamp ASC`,
        [stock.rows[0].id]
      );
      if (history.rows.length < 30) {
        return res.json({
          symbol: req.params.symbol.toUpperCase(),
          points: history.rows.length,
          insufficient: true,
          note: 'Need at least 30 data points to compute indicators. Accumulate history via a quote feed.',
        });
      }

      const closes = history.rows.map(r => parseFloat(r.close));
      const highs = history.rows.map(r => parseFloat(r.high));
      const lows = history.rows.map(r => parseFloat(r.low));
      const volumes = history.rows.map(r => parseFloat(r.volume));
      const last = a => (a && a.length ? a[a.length - 1] : null);

      res.json({
        symbol: req.params.symbol.toUpperCase(),
        points: history.rows.length,
        price: closes[closes.length - 1],
        sma20: last(indicators.sma(closes, 20)),
        sma50: last(indicators.sma(closes, 50)),
        ema21: last(indicators.ema(closes, 21)),
        rsi14: last(indicators.rsi(closes, 14)),
        macd: indicators.macd(closes),
        bollinger: indicators.bollinger(closes),
        atr14: last(indicators.atr(highs, lows, closes, 14)),
        adx14: last(indicators.adx(highs, lows, closes, 14)),
        psar: last(indicators.psar(highs, lows)),
        obv: last(indicators.obv(closes, volumes)),
        vwap: last(indicators.vwap(highs, lows, closes, volumes)),
        historicalVolatility: indicators.historicalVolatility(closes, 20),
        technicalScore: indicators.technicalScore(closes, highs, lows, volumes),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Option pricing + Greeks
  app.get('/api/options/price', (req, res) => {
    try {
      const S = parseFloat(req.query.spot);
      const K = parseFloat(req.query.strike);
      const T = parseFloat(req.query.days) / 365;
      const r = parseFloat(req.query.rate ?? 0.05);
      const vol = parseFloat(req.query.vol ?? 0.25);
      const q = parseFloat(req.query.dividend ?? 0);
      const type = req.query.type === 'put' ? 'put' : 'call';

      if (![S, K, T, vol].every(Number.isFinite) || S <= 0 || K <= 0 || T <= 0 || vol <= 0) {
        return res.status(400).json({ error: 'spot, strike, days and vol must be positive numbers' });
      }
      const bs = optionsLib.blackScholes(S, K, T, r, vol, type, q);
      res.json({
        type, spot: S, strike: K, days: Math.round(T * 365), rate: r, vol, dividend: q,
        price: bs.price, delta: bs.delta, gamma: bs.gamma,
        theta: bs.theta, vega: bs.vega, rho: bs.rho,
        americanPrice: optionsLib.binomialAmerican(S, K, T, r, vol, type, q, 300),
        expectedMove: optionsLib.expectedMove(S, vol, T),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Position sizing (fixed-fraction + Kelly)
  app.post('/api/risk/size', (req, res) => {
    try {
      const E = parseFloat(req.body.equity);
      const entry = parseFloat(req.body.entry);
      const stop = parseFloat(req.body.stop);
      const riskPct = parseFloat(req.body.riskPct ?? riskLib.DEFAULT_LIMITS.maxRiskPerTradePct);
      if (![E, entry, stop].every(Number.isFinite) || E <= 0) {
        return res.status(400).json({ error: 'equity, entry and stop are required' });
      }
      const winRate = parseFloat(req.body.winRate);
      const winLoss = parseFloat(req.body.winLossRatio);
      const hasKelly = Number.isFinite(winRate) && Number.isFinite(winLoss);
      res.json({
        fixedFraction: riskLib.sizeByRisk(E, riskPct, entry, stop),
        kelly: hasKelly ? riskLib.kellySize(winRate, winLoss, riskLib.DEFAULT_LIMITS.kellyFraction) : null,
        kellyFull: hasKelly ? riskLib.kellySize(winRate, winLoss, 1) : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pre-trade risk check
  app.post('/api/risk/check', (req, res) => {
    try {
      const { side, symbol, quantity, price, portfolio } = req.body;
      if (![quantity, price].every(Number.isFinite) || quantity <= 0 || price <= 0) {
        return res.status(400).json({ error: 'quantity and price must be positive' });
      }
      res.json(riskLib.checkOrder({
        side: side === 'SELL' ? 'SELL' : 'BUY',
        symbol: String(symbol || '').toUpperCase(),
        quantity, price, portfolio: portfolio || {},
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Portfolio risk report (exposure, concentration, VaR when history exists)
  app.get('/api/risk/report', async (req, res) => {
    try {
      const portfolio = await pool.query('SELECT * FROM portfolios WHERE user_id = $1 LIMIT 1', ['default']);
      if (portfolio.rows.length === 0) return res.status(404).json({ error: 'Portfolio not found' });
      const p = portfolio.rows[0];

      const positions = await pool.query(
        `SELECT po.shares, po.avg_cost, s.price, s.symbol, s.sector
         FROM positions po JOIN stocks s ON po.stock_id = s.id
         WHERE po.portfolio_id = $1`,
        [p.id]
      );

      const equity = parseFloat(p.total_value) || 0;
      const mapped = positions.rows.map(r => {
        const shares = parseFloat(r.shares), price = parseFloat(r.price);
        return {
          symbol: r.symbol, sector: r.sector, shares, price,
          avg_cost: parseFloat(r.avg_cost),
          weight: equity > 0 ? (shares * price) / equity : 0,
        };
      });

      const report = riskLib.portfolioRisk(mapped, equity);
      const curve = await pool.query(
        `SELECT value FROM market_indicators WHERE name = 'PORTFOLIO_EQUITY' ORDER BY id ASC`
      );
      if (curve.rows.length > 2) {
        riskLib.setEquityHistory(curve.rows.map(r => parseFloat(r.value)));
        Object.assign(report, riskLib.portfolioRisk(mapped, equity));
      }

      res.json({
        portfolio: { id: p.id, name: p.name, cash: parseFloat(p.cash_balance), equity },
        limits: riskLib.DEFAULT_LIMITS,
        report,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // System health summary
  app.get('/api/system/health', async (req, res) => {
    const started = Date.now();
    const out = { status: 'ok', checks: {}, timestamp: new Date().toISOString() };
    try {
      await pool.query('SELECT 1');
      out.checks.database = { ok: true };
    } catch (err) {
      out.status = 'degraded';
      out.checks.database = { ok: false, error: err.message };
    }
    out.checks.engine = { mode: process.env.TRADING_MODE || 'paper' };
    out.checks.latencyMs = Date.now() - started;
    res.json(out);
  });
}

module.exports = { registerAnalyticsRoutes, indicators, optionsLib, riskLib };
