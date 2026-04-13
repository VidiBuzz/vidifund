# VidiFund Stock Logo Agents

## Overview

This is a multi-agent system for downloading company logos for all stocks in the VidiFund portfolio. It uses Playwright to scrape logos from various sources (Clearbit API, Yahoo Finance, TradingView).

## Files Created

| File | Purpose |
|------|---------|
| `download_stock_logos.py` | Sequential logo downloader (single process) |
| `logo_downloader_agent.py` | Parallel agent system (4 workers) |
| `run_logo_agents.bat` | Windows batch launcher with menu |
| `vidifund-media/` | Output directory for all media assets |

## Directory Structure

```
M:\code\vidismart\vidifund-media\
├── audio\
│   ├── summary\         # Overview page audio
│   ├── funds\           # Per-fund audio briefings
│   └── stocks\          # Per-stock audio briefings
├── video\
│   ├── summary\         # Overview videos
│   ├── funds\           # Fund-specific videos
│   └── tutorials\       # Educational content
└── images\
    ├── funds\           # Fund hero images
    ├── stocks\          # Company logos (50 stocks)
    ├── charts\          # Data visualizations
    ├── icons\           # UI icons
    └── thumbs\          # Video thumbnails
```

## How to Run

### Option 1: Windows Batch File (Easiest)
```batch
M:\code\vidismart\run_logo_agents.bat
```
Then choose:
- **1** = Sequential download (single process, reliable)
- **2** = Parallel download (4 workers, faster)

### Option 2: Python Direct
```bash
# Sequential
cd M:\code\vidismart
venv\Scripts\python download_stock_logos.py

# Parallel
venv\Scripts\python logo_downloader_agent.py
```

## Stock Coverage (50 Total)

### Technology Giants
- AAPL (Apple), MSFT (Microsoft), NVDA (NVIDIA), GOOGL (Alphabet), META (Meta)
- AMD, ADBE (Adobe), CRM (Salesforce), ORCL (Oracle), CSCO (Cisco)
- INTU (Intuit), NOW (ServiceNow), QCOM (Qualcomm)

### Financial Services
- JPM (JPMorgan), V (Visa), MA (Mastercard), BAC (Bank of America), BRK.B (Berkshire)

### Healthcare
- UNH (UnitedHealth), LLY (Eli Lilly), PFE (Pfizer), ABBV (AbbVie), BMY (Bristol Myers)
- GILD (Gilead)

### Energy
- XOM (Exxon), CVX (Chevron), LIN (Linde)

### Consumer & Retail
- AMZN (Amazon), HD (Home Depot), COST (Costco), WMT (Walmart), TGT (Target)
- KO (Coca-Cola), PEP (Pepsi), PG (Procter & Gamble)

### Telecom & Utilities
- VZ (Verizon), T (AT&T)

### Industrials & Defense
- UPS, RTX (Raytheon), MMM (3M), LMT (Lockheed Martin)

### Semiconductors
- AVGO (Broadcom), TXN (Texas Instruments), INTC (Intel)
- AMAT (Applied Materials), LRCX (Lam Research), MU (Micron)

### Automotive
- TSLA (Tesla)

### Transportation
- UNP (Union Pacific)

### Other
- MO (Altria), IBM

## Logo Sources (Priority Order)

1. **Clearbit Logo API** (primary) - `https://logo.clearbit.com/{domain}`
2. **Yahoo Finance** (fallback) - Screenshots from quote pages
3. **TradingView** (last resort) - Page header screenshots

## Agent Architecture

### Sequential Agent
- Single browser instance
- Downloads one logo at a time
- Slower but uses less resources
- Best for: Testing, limited bandwidth

### Parallel Agent System
- Master orchestrator splits work into 4 batches
- Each batch runs in separate Python process
- 4 concurrent browser instances
- Downloads ~12-13 logos per worker
- Best for: Fast bulk downloading

## Progress Tracking

The agents will:
1. Check existing logos before starting
2. Skip already-downloaded logos
3. Show real-time progress
4. Provide summary at end

## Output Format

All logos saved as:
- **Format**: PNG
- **Size**: Varies by source (typically 128x128 to 400x400)
- **Naming**: `{symbol}.png` (e.g., `aapl.png`, `msft.png`)
- **Location**: `M:\code\vidismart\vidifund-media\images\stocks\`

## Troubleshooting

### Logos Not Downloading
1. Check internet connection
2. Some companies block automated access
3. Run again - script skips existing files
4. Try sequential mode if parallel fails

### Missing Logos
1. Check output directory exists
2. Run script again to retry failed downloads
3. Some logos may need manual download

### Performance Issues
- Use sequential mode if parallel causes system slowdown
- Close other applications
- Each browser instance uses ~200MB RAM

## Integration with VidiFund

Once logos are downloaded, the HTML can reference them:

```html
<img src="vidifund-media/images/stocks/aapl.png" alt="Apple Inc.">
<img src="vidifund-media/images/stocks/msft.png" alt="Microsoft Corp">
```

## Next Steps

After logos are downloaded:
1. Update `vidifund.acct.html` to use new logo paths
2. Add CSS styling for logo display
3. Create fund hero images
4. Add audio/video content

## Estimated Time

- **Sequential**: 15-25 minutes (50 logos × 20-30 seconds each)
- **Parallel**: 5-10 minutes (4 workers × 12-13 logos each)

## Resource Usage

- **Disk Space**: ~5MB for all 50 logos
- **RAM**: 
  - Sequential: ~300MB
  - Parallel: ~1.2GB (4 browsers)
- **Network**: ~50MB total download
