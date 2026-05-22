# Mini App / Backend Deployment (Actual)

Обновлено: 2026-03-03

## Фактическая схема

- Backend API и Telegram-бот запускаются из одного entrypoint: `src/index.ts`.
- Прод деплой backend/бота идет на TimeWeb VPS через `scripts/deploy.sh`.
- PM2 процесс: `telegatask`.
- Mini App деплоится в GitHub Pages через workflow `.github/workflows/deploy-miniapp.yml`.
- Если GitHub Pages недоступен, backend отдает mini app статику по `/mini-app`.

## Backend + Bot (TimeWeb)

Источник: `scripts/deploy.sh`.

- Хост: `root@147.45.132.90`
- SSH порт: `2222`
- Директория на сервере: `/opt/telegatask`
- Что делает скрипт:
  - синхронизирует проект на сервер;
  - копирует `.env` и `serviceAccountKey.json`;
  - ставит зависимости и собирает проект;
  - перезапускает PM2 процесс `telegatask`.

Команда локального деплоя:

```bash
./scripts/deploy.sh
```

Проверка на сервере:

```bash
pm2 status
pm2 logs telegatask
curl http://localhost:3000/health
```

## Mini App

### Основной вариант: GitHub Pages

Источник: `.github/workflows/deploy-miniapp.yml`.

- Триггер: push в `main` при изменениях в `mini-app/**`.
- Публикует директорию `mini-app`.
- Перед публикацией может инжектить API base URL через GitHub variable `MINIAPP_API_URL` (meta `api-base` в `mini-app/index.html`).

### Fallback: статика с backend

Источник: `src/index.ts`.

- Статика mini app монтируется на `/mini-app`.
- Редирект `/mini-app` -> `/mini-app/` для корректной загрузки.

## Связка Bot <-> Mini App

- Bot WebApp URL задается через `MINI_APP_URL` в `.env`.
- Кнопки WebApp формируются в `src/bot/telegataskBot.ts`.

## Связка Mini App <-> API

- Mini app отправляет заголовок `X-Telegram-Init-Data` (см. `mini-app/core/api.js`).
- Backend валидирует Telegram initData подпись в `src/middleware/validateWebApp.ts`.

## Данные и доступ

- Хранилище: Firestore через `firebase-admin`.
- Конфиг Firebase: `src/config/firebase.ts`.
- Credentials:
  - предпочтительно `GOOGLE_APPLICATION_CREDENTIALS`;
  - fallback: локальный `serviceAccountKey.json`.

## Обязательные env для production

```env
TELEGRAM_BOT_TOKEN=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
MEDIA_PLAN_FAST_MODEL=claude-haiku-4-5
MEDIA_PLAN_THINKING_MODEL=claude-opus-4-5
GOOGLE_APPLICATION_CREDENTIALS=/opt/telegatask/serviceAccountKey.json
MINI_APP_URL=https://taskbot.pldata.io
```
