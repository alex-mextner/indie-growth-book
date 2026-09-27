#!/usr/bin/env bash
# Characters with spaces (code blocks excluded) and estimated pages (2000 chars/page) per chapter.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import glob, re, os
for lang in ("ru", "en"):
    files = sorted(glob.glob(f"book/{lang}/[0-9]*.md"))
    if not files:
        continue
    total = 0
    print(f"== {lang}")
    for f in files:
        text = open(f, encoding="utf-8").read()
        text = re.sub(r"```.*?```", "", text, flags=re.S)
        n = len(text)
        total += n
        print(f"{os.path.basename(f):40s} {n:8d} chars {n/2000:6.1f} pages")
    print(f"{'TOTAL':40s} {total:8d} chars {total/2000:6.1f} pages")
PY
