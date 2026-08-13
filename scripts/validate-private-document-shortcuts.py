#!/usr/bin/env python3
"""Validate the user-approved, public Google Drive folder shortcut allowlist."""

from __future__ import annotations

import json
import html
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "data" / "private-document-shortcuts.json"
EXPECTED = (
    ("旅程資料總覽", "查看整體訂票與憑證分類。", "https://drive.google.com/drive/folders/1Vb20JQC1-UUqdad0n9Qhlq1ydvM71nb5"),
    ("機票", "查看航班相關分類。", "https://drive.google.com/drive/folders/1kNWR0Yuf2_wcqAFTK0HQESRdqdc-imKi"),
    ("住宿（Agoda／飯店）", "查看住宿相關分類。", "https://drive.google.com/drive/folders/1yUYqMIAUxxuFFkgWNi-wN_ZFrrMe2AwB"),
    ("租車", "查看租車相關分類。", "https://drive.google.com/drive/folders/1QA46EnxcPuEuy7RcNo0uw2wFLAJbZ-v4"),
    ("活動／交通票券", "查看活動與交通票券分類。", "https://drive.google.com/drive/folders/1TzIF8enZ_mQ9TVQZGA2HGA-M-DA0ZRzQ"),
)
EXPECTED_URLS = {item[2] for item in EXPECTED}
EXPECTED_FOLDER_IDS = {urlparse(url).path.rsplit("/", 1)[-1] for url in EXPECTED_URLS}
COMPLETE_DRIVE_URL = re.compile(r"https://drive\.google\.com/[^\s\"'<>\]\[(){}]+", re.IGNORECASE)
DRIVE_FOLDER_REFERENCE = re.compile(
    r"drive\.google\.com/drive/folders/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)
SENSITIVE = re.compile(
    "|".join((
        r"drive\.google\.com/(?:fi" + r"le/d|op" + r"en\?|u" + r"c\?)",
        r"(?:book" + r"ing|reser" + r"vation|confir" + r"mation|tic" + r"ket|pnr)"
        r"[\s_:-]*(?:ref(?:erence)?|code|number|no)?[\s:#=]*[A-Z0-9]{6,}",
        r"(?:票號|訂位碼|確認碼|訂單號)[\s:#：=]*[A-Z0-9-]{6,}",
        r"(?:\d[ -]?){13,19}",
    )),
    re.IGNORECASE,
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def is_folder_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "drive.google.com"
        and bool(re.fullmatch(r"/drive/folders/[A-Za-z0-9_-]+", parsed.path))
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
    )


def tracked_texts() -> dict[str, str]:
    texts: dict[str, str] = {}
    tracked = subprocess.check_output(
        ["git", "-C", str(ROOT), "ls-files"],
        text=True,
    ).splitlines()
    for relative in tracked:
        try:
            texts[relative] = (ROOT / relative).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
    return texts


def normalize_executable_url_text(text: str) -> str:
    def decode_ascii(match: re.Match[str]) -> str:
        codepoint = int(next(group for group in match.groups() if group is not None), 16)
        return chr(codepoint) if codepoint <= 0x7F else match.group(0)

    normalized = html.unescape(text)
    normalized = re.sub(r"\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})", decode_ascii, normalized)
    return normalized.replace(r"\/", "/")


def validate_whole_public_artifact() -> None:
    observed: set[str] = set()
    observed_folder_ids: set[str] = set()
    for text in tracked_texts().values():
        normalized = normalize_executable_url_text(text)
        for match in COMPLETE_DRIVE_URL.findall(normalized):
            observed.add(match.rstrip(".,;:!?"))
        observed_folder_ids.update(DRIVE_FOLDER_REFERENCE.findall(normalized))
    require(
        observed == EXPECTED_URLS,
        "tracked public artifact must expose exactly the five approved Drive folder URLs",
    )
    require(
        observed_folder_ids == EXPECTED_FOLDER_IDS,
        "tracked public artifact contains an unapproved Drive folder identifier",
    )


def main() -> int:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    require(set(data) == {"schemaVersion", "shortcuts"}, "shortcut config contains unapproved metadata")
    require(data.get("schemaVersion") == "1.0.0", "unexpected shortcut config schemaVersion")
    shortcuts = data.get("shortcuts")
    require(isinstance(shortcuts, list) and len(shortcuts) == 5, "shortcut config must contain exactly five entries")

    actual = []
    for index, shortcut in enumerate(shortcuts, start=1):
        require(isinstance(shortcut, dict) and set(shortcut) == {"label", "description", "url"}, f"shortcut {index} has unapproved fields")
        require(all(isinstance(shortcut[field], str) and shortcut[field].strip() for field in shortcut), f"shortcut {index} has blank data")
        require(is_folder_url(shortcut["url"]), f"shortcut {index} is not a bare Google Drive folder URL")
        rendered = "\n".join(shortcut.values())
        require(not SENSITIVE.search(rendered), f"shortcut {index} contains a file URL or sensitive identifier pattern")
        actual.append((shortcut["label"], shortcut["description"], shortcut["url"]))

    require(tuple(actual) == EXPECTED, "shortcut config does not exactly match the user-approved folder allowlist")
    validate_whole_public_artifact()
    print("PRIVATE DOCUMENT SHORTCUTS CHECK PASSED: whole tracked artifact exposes only the five approved Google Drive folder URLs; no file URLs or sensitive identifier patterns.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"PRIVATE DOCUMENT SHORTCUTS CHECK FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
