#!/usr/bin/env python3
"""Validate the static, sanitized trip snapshot without external network access."""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "trip-data.json"
ALLOWED_STATES = {"confirmed", "candidate", "backup", "pending"}
MAPS_PREFIX = "https://www.google.com/maps/"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def main() -> int:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    require(data["schemaVersion"] == "1.1.0", "unexpected snapshot schemaVersion")
    require(
        data["trip"]["states"] == ["confirmed", "candidate", "backup", "pending"],
        "state declaration does not match the required ordered contract",
    )
    official = data["officialItinerary"]
    require(official["status"] == "official", "official itinerary status is not locked")
    require(official["sourceLabel"] == "使用者指定正式版行程（公開安全摘要）", "unexpected official itinerary source label")
    require(official["dayCount"] == 11, "official itinerary day count is not 11")
    require(official["dateRange"] == data["trip"]["dateRange"], "official itinerary range differs from trip range")

    expected_dates = []
    current = date.fromisoformat(data["trip"]["dateRange"]["start"])
    end = date.fromisoformat(data["trip"]["dateRange"]["end"])
    while current <= end:
        expected_dates.append(current.isoformat())
        current += timedelta(days=1)
    require(
        [day["date"] for day in data["dailyPlans"]] == expected_dates,
        "daily plans do not exactly cover the official date range",
    )

    navigation_count = 0
    for index, day in enumerate(data["dailyPlans"], start=1):
        require(day["state"] in ALLOWED_STATES, f"dailyPlans[{index}] has invalid state")
        require(day["date"].startswith("2026-08-"), f"dailyPlans[{index}] has unexpected date")
        require(bool(day["source"]), f"dailyPlans[{index}] lacks source")
        for link_index, link in enumerate(day["navigation"], start=1):
            require(link["state"] in ALLOWED_STATES, f"navigation {index}.{link_index} has invalid state")
            require(bool(link["source"]), f"navigation {index}.{link_index} lacks source")
            require(
                link["mapsUrl"].startswith(MAPS_PREFIX),
                f"navigation {index}.{link_index} is not a public Google Maps URL",
            )
            location = link.get("mapLocation")
            require(isinstance(location, dict), f"navigation {index}.{link_index} lacks mapLocation")
            lat, lng = location.get("lat"), location.get("lng")
            require(isinstance(lat, (int, float)) and -90 <= lat <= 90, f"navigation {index}.{link_index} has invalid map latitude")
            require(isinstance(lng, (int, float)) and -180 <= lng <= 180, f"navigation {index}.{link_index} has invalid map longitude")
            require(bool(location.get("source")), f"navigation {index}.{link_index} lacks map location source")
            navigation_count += 1

    for section in ("saves", "checklist"):
        for index, item in enumerate(data[section], start=1):
            require(item["state"] in ALLOWED_STATES, f"{section}[{index}] has invalid state")
            require(bool(item["source"]), f"{section}[{index}] lacks source")

    print(
        "CONTRACT CHECK PASSED: "
        f"{len(data['dailyPlans'])} daily plans, {navigation_count} public Maps links, "
        f"{len(data['saves'])} saves, {len(data['checklist'])} checklist items; "
        "official itinerary source and dates locked."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"CONTRACT CHECK FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
