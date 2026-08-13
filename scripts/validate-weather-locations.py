#!/usr/bin/env python3
"""Validate the public, per-day weather representative locations."""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "data" / "weather-locations.json"
EXPECTED = [
    ("2026-08-13", "千葉幕張", 35.6473019, 140.0346524),
    ("2026-08-14", "千葉幕張", 35.6473019, 140.0346524),
    ("2026-08-15", "木更津港", 35.3814139, 139.9190909),
    ("2026-08-16", "千葉幕張", 35.6473019, 140.0346524),
    ("2026-08-17", "草津湯畑", 36.6229392, 138.5967297),
    ("2026-08-18", "四萬溫泉", 36.6857315, 138.7743845),
    ("2026-08-19", "輕井澤（跨區日代表地區）", 36.3391616, 138.6331098),
    ("2026-08-20", "輕井澤", 36.3582228, 138.5891689),
    ("2026-08-21", "輕井澤", 36.350658, 138.626833),
    ("2026-08-22", "東京・麻布十番", 35.6551687, 139.7372062),
    ("2026-08-23", "成田機場", 35.7758714, 140.3933101),
]
DATE = re.compile(r"^2026-08-(?:1[3-9]|2[0-3])$")
PRIVATE_METADATA = re.compile(r"(address|住宿|hotel|s[h]eet|n[o]tion|d[r]ive|g[m]ail|booking|reservation|priv[a]te|秘密|地址)", re.I)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def main() -> int:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    require(data.get("schemaVersion") == "1.0.0", "unexpected weather config schemaVersion")
    require(set(data) == {"schemaVersion", "locations"}, "weather config contains non-public metadata")
    locations = data.get("locations")
    require(isinstance(locations, list), "locations must be an array")
    actual = []
    for index, item in enumerate(locations, start=1):
        require(set(item) == {"date", "locationLabel", "lat", "lng"}, f"locations[{index}] contains non-public metadata")
        require(isinstance(item["date"], str) and bool(DATE.fullmatch(item["date"])), f"locations[{index}] invalid date")
        require(isinstance(item["locationLabel"], str) and item["locationLabel"].strip(), f"locations[{index}] invalid label")
        require(not PRIVATE_METADATA.search(item["locationLabel"]), f"locations[{index}] contains private metadata")
        for field, lower, upper in (("lat", -90, 90), ("lng", -180, 180)):
            value = item[field]
            require(isinstance(value, (int, float)) and math.isfinite(value) and lower <= value <= upper, f"locations[{index}] invalid {field}")
        actual.append((item["date"], item["locationLabel"], item["lat"], item["lng"]))
    require(actual == EXPECTED, "weather locations do not exactly match the 11-day public representative contract")
    print("WEATHER LOCATION CHECK PASSED: 11 exact public representative locations; no private metadata.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"WEATHER LOCATION CHECK FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
