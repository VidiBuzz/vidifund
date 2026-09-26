/**
 * FortunaTrade — Risk Management Engine
 *
 * Enforces pre-trade and post-trade limits. Every rule returns a structured
 * verdict so the same logic powers the API, the agent swarm and the UI.
 */

const { maxDrawdown, valueAtRisk, conditionalVaR, correlationMatrix, returnsFromPrices } = require('./indicators');

const DEFAULT_LIMITS = {
  maxPositionPct: 10,        // % of equity in any single name
  maxSectorPct: 30,          // % of equity in one sector
  maxGrossExposurePct: 200,  // leverage ceiling
  maxNetExposurePct: 100,
  maxDailyLossPct: 3,        // halt trading for the day
  maxDrawdownPct: 10,        // hard portfolio drawdown guardrail
  maxOpenPositions: 25,
  maxRiskPerTradePct: 1,     // amount at risk per trade
  maxConcentrationHerfindahl: 0.35,
  kellyFraction: 0.25,       // quarter-Kelly by default (conservative)
  warnThresholdPct: 75,      // % of any limit that triggers a warning
};

const SEVERITY = { OK: 'ok', WARN: 'warn', BLOCK: 'block' };

/**
 * Kelly criterion position sizing.
 * @param winRate probability of a win (0-1)
 * @param winLossRatio avg win / avg loss
 * @param fraction fraction of Kelly to use
 */
function kellySize(winRate, winLossRatio, fraction = 0.25) {
  if (winRate <= 0 || winRate >= 1 || winLossRatio <= 0) return 0;
  const k = (winRate * (winLossRatio + 1) - 1) / winLossRatio;
  return Math.max(0, k * fraction);
}

/**
 * Size a position from risk: risk the given % of equity as the stop distance.
 */
function sizeByRisk(equity, riskPct, entry, stop, maxPositionPct = DEFAULT_LIMITS.maxPositionPct) {
  if (entry <= 0 || stop <= 0 || entry <= stop) {
    return { shares: 0, riskAmount: 0, notional: 0, reason: 'Invalid entry/stop: stop must be below entry for a long' };
  }
  const riskPerShare = entry - stop;
  const riskBudget = equity * (riskPct / 100);
  let shares = Math.floor(riskBudget / riskPerShare);

  const notionalCap = equity * (maxPositionPct / 100);
  shares = Math.min(shares, Math.floor(notionalCap / entry));
  shares = Math.max(0, shares);

  return {
    shares,
    riskAmount: shares * riskPerShare,
    notional: shares * entry,
    stop,
    riskPctOfEquity: equity > 0 ? ((shares * riskPerShare) / equity) * 100 : 0,
    reason: null,
  };
}


/** Portfolio-level risk metrics. */
function portfolioRisk(positions, equity, priceHistory = {}) {
  const longs = positions.filter(p => p.shares > 0);
  const shorts = positions.filter(p => p.shares < 0);
  const gross = positions.reduce((s, p) => s + Math.abs(p.shares * p.price), 0);
  const net = positions.reduce((s, p) => s + p.shares * p.price, 0);
  const totalWeight = longs.reduce((s, p) => s + p.weight, 0);

  const sectorExposure = {};
  for (const p of longs) {
    const s = p.sector || 'Unknown';
    sectorExposure[s] = (sectorExposure[s] || 0) + Math.abs(p.shares * p.price);
  }
  const sectorPct = {};
  for (const [k, v] of Object.entries(sectorExposure)) {
    sectorPct[k] = equity > 0 ? (v / equity) * 100 : 0;
  }

  const weights = longs.map(p => p.weight);
  const hhi = weights.reduce((s, w) => s + w * w, 0);

  let var95 = null, cvar95 = null, mdd = null, correlation = null;
  if (priceHistory && Object.keys(priceHistory).length >= 2) {
    const series = {};
    for (const [sym, prices] of Object.entries(priceHistory)) {
      if (Array.isArray(prices) && prices.length > 2) series[sym] = returnsFromPrices(prices);
    }
    if (Object.keys(series).length >= 2) correlation = correlationMatrix(series);
  }
  if (equityHistory && equityHistory.length > 2) {
    const rets = returnsFromPrices(equityHistory);
    var95 = valueAtRisk(rets, 0.95);
    cvar95 = conditionalVaR(rets, 0.95);
    mdd = maxDrawdown(equityHistory).mdd;
  }

  return {
    equity, grossExposure: gross, netExposure: net,
    grossExposurePct: equity > 0 ? (gross / equity) * 100 : 0,
    netExposurePct: equity > 0 ? (net / equity) * 100 : 0,
    leverage: equity > 0 ? gross / equity : 0,
    longCount: longs.length, shortCount: shorts.length, positionCount: positions.length,
    totalLongWeight: totalWeight, sectorExposure: sectorPct, concentrationHHI: hhi,
    var95, cvar95, maxDrawdown: mdd, correlationMatrix: correlation,
  };
}

let equityHistory = null;
/** Supply the equity curve so VaR/CVaR/drawdown become computable. */
function setEquityHistory(curve) { equityHistory = Array.isArray(curve) ? curve : null; }


/**
 * Pre-trade risk check. Returns { allowed, severity, violations[] }.
 */
function checkOrder({ side, symbol, quantity, price, portfolio }, limits = DEFAULT_LIMITS) {
  const violations = [];
  const add = (rule, message, severity = SEVERITY.BLOCK) =>
    violations.push({ rule, message, severity });

  const equity = portfolio.equity || 0;
  const notional = quantity * price;
  const pctOfEquity = equity > 0 ? (notional / equity) * 100 : 0;

  if (quantity <= 0) add('QUANTITY', 'Quantity must be greater than zero');
  if (price <= 0) add('PRICE', 'Price must be greater than zero');

  if (side === 'BUY') {
    const cost = notional * 1.001; // + commission/slippage buffer
    if (cost > (portfolio.cash || 0)) {
      add('BUYING_POWER', `Order cost $${cost.toFixed(2)} exceeds available cash $${(portfolio.cash || 0).toFixed(2)}`);
    }
  } else {
    const held = (portfolio.holdings || {})[symbol] || 0;
    if (quantity > held) {
      add('POSITION', `Cannot sell ${quantity} ${symbol}; only ${held} held (short selling disabled)`);
    }
  }

  if (pctOfEquity > limits.maxPositionPct) {
    add('MAX_POSITION', `Order is ${pctOfEquity.toFixed(2)}% of equity, above the ${limits.maxPositionPct}% single-name limit`, SEVERITY.BLOCK);
  } else if (pctOfEquity > limits.maxPositionPct * (limits.warnThresholdPct / 100)) {
    add('MAX_POSITION_WARN', `Order approaches the ${limits.maxPositionPct}% single-name limit`, SEVERITY.WARN);
  }

  const sector = (portfolio.sectors || {})[symbol];
  if (sector && equity > 0) {
    const currentPct = portfolio.sectorPct?.[sector] || 0;
    if (side === 'BUY' && currentPct + pctOfEquity > limits.maxSectorPct) {
      add('MAX_SECTOR', `Would push ${sector} to ${(currentPct + pctOfEquity).toFixed(2)}%, above the ${limits.maxSectorPct}% sector limit`);
    }
  }

  const newGross = (portfolio.grossExposure || 0) + (side === 'BUY' ? notional : 0);
  const newGrossPct = equity > 0 ? (newGross / equity) * 100 : 0;
  if (newGrossPct > limits.maxGrossExposurePct) {
    add('MAX_GROSS', `Gross exposure would reach ${newGrossPct.toFixed(2)}%, above the ${limits.maxGrossExposurePct}% limit`);
  }

  const currentCount = Object.keys(portfolio.holdings || {}).filter(s => (portfolio.holdings[s] || 0) !== 0).length;
  if (side === 'BUY' && !portfolio.holdings?.[symbol] && currentCount >= limits.maxOpenPositions) {
    add('MAX_POSITIONS', `Already holding ${currentCount} positions, limit is ${limits.maxOpenPositions}`);
  }

  if (portfolio.dayPnlPct != null && portfolio.dayPnlPct <= -limits.maxDailyLossPct) {
    add('DAILY_LOSS_HALT', `Daily P&L is ${portfolio.dayPnlPct.toFixed(2)}%, at or beyond the -${limits.maxDailyLossPct}% halt threshold`);
  }
  if (portfolio.drawdownPct != null && portfolio.drawdownPct <= -limits.maxDrawdownPct) {
    add('DRAWDOWN_HALT', `Portfolio drawdown is ${portfolio.drawdownPct.toFixed(2)}%, at or beyond the -${limits.maxDrawdownPct}% guardrail`);
  }

  const blocked = violations.some(v => v.severity === SEVERITY.BLOCK);
  const warned = violations.some(v => v.severity === SEVERITY.WARN);
  return {
    allowed: !blocked,
    severity: blocked ? SEVERITY.BLOCK : warned ? SEVERITY.WARN : SEVERITY.OK,
    violations, notional, pctOfEquity,
  };
}

/** Rank a universe by technical score into actionable trade ideas. */
function screenSignals(universe, limit = 10) {
  return universe
    .filter(s => s.technicalScore != null)
    .sort((a, b) => Math.abs(b.technicalScore) - Math.abs(a.technicalScore))
    .slice(0, limit)
    .map(s => ({
      symbol: s.symbol,
      score: s.technicalScore,
      bias: s.technicalScore > 0 ? 'BULLISH' : 'BEARISH',
      strength: Math.abs(s.technicalScore) > 60 ? 'STRONG' : Math.abs(s.technicalScore) > 30 ? 'MODERATE' : 'WEAK',
      price: s.price, rsi: s.rsi, macd: s.macd, trend: s.trend,
    }));
}

module.exports = {
  DEFAULT_LIMITS, SEVERITY,
  kellySize, sizeByRisk, portfolioRisk, checkOrder, screenSignals, setEquityHistory,
};
