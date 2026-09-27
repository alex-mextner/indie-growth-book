# CLAUDE.md

Guidance for AI agents (Claude Code, Codex, review-cli seats) working in this repository.

## What this is

A book in two original editions — Russian (`book/ru/`) and English (`book/en/`) — about turning indie products and Telegram bots into businesses. Source is Pandoc Markdown; builds produce EPUB, FB2, DOCX and PDF. The Russian edition is published on Litres (Литрес Авторы) under a non-exclusive license; the source is public under CC BY-NC-SA 4.0.

## Build

```bash
./scripts/build.sh        # both languages, all formats → dist/
./scripts/build.sh ru     # Russian only
./scripts/build.sh en pdf # one language, one format
./scripts/stats.sh        # characters / pages per chapter vs. budget in docs/outline.md
```

Requires `pandoc` ≥ 3.1 and, for PDF, LibreOffice (DOCX → PDF). Litres accepts DOCX, FB2 or PDF; FB2 is the preferred upload.

## Layout

- `book/<lang>/NN-MM-slug.md` — one file per chapter; order = filename order. `metadata.yaml` per language.
- `docs/outline.md` — table of contents, page budgets, per-chapter status (plan → draft → review → fixes → done). Update status in the same commit as the chapter.
- `docs/style-guide.md` — voice, chapter structure (essence → bridge → step → recap), markup. **Read before writing.**
- `docs/review-process.md` — mandatory review cycle. **No chapter reaches `done` without two review rounds recorded in `reviews/`.**
- `reviews/prompts/` — prompts for reviewer seats (editor, fact-checker, target reader, practitioner, external).
- `assets/` — cover, diagrams (SVG source + PNG export), EPUB CSS.

## Rules

- **RU and EN stay in structural sync.** Same chapters, sections, callouts, steps. A change to one edition lands in the same PR as the matching change to the other (or the PR says explicitly which edition lags and why).
- **EN is not a translation.** Never write "translation", "translated from", "перевод" in EN files. Write original English prose to the same plan.
- **Copyright.** Paraphrase ideas from other books in your own words with a source note. Quotes ≤ 2 sentences, in quotation marks, attributed. Never reproduce passages, tables or figures from copyrighted books.
- **No invented facts.** No fabricated case studies presented as real, no invented statistics. Hypotheticals are marked as such; unsourced numbers are marked "rule of thumb: check it against your own data" / «ориентир, проверяйте на своих данных».
- **Platform facts carry a date and a source** (Threads, Telegram, ad exchanges, Litres) — they change.
- **Privacy.** The authors and people around them appear only with facts they approved for publication. No private messages, no personal stories from social media, no health, politics, finances of real people. When in doubt, generalize ("a friend who runs meetups").
- Callouts use fenced divs: `::: note`, `::: tip`, `::: warning`, `::: case`, `::: step`, `::: skip`.
- Chapter ids: `{#ch-2-1}`; cross-refs `[chapter 2.1](#ch-2-1)`.

## Workflow for a chapter

1. Read `docs/style-guide.md`, the outline entry, and neighbouring chapters.
2. Draft RU → run the review round (`docs/review-process.md`) → record in `reviews/` → fix → round 2.
3. Write EN to the same structure → EN review → record.
4. `./scripts/build.sh` must pass; update `docs/outline.md` status.
