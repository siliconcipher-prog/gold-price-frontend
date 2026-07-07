# requirements:
#   pip install playwright psycopg[binary] beautifulsoup4
#   python -m playwright install

import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

BASE_URL = "https://www.goodreturns.in/gold-rates/"
SOURCE_NAME = "goodreturns"
IST = ZoneInfo("Asia/Kolkata")
RUN_WINDOW_MINUTES = 20
ALLOWED_RUN_TIMES = [
    (8, 0),
    (9, 0),
    (10, 30),
    (16, 0),
    (17, 0),
]

PG_DSN = os.getenv(
    "PG_DSN",
    f"host={os.getenv('PGHOST','localhost')} "
    f"port={os.getenv('PGPORT','5432')} "
    f"user={os.getenv('PGUSER','postgres')} "
    f"password={os.getenv('PGPASSWORD','1234')} "
    f"dbname={os.getenv('PGDATABASE','gold_tracker')}"
)

ANCHOR_TO_SLAB = {
    "Chennai": "Chennai",
    "Mumbai": "Mumbai",
    "Pune": "Mumbai",
    "Bangalore": "Mumbai",
    "Hyderabad": "Mumbai",
    "Delhi": "Delhi",
    "Vadodara": "Vadodara",
    "Ahmedabad": "Vadodara",
}

def should_run_now():
    if os.getenv("FORCE_RUN", "").lower() in {"1", "true", "yes"}:
        return True

    now = datetime.now(IST)
    current_minutes = now.hour * 60 + now.minute

    for hour, minute in ALLOWED_RUN_TIMES:
        target_minutes = hour * 60 + minute
        if abs(current_minutes - target_minutes) <= RUN_WINDOW_MINUTES:
            return True

    return False

# -------------------------
# Helpers
# -------------------------

def debug(msg):
    ts = datetime.now(IST).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")

def clean_price(txt):
    if not txt:
        return None
    txt = txt.replace("₹", "").replace(",", "").strip()
    import re
    m = re.search(r"\d+(\.\d+)?", txt)
    return float(m.group(0)) if m else None

# -------------------------
# Fetch HTML (OLD WORKING WAY)
# -------------------------

def fetch_overview_html():
    from playwright.sync_api import sync_playwright

    debug("Fetching GoodReturns page (legacy method)...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            locale="en-IN",
        )
        page = context.new_page()

        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)

        # IMPORTANT: this is what makes it work
        page.wait_for_selector(
            "tbody.major_cities_container tr",
            state="attached",
            timeout=20000
        )

        html = page.content()
        browser.close()
        return html

# -------------------------
# Parse Prices
# -------------------------

def parse_prices(html):
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    slabs = {}

    # 🇮🇳 India (header block)
    def val(id_):
        el = soup.find("span", {"id": id_})
        return clean_price(el.get_text(strip=True)) if el else None

    india_prices = {
        "24K": val("24K-price"),
        "22K": val("22K-price"),
        "18K": val("18K-price"),
    }

    if all(india_prices.values()):
        slabs["India"] = india_prices
        debug(f"[INDIA] {india_prices}")

    # City table
    rows = soup.select("tbody.major_cities_container tr")
    for tr in rows:
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue

        city = tds[0].get_text(strip=True)
        if city not in ANCHOR_TO_SLAB:
            continue

        slab = ANCHOR_TO_SLAB[city]
        prices = {
            "24K": clean_price(tds[1].get_text()),
            "22K": clean_price(tds[2].get_text()),
            "18K": clean_price(tds[3].get_text()),
        }

        if all(prices.values()):
            slabs[slab] = prices
            debug(f"[CITY] {slab} <- {city} -> {prices}")


    return slabs

# -------------------------
# Insert into gold_price_slabs
# -------------------------

INSERT_SQL = """
INSERT INTO gold_price_slabs (
  slab_name,
  price_24k,
  price_22k,
  price_18k,
  recorded_on,
  recorded_at,
  source
)
VALUES (%s,%s,%s,%s,%s,NOW(),%s)
ON CONFLICT (slab_name, recorded_on)
DO UPDATE SET
  price_24k = EXCLUDED.price_24k,
  price_22k = EXCLUDED.price_22k,
  price_18k = EXCLUDED.price_18k,
  recorded_at = NOW(),
  source = EXCLUDED.source;
"""

def insert_slabs(slabs):
    import psycopg

    if not slabs:
        debug("No slabs found. Nothing to insert.")
        return

    today = datetime.now(IST).date()
    with psycopg.connect(PG_DSN) as conn:
        with conn.cursor() as cur:
            for slab, prices in slabs.items():
                cur.execute(
                    INSERT_SQL,
                    (
                        slab,
                        prices["24K"],
                        prices["22K"],
                        prices["18K"],
                        today,
                        SOURCE_NAME,
                    )
                )
        conn.commit()

    debug(f"Inserted/updated {len(slabs)} slabs.")

# -------------------------
# Main
# -------------------------

def main():

    if "--check-window" in sys.argv[1:]:
        print(f"should_run={'true' if should_run_now() else 'false'}")
        return

    if not should_run_now():
        debug("Skipping execution - outside allowed time window.")
        return

    debug("Execution window matched.")

    html = fetch_overview_html()
    slabs = parse_prices(html)
    insert_slabs(slabs)

if __name__ == "__main__":
    main()
