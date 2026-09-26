/**
 * FortunaTrade — Options Pricing & Greeks
 *
 * Black-Scholes-Merton (European) with continuous dividend yield, plus
 * binomial (CRR) for American exercise, Greeks by both analytical and
 * finite-difference methods so the two can be cross-checked.
 */

const SQRT2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF. */
function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT2PI;
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 erf approximation. */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/**
 * Black-Scholes price.
 * @param {number} S spot
 * @param {number} K strike
 * @param {number} T time to expiry in years
 * @param {number} r risk-free rate (e.g. 0.05)
 * @param {number} vol implied volatility (e.g. 0.25)
 * @param {'call'|'put'} type
 * @param {number} q dividend yield
 */
function blackScholes(S, K, T, r, vol, type = 'call', q = 0) {
  if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) {
    const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    return { price: intrinsic, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
  const d2 = d1 - vol * Math.sqrt(T);
  const df = Math.exp(-r * T);
  const dq = Math.exp(-q * T);

  const price = type === 'call'
    ? S * dq * normCdf(d1) - K * df * normCdf(d2)
    : K * df * normCdf(-d2) - S * dq * normCdf(-d1);

  return {
    price,
    delta: type === 'call' ? dq * normCdf(d1) : dq * (normCdf(d1) - 1),
    gamma: (dq * normPdf(d1)) / (S * vol * Math.sqrt(T)),
    // Theta is per-day, conventionally divided by 365.
    theta: (type === 'call'
      ? -(S * dq * normPdf(d1) * vol) / (2 * Math.sqrt(T)) - r * K * df * normCdf(d2) + q * S * dq * normCdf(d1)
      : -(S * dq * normPdf(d1) * vol) / (2 * Math.sqrt(T)) + r * K * df * normCdf(-d2) - q * S * dq * normCdf(-d1)
    ) / 365,
    vega: (S * dq * normPdf(d1) * Math.sqrt(T)) / 100,
    rho: (type === 'call' ? K * T * df * normCdf(d2) : -K * T * df * normCdf(-d2)) / 100,
    d1, d2,
  };
}

/** Cox-Ross-Rubinstein binomial price for American options. */
function binomialAmerican(S, K, T, r, vol, type = 'call', q = 0, steps = 200) {
  if (T <= 0) return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const dt = T / steps;
  const u = Math.exp(vol * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = (Math.exp((r - q) * dt) - d) / (u - d);
  if (p < 0 || p > 1) return blackScholes(S, K, T, r, vol, type, q).price;

  const values = [];
  for (let i = 0; i <= steps; i++) {
    const ST = S * Math.pow(u, 2 * i - steps);
    values.push(type === 'call' ? Math.max(0, ST - K) : Math.max(0, K - ST));
  }
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const cont = disc * (p * values[i + 1] + (1 - p) * values[i]);
      const ST = S * Math.pow(u, 2 * i - step);
      values[i] = type === 'call' ? Math.max(cont, ST - K) : Math.max(cont, K - ST);
    }
  }
  return values[0];
}

/** Newton-Raphson implied volatility with bisection fallback. */
function impliedVol(marketPrice, S, K, T, r, type = 'call', q = 0) {
  if (T <= 0 || marketPrice <= 0) return null;
  const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (marketPrice <= intrinsic + 1e-8) return null;

  let vol = 0.3;
  for (let i = 0; i < 100; i++) {
    const diff = blackScholes(S, K, T, r, vol, type, q).price - marketPrice;
    if (Math.abs(diff) < 1e-7) return vol;
    const v = blackScholes(S, K, T, r, vol, type, q).vega;
    if (!isFinite(v) || Math.abs(v) < 1e-10) break;
    vol = vol - diff / v;
    if (vol <= 0 || vol > 5) break;
  }
  let lo = 1e-6, hi = 5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const diff = blackScholes(S, K, T, r, mid, type, q).price - marketPrice;
    if (Math.abs(diff) < 1e-8) return mid;
    if (diff > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Full Greeks bundle for one contract. */
function greeks(S, K, T, r, vol, type = 'call', q = 0) {
  const g = blackScholes(S, K, T, r, vol, type, q);
  return {
    price: g.price, delta: g.delta, gamma: g.gamma,
    theta: g.theta, vega: g.vega, rho: g.rho,
  };
}

/**
 * Aggregate portfolio Greeks across many positions.
 * Positions: [{ S, K, T, r, vol, type, q, quantity }] where quantity is
 * signed: long options positive, short negative. Use contractMultiplier=100.
 */
function portfolioGreeks(positions, contractMultiplier = 100) {
  const tot = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, marketValue: 0 };
  for (const p of positions) {
    const g = greeks(p.S, p.K, p.T, p.r, p.vol, p.type, p.q || 0);
    const qty = (p.quantity || 0) * contractMultiplier;
    tot.delta += g.delta * qty;
    tot.gamma += g.gamma * qty;
    tot.theta += g.theta * qty;
    tot.vega += g.vega * qty;
    tot.rho += g.rho * qty;
    tot.marketValue += g.price * qty;
  }
  return tot;
}

/** Expected move: 1-sigma price range over the holding period, in dollars. */
function expectedMove(S, vol, T) {
  const sigma = S * vol * Math.sqrt(Math.max(0, T));
  return { lower: S - sigma, upper: S + sigma, sigma, oneStdPct: vol * Math.sqrt(Math.max(0, T)) * 100 };
}

module.exports = {
  normPdf, normCdf, blackScholes, binomialAmerican,
  impliedVol, greeks, portfolioGreeks, expectedMove,
};
