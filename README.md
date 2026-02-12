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
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
```

## Запуск

```bash
npm run dev   # разработка
npm run build && npm run start   # прод
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
