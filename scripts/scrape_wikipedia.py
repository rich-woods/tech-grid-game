#!/usr/bin/env python3
"""
Wikipedia list-page scrape -> SQL seed for Tech Grid.

Wikipedia "List of X models" pages are editorially maintained, so they
filter out the long-tail garbage that pollutes Wikidata's blanket class
hierarchy. This script targets a curated set of those pages, parses the
first wikitable on each, and emits SQL INSERTs.

Usage:
    python scrape_wikipedia.py > ../supabase/02d_seed_wikipedia.sql

Stdlib only — no pip install needed.
"""

import html
import html.parser as htmlparser
import json
import re
import sys
import time
import urllib.parse
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass

API = "https://en.wikipedia.org/w/api.php"
HEADERS = {
    "User-Agent": "TechGridSeed/1.0 (https://github.com/rich-woods/tech-grid-game)",
    "Accept": "application/json",
}

# Curated Wikipedia list pages. Each entry:
#   title        — Wikipedia article title
#   manufacturer — gets stored on every product
#   kind         — always 'hardware' here
#   tags         — base tags applied to every product from this page
PAGES = [
    # --- Apple ---
    ("List of iPhone models",          "Apple",     "hardware",
     ["smartphone","apple","ios","mobile","has-camera","has-touchscreen"]),
    ("List of iPad models",            "Apple",     "hardware",
     ["tablet","apple","ipados","has-touchscreen","has-camera"]),
    ("List of Mac models",             "Apple",     "hardware",
     ["apple","macos"]),
    ("MacBook Air",                    "Apple",     "hardware",
     ["laptop","apple","macos"]),
    ("MacBook Pro",                    "Apple",     "hardware",
     ["laptop","apple","macos","premium"]),
    ("Apple Watch",                    "Apple",     "hardware",
     ["wearable","apple","watchos","has-touchscreen"]),
    ("AirPods",                        "Apple",     "hardware",
     ["audio","apple","wireless","earbuds"]),
    ("Apple Vision Pro",               "Apple",     "hardware",
     ["vr","xr","wearable","apple","premium"]),
    # --- Samsung ---
    ("Samsung Galaxy S series",        "Samsung",   "hardware",
     ["smartphone","samsung","android","mobile","has-camera","has-touchscreen"]),
    ("Samsung Galaxy Note series",     "Samsung",   "hardware",
     ["smartphone","samsung","android","mobile","has-camera","has-touchscreen","has-stylus"]),
    ("Samsung Galaxy Z series",        "Samsung",   "hardware",
     ["smartphone","samsung","android","mobile","has-camera","has-touchscreen","foldable"]),
    ("Samsung Galaxy Tab",             "Samsung",   "hardware",
     ["tablet","samsung","android","has-touchscreen"]),
    # --- Google ---
    ("Pixel (1st generation)",         "Google",    "hardware",
     ["smartphone","google","android","mobile","has-camera","has-touchscreen"]),
    ("List of Google Pixel products",  "Google",    "hardware",
     ["google"]),
    # --- Microsoft / Xbox ---
    ("Microsoft Surface",              "Microsoft", "hardware",
     ["microsoft","windows","has-touchscreen"]),
    ("Xbox",                           "Microsoft", "hardware",
     ["console","gaming","microsoft","xbox"]),
    # --- Sony / PlayStation ---
    ("List of PlayStation models",     "Sony",      "hardware",
     ["console","gaming","sony","playstation"]),
    # --- Nintendo ---
    ("Nintendo Switch",                "Nintendo",  "hardware",
     ["console","gaming","nintendo","handheld","has-touchscreen"]),
    # --- VR / XR ---
    ("Meta Quest",                     "Meta",      "hardware",
     ["vr","xr","wearable","meta","gaming"]),
    # --- Cameras ---
    ("GoPro",                          "GoPro",     "hardware",
     ["camera","has-camera","action-cam","gopro"]),
    # --- Streaming devices (recognizable, unlike the Wikidata long-tail) ---
    ("Roku",                           "Roku",      "hardware",
     ["streaming","home","roku"]),
    ("Chromecast",                     "Google",    "hardware",
     ["streaming","home","google"]),
    ("Amazon Fire TV",                 "Amazon",    "hardware",
     ["streaming","home","amazon"]),
    # --- Smart speakers ---
    ("Amazon Echo",                    "Amazon",    "hardware",
     ["smart-home","audio","home","amazon"]),
    ("Google Nest (smart speakers)",   "Google",    "hardware",
     ["smart-home","audio","home","google"]),
    ("HomePod",                        "Apple",     "hardware",
     ["smart-home","audio","home","apple"]),
    # --- E-readers ---
    ("Amazon Kindle",                  "Amazon",    "hardware",
     ["e-reader","has-touchscreen","amazon"]),
]

SLEEP_BETWEEN_PAGES = 1.0
MAX_ROWS_PER_TABLE = 80
MIN_NAME_LENGTH = 3
MAX_NAME_LENGTH = 60

# ---------- HTML parser: walk wikitable rows ------------------------
class TableExtractor(htmlparser.HTMLParser):
    """Pulls all rows out of every <table class="wikitable"> on a page."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.depth = 0          # nesting of wikitables
        self.current_table = None
        self.current_row = None
        self.cell_tag = None    # 'td' or 'th' or None
        self.cell_text = []
        self.skip_depth = 0     # for <sup>, <style>, etc. inside a cell

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table" and "wikitable" in attrs.get("class", ""):
            self.depth += 1
            if self.depth == 1:
                self.current_table = []
        elif self.depth >= 1 and tag == "tr":
            self.current_row = []
        elif self.depth >= 1 and tag in ("td", "th"):
            self.cell_tag = tag
            self.cell_text = []
        elif self.cell_tag and tag in ("sup", "style", "script", "abbr"):
            # Skip footnote markers, inline styles, etc.
            self.skip_depth += 1
        elif self.cell_tag and tag == "br":
            self.cell_text.append(" ")

    def handle_endtag(self, tag):
        if tag == "table" and self.depth >= 1:
            if self.depth == 1:
                self.tables.append(self.current_table or [])
                self.current_table = None
            self.depth -= 1
        elif self.depth >= 1 and tag == "tr":
            if self.current_row:
                self.current_table.append(self.current_row)
            self.current_row = None
        elif self.depth >= 1 and tag in ("td", "th") and self.cell_tag == tag:
            text = clean_cell("".join(self.cell_text))
            if self.current_row is not None:
                self.current_row.append((tag, text))
            self.cell_tag = None
            self.cell_text = []
        elif self.cell_tag and tag in ("sup", "style", "script", "abbr"):
            self.skip_depth = max(0, self.skip_depth - 1)

    def handle_data(self, data):
        if self.cell_tag and self.skip_depth == 0:
            self.cell_text.append(data)

# ---------- text helpers --------------------------------------------
WS = re.compile(r"\s+")
FOOTNOTE = re.compile(r"\[[^\]]+\]")          # [1], [a], [note 3]
PARENS_NESTED = re.compile(r"\([^)]*\)")
YEAR_PAT = re.compile(r"\b(19[7-9]\d|20[0-3]\d)\b")

def clean_cell(s):
    s = FOOTNOTE.sub("", s)
    s = s.replace(" ", " ")
    s = WS.sub(" ", s).strip()
    return s

def extract_year(text):
    if not text:
        return None
    m = YEAR_PAT.search(text)
    return int(m.group(1)) if m else None

def slugify(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s[:80]

# ---------- column header matching ----------------------------------
NAME_HEADERS = ("model", "name", "device", "product", "generation", "version")
YEAR_HEADERS = ("release", "released", "date", "year", "introduced", "launch", "announced", "first sale")

def find_columns(header_row):
    """Return (name_idx, year_idx) for the table, or (None, None)."""
    name_idx = None
    year_idx = None
    for i, (tag, txt) in enumerate(header_row):
        low = txt.lower()
        if name_idx is None and any(h in low for h in NAME_HEADERS):
            name_idx = i
        if year_idx is None and any(h in low for h in YEAR_HEADERS):
            year_idx = i
    # Fallback: assume first column is the name if we found nothing
    if name_idx is None and header_row:
        name_idx = 0
    return name_idx, year_idx

# ---------- Wikipedia API call --------------------------------------
def fetch_html(title):
    params = urllib.parse.urlencode({
        "action": "parse",
        "page": title,
        "format": "json",
        "prop": "text",
        "disablelimitreport": "1",
        "disableeditsection": "1",
        "redirects": "1",
    })
    req = urllib.request.Request(API + "?" + params, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.load(resp)
    if "error" in body:
        raise RuntimeError(body["error"].get("info", "Unknown API error"))
    return body["parse"]["text"]["*"]

# ---------- SQL emit helpers ----------------------------------------
def sql_quote(s):
    if s is None or s == "":
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def sql_text_array(arr):
    if not arr:
        return "'{}'"
    cleaned = []
    for a in arr:
        a = a.replace("\\", "\\\\").replace('"', '\\"')
        cleaned.append('"' + a + '"')
    return "'{" + ",".join(cleaned) + "}'"

# ---------- main ----------------------------------------------------
def is_plausible_product_name(name):
    if not name or len(name) < MIN_NAME_LENGTH or len(name) > MAX_NAME_LENGTH:
        return False
    if not re.search(r"[A-Za-z]", name):
        return False
    # Skip rows that look like section headings (often all-caps or start with "Total")
    if name.lower().startswith(("total", "summary", "see also", "notes", "references")):
        return False
    return True

def main():
    seen_slugs = set()
    rows = []

    for title, manufacturer, kind, base_tags in PAGES:
        sys.stderr.write(f"Fetching {title}... ")
        sys.stderr.flush()
        try:
            html_body = fetch_html(title)
        except Exception as e:
            sys.stderr.write(f"FAILED ({e})\n")
            time.sleep(SLEEP_BETWEEN_PAGES)
            continue

        parser = TableExtractor()
        parser.feed(html_body)
        added = 0
        for table in parser.tables:
            if len(table) < 2:
                continue
            header = table[0]
            name_idx, year_idx = find_columns(header)
            if name_idx is None:
                continue
            for row in table[1:MAX_ROWS_PER_TABLE + 1]:
                if name_idx >= len(row):
                    continue
                name = row[name_idx][1]
                # Sometimes the model column has hyperlinks/extra text;
                # take the first comma-separated chunk.
                name = name.split(",")[0].strip()
                # Drop trailing parenthetical like "(2nd generation)"
                bare = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
                if not is_plausible_product_name(bare):
                    continue
                year = None
                if year_idx is not None and year_idx < len(row):
                    year = extract_year(row[year_idx][1])
                slug = slugify(bare)
                if not slug or slug in seen_slugs:
                    continue
                seen_slugs.add(slug)

                tags = list(base_tags)
                # Heuristic enrichment from name
                low = bare.lower()
                if re.search(r"\b(pro|max|ultra|premium)\b", low) and "premium" not in tags:
                    tags.append("premium")
                if re.search(r"\b(mini|lite|se|essential)\b", low) and "premium" not in tags:
                    tags.append("budget")

                rows.append({
                    "name": bare,
                    "slug": slug,
                    "manufacturer": manufacturer,
                    "kind": kind,
                    "year": year,
                    "tags": tags,
                })
                added += 1
        sys.stderr.write(f"{added} products\n")
        time.sleep(SLEEP_BETWEEN_PAGES)

    sys.stderr.write(f"\nTotal unique products: {len(rows)}\n")

    out = sys.stdout
    out.write("-- =====================================================================\n")
    out.write("-- Wikipedia-sourced products. Auto-generated by scrape_wikipedia.py.\n")
    out.write("-- Editorially maintained list pages → cleaner than Wikidata blanket queries.\n")
    out.write("-- Run AFTER 02_seed.sql; uses ON CONFLICT (slug) DO NOTHING for safe re-runs.\n")
    out.write("-- =====================================================================\n")
    if not rows:
        out.write("-- (no rows extracted)\n")
        return
    out.write("insert into products (name, slug, manufacturer, kind, release_year, tags) values\n")
    lines = []
    for r in rows:
        lines.append(
            "  (" + sql_quote(r["name"]) + ", "
            + sql_quote(r["slug"]) + ", "
            + sql_quote(r["manufacturer"]) + ", "
            + sql_quote(r["kind"]) + ", "
            + (str(r["year"]) if r["year"] else "NULL") + ", "
            + sql_text_array(r["tags"]) + ")"
        )
    out.write(",\n".join(lines))
    out.write("\non conflict (slug) do nothing;\n\n")
    out.write("select refresh_product_categories();\n")

if __name__ == "__main__":
    main()
