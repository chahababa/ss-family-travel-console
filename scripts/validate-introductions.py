#!/usr/bin/env python3
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "data" / "introductions.json").read_text(encoding="utf-8"))
items = data.get("items")
assert isinstance(items, list) and len(items) >= 8, "introductions.items must contain the trip introductions"

required = {"id", "title", "dates", "area", "category", "summary", "features", "background", "familyTip", "sources"}
ids = set()
source_refs = set()
for index, item in enumerate(items):
    missing = required - item.keys()
    assert not missing, f"introduction {index} missing: {sorted(missing)}"
    assert item["id"] not in ids, f"duplicate introduction id: {item['id']}"
    ids.add(item["id"])
    assert isinstance(item["dates"], list) and all(date.startswith("2026-08-") for date in item["dates"]), f"invalid dates: {item['id']}"
    assert len(item["features"]) >= 3 and all(isinstance(value, str) and value.strip() for value in item["features"]), f"invalid features: {item['id']}"
    assert item["background"].strip() and item["familyTip"].strip(), f"missing context: {item['id']}"
    assert item["sources"], f"missing source: {item['id']}"
    for source in item["sources"]:
        parsed = urlparse(source.get("url", ""))
        assert parsed.scheme == "https" and parsed.netloc and source.get("title"), f"unsafe source: {item['id']}"
        assert isinstance(source.get("ref"), int) and source["ref"] > 0, f"invalid source ref: {item['id']}"
        source_refs.add(source["ref"])

assert source_refs == set(range(1, max(source_refs) + 1)), "source refs must be contiguous"
coverage = data.get("candidateCoverage", {})
expected_candidates = set(coverage.get("names", []))
actual_candidates = {item.get("sourceName") for item in items if item.get("state") == "candidate"}
assert expected_candidates and actual_candidates == expected_candidates, f"candidate library coverage mismatch: expected={sorted(expected_candidates)}, actual={sorted(actual_candidates)}"
print(f"INTRODUCTION DATA VALIDATION PASSED: {len(items)} cards with {len(source_refs)} numbered official HTTPS sources; {len(actual_candidates)} candidate-library items covered.")
