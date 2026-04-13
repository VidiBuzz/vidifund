#!/usr/bin/env python3
"""
Stock Logo Downloader using Playwright
Downloads company logos for all stocks in VidiFund portfolio
"""

import asyncio
import os
from playwright.async_api import async_playwright

# Stock symbols from vidifund.acct.html
STOCKS = {
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corp',
    'NVDA': 'NVIDIA Corp',
    'XOM': 'Exxon Mobil',
    'CVX': 'Chevron Corp',
    'LIN': 'Linde plc',
    'AMZN': 'Amazon.com',
    'GOOGL': 'Alphabet Inc.',
    'META': 'Meta Platforms',
    'LLY': 'Eli Lilly',
    'AVGO': 'Broadcom',
    'TSLA': 'Tesla Inc.',
    'JPM': 'JPMorgan Chase',
    'UNH': 'UnitedHealth',
    'V': 'Visa Inc.',
    'HD': 'Home Depot',
    'MA': 'Mastercard Inc.',
    'PG': 'Procter & Gamble',
    'COST': 'Costco Wholesale',
    'ORCL': 'Oracle Corp',
    'TXN': 'Texas Instruments',
    'IBM': 'IBM Corp',
    'INTC': 'Intel Corp',
    'WMT': 'Walmart Inc.',
    'BAC': 'Bank of America',
    'PFE': 'Pfizer Inc.',
    'UNP': 'Union Pacific',
    'ABBV': 'AbbVie Inc.',
    'VZ': 'Verizon',
    'T': 'AT&T Inc.',
    'KO': 'Coca-Cola Co.',
    'PEP': 'PepsiCo Inc.',
    'BMY': 'Bristol Myers',
    'MO': 'Altria Group',
    'UPS': 'UPS Inc.',
    'GILD': 'Gilead Sciences',
    'RTX': 'RTX Corp',
    'MMM': '3M Company',
    'LMT': 'Lockheed Martin',
    'TGT': 'Target Corp',
    'BRK.B': 'Berkshire Hathaway',
    'AMD': 'AMD',
    'ADBE': 'Adobe Inc.',
    'CRM': 'Salesforce',
    'CSCO': 'Cisco Systems',
    'INTU': 'Intuit Inc.',
    'NOW': 'ServiceNow',
    'QCOM': 'Qualcomm',
    'AMAT': 'Applied Materials',
    'LRCX': 'Lam Research',
    'MU': 'Micron Tech'
}

# Output directory
OUTPUT_DIR = r'M:\code\vidismart\vidifund-media\images\stocks'

# Logo sources - multiple strategies
LOGO_SOURCES = {
    'AAPL': 'https://logo.clearbit.com/apple.com',
    'MSFT': 'https://logo.clearbit.com/microsoft.com',
    'NVDA': 'https://logo.clearbit.com/nvidia.com',
    'XOM': 'https://logo.clearbit.com/exxonmobil.com',
    'CVX': 'https://logo.clearbit.com/chevron.com',
    'LIN': 'https://logo.clearbit.com/linde.com',
    'AMZN': 'https://logo.clearbit.com/amazon.com',
    'GOOGL': 'https://logo.clearbit.com/google.com',
    'META': 'https://logo.clearbit.com/meta.com',
    'LLY': 'https://logo.clearbit.com/lilly.com',
    'AVGO': 'https://logo.clearbit.com/broadcom.com',
    'TSLA': 'https://logo.clearbit.com/tesla.com',
    'JPM': 'https://logo.clearbit.com/jpmorgan.com',
    'UNH': 'https://logo.clearbit.com/unitedhealthgroup.com',
    'V': 'https://logo.clearbit.com/visa.com',
    'HD': 'https://logo.clearbit.com/homedepot.com',
    'MA': 'https://logo.clearbit.com/mastercard.com',
    'PG': 'https://logo.clearbit.com/pg.com',
    'COST': 'https://logo.clearbit.com/costco.com',
    'ORCL': 'https://logo.clearbit.com/oracle.com',
    'TXN': 'https://logo.clearbit.com/ti.com',
    'IBM': 'https://logo.clearbit.com/ibm.com',
    'INTC': 'https://logo.clearbit.com/intel.com',
    'WMT': 'https://logo.clearbit.com/walmart.com',
    'BAC': 'https://logo.clearbit.com/bankofamerica.com',
    'PFE': 'https://logo.clearbit.com/pfizer.com',
    'UNP': 'https://logo.clearbit.com/up.com',
    'ABBV': 'https://logo.clearbit.com/abbvie.com',
    'VZ': 'https://logo.clearbit.com/verizon.com',
    'T': 'https://logo.clearbit.com/att.com',
    'KO': 'https://logo.clearbit.com/coca-cola.com',
    'PEP': 'https://logo.clearbit.com/pepsico.com',
    'BMY': 'https://logo.clearbit.com/bms.com',
    'MO': 'https://logo.clearbit.com/altria.com',
    'UPS': 'https://logo.clearbit.com/ups.com',
    'GILD': 'https://logo.clearbit.com/gilead.com',
    'RTX': 'https://logo.clearbit.com/rtx.com',
    'MMM': 'https://logo.clearbit.com/3m.com',
    'LMT': 'https://logo.clearbit.com/lockheedmartin.com',
    'TGT': 'https://logo.clearbit.com/target.com',
    'BRK.B': 'https://logo.clearbit.com/berkshirehathaway.com',
    'AMD': 'https://logo.clearbit.com/amd.com',
    'ADBE': 'https://logo.clearbit.com/adobe.com',
    'CRM': 'https://logo.clearbit.com/salesforce.com',
    'CSCO': 'https://logo.clearbit.com/cisco.com',
    'INTU': 'https://logo.clearbit.com/intuit.com',
    'NOW': 'https://logo.clearbit.com/servicenow.com',
    'QCOM': 'https://logo.clearbit.com/qualcomm.com',
    'AMAT': 'https://logo.clearbit.com/appliedmaterials.com',
    'LRCX': 'https://logo.clearbit.com/lamresearch.com',
    'MU': 'https://logo.clearbit.com/micron.com'
}

async def download_logo(page, symbol, company_name, output_path):
    """Download logo for a single stock"""
    try:
        # Try Clearbit logo API first
        logo_url = LOGO_SOURCES.get(symbol)
        
        if logo_url:
            print(f"Downloading {symbol} logo from Clearbit...")
            response = await page.goto(logo_url, timeout=30000)
            
            if response and response.ok:
                # Take screenshot of the logo
                await page.screenshot(path=output_path, type='png')
                print(f"✓ Saved {symbol}.png")
                return True
        
        # Fallback: Try to capture from Yahoo Finance
        print(f"Trying Yahoo Finance for {symbol}...")
        yahoo_url = f"https://finance.yahoo.com/quote/{symbol}"
        await page.goto(yahoo_url, timeout=30000)
        
        # Wait for logo to load (various selectors)
        try:
            # Yahoo Finance logo selector
            logo_element = await page.wait_for_selector('img[src*="logo"], .logo, [data-testid="company-logo"]', timeout=5000)
            if logo_element:
                await logo_element.screenshot(path=output_path, type='png')
                print(f"✓ Saved {symbol}.png from Yahoo Finance")
                return True
        except:
            pass
        
        # Final fallback: Try TradingView
        print(f"Trying TradingView for {symbol}...")
        tv_url = f"https://www.tradingview.com/symbols/NASDAQ-{symbol}/"
        await page.goto(tv_url, timeout=30000)
        
        # Wait and screenshot the page header area where logo usually is
        await asyncio.sleep(2)
        await page.screenshot(path=output_path, type='png', clip={'x': 0, 'y': 0, 'width': 400, 'height': 200})
        print(f"✓ Saved {symbol}.png from TradingView (cropped)")
        return True
        
    except Exception as e:
        print(f"✗ Failed to download {symbol}: {e}")
        return False

async def main():
    """Main function to download all stock logos"""
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print(f"Starting logo download for {len(STOCKS)} stocks...")
    print(f"Output directory: {OUTPUT_DIR}\n")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        # Create a context with specific viewport
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        
        page = await context.new_page()
        
        # Set default timeout
        page.set_default_timeout(30000)
        
        successful = 0
        failed = []
        
        for symbol, company_name in STOCKS.items():
            output_path = os.path.join(OUTPUT_DIR, f"{symbol.lower()}.png")
            
            # Skip if already exists
            if os.path.exists(output_path):
                print(f"⏭ {symbol} already exists, skipping...")
                successful += 1
                continue
            
            print(f"\n[{successful + len(failed) + 1}/{len(STOCKS)}] Processing {symbol} ({company_name})...")
            
            if await download_logo(page, symbol, company_name, output_path):
                successful += 1
            else:
                failed.append(symbol)
            
            # Small delay between requests
            await asyncio.sleep(1)
        
        await browser.close()
    
    # Summary
    print(f"\n{'='*60}")
    print(f"DOWNLOAD COMPLETE")
    print(f"{'='*60}")
    print(f"Successful: {successful}/{len(STOCKS)}")
    print(f"Failed: {len(failed)}")
    
    if failed:
        print(f"\nFailed symbols: {', '.join(failed)}")
        print("\nYou can re-run this script to retry failed downloads.")

if __name__ == "__main__":
    asyncio.run(main())
