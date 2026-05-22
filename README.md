# telegatask

Telegram-бот для управления задачами и базой знаний.

## Установка

```bash
npm install
```

## Конфигурация

Создайте `.env`:

```
TELEGRAM_BOT_TOKEN=...
GEMINI_API_KEY=...        # для /ask, parse_today, парсинга дат
ANTHROPIC_API_KEY=...     # для /mediaplan (Claude)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3-fast:latest
OLLAMA_TIMEOUT_MS=90000
MEDIA_PLAN_FAST_MODEL=claude-haiku-4-5
MEDIA_PLAN_THINKING_MODEL=claude-opus-4-5
MEDIA_PLAN_RESEARCH_MODEL=claude-haiku-4-5
MEDIA_PLAN_STRATEGY_MODEL=claude-opus-4-6
MEDIA_PLAN_TEST_GROUP_ID=-5275318533
MEDIA_PLAN_CLAUDE_RETRY_ATTEMPTS=4
MEDIA_PLAN_CLAUDE_RETRY_BASE_MS=1200
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
```

## Запуск

```bash
npm run dev   # разработка
npm run build && npm run start   # прод
```

## Deployment Topology

- Backend API + Telegram bot запускаются одним процессом из `src/index.ts`.
- Production деплой backend/бота: TimeWeb VPS через [`scripts/deploy.sh`](/Volumes/Elements/telegatask/scripts/deploy.sh) (SSH `2222`, PM2 процесс `telegatask`).
- Mini App:
  - основной вариант: GitHub Pages workflow [`deploy-miniapp.yml`](/Volumes/Elements/telegatask/.github/workflows/deploy-miniapp.yml);
  - fallback: статика от backend по пути `/mini-app` (см. `src/index.ts`).
- Бот открывает Mini App по `MINI_APP_URL` из `.env`.
- Mini App ходит в API с `X-Telegram-Init-Data`, backend валидирует подпись WebApp initData.

Минимальные переменные для прода:

```
TELEGRAM_BOT_TOKEN=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
MEDIA_PLAN_FAST_MODEL=claude-haiku-4-5
MEDIA_PLAN_THINKING_MODEL=claude-opus-4-5
GOOGLE_APPLICATION_CREDENTIALS=/opt/telegatask/serviceAccountKey.json
MINI_APP_URL=https://taskbot.pldata.io
```

Mac Mini (PM2) first-time setup:

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
# выполнить команду, которую выведет pm2 startup
```

## Ручная проверка (Knowledge 2.0)

### 1. /k — добавление заметок

- `/k Текст заметки` — создать note
- `/k` + reply на сообщение — сохранить как message
- `/k важно ...` или `/k!` — пометить important
- `/k` + reply на документ/фото — сохранить как file_ref (без загрузки)

### 2. /ksearch — поиск

- `/ksearch запрос` — поиск по ключевым словам с учётом свежести
- В группе: scope по чату/команде
- В личке: scope по пользователю

### 3. /ask — RAG-ответ

- `/ask Вопрос?` — Gemini отвечает по базе знаний с цитатами
- Требует GEMINI_API_KEY

### 4. Проверка

```
GET /health
GET /debug/status
GET /debug/action-logs?limit=20
```

## API

- `GET /health` — health check
- `GET /debug/ping-db` — проверка Firestore
- `GET /debug/status` — статус, env
- `GET /debug/action-logs?limit=50` — action logs
