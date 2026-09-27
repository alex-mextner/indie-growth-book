# Из продукта в бизнес / From Product to Business

**RU.** Книга для тех, кто умеет делать продукты, но не умеет делать так, чтобы ими пользовались и за них платили. Инди-разработчики, авторы Telegram-ботов и пет-проектов, маленькие команды без бюджета на маркетинг. Не объясняет очевидное и строит мостики к тому, чего вы не знаете: атрибуция, воронки и когорты, юнит-экономика продукта с ИИ-затратами, контент и сообщества, посевы и платная реклама на 100 $, подписки и партнёрская монетизация, отдельная большая часть о Telegram-ботах.

**EN.** A book for people who can build products but haven't figured out how to get them used and paid for. Indie developers, Telegram bot authors, side-project makers, tiny teams with no marketing budget. It skips the obvious and builds bridges to what you don't know yet: attribution, funnels and cohorts, unit economics for AI-cost products, content and communities, seeding and a $100 paid-ads test, subscriptions and partner monetization — plus a full part on Telegram bots.

~300 pages · 6 parts · 35 chapters · templates, checklists, RU↔EN glossary.

Статус / status: **в работе / work in progress** — см. [docs/outline.md](docs/outline.md).

## Сборка / Build

```bash
./scripts/build.sh          # RU + EN → dist/*.epub, *.fb2, *.docx, *.pdf
./scripts/build.sh ru fb2   # один язык, один формат
```

Нужны `pandoc` ≥ 3.1; для PDF — LibreOffice. Каждый push собирает книгу в GitHub Actions (артефакты в разделе Actions).

## Как пишется / How it's written

Каждая глава проходит минимум два раунда независимого ревью (редактор, фактчекер, целевой читатель, практик, внешняя модель) — см. [docs/review-process.md](docs/review-process.md) и записи в [reviews/](reviews/). Стиль — [docs/style-guide.md](docs/style-guide.md).

## Авторы / Authors

**Alex Mextner** — продуктовый дизайнер и фронтенд-разработчик, CTO [HyperIDE](https://hyperide.ai), автор книги [VS Code Extension API — The Complete Developer Guide](https://github.com/alex-mextner/code-ext-book). Telegram: [@mxtnr](https://t.me/mxtnr).

## Лицензия / License

Текст — [CC BY-NC-SA 4.0](LICENSE): можно читать, делиться и переделывать с указанием авторства и под той же лицензией, **но не в коммерческих целях**. Продажа (в том числе на Литрес) — только авторами.
Text is licensed under [CC BY-NC-SA 4.0](LICENSE): share and adapt with attribution under the same license, **non-commercially**. Commercial distribution is reserved to the authors.
