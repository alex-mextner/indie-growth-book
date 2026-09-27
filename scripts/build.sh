#!/usr/bin/env bash
# Build the book. Usage: ./scripts/build.sh [ru|en|all] [epub|fb2|docx|pdf|all]
set -euo pipefail
cd "$(dirname "$0")/.."
LANGS=${1:-all}; FORMATS=${2:-all}
[ "$LANGS" = all ] && LANGS="ru en"
[ "$FORMATS" = all ] && FORMATS="epub fb2 docx pdf"
mkdir -p dist
for L in $LANGS; do
  SRC=(book/$L/metadata.yaml $(ls book/$L/[0-9]*.md | sort))
  NAME="indie-growth-book-$L"
  COMMON=(--from markdown+fenced_divs+footnotes+pipe_tables --lua-filter scripts/callouts.lua --toc --toc-depth=2 --resource-path=.:assets)
  for F in $FORMATS; do
    case $F in
      epub) pandoc "${COMMON[@]}" --css assets/epub.css $( [ -f assets/cover-$L.png ] && echo --epub-cover-image=assets/cover-$L.png ) -o dist/$NAME.epub "${SRC[@]}" ;;
      fb2)  pandoc "${COMMON[@]}" -t fb2 -o dist/$NAME.fb2 "${SRC[@]}" ;;
      docx) pandoc "${COMMON[@]}" -o dist/$NAME.docx "${SRC[@]}" ;;
      pdf)  pandoc "${COMMON[@]}" -o dist/$NAME.docx "${SRC[@]}" && soffice --headless --convert-to pdf --outdir dist dist/$NAME.docx >/dev/null ;;
    esac
    echo "built dist/$NAME.$F"
  done
done
