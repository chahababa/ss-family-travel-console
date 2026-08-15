#!/usr/bin/env python3
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PHOTO_DIRECTORY = ROOT / "assets" / "introductions"
EXPECTED_PHOTO_IDS = {
    "kusatsu-yubatake",
    "shima-onsen",
    "karuizawa-nature-culture",
    "usui-railway",
    "candidate-iwami-kagura",
    "candidate-yamba-roadside-station",
}

def webp_dimensions(path):
    """Read dimensions from a lossily encoded WebP VP8 keyframe without extra deps."""
    payload = path.read_bytes()
    assert payload.startswith(b"RIFF") and payload[8:12] == b"WEBP", f"not a WebP: {path}"
    marker = payload.find(b"\x9d\x01\x2a")
    assert marker >= 0 and marker + 7 <= len(payload), f"cannot read WebP dimensions: {path}"
    width = int.from_bytes(payload[marker + 3:marker + 5], "little") & 0x3fff
    height = int.from_bytes(payload[marker + 5:marker + 7], "little") & 0x3fff
    return width, height


data = json.loads((ROOT / "data" / "introductions.json").read_text(encoding="utf-8"))
items = data.get("items")
assert isinstance(items, list) and len(items) >= 8, "introductions.items must contain the trip introductions"
trip = json.loads((ROOT / "data" / "trip-data.json").read_text(encoding="utf-8"))
renderer = (ROOT / "app.js").read_text(encoding="utf-8")
assert "本站版本經 16:9 裁切與 WebP 壓縮" in renderer, "photo derivative disclosure missing from renderer"

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
    photo = item.get("photo")
    if photo is not None:
        required_photo = {"src", "alt", "caption", "creator", "license", "licenseUrl", "sourceUrl"}
        missing_photo = required_photo - photo.keys()
        assert not missing_photo, f"photo missing fields: {item['id']}: {sorted(missing_photo)}"
        assert photo["src"].startswith("assets/introductions/") and photo["src"].endswith(".webp"), f"unsafe photo src: {item['id']}"
        photo_path = ROOT / photo["src"]
        assert photo_path.is_file() and photo_path.stat().st_size >= 50_000, f"missing or undersized photo: {item['id']}"
        width, height = webp_dimensions(photo_path)
        assert width == 1280 and height == 720, f"unexpected photo dimensions: {item['id']}: {width}x{height}"
        assert all(isinstance(photo[field], str) and photo[field].strip() for field in ("alt", "caption", "creator", "license")), f"blank photo attribution: {item['id']}"
        for url_field in ("licenseUrl", "sourceUrl"):
            parsed = urlparse(photo[url_field])
            assert parsed.scheme == "https" and parsed.netloc, f"unsafe photo URL: {item['id']}"
        assert urlparse(photo["sourceUrl"]).netloc == "commons.wikimedia.org", f"photo source must be Wikimedia Commons: {item['id']}"

photo_ids = {item["id"] for item in items if item.get("photo")}
assert photo_ids == EXPECTED_PHOTO_IDS, f"unexpected photo coverage: {sorted(photo_ids)}"
assert len(list(PHOTO_DIRECTORY.glob("*.webp"))) == len(EXPECTED_PHOTO_IDS), "local photo file count must match photo cards"

assert source_refs == set(range(1, max(source_refs) + 1)), "source refs must be contiguous"
coverage = data.get("candidateCoverage", {})
expected_candidates = set(coverage.get("names", []))
actual_candidates = {item.get("sourceName") for item in items if item.get("state") == "candidate"}
assert expected_candidates and actual_candidates == expected_candidates, f"candidate library coverage mismatch: expected={sorted(expected_candidates)}, actual={sorted(actual_candidates)}"

daily_links = data.get("dailyItineraryLinks")
assert isinstance(daily_links, list) and daily_links, "daily itinerary links must be present"
daily_items = {(day["date"], label) for day in trip["dailyPlans"] for label in day["highLevelItinerary"]}
daily_link_keys = set()
for index, link in enumerate(daily_links):
    required_link = {"date", "label", "introductionId"}
    assert set(link) == required_link, f"daily itinerary link {index} has unexpected fields"
    key = (link["date"], link["label"])
    assert key in daily_items, f"daily itinerary link {index} does not match an official itinerary item"
    assert key not in daily_link_keys, f"duplicate daily itinerary link: {key}"
    assert link["introductionId"] in ids, f"daily itinerary link {index} points to a missing introduction"
    daily_link_keys.add(key)
august_15_intro_ids = {
    link["introductionId"] for link in daily_links if link["date"] == "2026-08-15"
}
assert august_15_intro_ids == {
    "shibuya-design-stationery",
    "ron-mueck-mori-2026",
    "kabukicho-bon-odori-2026",
}, f"8/15 Tokyo four-stop introduction coverage mismatch: {sorted(august_15_intro_ids)}"
print(f"INTRODUCTION DATA VALIDATION PASSED: {len(items)} cards; {len(daily_links)} daily itinerary links; {len(photo_ids)} licensed, local 1280x720 WebP photos; {len(source_refs)} numbered official HTTPS sources; {len(actual_candidates)} candidate-library items covered.")
