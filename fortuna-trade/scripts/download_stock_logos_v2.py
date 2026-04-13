#!/usr/bin/env python3
"""
Stock Logo Downloader using Yahoo Finance
Downloads company logos for all stocks in VidiFund portfolio
"""

import asyncio
import os
import re
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

OUTPUT_DIR = r'M:\code\vidismart\vidifund-media\images\stocks'

async def download_logo_yahoo(page, symbol, company_name, output_path):
    """Download logo from Yahoo Finance"""
    try:
        print(f"  Trying Yahoo Finance...")
        
        # Handle BRK.B special case
        if symbol == 'BRK.B':
            url = "https://finance.yahoo.com/quote/BRK-B"
        else:
            url = f"https://finance.yahoo.com/quote/{symbol}"
        
        await page.goto(url, timeout=30000)
        await asyncio.sleep(2)  # Wait for page to load
        
        # Try to find logo using various selectors
        logo_selectors = [
            'img[data-testid="company-logo"]',
            'img[src*="logo"]',
            '[data-testid="quote-statistics"] img',
            'section img[alt*="logo"]',
            'img[alt*="company"]',
            'img[alt*="Company"]',
        ]
        
        for selector in logo_selectors:
            try:
                element = await page.query_selector(selector)
                if element:
                    await element.screenshot(path=output_path, type='png')
                    print(f"  -> Found with selector: {selector}")
                    return True
            except:
                continue
        
        # Try to get logo from page content
        logo_url = await page.evaluate('''() => {
            const img = document.querySelector('img[data-testid="company-logo"]');
            return img ? img.src : null;
        }''')
        
        if logo_url:
            await page.goto(logo_url, timeout=10000)
            await page.screenshot(path=output_path, type='png')
            print(f"  -> Downloaded from direct URL")
            return True
        
        return False
        
    except Exception as e:
        print(f"  Yahoo Finance failed: {str(e)[:50]}")
        return False


async def download_logo_google(page, symbol, company_name, output_path):
    """Download logo using Google Images"""
    try:
        print(f"  Trying Google Images...")
        
        search_query = f"{company_name} logo transparent png"
        url = f"https://www.google.com/search?q={search_query.replace(' ', '+')}&tbm=isch"
        
        await page.goto(url, timeout=30000)
        await asyncio.sleep(2)
        
        # Click first image
        first_img = await page.query_selector('img[data-src], img[src*="googleusercontent"]')
        if first_img:
            await first_img.click()
            await asyncio.sleep(1)
            
            # Try to get larger image
            large_img = await page.query_selector('img[src*="http"]:not([src*="google"])')
            if large_img:
                await large_img.screenshot(path=output_path, type='png')
                print(f"  -> Downloaded from Google Images")
                return True
        
        return False
        
    except Exception as e:
        print(f"  Google Images failed: {str(e)[:50]}")
        return False


async def download_logo_wikipedia(page, symbol, company_name, output_path):
    """Download logo from Wikipedia"""
    try:
        print(f"  Trying Wikipedia...")
        
        # Create search query
        search_name = company_name.split()[0]  # Use first word
        url = f"https://en.wikipedia.org/wiki/{search_name}"
        
        await page.goto(url, timeout=30000)
        await asyncio.sleep(2)
        
        # Look for logo in infobox
        logo = await page.query_selector('.infobox img, .sidebar img')
        if logo:
            await logo.screenshot(path=output_path, type='png')
            print(f"  -> Downloaded from Wikipedia")
            return True
        
        return False
        
    except Exception as e:
        print(f"  Wikipedia failed: {str(e)[:50]}")
        return False


async def download_logo(page, symbol, company_name, output_path):
    """Download logo using multiple strategies"""
    print(f"[{symbol}] {company_name}")
    
    # Strategy 1: Yahoo Finance
    if await download_logo_yahoo(page, symbol, company_name, output_path):
        file_size = os.path.getsize(output_path)
        print(f"  OK - {file_size} bytes")
        return True
    
    # Strategy 2: Google Images
    if await download_logo_google(page, symbol, company_name, output_path):
        file_size = os.path.getsize(output_path)
        print(f"  OK - {file_size} bytes")
        return True
    
    # Strategy 3: Wikipedia
    if await download_logo_wikipedia(page, symbol, company_name, output_path):
        file_size = os.path.getsize(output_path)
        print(f"  OK - {file_size} bytes")
        return True
    
    print(f"  FAILED - All strategies exhausted")
    return False


async def main():
    """Main function to download all stock logos"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print("=" * 60)
    print("VIDIFUND STOCK LOGO DOWNLOADER v2")
    print("=" * 60)
    print(f"Output: {OUTPUT_DIR}")
    print(f"Total stocks: {len(STOCKS)}")
    print("=" * 60)
    print()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = await context.new_page()
        
        successful = 0
        failed = []
        
        for i, (symbol, company_name) in enumerate(STOCKS.items(), 1):
            output_path = os.path.join(OUTPUT_DIR, f"{symbol.lower()}.png")
            
            # Skip if already exists
            if os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                print(f"[{i}/{len(STOCKS)}] {symbol} - Already exists ({file_size} bytes)")
                successful += 1
                continue
            
            print(f"[{i}/{len(STOCKS)}]", end=" ")
            
            if await download_logo(page, symbol, company_name, output_path):
                successful += 1
            else:
                failed.append(symbol)
            
            # Delay between requests
            await asyncio.sleep(1)
        
        await browser.close()
    
    # Summary
    print()
    print("=" * 60)
    print("DOWNLOAD SUMMARY")
    print("=" * 60)
    print(f"Successful: {successful}/{len(STOCKS)}")
    print(f"Failed: {len(failed)}")
    
    if failed:
        print(f"\nFailed symbols: {', '.join(failed)}")
    
    print(f"\nOutput directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
