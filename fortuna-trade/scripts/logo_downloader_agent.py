#!/usr/bin/env python3
"""
Logo Downloader Agent - Parallel/Batch Processing
Splits stock logo downloads across multiple workers for faster processing
"""

import asyncio
import subprocess
import sys
import os
from datetime import datetime

# All stocks to process (50 total)
ALL_STOCKS = [
    'AAPL', 'MSFT', 'NVDA', 'XOM', 'CVX', 'LIN', 'AMZN', 'GOOGL', 'META', 'LLY',
    'AVGO', 'TSLA', 'JPM', 'UNH', 'V', 'HD', 'MA', 'PG', 'COST', 'ORCL',
    'TXN', 'IBM', 'INTC', 'WMT', 'BAC', 'PFE', 'UNP', 'ABBV', 'VZ', 'T',
    'KO', 'PEP', 'BMY', 'MO', 'UPS', 'GILD', 'RTX', 'MMM', 'LMT', 'TGT',
    'BRK.B', 'AMD', 'ADBE', 'CRM', 'CSCO', 'INTU', 'NOW', 'QCOM', 'AMAT', 'LRCX', 'MU'
]

OUTPUT_DIR = r'M:\code\vidismart\vidifund-media\images\stocks'


def get_existing_logos():
    """Check which logos already exist"""
    existing = set()
    if os.path.exists(OUTPUT_DIR):
        for f in os.listdir(OUTPUT_DIR):
            if f.endswith('.png'):
                symbol = f.replace('.png', '').upper()
                existing.add(symbol)
    return existing


def split_batches(stocks, num_batches=4):
    """Split stocks into evenly sized batches"""
    batches = [[] for _ in range(num_batches)]
    for i, stock in enumerate(stocks):
        batches[i % num_batches].append(stock)
    return batches


async def run_worker(batch_num, stocks):
    """Run a worker process for a batch of stocks"""
    print(f"[Worker {batch_num}] Starting with {len(stocks)} stocks: {', '.join(stocks[:5])}...")
    
    # Create a temporary script for this batch
    script_content = f'''
import asyncio
import os
from playwright.async_api import async_playwright

BATCH = {stocks!r}
OUTPUT_DIR = r'{OUTPUT_DIR}'

LOGO_SOURCES = {{
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
}}

async def download_logo(page, symbol, output_path):
    try:
        logo_url = LOGO_SOURCES.get(symbol)
        if logo_url:
            await page.goto(logo_url, timeout=30000)
            await page.screenshot(path=output_path, type='png')
            return True
    except Exception as e:
        print(f"Error downloading {{symbol}}: {{e}}")
    return False

async def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={{'width': 1280, 'height': 720}})
        page = await context.new_page()
        
        for symbol in BATCH:
            output_path = os.path.join(OUTPUT_DIR, f"{{symbol.lower()}}.png")
            if os.path.exists(output_path):
                print(f"[Worker] {{symbol}} already exists")
                continue
            
            if await download_logo(page, symbol, output_path):
                print(f"[Worker] ✓ Downloaded {{symbol}}")
            else:
                print(f"[Worker] ✗ Failed {{symbol}}")
            
            await asyncio.sleep(0.5)
        
        await browser.close()

asyncio.run(main())
'''
    
    # Write temporary script
    temp_script = f'M:\\code\\vidismart\\logo_worker_{batch_num}.py'
    with open(temp_script, 'w') as f:
        f.write(script_content)
    
    # Run the script
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, temp_script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        # Clean up temp script
        os.remove(temp_script)
        
        # Print output
        if stdout:
            print(f"[Worker {batch_num}] Output:\n{stdout.decode()}")
        if stderr:
            print(f"[Worker {batch_num}] Errors:\n{stderr.decode()}")
        
        return process.returncode == 0
        
    except Exception as e:
        print(f"[Worker {batch_num}] Failed: {e}")
        return False


async def main():
    """Main orchestration function"""
    print("=" * 70)
    print("STOCK LOGO DOWNLOADER AGENT - PARALLEL PROCESSING")
    print("=" * 70)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Check existing
    existing = get_existing_logos()
    print(f"Found {len(existing)} existing logos")
    
    # Filter out existing
    remaining = [s for s in ALL_STOCKS if s not in existing]
    print(f"Remaining to download: {len(remaining)} stocks\n")
    
    if not remaining:
        print("✓ All logos already downloaded!")
        return
    
    # Split into batches (4 parallel workers)
    num_workers = min(4, len(remaining))
    batches = split_batches(remaining, num_workers)
    
    print(f"Splitting into {num_workers} parallel batches:\n")
    for i, batch in enumerate(batches):
        print(f"  Worker {i+1}: {len(batch)} stocks ({', '.join(batch[:3])}...)")
    
    print("\n" + "=" * 70)
    print("STARTING PARALLEL DOWNLOAD...")
    print("=" * 70 + "\n")
    
    # Run all workers concurrently
    tasks = [
        run_worker(i+1, batch)
        for i, batch in enumerate(batches)
    ]
    
    results = await asyncio.gather(*tasks)
    
    # Summary
    print("\n" + "=" * 70)
    print("DOWNLOAD SUMMARY")
    print("=" * 70)
    
    successful_workers = sum(results)
    print(f"Workers completed successfully: {successful_workers}/{num_workers}")
    
    # Check final count
    final_existing = get_existing_logos()
    print(f"Total logos now available: {len(final_existing)}/{len(ALL_STOCKS)}")
    print(f"Missing: {len(ALL_STOCKS) - len(final_existing)}")
    
    if len(final_existing) < len(ALL_STOCKS):
        missing = [s for s in ALL_STOCKS if s not in final_existing]
        print(f"\nMissing logos: {', '.join(missing[:10])}{'...' if len(missing) > 10 else ''}")
    
    print(f"\nCompleted at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Output directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
