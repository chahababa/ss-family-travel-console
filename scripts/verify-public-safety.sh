#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TARGETS=(
  "$ROOT/README.md"
  "$ROOT/index.html"
  "$ROOT/app.js"
  "$ROOT/helpers.js"
  "$ROOT/weather.js"
  "$ROOT/styles.css"
  "$ROOT/package.json"
  "$ROOT/data/trip-data.json"
  "$ROOT/data/introductions.json"
  "$ROOT/data/weather-locations.json"
  "$ROOT/data/private-document-shortcuts.json"
  "$ROOT/scripts/validate-trip-data.py"
  "$ROOT/scripts/validate-weather-locations.py"
  "$ROOT/scripts/validate-introductions.py"
)

for path in "${TARGETS[@]}"; do
  [[ -f "$path" ]] || { printf 'Missing required public scan target: %s\n' "$path" >&2; exit 2; }
done

check_absent() {
  local label="$1" pattern="$2"
  if grep -Ein -- "$pattern" "${TARGETS[@]}"; then
    printf 'PUBLIC SAFETY CHECK FAILED: %s\n' "$label" >&2
    exit 1
  fi
}

check_absent 'private-system reference outside approved Drive folder shortcuts' '(Gmail|drive\.google\.com/file/d/|drive\.google\.com/open\?|drive\.google\.com/uc\?)'
check_absent 'UUID-like internal identifier' '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
check_absent 'credential-shaped value' '(gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|ntn_[A-Za-z0-9_-]{12,}|secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|BEGIN [A-Z ]*PRIVATE KEY)'
check_absent 'reservation or payment identifier' '(booking|reservation|confirmation)[[:space:]_-]*(ref(erence)?|code|number|no)?[[:space:]]*[:#=][[:space:]]*[A-Z0-9]{6,}|([0-9]{4}[- ][0-9]{4}[- ][0-9]{4}[- ][0-9]{4}|[0-9]{13,19})'

printf 'PUBLIC SAFETY CHECK PASSED: %d files scanned; no private-system references or secret-shaped patterns found.\n' "${#TARGETS[@]}"
