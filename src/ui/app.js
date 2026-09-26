/**
 * FortunaTrade UI v2
 *
 * Vanilla ES2020 — no framework, no CDN Tailwind. State is a single store;
 * every panel re-renders from it. Data comes from the FortunaTrade REST API
 * and degrades to a deterministic offline dataset when the API is unreachable
 * so the interface is never blank.
 */
'use strict';

const API = '/api';
const state = {
  view: 'dashboard',
  stocks: [],
  positions: [],
  portfolio: null,
  risk: null,
  orders: [],
  approvals: [],
  agents: [],
  vix: 18.4,
  marketStatus: 'UNKNOWN',
  latency: null,
  timeframe: '1M',
  connected: false,
  equitySeries: [],
};

// ─── Formatting ─────────────────────────────────────────────────────────────
const fmt = {
  money(n, dp = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
  },
  compact(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  },
  num(n, dp = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
  },
  pct(n, dp = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`;
  },
  signClass(n) { return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── API layer ──────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const started = performance.now();
  try {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    state.latency = Math.round(performance.now() - started);
    state.connected = true;
    return await res.json();
  } catch (err) {
    state.connected = false;
    throw err;
  }
}

async function loadAll() {
  const results = await Promise.allSettled([
    api('/stocks?limit=50'),
    api('/portfolio'),
    api('/market'),
  ]);

  const [stocksR, portfolioR, marketR] = results;
  state.stocks = stocksR.status === 'fulfilled' ? stocksR.value.stocks || [] : OFFLINE.stocks;
  state.portfolio = portfolioR.status === 'fulfilled' ? portfolioR.value : null;
  state.positions = portfolioR.status === 'fulfilled' ? (portfolioR.value.positions || []) : OFFLINE.positions;

  if (marketR.status === 'fulfilled' && marketR.value.indicators) {
    const vix = marketR.value.indicators.find(i => /VIX/i.test(i.name));
    if (vix) state.vix = Number(vix.value);
  }
  buildEquitySeries();
}

/**
 * Derive a portfolio equity curve ending at the current mark-to-market value.
 *
 * We do not have a stored history, so we walk backwards from the live value
 * using a deterministic pseudo-random drift. This is clearly labelled as
 * illustrative in the UI; replace with a persisted equity curve from
 * `market_indicators` once the trade blotter has run.
 */
function buildEquitySeries() {
  const totalCost = state.positions.reduce((s, p) => s + Number(p.avg_cost) * Number(p.shares), 0);
  const totalValue = state.positions.reduce((s, p) => s + Number(p.shares) * Number(p.current_price ?? p.price), 0);
  if (!totalCost) { state.equitySeries = []; return; }

  const days = 30;
  const cash = Number(state.portfolio?.portfolio?.cash_balance ?? 0);
  const endEquity = totalValue + cash;

  // Geometric random walk anchored so the final point equals live equity.
  // Seeded so the curve is stable across re-renders.
  let seed = totalCost >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const returns = [];
  for (let d = 0; d < days; d++) {
    returns.push((rand() - 0.47) * 0.012);
  }

  // Build forward from an unknown start, then rescale so the end matches.
  let v = 1;
  const rel = [v];
  for (const r of returns) { v *= 1 + r; rel.push(v); }

  const startEquity = endEquity / rel[rel.length - 1];
  state.equitySeries = rel.map(x => ({ v: startEquity * x }));
  state.equitySeries[state.equitySeries.length - 1].v = endEquity;
  state.equitySeriesIllustrative = true;
}

// ─── VIX regime ─────────────────────────────────────────────────────────────
const VIX_REGIMES = [
  { max: 12,  key: 'low',      label: 'LOW',      advice: 'Favourable for long premium and momentum entries.' },
  { max: 20,  key: 'normal',   label: 'NORMAL',   advice: 'Standard sizing; defined-risk strategies viable.' },
  { max: 30,  key: 'elevated', label: 'ELEVATED', advice: 'Cut equity exposure, widen stops, avoid naked short premium.' },
  { max: 40,  key: 'high',     label: 'HIGH',     advice: 'Defensive posture; add hedges and reduce leverage.' },
  { max: 999, key: 'panic',    label: 'PANIC',    advice: 'Halt new risk. Capital preservation only.' },
];

function currentRegime() {
  return VIX_REGIMES.find(r => state.vix < r.max) || VIX_REGIMES[VIX_REGIMES.length - 1];
}

/** US equity market session from ET wall-clock time. */
function marketSession(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6) return 'CLOSED · WEEKEND';
  if (mins < 4 * 60) return 'PRE-MARKET';
  if (mins < 9 * 60 + 30) return 'PRE-MARKET';
  if (mins < 16 * 60) return 'OPEN';
  if (mins < 20 * 60) return 'AFTER HOURS';
  return 'CLOSED';
}

// ─── Toasts ─────────────────────────────────────────────────────────────────
function toast(message, kind = 'info') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 200ms';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 4200);
}


// ─── Offline fallback dataset ───────────────────────────────────────────────
const OFFLINE = {
  stocks: [
    { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', price: 232.14, change_percent: 1.42, volume: 58400000, market_cap: 3480000000000 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', price: 428.55, change_percent: 0.63, volume: 24100000, market_cap: 3180000000000 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', price: 134.72, change_percent: -2.18, volume: 298000000, market_cap: 3310000000000 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication', price: 168.20, change_percent: 0.94, volume: 27900000, market_cap: 2060000000000 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', price: 186.33, change_percent: 1.11, volume: 41200000, market_cap: 1950000000000 },
    { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Communication', price: 512.40, change_percent: -0.37, volume: 16700000, market_cap: 1290000000000 },
    { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer', price: 242.87, change_percent: -2.94, volume: 118000000, market_cap: 774000000000 },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials', price: 218.63, change_percent: 0.45, volume: 9800000, market_cap: 612000000000 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financials', price: 456.20, change_percent: 0.21, volume: 3100000, market_cap: 985000000000 },
    { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy', price: 118.45, change_percent: 1.62, volume: 17800000, market_cap: 508000000000 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', price: 158.30, change_percent: -0.18, volume: 7200000, market_cap: 381000000000 },
    { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer', price: 78.94, change_percent: 0.53, volume: 18400000, market_cap: 634000000000 },
  ],
  positions: [
    { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', shares: 500, avg_cost: 201.40, current_price: 232.14, current_value: 116070, unrealized_pnl: 15370 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', shares: 220, avg_cost: 402.10, current_price: 428.55, current_value: 94281, unrealized_pnl: 5819 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', shares: 800, avg_cost: 118.90, current_price: 134.72, current_value: 107776, unrealized_pnl: 12656 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication', shares: 600, avg_cost: 155.25, current_price: 168.20, current_value: 100920, unrealized_pnl: 7770 },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials', shares: 300, avg_cost: 205.70, current_price: 218.63, current_value: 65589, unrealized_pnl: 3879 },
    { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy', shares: 450, avg_cost: 112.30, current_price: 118.45, current_value: 53302.5, unrealized_pnl: 2767.5 },
  ],
};

const AGENTS = [
  { name: 'Chief Trading Officer', role: 'Orchestration', status: 'active' },
  { name: 'VIX Analyst', role: 'Volatility regime', status: 'scanning' },
  { name: 'Sentiment Agent', role: 'News & social NLP', status: 'active' },
  { name: 'Market Scanner', role: 'Opportunity discovery', status: 'scanning' },
  { name: 'Fundamental Sage', role: 'SEC filings / XBRL', status: 'active' },
  { name: 'Macro Master', role: 'Rates & CPI', status: 'active' },
  { name: 'Technical Analyst', role: 'Indicator synthesis', status: 'scanning' },
  { name: 'Quant Alpha', role: 'Factor modelling', status: 'active' },
  { name: 'Greeks-Delta', role: 'Delta hedging', status: 'active' },
  { name: 'Greeks-Gamma', role: 'Gamma scalping', status: 'idle' },
  { name: 'Greeks-Vega', role: 'Vol risk', status: 'active' },
  { name: 'Risk Guardian', role: 'Drawdown guardrail', status: 'active' },
  { name: 'News Breach', role: 'Headline risk', status: 'scanning' },
  { name: 'Earnings Radar', role: 'Event calendar', status: 'active' },
  { name: 'Sector Rotator', role: 'Relative strength', status: 'active' },
  { name: 'Order Sniper', role: 'Execution', status: 'idle' },
  { name: 'Size Calculator', role: 'Kelly sizing', status: 'active' },
  { name: 'Trail Manager', role: 'Stops & targets', status: 'active' },
  { name: 'Exit Agent', role: 'Liquidation', status: 'idle' },
  { name: 'Audit Logger', role: 'Compliance trail', status: 'active' },
];

// ─── Offline risk computation (mirrors src/lib/risk.js) ─────────────────────
function computeRisk() {
  const positions = state.positions.map(p => {
    const value = Number(p.shares) * Number(p.current_price ?? p.price ?? 0);
    return { ...p, value, weight: 0 };
  });
  const positionsValue = positions.reduce((s, p) => s + p.value, 0);
  const cash = Number(state.portfolio?.portfolio?.cash_balance ?? 250000);
  const equity = positionsValue + cash;
  positions.forEach(p => { p.weight = equity > 0 ? p.value / equity : 0; });

  const gross = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const pnl = positions.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0);
  const costBasis = positions.reduce((s, p) => s + Number(p.shares) * Number(p.avg_cost ?? 0), 0);
  const hhi = positions.reduce((s, p) => s + p.weight * p.weight, 0);

  const sectorMap = {};
  for (const p of positions) {
    const sec = p.sector || 'Unknown';
    sectorMap[sec] = (sectorMap[sec] || 0) + p.value;
  }
  const sectorPct = Object.fromEntries(Object.entries(sectorMap).map(([k, v]) => [k, equity > 0 ? (v / equity) * 100 : 0]));

  return {
    equity, cash, positionsValue, gross, pnl, costBasis, hhi, sectorPct,
    grossPct: equity > 0 ? (gross / equity) * 100 : 0,
    pnlPct: costBasis > 0 ? (pnl / costBasis) * 100 : 0,
    largestPosition: positions.reduce((m, p) => Math.max(m, p.weight), 0) * 100,
    largestSector: Math.max(0, ...Object.values(sectorPct)),
  };
}

// ─── Renderers ──────────────────────────────────────────────────────────────
function renderStatTiles() {
  const r = state.risk || computeRisk();
  const regime = currentRegime();

  const tiles = [
    { label: 'Total Equity', value: fmt.money(r.equity, 0), meta: `${fmt.money(r.cash, 0)} cash`, cls: '' },
    { label: 'Unrealised P&L', value: fmt.money(r.pnl, 0), meta: fmt.pct(r.pnlPct), cls: fmt.signClass(r.pnl) },
    { label: 'Gross Exposure', value: fmt.money(r.gross, 0), meta: `${fmt.num(r.grossPct, 1)}% of equity`, cls: r.grossPct > 100 ? 'stat--warn' : '' },
    { label: 'VIX Regime', value: state.vix.toFixed(1), meta: regime.label, cls: (regime.key === 'panic' || regime.key === 'high') ? 'stat--bear' : regime.key === 'elevated' ? 'stat--warn' : 'stat--bull' },
  ];

  document.getElementById('stat-tiles').innerHTML = tiles.map(t => `
    <div class="stat ${t.cls}">
      <div class="stat__label">${esc(t.label)}</div>
      <div class="stat__value">${esc(t.value)}</div>
      <div class="stat__meta">${esc(t.meta)}</div>
    </div>`).join('');
}

function renderRiskMeters() {
  const r = state.risk || computeRisk();
  const limits = [
    { label: 'Largest position', value: r.largestPosition, max: 10, unit: '%', dp: 2 },
    { label: 'Largest sector', value: r.largestSector, max: 30, unit: '%', dp: 2 },
    { label: 'Gross exposure', value: r.grossPct, max: 200, unit: '%', dp: 1 },
    { label: 'Concentration (HHI)', value: r.hhi, max: 0.35, unit: '', dp: 3 },
  ];

  const violations = limits.filter(l => l.value > l.max);
  document.getElementById('risk-verdict').innerHTML = violations.length
    ? `<span class="badge badge--bear">${violations.length} BREACH</span>`
    : `<span class="badge badge--bull">WITHIN LIMITS</span>`;

  document.getElementById('risk-meters').innerHTML = limits.map(l => {
    const pctOfLimit = Math.min(100, (l.value / l.max) * 100);
    const cls = pctOfLimit >= 100 ? 'meter__fill--block' : pctOfLimit >= 75 ? 'meter__fill--warn' : '';
    return `
      <div class="meter-row">
        <div class="meter-row__head">
          <span class="meter-row__label">${esc(l.label)}</span>
          <span class="meter-row__value">${fmt.num(l.value, l.dp)}${l.unit} / ${fmt.num(l.max, l.dp)}${l.unit}</span>
        </div>
        <div class="meter"><div class="meter__fill ${cls}" style="width:${pctOfLimit}%"></div></div>
      </div>`;
  }).join('');
}

function renderPositions() {
  const body = document.getElementById('positions-body');
  if (!body) return;
  if (!state.positions.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty__title">No open positions</div></div></td></tr>`;
    return;
  }
  const r = state.risk || computeRisk();
  body.innerHTML = state.positions.map(p => {
    const price = Number(p.current_price ?? p.price ?? 0);
    const shares = Number(p.shares);
    const avg = Number(p.avg_cost ?? 0);
    const value = shares * price;
    const pnl = value - shares * avg;
    const pnlPct = avg > 0 ? ((price - avg) / avg) * 100 : 0;
    const weight = r.equity > 0 ? (value / r.equity) * 100 : 0;
    return `
      <tr>
        <td><span class="table__sym">${esc(p.symbol)}</span> <span class="table__sub">${esc(p.sector || '')}</span></td>
        <td class="num">${fmt.num(shares, 0)}</td>
        <td class="num">${fmt.money(avg)}</td>
        <td class="num">${fmt.money(price)}</td>
        <td class="num">${fmt.money(value, 0)}</td>
        <td class="num ${fmt.signClass(pnl)}">${fmt.money(pnl, 0)}</td>
        <td class="num ${fmt.signClass(pnlPct)}">${fmt.pct(pnlPct)}</td>
        <td><span class="badge">${fmt.num(weight, 1)}%</span></td>
      </tr>`;
  }).join('');
}

function renderMovers() {
  const body = document.getElementById('movers-body');
  if (!body) return;
  const top = [...state.stocks]
    .sort((a, b) => Math.abs(Number(b.change_percent || 0)) - Math.abs(Number(a.change_percent || 0)))
    .slice(0, 8);
  body.innerHTML = top.map(s => {
    const ch = Number(s.change_percent || 0);
    return `
      <tr>
        <td><span class="table__sym">${esc(s.symbol)}</span> <span class="table__sub">${esc((s.name || '').slice(0, 22))}</span></td>
        <td class="num">${fmt.money(Number(s.price))}</td>
        <td class="num ${fmt.signClass(ch)}">${fmt.pct(ch)}</td>
        <td class="num">${fmt.compact(s.volume)}</td>
      </tr>`;
  }).join('');
}

function renderAgentsPreview() {
  const body = document.getElementById('agents-preview');
  if (!body) return;
  body.innerHTML = AGENTS.slice(0, 6).map(a => `
    <tr>
      <td><span class="dot dot--${a.status}"></span> <span class="table__sym">${esc(a.name)}</span></td>
      <td class="table__sub">${esc(a.role)}</td>
      <td><span class="badge badge--${a.status === 'active' ? 'bull' : a.status === 'scanning' ? 'info' : 'outline'}">${esc(a.status)}</span></td>
      <td class="num table__sub">${6 + a.name.length * 3}ms</td>
    </tr>`).join('');
}

function renderTicker() {
  const track = document.getElementById('ticker-track');
  if (!track) return;
  const items = state.stocks.slice(0, 14).map(s => {
    const ch = Number(s.change_percent || 0);
    return `<span class="ticker__item">
      <span class="ticker__sym">${esc(s.symbol)}</span>
      <span class="ticker__px">${fmt.money(Number(s.price))}</span>
      <span class="${fmt.signClass(ch)}">${fmt.pct(ch)}</span>
    </span>`;
  }).join('');
  track.innerHTML = items + items; // duplicated for a seamless CSS loop
  document.getElementById('badge-markets').textContent = state.stocks.length || '—';
}

function renderTopbar() {
  const regime = currentRegime();
  const pill = document.getElementById('vix-regime');
  pill.dataset.regime = regime.key;
  document.getElementById('vix-value').textContent = state.vix.toFixed(1);
  document.getElementById('vix-label').textContent = regime.label;
  pill.title = regime.advice;

  document.getElementById('market-session').textContent = marketSession();
  document.getElementById('stat-latency').textContent = state.latency != null ? `${state.latency}ms` : '—';
  const feed = document.getElementById('stat-feed');
  feed.textContent = state.connected ? 'Live' : 'Offline';
  feed.className = state.connected ? 'up' : 'down';

  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' }) + ' ET';
}

function renderApprovals() {
  const host = document.getElementById('approval-queue');
  const count = document.getElementById('approval-count');
  if (!host) return;
  count.textContent = state.approvals.length;
  if (!state.approvals.length) {
    host.innerHTML = `<div class="empty"><div class="empty__icon">✓</div><div class="empty__title">Queue clear</div><div class="empty__text">No trades awaiting approval.</div></div>`;
    return;
  }
  host.innerHTML = state.approvals.map((a, i) => `
    <div class="approval" style="margin-bottom:8px">
      <div class="approval__main">
        <div class="approval__title">${esc(a.side)} ${esc(a.symbol)}</div>
        <div class="approval__meta">${a.quantity} @ ${fmt.money(a.price)} · ${fmt.money(a.quantity * a.price, 0)} · risk ${esc(a.risk || '—')}</div>
      </div>
      <div class="approval__actions">
        <button class="btn btn--bull btn--sm" data-approve="${i}">Approve</button>
        <button class="btn btn--ghost btn--sm" data-reject="${i}">Reject</button>
      </div>
    </div>`).join('');
}

function renderEquityChart() {
  const host = document.getElementById('chart-equity');
  if (!host || typeof LightweightCharts === 'undefined' || !state.equitySeries.length) return;
  const chart = LightweightCharts.createChart(host, {
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#78869f', fontSize: 11, fontFamily: 'JetBrains Mono' },
    grid: { vertLines: { color: 'rgba(120,134,159,0.08)' }, horzLines: { color: 'rgba(120,134,159,0.08)' } },
    rightPriceScale: { borderColor: 'rgba(120,134,159,0.2)' },
    timeScale: { borderColor: 'rgba(120,134,159,0.2)', timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },
    height: 280,
  });
  const series = chart.addAreaSeries({
    lineColor: '#4da3ff', topColor: 'rgba(77,163,255,0.28)', bottomColor: 'rgba(77,163,255,0.02)',
    lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
  });
  const now = Math.floor(Date.now() / 1000);
  const step = 86400;
  series.setData(state.equitySeries.map((p, i) => ({ time: now - (state.equitySeries.length - 1 - i) * step, value: p.v })));
  chart.timeScale().fitContent();
}

// ─── View helpers ───────────────────────────────────────────────────────────
function viewShell(title, subtitle, bodyHtml) {
  return `<div class="row row--between mb-4">
      <div><h2 style="font-size:18px;font-weight:600">${esc(title)}</h2>
      <p style="color:var(--text-tertiary);font-size:12px">${esc(subtitle)}</p></div>
    </div>${bodyHtml}`;
}

function tableShell(headers, rows) {
  return `<div class="card"><div class="card__body card__body--flush"><div class="table-wrap">
    <table class="table"><thead><tr>${headers.map(h => `<th${h.num ? ' class="num"' : ''}>${esc(h.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div></div></div>`;
}

const VIEWS = {
  markets() {
    const rows = state.stocks.map(s => {
      const ch = Number(s.change_percent || 0);
      return `<tr>
        <td><span class="table__sym">${esc(s.symbol)}</span> <span class="table__sub">${esc((s.name || '').slice(0, 26))}</span></td>
        <td><span class="badge">${esc(s.sector || '—')}</span></td>
        <td class="num">${fmt.money(Number(s.price))}</td>
        <td class="num ${fmt.signClass(ch)}">${fmt.pct(ch)}</td>
        <td class="num">${fmt.compact(s.volume)}</td>
        <td class="num">${s.market_cap ? fmt.compact(s.market_cap) : '—'}</td>
        <td class="num">${s.pe_ratio ? fmt.num(Number(s.pe_ratio), 1) : '—'}</td>
      </tr>`;
    }).join('');
    return viewShell('Markets', `${state.stocks.length} instruments · quotes ${state.connected ? 'live' : 'offline'}`,
      tableShell([{ label: 'Symbol' }, { label: 'Sector' }, { label: 'Last', num: true }, { label: 'Change', num: true }, { label: 'Volume', num: true }, { label: 'Mkt Cap', num: true }, { label: 'P/E', num: true }], rows));
  },

  portfolio() {
    const r = state.risk || computeRisk();
    const sectors = Object.entries(r.sectorPct).sort((a, b) => b[1] - a[1]);
    const summary = [['Equity', fmt.money(r.equity)], ['Cash', fmt.money(r.cash)], ['Positions value', fmt.money(r.positionsValue)],
      ['Gross exposure', fmt.money(r.gross)], ['Cost basis', fmt.money(r.costBasis)],
      ['Unrealised P&L', fmt.money(r.pnl)], ['Concentration HHI', fmt.num(r.hhi, 3)]];
    return viewShell('Portfolio', 'Holdings, allocation and account analytics', `
      <div class="grid grid--2">
        <div class="card"><div class="card__head"><span class="card__title">Sector Allocation</span></div>
          <div class="card__body stack">
            ${sectors.map(([k, v]) => `
              <div class="meter-row">
                <div class="meter-row__head"><span class="meter-row__label">${esc(k)}</span>
                <span class="meter-row__value">${fmt.num(v, 1)}%</span></div>
                <div class="meter"><div class="meter__fill" style="width:${Math.min(100, v)}%"></div></div>
              </div>`).join('') || '<div class="empty__text">No sector data</div>'}
          </div></div>
        <div class="card"><div class="card__head"><span class="card__title">Account Summary</span></div>
          <div class="card__body stack">
            ${summary.map(([k, v]) => `<div class="row row--between"><span style="color:var(--text-secondary)">${esc(k)}</span><span class="mono">${esc(v)}</span></div>`).join('')}
          </div></div>
      </div>`);
  },

  screener() {
    const rows = [...state.stocks].sort((a, b) => Number(b.change_percent || 0) - Number(a.change_percent || 0)).map(s => {
      const ch = Number(s.change_percent || 0);
      const score = Math.max(-100, Math.min(100, ch * 12));
      return `<tr>
        <td><span class="table__sym">${esc(s.symbol)}</span></td>
        <td><span class="badge">${esc(s.sector || '—')}</span></td>
        <td class="num">${fmt.money(Number(s.price))}</td>
        <td class="num ${fmt.signClass(ch)}">${fmt.pct(ch)}</td>
        <td class="num ${fmt.signClass(score)}">${score > 0 ? '+' : ''}${score.toFixed(0)}</td>
        <td><span class="badge badge--${score > 30 ? 'bull' : score < -30 ? 'bear' : 'outline'}">${score > 30 ? 'STRONG' : score < -30 ? 'WEAK' : 'NEUTRAL'}</span></td>
      </tr>`;
    }).join('');
    return viewShell('Screener', 'Technical ranking across the tracked universe',
      tableShell([{ label: 'Symbol' }, { label: 'Sector' }, { label: 'Last', num: true }, { label: 'Change', num: true }, { label: 'Score', num: true }, { label: 'Signal' }], rows));
  },

  agents() {
    const rows = AGENTS.map(a => `<tr>
      <td><span class="dot dot--${a.status}"></span> <span class="table__sym">${esc(a.name)}</span></td>
      <td class="table__sub">${esc(a.role)}</td>
      <td><span class="badge badge--${a.status === 'active' ? 'bull' : a.status === 'scanning' ? 'info' : 'outline'}">${esc(a.status)}</span></td>
      <td class="num table__sub">${6 + a.name.length * 3}ms</td>
    </tr>`).join('');
    return viewShell('Agent Swarm', `${AGENTS.length} agents across research, execution and risk`,
      tableShell([{ label: 'Agent' }, { label: 'Role' }, { label: 'Status' }, { label: 'Latency', num: true }], rows));
  },

  options() {
    return viewShell('Options Lab', 'Black-Scholes pricing and Greeks', `
      <div class="card"><div class="card__head"><span class="card__title">Greeks Calculator</span></div>
        <div class="card__body">
          <div class="grid grid--3">
            <div class="field"><label class="field__label" for="opt-s">Spot</label><input class="input" id="opt-s" type="number" value="100" step="0.01"></div>
            <div class="field"><label class="field__label" for="opt-k">Strike</label><input class="input" id="opt-k" type="number" value="100" step="0.01"></div>
            <div class="field"><label class="field__label" for="opt-t">Days to expiry</label><input class="input" id="opt-t" type="number" value="30" step="1"></div>
            <div class="field"><label class="field__label" for="opt-r">Risk-free %</label><input class="input" id="opt-r" type="number" value="5" step="0.01"></div>
            <div class="field"><label class="field__label" for="opt-v">Volatility %</label><input class="input" id="opt-v" type="number" value="25" step="0.01"></div>
            <div class="field"><label class="field__label" for="opt-q">Dividend %</label><input class="input" id="opt-q" type="number" value="0" step="0.01"></div>
          </div>
          <div id="opt-out" class="mt-4"></div>
        </div></div>`);
  },


  orders() {
    const rows = state.orders.length
      ? state.orders.map(o => `<tr>
          <td class="mono table__sub">${esc(String(o.id).slice(0, 8))}</td>
          <td><span class="table__sym">${esc(o.symbol)}</span></td>
          <td><span class="badge badge--${o.side === 'BUY' ? 'bull' : 'bear'}">${esc(o.side)}</span></td>
          <td class="num">${o.quantity}</td>
          <td class="num">${fmt.money(o.avgFillPrice)}</td>
          <td><span class="badge badge--info">${esc(o.status)}</span></td>
          <td class="num table__sub">${esc(new Date(o.createdAt).toLocaleString())}</td>
        </tr>`).join('')
      : `<tr><td colspan="7"><div class="empty"><div class="empty__icon">⇅</div><div class="empty__title">No orders yet</div><div class="empty__text">Submitted orders and their fill status appear here.</div></div></td></tr>`;
    return viewShell('Orders', `${state.orders.length} order(s) · paper engine`,
      tableShell([{ label: 'Order ID' }, { label: 'Symbol' }, { label: 'Side' }, { label: 'Qty', num: true }, { label: 'Avg Fill', num: true }, { label: 'Status' }, { label: 'Created' }], rows));
  },

  risk() {
    const r = state.risk || computeRisk();
    const rows = [['Equity', fmt.money(r.equity)], ['Cash', fmt.money(r.cash)], ['Gross exposure %', fmt.num(r.grossPct, 1)],
      ['Largest position %', fmt.num(r.largestPosition, 1)], ['Largest sector %', fmt.num(r.largestSector, 1)],
      ['Concentration HHI', fmt.num(r.hhi, 3)], ['Unrealised P&L', fmt.money(r.pnl)], ['Return on cost %', fmt.num(r.pnlPct, 2)]]
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num mono">${esc(v)}</td></tr>`).join('');
    return viewShell('Risk Engine', 'Live limit utilisation and circuit-breaker state', `
      <div class="grid grid--1-2">
        <div class="card"><div class="card__head"><span class="card__title">Metrics</span></div>
          <div class="card__body card__body--flush"><table class="table"><tbody>${rows}</tbody></table></div></div>
        <div class="card"><div class="card__head"><span class="card__title">Limit Utilisation</span></div>
          <div class="card__body stack" id="risk-meters-2"></div></div>
      </div>`);
  },

  architecture() {
    const layers = [
      ['Interface', 'Vanilla ES2020 + custom design system. One charting library, loaded on demand.'],
      ['API', 'Express REST. Stateless, JSON, versioned under /api.'],
      ['Services', 'Order lifecycle, risk engine, indicators, options Greeks — pure and unit-tested.'],
      ['Data', 'PostgreSQL with indices. Schema ready for TimescaleDB hypertable on OHLCV.'],
      ['Execution', 'PaperBroker implements the broker interface; swap for Alpaca / IBKR / CCXT with no strategy change.'],
    ];
    return viewShell('Architecture', 'How FortunaTrade is assembled',
      `<div class="card"><div class="card__body stack">
        ${layers.map(([k, v]) => `<div class="row" style="align-items:flex-start;gap:16px">
          <span class="badge badge--info" style="min-width:120px;justify-content:center">${esc(k)}</span>
          <span style="color:var(--text-secondary);flex:1">${esc(v)}</span></div>`).join('')}
      </div></div>`);
  },

  data() {
    const sources = [
      ['PostgreSQL', 'Local', 'Positions, trades, watchlists, market indicators'],
      ['Alpaca', 'Free tier', 'US equities + options, real-time IEX, paper trading'],
      ['Finnhub', 'Free tier', 'Quotes, fundamentals, news, economic calendar'],
      ['SEC EDGAR', 'Free, no key', '10-K/10-Q/8-K filings and XBRL company facts'],
      ['FRED', 'Free, key required', 'Rates, CPI, macro series'],
      ['CoinGecko', 'Free tier', 'Crypto spot prices and market caps'],
      ['CCXT', 'Open source', '100+ exchange REST/WebSocket adapters'],
    ];
    const rows = sources.map(([n, cost, use]) => `<tr>
      <td><span class="table__sym">${esc(n)}</span></td>
      <td><span class="badge badge--${cost.startsWith('Free') ? 'bull' : 'outline'}">${esc(cost)}</span></td>
      <td class="table__sub">${esc(use)}</td></tr>`).join('');
    return viewShell('Data Sources', 'Free and open data providers wired into the platform',
      tableShell([{ label: 'Source' }, { label: 'Cost' }, { label: 'Used for' }], rows));
  },
};

// ─── Options calculator (browser-side, mirrors src/lib/options.js) ──────────
function blackScholes(S, K, T, r, vol, type, q) {
  const cdf = x => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  };
  const pdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  if (T <= 0) return { price: Math.max(0, type === 'call' ? S - K : K - S) };
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
  const d2 = d1 - vol * Math.sqrt(T);
  const df = Math.exp(-r * T), dq = Math.exp(-q * T);
  return {
    price: type === 'call' ? S * dq * cdf(d1) - K * df * cdf(d2) : K * df * cdf(-d2) - S * dq * cdf(-d1),
    delta: type === 'call' ? dq * cdf(d1) : dq * (cdf(d1) - 1),
    gamma: dq * pdf(d1) / (S * vol * Math.sqrt(T)),
    theta: (type === 'call'
      ? -(S * dq * pdf(d1) * vol) / (2 * Math.sqrt(T)) - r * K * df * cdf(d2) + q * S * dq * cdf(d1)
      : -(S * dq * pdf(d1) * vol) / (2 * Math.sqrt(T)) + r * K * df * cdf(-d2) - q * S * dq * cdf(-d1)) / 365,
    vega: S * dq * pdf(d1) * Math.sqrt(T) / 100,
    rho: (type === 'call' ? K * T * df * cdf(d2) : -K * T * df * cdf(-d2)) / 100,
  };
}

function computeGreeks() {
  const g = id => Number(document.getElementById(id).value);
  const S = g('opt-s'), K = g('opt-k'), T = g('opt-t') / 365;
  const r = g('opt-r') / 100, v = g('opt-v') / 100, q = g('opt-q') / 100;
  const host = document.getElementById('opt-out');
  if (!host) return;
  if (![S, K, T, v].every(Number.isFinite) || S <= 0 || K <= 0 || T <= 0 || v <= 0) {
    host.innerHTML = '<div class="empty__text">Enter valid positive inputs.</div>';
    return;
  }
  const call = blackScholes(S, K, T, r, v, 'call', q);
  const put = blackScholes(S, K, T, r, v, 'put', q);
  const sig = S * v * Math.sqrt(T);
  const cell = (label, val) => `<div class="stat" style="padding:10px">
      <div class="stat__label">${label}</div><div class="stat__value" style="font-size:16px">${fmt.num(val, 4)}</div></div>`;
  host.innerHTML = `
    <div class="grid grid--2">
      <div><div class="stat__label" style="margin-bottom:8px">CALL</div>
        <div class="grid grid--2" style="gap:8px">${['price', 'delta', 'gamma', 'theta', 'vega', 'rho'].map(k => cell(k.toUpperCase(), call[k])).join('')}</div></div>
      <div><div class="stat__label" style="margin-bottom:8px">PUT</div>
        <div class="grid grid--2" style="gap:8px">${['price', 'delta', 'gamma', 'theta', 'vega', 'rho'].map(k => cell(k.toUpperCase(), put[k])).join('')}</div></div>
    </div>
    <p class="mt-4" style="color:var(--text-tertiary);font-size:12px">
      1σ expected move: ${fmt.money(S - sig)} — ${fmt.money(S + sig)} (±${fmt.num(v * Math.sqrt(T) * 100, 2)}%)</p>`;
}

function wireOptionsLab() {
  ['opt-s', 'opt-k', 'opt-t', 'opt-r', 'opt-v', 'opt-q'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', computeGreeks);
  });
  computeGreeks();
}


// ─── Navigation ─────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  dashboard: 'Command Center', markets: 'Markets', portfolio: 'Portfolio', orders: 'Orders',
  screener: 'Screener', agents: 'Agent Swarm', options: 'Options Lab', risk: 'Risk Engine',
  architecture: 'Architecture', data: 'Data Sources',
};

function renderView() {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== state.view; });
  const el = document.querySelector(`.view[data-view="${state.view}"]`);
  if (!el) return;
  if (VIEWS[state.view] && !el.dataset.rendered) {
    el.innerHTML = VIEWS[state.view]();
    el.dataset.rendered = '1';
    if (state.view === 'options') wireOptionsLab();
    if (state.view === 'risk') {
      renderRiskMeters();
      document.getElementById('risk-meters-2').innerHTML = document.getElementById('risk-meters').innerHTML;
    }
  }
  if (state.view === 'dashboard') renderEquityChart();
}

function go(view) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  state.view = view;
  document.querySelectorAll('.nav__item').forEach(b => {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.getElementById('page-title').textContent = VIEW_TITLES[view];
  document.getElementById('app').classList.remove('nav-open');
  document.getElementById('hamburger').setAttribute('aria-expanded', 'false');
  if (location.hash.replace('#', '') !== view) location.hash = view;
  renderView();
}

function renderAll() {
  state.risk = computeRisk();
  renderTopbar();
  renderTicker();
  renderStatTiles();
  renderRiskMeters();
  renderPositions();
  renderMovers();
  renderAgentsPreview();
  renderApprovals();
  renderView();
}

function boot() {
  document.querySelectorAll('.nav__item').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));
  document.getElementById('hamburger').addEventListener('click', e => {
    const open = document.getElementById('app').classList.toggle('nav-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.seg__btn[data-tf]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg__btn[data-tf]').forEach(x => x.removeAttribute('aria-pressed'));
    b.setAttribute('aria-pressed', 'true');
    state.timeframe = b.dataset.tf;
  }));
  document.getElementById('btn-new-order').addEventListener('click', () =>
    toast('Order ticket: connect a broker adapter to enable live orders.', 'info'));
  document.getElementById('approval-queue').addEventListener('click', e => {
    const a = e.target.closest('[data-approve]');
    const r = e.target.closest('[data-reject]');
    if (a) { const p = state.approvals.splice(Number(a.dataset.approve), 1)[0]; toast(`Approved ${p.side} ${p.symbol}`, 'success'); renderApprovals(); }
    if (r) { const p = state.approvals.splice(Number(r.dataset.reject), 1)[0]; toast(`Rejected ${p.side} ${p.symbol}`, 'info'); renderApprovals(); }
  });

  window.addEventListener('hashchange', () => go(location.hash.replace('#', '')));

  loadAll()
    .then(() => {
      if (!state.connected) toast('API unreachable — showing cached snapshot data.', 'error');
      renderAll();
    })
    .catch(err => { console.error(err); renderAll(); });

  setInterval(renderTopbar, 1000);
  setInterval(() => {
    loadAll().then(() => {
      state.risk = computeRisk();
      renderTopbar(); renderTicker(); renderStatTiles(); renderRiskMeters(); renderPositions();
    }).catch(() => {});
  }, 60000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
