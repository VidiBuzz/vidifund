/**
 * FortunaTrade — Indicators Library
 * Pure functions, no dependencies. All math implemented from first principles
 * so the platform does not depend on TA-Lib native builds.
 */

const EPS = 1e-12;

// ─── Moving Averages ────────────────────────────────────────────────────────
function sma(values, period) {
  if (period <= 0 || values.length < period) return [];
  const out = new Array(values.length - period + 1);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i - period + 1] = sum / period;
  }
  return out;
}

function ema(values, period) {
  if (period <= 0 || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length - period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[0] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i - period + 1] = prev;
  }
  return out;
}

/** Wilder's smoothing — used by RSI, ATR, ADX. */
function wilderSmooth(values, period) {
  if (values.length < period) return [];
  const out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out.push(prev);
  }
  return out;
}

// ─── Oscillators ────────────────────────────────────────────────────────────
/** Relative Strength Index (Wilder). Returns 0-100 aligned to the tail. */
function rsi(closes, period = 14) {
  if (closes.length <= period) return [];
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const ag = wilderSmooth(gains, period);
  const al = wilderSmooth(losses, period);
  const out = [];
  for (let i = 0; i < ag.length; i++) {
    const rs = al[i] < EPS ? 100 : ag[i] / al[i];
    out.push(al[i] < EPS ? 100 : 100 - 100 / (1 + rs));
  }
  return out;
}

/** Stochastic Oscillator %K. */
function stochastic(closes, highs, lows, period = 14) {
  if (closes.length < period) return [];
  const out = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    out.push(hh - ll < EPS ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  return out;
}

// ─── Volatility ─────────────────────────────────────────────────────────────
/** Bollinger Bands. */
function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  if (!mid.length) return { upper: [], middle: [], lower: [], bandwidth: [] };
  const upper = [], lower = [], bandwidth = [];
  for (let i = 0; i < mid.length; i++) {
    const w = closes.slice(i, i + period);
    const mean = mid[i];
    const sd = Math.sqrt(w.reduce((a, v) => a + (v - mean) ** 2, 0) / period);
    upper.push(mean + mult * sd);
    lower.push(mean - mult * sd);
    bandwidth.push(mean < EPS ? 0 : ((2 * mult * sd) / mean) * 100);
  }
  return { upper, middle: mid, lower, bandwidth };
}

/** Average True Range (Wilder). */
function atr(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return [];
  const tr = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  return wilderSmooth(tr, period);
}

/** Annualized historical volatility from log returns, as a percentage. */
function historicalVolatility(closes, period = 20, tradingDays = 252) {
  if (closes.length < period + 1) return null;
  const rets = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, v) => a + (v - mean) ** 2, 0) / (rets.length - 1 || 1);
  return Math.sqrt(varr) * Math.sqrt(tradingDays) * 100;
}

// ─── Trend ──────────────────────────────────────────────────────────────────
/** Average Directional Index — trend strength regardless of direction. */
function adx(highs, lows, closes, period = 14) {
  if (closes.length < period * 2 + 1) return [];
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const sTR = wilderSmooth(tr, period);
  const sP = wilderSmooth(plusDM, period);
  const sM = wilderSmooth(minusDM, period);
  const dx = [];
  for (let i = 0; i < sTR.length; i++) {
    if (sTR[i] < EPS) { dx.push(0); continue; }
    const pdi = (sP[i] / sTR[i]) * 100;
    const mdi = (sM[i] / sTR[i]) * 100;
    const sum = pdi + mdi;
    dx.push(sum < EPS ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }
  return wilderSmooth(dx, period);
}

/** Parabolic SAR. */
function psar(highs, lows, step = 0.02, max = 0.2) {
  if (highs.length < 2) return [];
  const out = [];
  let bull = highs[1] >= highs[0];
  let ep = bull ? Math.max(highs[0], highs[1]) : Math.min(lows[0], lows[1]);
  let sar = bull ? lows[0] : highs[0];
  let af = step;
  for (let i = 1; i < highs.length; i++) {
    sar += af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1]);
      if (lows[i] < sar) { bull = false; sar = ep; ep = lows[i]; af = step; }
      else if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, max); }
    } else {
      sar = Math.max(sar, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1]);
      if (highs[i] > sar) { bull = true; sar = ep; ep = highs[i]; af = step; }
      else if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, max); }
    }
    out.push(sar);
  }
  return out;
}

// ─── Volume ─────────────────────────────────────────────────────────────────
function obv(closes, volumes) {
  const out = [0];
  for (let i = 1; i < closes.length; i++) {
    const dir = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
    out.push(out[i - 1] + dir * volumes[i]);
  }
  return out;
}

function vwap(highs, lows, closes, volumes) {
  const out = [];
  let pv = 0, vv = 0;
  for (let i = 0; i < closes.length; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    pv += typical * volumes[i];
    vv += volumes[i];
    out.push(vv < EPS ? typical : pv / vv);
  }
  return out;
}

/** MACD line, signal line, histogram. */
function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  if (!ef.length || !es.length) return { macd: [], signal: [], histogram: [] };
  const n = Math.min(ef.length, es.length);
  const line = Array.from({ length: n }, (_, i) => ef[ef.length - n + i] - es[es.length - n + i]);
  const sig = ema(line, signal);
  const hist = line.slice(line.length - sig.length).map((v, i) => v - sig[i]);
  return { macd: line, signal: sig, histogram: hist };
}

// ─── Portfolio / Risk Analytics ─────────────────────────────────────────────
/** Sharpe ratio. riskFree is an annual rate, e.g. 0.04. */
function sharpe(returns, riskFree = 0, periodsPerYear = 252) {
  if (returns.length < 2) return null;
  const excess = returns.map(r => r - riskFree / periodsPerYear);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const sd = Math.sqrt(excess.reduce((a, v) => a + (v - mean) ** 2, 0) / (excess.length - 1));
  return sd < EPS ? null : (mean / sd) * Math.sqrt(periodsPerYear);
}

/** Sortino ratio — only penalises downside deviation. */
function sortino(returns, riskFree = 0, periodsPerYear = 252) {
  if (returns.length < 2) return null;
  const excess = returns.map(r => r - riskFree / periodsPerYear);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downside = excess.filter(v => v < 0);
  if (!downside.length) return null;
  const dd = Math.sqrt(downside.reduce((a, v) => a + v ** 2, 0) / downside.length);
  return dd < EPS ? null : (mean / dd) * Math.sqrt(periodsPerYear);
}

/** Maximum drawdown as a negative fraction, e.g. -0.084. */
function maxDrawdown(equityCurve) {
  if (equityCurve.length < 2) return { mdd: 0, peak: null, trough: null };
  let peak = equityCurve[0], maxDd = 0, peakIdx = 0, troughIdx = 0, curPeakIdx = 0;
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) { peak = equityCurve[i]; curPeakIdx = i; }
    const dd = (equityCurve[i] - peak) / peak;
    if (dd < maxDd) { maxDd = dd; peakIdx = curPeakIdx; troughIdx = i; }
  }
  return { mdd: maxDd, peak: peakIdx, trough: troughIdx };
}

/** Historical Value-at-Risk at a given confidence (e.g. 0.95). Negative fraction. */
function valueAtRisk(returns, confidence = 0.95) {
  if (returns.length < 2) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * (sorted.length - 1));
  return sorted[idx];
}

/** Conditional VaR — mean of losses beyond the VaR threshold. */
function conditionalVaR(returns, confidence = 0.95) {
  if (returns.length < 2) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidence) * (sorted.length - 1));
  const tail = sorted.slice(cutoff);
  if (!tail.length) return null;
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/** Pearson correlation matrix from a map of symbol -> return series. */
function correlationMatrix(series) {
  const keys = Object.keys(series);
  const corr = {};
  for (const a of keys) {
    corr[a] = {};
    for (const b of keys) {
      const x = series[a], y = series[b];
      const len = Math.min(x.length, y.length);
      if (len < 2) { corr[a][b] = 0; continue; }
      const xs = x.slice(-len), ys = y.slice(-len);
      const mx = xs.reduce((s, v) => s + v, 0) / len;
      const my = ys.reduce((s, v) => s + v, 0) / len;
      let cov = 0, vx = 0, vy = 0;
      for (let i = 0; i < len; i++) {
        cov += (xs[i] - mx) * (ys[i] - my);
        vx += (xs[i] - mx) ** 2;
        vy += (ys[i] - my) ** 2;
      }
      corr[a][b] = vx < EPS || vy < EPS ? 0 : cov / Math.sqrt(vx * vy);
    }
  }
  return corr;
}

/** Simple returns from a price series. */
function returnsFromPrices(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > EPS) out.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return out;
}

/**
 * Composite technical score from -100 (oversold/bearish) to +100 (overbought/bullish).
 * Weights trend, momentum, mean-reversion and volatility penalty.
 */
function technicalScore(closes, highs = closes, lows = closes, volumes = closes.map(() => 1)) {
  if (closes.length < 30) return null;
  const last = closes[closes.length - 1];
  const s = {};

  const p = sma(closes, 50);
  s.trend = p.length ? (last > p[p.length - 1] ? 40 : -40) : 0;

  const r = rsi(closes, 14);
  s.momentum = r.length ? ((r[r.length - 1] - 50) / 50) * 30 : 0;

  const st = stochastic(closes, highs, lows, 14);
  s.stoch = st.length ? ((st[st.length - 1] - 50) / 50) * 20 : 0;

  const m = macd(closes);
  s.macd = m.histogram.length
    ? Math.max(-15, Math.min(15, (m.histogram[m.histogram.length - 1] / last) * 10000))
    : 0;

  const a = atr(highs, lows, closes, 14);
  s.volatilityPenalty = a.length ? (a[a.length - 1] / last) * 100 : 0;

  const total = s.trend + s.momentum + s.stoch + s.macd - s.volatilityPenalty;
  return Math.max(-100, Math.min(100, total));
}

module.exports = {
  sma, ema, wilderSmooth, rsi, stochastic, macd, bollinger, atr,
  historicalVolatility, adx, psar, obv, vwap,
  sharpe, sortino, maxDrawdown, valueAtRisk, conditionalVaR,
  correlationMatrix, returnsFromPrices, technicalScore,
};

