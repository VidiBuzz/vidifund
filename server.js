const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3030;

// Analytics routes (indicators, options, risk) backed by src/lib
const { registerAnalyticsRoutes } = require('./src/routes/analytics');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Database initialization
async function initDB() {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS stocks (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        sector VARCHAR(100),
        industry VARCHAR(100),
        market_cap BIGINT,
        price DECIMAL(10, 2),
        change_percent DECIMAL(5, 2),
        volume BIGINT,
        pe_ratio DECIMAL(10, 2),
        dividend_yield DECIMAL(5, 2),
        week_52_high DECIMAL(10, 2),
        week_52_low DECIMAL(10, 2),
        description TEXT,
        logo_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_prices (
        id SERIAL PRIMARY KEY,
        stock_id INTEGER REFERENCES stocks(id),
        price DECIMAL(10, 2) NOT NULL,
        open DECIMAL(10, 2),
        high DECIMAL(10, 2),
        low DECIMAL(10, 2),
        volume BIGINT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS portfolios (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        user_id VARCHAR(100),
        total_value DECIMAL(15, 2) DEFAULT 0,
        cash_balance DECIMAL(15, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id),
        stock_id INTEGER REFERENCES stocks(id),
        shares DECIMAL(10, 4) NOT NULL,
        avg_cost DECIMAL(10, 2),
        current_value DECIMAL(15, 2),
        unrealized_pnl DECIMAL(15, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id),
        stock_id INTEGER REFERENCES stocks(id),
        action VARCHAR(10) NOT NULL CHECK (action IN ('BUY', 'SELL')),
        shares DECIMAL(10, 4) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        total DECIMAL(15, 2),
        notes TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS watchlists (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        user_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS watchlist_items (
        id SERIAL PRIMARY KEY,
        watchlist_id INTEGER REFERENCES watchlists(id),
        stock_id INTEGER REFERENCES stocks(id),
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(watchlist_id, stock_id)
      );

      CREATE TABLE IF NOT EXISTS market_indicators (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        value DECIMAL(15, 4),
        change_percent DECIMAL(5, 2),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_stocks_symbol ON stocks(symbol);
      CREATE INDEX IF NOT EXISTS idx_stock_prices_stock_id ON stock_prices(stock_id);
      CREATE INDEX IF NOT EXISTS idx_stock_prices_timestamp ON stock_prices(timestamp);
      CREATE INDEX IF NOT EXISTS idx_positions_portfolio_id ON positions(portfolio_id);
      CREATE INDEX IF NOT EXISTS idx_trades_portfolio_id ON trades(portfolio_id);
    `);
        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
    }
}

// Seed initial stock data
async function seedStocks() {
    try {
        const count = await pool.query('SELECT COUNT(*) FROM stocks');
        if (parseInt(count.rows[0].count) > 0) {
            console.log('✅ Stocks already seeded');
            return;
        }

        const stocks = [
            { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', price: 178.72, change: 1.23, volume: 54200000, pe: 29.5, dividend: 0.55, high: 198.23, low: 143.90 },
            { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', industry: 'Software', price: 378.91, change: 0.87, volume: 22100000, pe: 35.2, dividend: 0.72, high: 384.30, low: 275.37 },
            { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors', price: 875.28, change: 3.45, volume: 41500000, pe: 65.8, dividend: 0.02, high: 974.00, low: 373.56 },
            { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', industry: 'Internet Content', price: 141.80, change: -0.52, volume: 25300000, pe: 25.4, dividend: 0, high: 153.78, low: 101.88 },
            { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical', industry: 'Internet Retail', price: 178.25, change: 1.15, volume: 48700000, pe: 60.2, dividend: 0, high: 189.77, low: 118.35 },
            { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', industry: 'Internet Content', price: 505.75, change: 2.18, volume: 18900000, pe: 28.9, dividend: 0, high: 542.81, low: 274.38 },
            { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', price: 248.42, change: -1.87, volume: 112300000, pe: 72.1, dividend: 0, high: 299.29, low: 152.37 },
            { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services', industry: 'Insurance', price: 408.95, change: 0.34, volume: 3200000, pe: 9.8, dividend: 0, high: 421.70, low: 337.10 },
            { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banks', price: 198.47, change: 0.92, volume: 8900000, pe: 11.5, dividend: 2.32, high: 205.88, low: 135.19 },
            { symbol: 'V', name: 'Visa Inc.', sector: 'Financial Services', industry: 'Credit Services', price: 279.32, change: 0.45, volume: 6700000, pe: 30.1, dividend: 0.74, high: 290.96, low: 221.66 },
            { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Drug Manufacturers', price: 156.74, change: -0.28, volume: 7100000, pe: 22.3, dividend: 3.05, high: 175.97, low: 144.95 },
            { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Defensive', industry: 'Discount Stores', price: 165.23, change: 0.67, volume: 8200000, pe: 27.8, dividend: 1.28, high: 170.53, low: 147.23 },
            { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy', industry: 'Oil & Gas', price: 104.56, change: -0.89, volume: 14500000, pe: 13.2, dividend: 3.45, high: 120.70, low: 95.77 },
            { symbol: 'PG', name: 'Procter & Gamble Co.', sector: 'Consumer Defensive', industry: 'Household Products', price: 162.89, change: 0.23, volume: 6300000, pe: 25.6, dividend: 2.38, high: 168.48, low: 141.24 },
            { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financial Services', industry: 'Credit Services', price: 458.92, change: 0.78, volume: 2900000, pe: 35.4, dividend: 0.57, high: 490.05, low: 359.42 },
            { symbol: 'HD', name: 'Home Depot Inc.', sector: 'Consumer Cyclical', industry: 'Home Improvement', price: 362.45, change: 1.12, volume: 3800000, pe: 23.7, dividend: 2.35, high: 407.41, low: 285.37 },
            { symbol: 'BAC', name: 'Bank of America Corp.', sector: 'Financial Services', industry: 'Banks', price: 34.78, change: 0.56, volume: 42100000, pe: 11.2, dividend: 2.65, high: 37.85, low: 26.33 },
            { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare', industry: 'Drug Manufacturers', price: 28.45, change: -0.34, volume: 38900000, pe: 15.8, dividend: 5.62, high: 35.72, low: 25.20 },
            { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare', industry: 'Drug Manufacturers', price: 172.34, change: 0.89, volume: 5600000, pe: 38.2, dividend: 3.52, high: 182.44, low: 140.95 },
            { symbol: 'COST', name: 'Costco Wholesale Corp.', sector: 'Consumer Defensive', industry: 'Discount Stores', price: 728.91, change: 0.45, volume: 2100000, pe: 45.6, dividend: 0.62, high: 765.42, low: 531.40 },
            { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology', industry: 'Semiconductors', price: 1345.67, change: 2.34, volume: 2800000, pe: 35.8, dividend: 1.85, high: 1415.24, low: 795.85 },
            { symbol: 'UNH', name: 'UnitedHealth Group Inc.', sector: 'Healthcare', industry: 'Healthcare Plans', price: 527.89, change: -0.67, volume: 3200000, pe: 22.4, dividend: 1.45, high: 558.10, low: 445.68 },
            { symbol: 'ORCL', name: 'Oracle Corporation', sector: 'Technology', industry: 'Software', price: 127.45, change: 1.56, volume: 8900000, pe: 32.1, dividend: 1.22, high: 132.13, low: 99.26 },
            { symbol: 'INTC', name: 'Intel Corporation', sector: 'Technology', industry: 'Semiconductors', price: 43.21, change: -1.23, volume: 45600000, pe: 85.2, dividend: 1.45, high: 51.28, low: 18.51 },
            { symbol: 'VZ', name: 'Verizon Communications', sector: 'Communication Services', industry: 'Telecom', price: 40.56, change: 0.12, volume: 18700000, pe: 14.5, dividend: 6.52, high: 43.42, low: 30.15 },
            { symbol: 'T', name: 'AT&T Inc.', sector: 'Communication Services', industry: 'Telecom', price: 17.89, change: -0.23, volume: 35400000, pe: 12.8, dividend: 5.85, high: 19.55, low: 13.43 },
            { symbol: 'IBM', name: 'International Business Machines', sector: 'Technology', industry: 'IT Services', price: 185.67, change: 0.78, volume: 4200000, pe: 22.5, dividend: 3.45, high: 199.18, low: 135.87 },
            { symbol: 'TXN', name: 'Texas Instruments Inc.', sector: 'Technology', industry: 'Semiconductors', price: 189.34, change: 1.45, volume: 5100000, pe: 24.8, dividend: 2.85, high: 199.90, low: 155.52 }
        ];

        for (const stock of stocks) {
            await pool.query(
                `INSERT INTO stocks (symbol, name, sector, industry, price, change_percent, volume, pe_ratio, dividend_yield, week_52_high, week_52_low, logo_url) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (symbol) DO NOTHING`,
                [stock.symbol, stock.name, stock.sector, stock.industry, stock.price, stock.change, stock.volume, stock.pe, stock.dividend, stock.high, stock.low, `/images/stocks/${stock.symbol.toLowerCase()}.png`]
            );
        }
        console.log(`✅ Seeded ${stocks.length} stocks`);

        // Seed market indicators
        const indicators = [
            { name: 'S&P 500', value: 5234.18, change: 0.87 },
            { name: 'NASDAQ', value: 16399.52, change: 1.23 },
            { name: 'DOW JONES', value: 39512.84, change: 0.45 },
            { name: 'VIX', value: 13.45, change: -2.34 },
            { name: '10Y TREASURY', value: 4.285, change: 0.12 },
            { name: 'GOLD', value: 2345.60, change: 0.56 },
            { name: 'BITCOIN', value: 67890.00, change: 2.45 },
            { name: 'EUR/USD', value: 1.0845, change: -0.15 }
        ];

        for (const ind of indicators) {
            await pool.query(
                `INSERT INTO market_indicators (name, value, change_percent) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [ind.name, ind.value, ind.change]
            );
        }
        console.log(`✅ Seeded ${indicators.length} market indicators`);

        // Seed default portfolio
        const portfolio = await pool.query(
            `INSERT INTO portfolios (name, user_id, total_value, cash_balance) VALUES ($1, $2, $3, $4) RETURNING id`,
            ['Main Portfolio', 'default', 1000000, 250000]
        );
        const portfolioId = portfolio.rows[0].id;

        // Seed positions
        const positions = [
            { stock: 'AAPL', shares: 500, avgCost: 165.50 },
            { stock: 'MSFT', shares: 300, avgCost: 345.20 },
            { stock: 'NVDA', shares: 200, avgCost: 720.00 },
            { stock: 'GOOGL', shares: 800, avgCost: 125.30 },
            { stock: 'AMZN', shares: 400, avgCost: 155.80 },
            { stock: 'META', shares: 150, avgCost: 420.50 },
            { stock: 'JPM', shares: 600, avgCost: 175.40 },
            { stock: 'V', shares: 250, avgCost: 255.60 }
        ];

        for (const pos of positions) {
            const stockResult = await pool.query('SELECT id, price FROM stocks WHERE symbol = $1', [pos.stock]);
            if (stockResult.rows.length > 0) {
                const stock = stockResult.rows[0];
                const currentValue = stock.price * pos.shares;
                const unrealizedPnl = currentValue - (pos.avgCost * pos.shares);
                await pool.query(
                    `INSERT INTO positions (portfolio_id, stock_id, shares, avg_cost, current_value, unrealized_pnl) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [portfolioId, stock.id, pos.shares, pos.avgCost, currentValue, unrealizedPnl]
                );
            }
        }
        console.log(`✅ Seeded ${positions.length} positions`);

    } catch (err) {
        console.error('❌ Seed error:', err.message);
    }
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'VidiFund', timestamp: new Date().toISOString() });
});

// Get all stocks
app.get('/api/stocks', async (req, res) => {
    try {
        const { sector, search, limit = 50, offset = 0 } = req.query;
        let query = 'SELECT * FROM stocks WHERE 1=1';
        const params = [];
        let paramCount = 1;

        if (sector) {
            query += ` AND sector = $${paramCount}`;
            params.push(sector);
            paramCount++;
        }

        if (search) {
            query += ` AND (symbol ILIKE $${paramCount} OR name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        query += ` ORDER BY market_cap DESC NULLS LAST LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        res.json({ stocks: result.rows, total: result.rows.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single stock
app.get('/api/stocks/:symbol', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM stocks WHERE symbol = $1', [req.params.symbol.toUpperCase()]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Stock not found' });
        }
        res.json({ stock: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get stock price history
app.get('/api/stocks/:symbol/history', async (req, res) => {
    try {
        const { period = '1M' } = req.query;
        const stock = await pool.query('SELECT id FROM stocks WHERE symbol = $1', [req.params.symbol.toUpperCase()]);
        if (stock.rows.length === 0) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        const interval = period === '1D' ? '1 hour' : period === '1W' ? '6 hours' : period === '1M' ? '1 day' : period === '1Y' ? '1 week' : '1 month';
        const result = await pool.query(
            `SELECT price, timestamp FROM stock_prices 
       WHERE stock_id = $1 AND timestamp >= NOW() - INTERVAL '${period}'
       ORDER BY timestamp ASC`,
            [stock.rows[0].id]
        );
        res.json({ history: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get market indicators
app.get('/api/market', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM market_indicators ORDER BY name');
        res.json({ indicators: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get portfolio
app.get('/api/portfolio', async (req, res) => {
    try {
        const portfolio = await pool.query('SELECT * FROM portfolios WHERE user_id = $1 LIMIT 1', ['default']);
        if (portfolio.rows.length === 0) {
            return res.status(404).json({ error: 'Portfolio not found' });
        }

        const positions = await pool.query(
            `SELECT p.*, s.symbol, s.name, s.sector, s.price as current_price, s.change_percent, s.logo_url
       FROM positions p
       JOIN stocks s ON p.stock_id = s.id
       WHERE p.portfolio_id = $1
       ORDER BY p.current_value DESC`,
            [portfolio.rows[0].id]
        );

        const totalValue = positions.rows.reduce((sum, p) => sum + parseFloat(p.current_value), 0);
        const totalPnl = positions.rows.reduce((sum, p) => sum + parseFloat(p.unrealized_pnl), 0);

        res.json({
            portfolio: portfolio.rows[0],
            positions: positions.rows,
            summary: {
                totalValue,
                totalPnl,
                pnlPercent: totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0,
                positionCount: positions.rows.length
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get sectors
app.get('/api/sectors', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT sector, COUNT(*) as count, AVG(change_percent) as avg_change
       FROM stocks
       GROUP BY sector
       ORDER BY count DESC`
        );
        res.json({ sectors: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get watchlist
app.get('/api/watchlist', async (req, res) => {
    try {
        const watchlist = await pool.query('SELECT * FROM watchlists WHERE user_id = $1 LIMIT 1', ['default']);
        if (watchlist.rows.length === 0) {
            return res.json({ watchlist: [], items: [] });
        }

        const items = await pool.query(
            `SELECT s.*, w.added_at
       FROM watchlist_items w
       JOIN stocks s ON w.stock_id = s.id
       WHERE w.watchlist_id = $1
       ORDER BY w.added_at DESC`,
            [watchlist.rows[0].id]
        );
        res.json({ watchlist: watchlist.rows[0], items: items.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add to watchlist
app.post('/api/watchlist', async (req, res) => {
    try {
        const { symbol } = req.body;
        const stock = await pool.query('SELECT id FROM stocks WHERE symbol = $1', [symbol.toUpperCase()]);
        if (stock.rows.length === 0) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        let watchlist = await pool.query('SELECT id FROM watchlists WHERE user_id = $1 LIMIT 1', ['default']);
        if (watchlist.rows.length === 0) {
            watchlist = await pool.query('INSERT INTO watchlists (name, user_id) VALUES ($1, $2) RETURNING id', ['My Watchlist', 'default']);
        }

        await pool.query(
            `INSERT INTO watchlist_items (watchlist_id, stock_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [watchlist.rows[0].id, stock.rows[0].id]
        );
        res.json({ success: true, message: 'Added to watchlist' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove from watchlist
app.delete('/api/watchlist/:symbol', async (req, res) => {
    try {
        const stock = await pool.query('SELECT id FROM stocks WHERE symbol = $1', [req.params.symbol.toUpperCase()]);
        const watchlist = await pool.query('SELECT id FROM watchlists WHERE user_id = $1 LIMIT 1', ['default']);
        if (watchlist.rows.length > 0 && stock.rows.length > 0) {
            await pool.query('DELETE FROM watchlist_items WHERE watchlist_id = $1 AND stock_id = $2', [watchlist.rows[0].id, stock.rows[0].id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get trade history
app.get('/api/trades', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const result = await pool.query(
            `SELECT t.*, s.symbol, s.name
       FROM trades t
       JOIN stocks s ON t.stock_id = s.id
       ORDER BY t.executed_at DESC
       LIMIT $1`,
            [parseInt(limit)]
        );
        res.json({ trades: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Execute trade
app.post('/api/trades', async (req, res) => {
    try {
        const { symbol, action, shares, price, notes } = req.body;
        const stock = await pool.query('SELECT id FROM stocks WHERE symbol = $1', [symbol.toUpperCase()]);
        if (stock.rows.length === 0) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        const portfolio = await pool.query('SELECT id FROM portfolios WHERE user_id = $1 LIMIT 1', ['default']);
        const total = shares * price;

        const trade = await pool.query(
            `INSERT INTO trades (portfolio_id, stock_id, action, shares, price, total, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [portfolio.rows[0].id, stock.rows[0].id, action, shares, price, total, notes]
        );

        res.json({ success: true, trade: trade.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Simulate price updates (for demo purposes)
app.post('/api/simulate', async (req, res) => {
    try {
        const stocks = await pool.query('SELECT id, price, change_percent FROM stocks');
        for (const stock of stocks.rows) {
            const change = (Math.random() - 0.5) * 2;
            const newPrice = parseFloat(stock.price) * (1 + change / 100);
            await pool.query(
                `UPDATE stocks SET price = $1, change_percent = $2, updated_at = NOW() WHERE id = $3`,
                [newPrice.toFixed(2), change, stock.id]
            );
            await pool.query(
                `INSERT INTO stock_prices (stock_id, price, open, high, low, volume) VALUES ($1, $2, $3, $4, $5, $6)`,
                [stock.id, newPrice.toFixed(2), newPrice.toFixed(2), (newPrice * 1.01).toFixed(2), (newPrice * 0.99).toFixed(2), Math.floor(Math.random() * 10000000)]
            );
        }
        res.json({ success: true, message: `Updated ${stocks.rows.length} stocks` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Analytics routes (indicators / options / risk) must be registered before
// the catch-all below, otherwise the SPA handler swallows them.
registerAnalyticsRoutes(app, pool);

// Serve frontend for all non-API routes
// v2 is the default interface; the v1 monolith stays available at /v1 for
// comparison until the redesign is signed off.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'ui', 'index.html'));
});

app.get('/v1', (req, res) => {
    res.sendFile(path.join(__dirname, 'FortunaTrade-unified.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'ui', 'index.html'));
});

// Start server
async function start() {
    try {
        await initDB();
        await seedStocks();
        app.listen(PORT, () => {
            console.log(`🚀 VidiFund server running on port ${PORT}`);
            console.log(`📊 API: http://localhost:${PORT}/api/stocks`);
            console.log(`💼 Dashboard: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
