#!/usr/bin/env python3
"""
Pull tech products from Wikidata and emit SQL inserts for tech-grid.

Usage:
    python scrape_wikidata.py > ../supabase/02b_seed_wikidata.sql

Then run the resulting SQL in your Supabase SQL Editor.

Requires Python 3.8+ (stdlib only — no pip install needed).
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request

# Force UTF-8 for stdout/stderr — Wikidata product names contain em-dashes,
# minus signs, accented characters, etc. that Windows cp1252 can't encode.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass  # Python <3.7 — unlikely on Windows but harmless

ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {
    "User-Agent": "TechGridSeed/1.0 (https://example.com; contact@example.com) Python/urllib",
    "Accept": "application/sparql-results+json",
}

# Each spec: (display_name, base_tags applied to every match, kind, Wikidata Q-ID)
# Q-IDs picked so wdt:P31/wdt:P279* (instance-of, with subclass traversal) gives
# the right pool. We cap each query at LIMIT_PER_QUERY items.
SPECS = [
    # --- Hardware ---
    ("Smartphone",          ["smartphone","mobile","has-camera","has-touchscreen"],     "hardware", "Q22645"),
    ("Mobile phone",        ["mobile","has-touchscreen"],                                "hardware", "Q17517"),
    ("Laptop",              ["laptop"],                                                  "hardware", "Q3962"),
    ("Personal computer",   ["desktop"],                                                 "hardware", "Q16338"),
    ("Tablet computer",     ["tablet","has-touchscreen"],                                "hardware", "Q155921"),
    ("Smartwatch",          ["wearable","has-touchscreen"],                              "hardware", "Q2247863"),
    ("Fitness tracker",     ["wearable","fitness"],                                      "hardware", "Q3066358"),
    ("Headphones",          ["audio","headphones"],                                      "hardware", "Q186819"),
    ("Wireless earbuds",    ["audio","wireless","earbuds"],                              "hardware", "Q104173078"),
    ("Earphones",           ["audio","earbuds"],                                         "hardware", "Q1762351"),
    ("Bluetooth speaker",   ["audio","wireless","home"],                                 "hardware", "Q174198"),
    ("Game console",        ["console","gaming"],                                        "hardware", "Q210667"),
    ("Handheld game console",["console","gaming","handheld","has-touchscreen"],          "hardware", "Q940994"),
    ("VR headset",          ["vr","xr","wearable"],                                      "hardware", "Q1745728"),
    ("Augmented reality",   ["xr","wearable"],                                           "hardware", "Q161157"),
    ("E-reader",            ["e-reader","has-touchscreen"],                              "hardware", "Q428661"),
    ("Digital camera",      ["camera","has-camera"],                                     "hardware", "Q175207"),
    ("Mirrorless camera",   ["camera","has-camera","mirrorless"],                        "hardware", "Q1192305"),
    ("DSLR camera",         ["camera","has-camera","dslr"],                              "hardware", "Q196342"),
    ("Action camera",       ["camera","has-camera","action-cam"],                        "hardware", "Q1666010"),
    ("Drone",               ["drone","has-camera"],                                      "hardware", "Q2186409"),
    ("Smart speaker",       ["smart-home","audio","home"],                               "hardware", "Q19362034"),
    ("Streaming device",    ["streaming","home"],                                        "hardware", "Q1153484"),
    # Smart TV (Q4373292) and Television set (Q56242063) intentionally
    # excluded — Wikidata's coverage there is dominated by obscure model
    # numbers that aren't guessable in a trivia game. Add notable TVs
    # (LG C-series, Samsung Frame, etc.) as hand-curated products instead.
    ("Computer monitor",    ["monitor","display"],                                       "hardware", "Q47128893"),
    ("Computer keyboard",   ["keyboard","accessory"],                                    "hardware", "Q250"),
    ("Computer mouse",      ["mouse","accessory"],                                       "hardware", "Q7987"),
    ("Webcam",              ["camera","has-camera","accessory"],                         "hardware", "Q11035"),
    ("Printer",             ["printer","home"],                                          "hardware", "Q82001"),
    ("Router",              ["router","networking","home"],                              "hardware", "Q190157"),
    ("Smart thermostat",    ["smart-home","home","has-touchscreen"],                     "hardware", "Q42389127"),
    ("Robot vacuum",        ["smart-home","home"],                                       "hardware", "Q1762797"),
    ("USB flash drive",     ["storage","accessory"],                                     "hardware", "Q120651"),
    ("Solid-state drive",   ["storage","accessory"],                                     "hardware", "Q165678"),
    ("Graphics card",       ["accessory","gaming","gpu"],                                "hardware", "Q183178"),
    ("Game controller",     ["gaming","accessory","controller"],                         "hardware", "Q865422"),
    # Software queries removed — hardware-only scope.
]

LIMIT_PER_QUERY = 1000
SLEEP_BETWEEN_QUERIES = 1.0

# Manufacturer string normalization (column value in `products`)
MFR_NORMALIZE = {
    "Apple Inc.": "Apple",
    "Google LLC": "Google", "Alphabet Inc.": "Google",
    "Microsoft Corporation": "Microsoft",
    "Samsung Electronics": "Samsung",
    "Sony Corporation": "Sony", "Sony Group Corporation": "Sony", "Sony Group": "Sony",
    "Meta Platforms": "Meta", "Facebook, Inc.": "Meta", "Facebook": "Meta",
    "Amazon.com": "Amazon", "Amazon (company)": "Amazon",
    "Adobe Inc.": "Adobe", "Adobe Systems": "Adobe",
    "Valve Corporation": "Valve",
    "OnePlus Technology": "OnePlus",
    "Xiaomi Inc.": "Xiaomi", "Xiaomi Corporation": "Xiaomi",
    "Hewlett-Packard": "HP", "HP Inc.": "HP",
    "Razer Inc.": "Razer",
    "Dell Technologies": "Dell",
    "ASUS": "Asus", "ASUSTeK Computer": "Asus",
    "Mozilla Foundation": "Mozilla", "Mozilla Corporation": "Mozilla",
    "Acer Inc.": "Acer",
    "LG Electronics": "LG",
    "Nintendo": "Nintendo",
}

# Manufacturers that should also become a per-product tag (so "Made by X"
# categories match). The tag is matched case-insensitively in 03_functions.sql,
# so we keep it lowercase here.
MFR_TAG = {
    "Apple": "apple", "Google": "google", "Microsoft": "microsoft",
    "Samsung": "samsung", "Sony": "sony", "Meta": "meta", "Amazon": "amazon",
    "Adobe": "adobe", "Nintendo": "nintendo", "Valve": "valve",
    "OnePlus": "oneplus", "Xiaomi": "xiaomi", "Huawei": "huawei",
    "Asus": "asus", "Lenovo": "lenovo", "Dell": "dell", "HP": "hp",
    "Razer": "razer", "DJI": "dji", "GoPro": "gopro", "Bose": "bose",
    "Sonos": "sonos", "Roku": "roku", "Mozilla": "mozilla",
    "OpenAI": "openai", "Anthropic": "anthropic", "Spotify": "spotify",
    "Netflix": "netflix", "Disney": "disney", "TikTok": "tiktok",
    "Acer": "acer", "LG": "lg",
}

# Drops: clearly not consumer-facing or too obscure to be guessable
NAME_BLACKLIST_PATTERNS = [
    r"\bprototype\b",
    r"\bconcept\b",
    r"\b(reference|developer|engineering)\s+(model|board|kit)\b",
    r"^[A-Z]{1,3}-?\d+\s*$",       # e.g. "BLU-200" with no real name
    r"\bdummy\b",
]

QUERY_TPL = """
SELECT DISTINCT ?item ?itemLabel ?makerLabel ?year WHERE {{
  ?item wdt:P31/wdt:P279* wd:{cls} .
  OPTIONAL {{ ?item wdt:P176 ?manuf. }}
  OPTIONAL {{ ?item wdt:P178 ?dev. }}
  BIND(COALESCE(?manuf, ?dev) AS ?maker)
  OPTIONAL {{ ?item wdt:P571 ?inceptionDate. BIND(YEAR(?inceptionDate) AS ?yA) }}
  OPTIONAL {{ ?item wdt:P577 ?pubDate.       BIND(YEAR(?pubDate) AS ?yB) }}
  BIND(COALESCE(?yA, ?yB) AS ?year)
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT {limit}
"""

def sparql(query):
    body = urllib.parse.urlencode({"query": query}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers=HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)

def slugify(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s[:80]

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

def normalize_label(s):
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    return s

def name_looks_bad(name):
    n = name.lower()
    for pat in NAME_BLACKLIST_PATTERNS:
        if re.search(pat, n):
            return True
    if not re.search(r"[a-z]", n):
        return True
    return False

def enrich_tags(name, base_tags, mfr):
    tags = list(base_tags)
    n = name.lower()
    if re.search(r"\bpro\b|\bmax\b|\bultra\b|\bpremium\b", n) and "budget" not in tags:
        tags.append("premium")
    if re.search(r"\blite\b|\bmini\b|\bse\b|\bessential\b", n) and "premium" not in tags:
        tags.append("budget")
    if any(t in n for t in [" ai", "gpt", "copilot", "claude", "gemini", "bard "]):
        tags.append("ai")
    if mfr and mfr in MFR_TAG and MFR_TAG[mfr] not in tags:
        tags.append(MFR_TAG[mfr])
    # de-dup, preserve order
    seen = set(); out = []
    for t in tags:
        if t not in seen:
            seen.add(t); out.append(t)
    return out

def main():
    seen_slugs = set()
    rows = []

    for label, base_tags, kind, qid in SPECS:
        sys.stderr.write(f"Querying {label} ({qid})... ")
        sys.stderr.flush()
        query = QUERY_TPL.format(cls=qid, limit=LIMIT_PER_QUERY)
        try:
            data = sparql(query)
        except Exception as e:
            sys.stderr.write(f"FAILED ({e})\n")
            continue
        bindings = data.get("results", {}).get("bindings", [])
        sys.stderr.write(f"{len(bindings)} hits\n")
        added = 0
        for b in bindings:
            name = normalize_label(b.get("itemLabel", {}).get("value", ""))
            if not name or len(name) > 60: continue
            if re.match(r"^Q\d+$", name): continue
            if name_looks_bad(name): continue
            if not re.search(r"[A-Za-z]", name): continue

            mfr_raw = b.get("makerLabel", {}).get("value", "") or None
            mfr = MFR_NORMALIZE.get(mfr_raw, mfr_raw) if mfr_raw else None
            if mfr and re.match(r"^Q\d+$", mfr):
                mfr = None  # unresolved label

            yr_raw = b.get("year", {}).get("value")
            try: year = int(yr_raw) if yr_raw else None
            except: year = None
            if year and (year < 2005 or year > 2030):
                year = None

            slug = slugify(name)
            if not slug or slug in seen_slugs: continue
            seen_slugs.add(slug)

            tags = enrich_tags(name, base_tags, mfr)
            rows.append({
                "name": name, "slug": slug, "manufacturer": mfr,
                "kind": kind, "year": year, "tags": tags,
            })
            added += 1
        sys.stderr.write(f"  added {added} unique\n")
        time.sleep(SLEEP_BETWEEN_QUERIES)

    sys.stderr.write(f"\nTotal unique products: {len(rows)}\n")

    # ----- emit SQL -----
    out = sys.stdout
    out.write("-- =====================================================================\n")
    out.write("-- Wikidata-sourced products. Auto-generated by scrape_wikidata.py.\n")
    out.write("-- Run AFTER 02_seed.sql; uses ON CONFLICT (slug) DO NOTHING so it\n")
    out.write("-- can be re-run safely.\n")
    out.write("-- =====================================================================\n")
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
    out.write("-- Refresh the matrix of which products satisfy which categories\n")
    out.write("select refresh_product_categories();\n")

if __name__ == "__main__":
    main()
