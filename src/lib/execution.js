/**
 * FortunaTrade — Execution Engine
 *
 * Order lifecycle state machine, slippage + commission model, and a
 * deterministic paper-matching engine. In live mode the same interface is
 * implemented by a broker adapter (Alpaca/IBKR/CCXT) with no strategy changes.
 */

const { randomUUID } = require('crypto');

// ─── Order lifecycle ────────────────────────────────────────────────────────
const ORDER_STATUS = {
  PENDING_RISK: 'PENDING_RISK',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WORKING: 'WORKING',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
};

const ORDER_TYPE = { MARKET: 'MARKET', LIMIT: 'LIMIT', STOP: 'STOP', STOP_LIMIT: 'STOP_LIMIT' };
const SIDE = { BUY: 'BUY', SELL: 'SELL', SELL_SHORT: 'SELL_SHORT', BUY_TO_COVER: 'BUY_TO_COVER' };

const TERMINAL = new Set([ORDER_STATUS.FILLED, ORDER_STATUS.REJECTED, ORDER_STATUS.CANCELLED]);

// ─── Cost model ─────────────────────────────────────────────────────────────
/**
 * Zero-commission default (Alpaca/IBKR retail), configurable.
 * Slippage is half the quoted spread plus a size/urgency term.
 */
const DEFAULT_COSTS = {
  commissionPerOrder: 0,
  commissionPct: 0,
  minCommission: 0,
  halfSpreadBps: 2.5,        // 5 bps round-trip spread
  impactCoefficient: 0.05,   // square-root market impact (eta)
  dailyVol: 0.02,            // daily volatility used by the impact model
  maxImpactPct: 0.02,        // cap impact at 2% of price
  defaultParticipation: 0.01,// assumed share of ADV when ADV is unknown
  urgency: 0.5,              // 0 = patient, 1 = aggressive
};

function estimateCosts({ quantity, price, spread, adv, costs = DEFAULT_COSTS }) {
  const qty = Math.abs(quantity);
  const notional = qty * price;
  const halfSpread = spread != null ? spread / 2 : (price * costs.halfSpreadBps) / 10000;
  const spreadCost = halfSpread * qty;

  // Square-root market impact: impact_pct = eta * sigma * sqrt(Q / ADV).
  // `adv` is average daily volume in shares; falls back to a notional heuristic
  // so the model still produces size-dependent slippage with no market data.
  const refShares = adv != null && adv > 0 ? adv : Math.max(notional / price, 1) / Math.max(0.01, costs.defaultParticipation || 0.01);
  const sigma = costs.dailyVol || 0.02;
  const impactPct = costs.impactCoefficient * sigma * Math.sqrt(qty / refShares);
  const impactPerShare = Math.min(price * impactPct, price * (costs.maxImpactPct || 0.02));
  const impactCost = impactPerShare * qty;

  const totalSlippage = (spreadCost * (0.5 + costs.urgency)) + impactCost * costs.urgency;
  const commission = Math.max(costs.minCommission, notional * costs.commissionPct) + costs.commissionPerOrder;

  return {
    spreadCost, impactCost, impactPct, totalSlippage, commission,
    totalCost: totalSlippage + commission,
    expectedFillPrice: price + Math.sign(quantity) * (totalSlippage / Math.max(1, qty)),
  };
}

// ─── Order factory ──────────────────────────────────────────────────────────
function createOrder({ symbol, side, quantity, orderType = ORDER_TYPE.MARKET, limitPrice, stopPrice, timeInForce = 'DAY', portfolioId = 'default' }) {
  if (!symbol) throw new Error('symbol is required');
  if (!Object.values(SIDE).includes(side)) throw new Error(`invalid side: ${side}`);
  if (!Object.values(ORDER_TYPE).includes(orderType)) throw new Error(`invalid orderType: ${orderType}`);
  if (!(quantity > 0)) throw new Error('quantity must be > 0');
  if ((orderType === ORDER_TYPE.LIMIT || orderType === ORDER_TYPE.STOP_LIMIT) && !(limitPrice > 0)) {
    throw new Error('limitPrice required for LIMIT/STOP_LIMIT');
  }
  if ((orderType === ORDER_TYPE.STOP || orderType === ORDER_TYPE.STOP_LIMIT) && !(stopPrice > 0)) {
    throw new Error('stopPrice required for STOP/STOP_LIMIT');
  }

  return {
    id: randomUUID(),
    clientOrderId: `ft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    portfolioId, symbol, side, quantity, orderType, limitPrice, stopPrice, timeInForce,
    status: ORDER_STATUS.PENDING_RISK,
    filledQuantity: 0,
    avgFillPrice: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fills: [],
    riskVerdict: null,
    rejectReason: null,
  };
}

/** Apply a fill to an order, maintaining weighted average price. */
function applyFill(order, fillPrice, fillQuantity, fee = 0, liquidity = 'taken') {
  if (TERMINAL.has(order.status)) throw new Error(`cannot fill a ${order.status} order`);
  if (fillPrice <= 0 || fillQuantity <= 0) throw new Error('invalid fill');

  const newQty = order.filledQuantity + fillQuantity;
  order.avgFillPrice = (order.avgFillPrice * order.filledQuantity + fillPrice * fillQuantity) / newQty;
  order.filledQuantity = newQty;
  order.status = newQty >= order.quantity ? ORDER_STATUS.FILLED : ORDER_STATUS.PARTIALLY_FILLED;
  order.fills.push({ price: fillPrice, quantity: fillQuantity, fee, liquidity, at: new Date().toISOString() });
  order.updatedAt = new Date().toISOString();
  return order;
}

/** Remaining quantity. */
function remaining(order) {
  return Math.max(0, order.quantity - order.filledQuantity);
}

function limitNotSatisfied(order, ref, isBuy) {
  return isBuy ? ref > order.limitPrice : ref < order.limitPrice;
}

function stopTriggered(order, price, isBuy) {
  return isBuy ? price >= order.stopPrice : price <= order.stopPrice;
}


// ─── Paper matching engine ──────────────────────────────────────────────────
/**
 * Deterministic simulator. Given a quote it decides how an order would fill,
 * modelling market impact from size. Replace this class with a broker adapter
 * for live trading — the strategy layer calls submit() either way.
 */
class PaperBroker {
  constructor({ slippageModel = estimateCosts, initialCash = 1_000_000 } = {}) {
    this.cash = initialCash;
    this.positions = new Map();   // symbol -> { shares, avgCost }
    this.orders = new Map();      // orderId -> order
    this.prices = {};
    this.equityCurve = [];
    this.slippageModel = slippageModel;
    this.equity = initialCash;
  }

  /** Mark a symbol to a price, refreshing account equity. */
  mark(symbol, price, allPrices = {}) {
    this.prices[symbol] = price;
    for (const [sym, p] of Object.entries(allPrices)) this.prices[sym] = p;
    let marketValue = 0;
    for (const [sym, pos] of this.positions) {
      marketValue += pos.shares * (this.prices[sym] ?? pos.avgCost);
    }
    this.equity = this.cash + marketValue;
    this.equityCurve.push({ at: new Date().toISOString(), equity: this.equity });
    return this.equity;
  }

  /** Register an order without executing it. */
  submit(order) {
    this.orders.set(order.id, order);
    return order;
  }

  /**
   * Attempt to fill an order against the current quote.
   * Market orders fill fully; limit orders fill only if the price is marketable.
   */
  tryFill(order, quote) {
    if (TERMINAL.has(order.status) || order.status === ORDER_STATUS.PENDING_RISK) return order;
    const { price, bid, ask, spread, volume, adv } = quote;
    if (!(price > 0)) return order;

    const isBuy = order.side === SIDE.BUY || order.side === SIDE.BUY_TO_COVER;
    const isSell = order.side === SIDE.SELL || order.side === SIDE.SELL_SHORT;
    const ref = isBuy ? (ask ?? price) : (bid ?? price);

    if (order.orderType === ORDER_TYPE.LIMIT && limitNotSatisfied(order, ref, isBuy)) return order;
    if (order.orderType === ORDER_TYPE.STOP && !stopTriggered(order, price, isBuy)) return order;
    if (order.orderType === ORDER_TYPE.STOP_LIMIT && stopTriggered(order, price, isBuy) && limitNotSatisfied(order, ref, isBuy)) return order;

    // Volume participation cap — a market order cannot exceed a fraction of bar volume
    const maxFill = volume ? Math.max(1, Math.floor(volume * 0.1)) : order.quantity;
    const fillQty = Math.min(remaining(order), maxFill);

    const costs = this.slippageModel({
      quantity: fillQty, price: ref,
      spread: spread ?? (ask != null && bid != null ? ask - bid : undefined),
      adv: adv ?? volume,
    });
    const fillPrice = order.orderType === ORDER_TYPE.MARKET ? costs.expectedFillPrice : ref;

    applyFill(order, fillPrice, fillQty, costs.commission);

    if (isBuy) {
      const pos = this.positions.get(order.symbol) || { shares: 0, avgCost: 0 };
      const newShares = pos.shares + fillQty;
      pos.avgCost = newShares > 0 ? (pos.avgCost * pos.shares + fillPrice * fillQty) / newShares : fillPrice;
      pos.shares = newShares;
      this.positions.set(order.symbol, pos);
      this.cash -= fillPrice * fillQty + costs.commission;
    } else {
      const pos = this.positions.get(order.symbol) || { shares: 0, avgCost: 0 };
      pos.shares -= fillQty;
      this.cash += fillPrice * fillQty - costs.commission;
      if (pos.shares === 0) this.positions.delete(order.symbol);
      else this.positions.set(order.symbol, pos);
    }

    let marketValue = 0;
    for (const [sym, pos] of this.positions) {
      marketValue += pos.shares * (this.prices[sym] ?? pos.avgCost);
    }
    this.equity = this.cash + marketValue;
    return order;
  }

  /** Cancel a working order. */
  cancel(orderId, reason = 'user request') {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`unknown order ${orderId}`);
    if (TERMINAL.has(order.status)) throw new Error(`cannot cancel a ${order.status} order`);
    order.status = ORDER_STATUS.CANCELLED;
    order.rejectReason = reason;
    order.updatedAt = new Date().toISOString();
    return order;
  }

  account() {
    return {
      cash: this.cash,
      equity: this.equity,
      positions: [...this.positions.entries()].map(([symbol, p]) => ({ symbol, ...p })),
      openOrders: [...this.orders.values()].filter(o => !TERMINAL.has(o.status)).length,
      equityCurve: this.equityCurve,
    };
  }
}

module.exports = {
  ORDER_STATUS, ORDER_TYPE, SIDE, TERMINAL, DEFAULT_COSTS,
  estimateCosts, createOrder, applyFill, remaining, PaperBroker,
};
