# Mini App и домен pldata.io

## Что сейчас сделано

### Mini App (менеджер задач)
- **Фронтенд:** HTML + CSS + JS (без фреймворков), Telegram Web App SDK.
- **Хостинг:** GitHub Pages, кастомный домен **https://taskbot.pldata.io** (CNAME в Cloudflare → nikolai-sol.github.io).
- **Функции:** список задач (активные / выполненные / все), кнопки «Выполнено» и «Удалить», фильтры, тосты, тема Telegram.

### API бота для Mini App
- **Эндпоинты:** `GET /api/tasks`, `POST /api/tasks/:id/status`, `DELETE /api/tasks/:id`.
- **Авторизация:** проверка Telegram WebApp `initData` (HMAC-SHA256).
- **Сервер:** Nginx на порту 80 проксирует **api.pldata.io** на Node (порт 3000). HTTPS — через Cloudflare (режим Flexible).

### Домен и DNS (Cloudflare)
- **api.pldata.io** — A → 147.45.132.90, **Proxied** (HTTPS для пользователя).
- **taskbot.pldata.io** — CNAME → nikolai-sol.github.io, **DNS only**.
- **pldata.io / www** — A → 185.215.4.10 (Тильда), **DNS only** (избегаем редирект-лупа).
- **autodiscover, email, lyncdiscover, msoid, sip** — **DNS only** (почта/Microsoft).

### Бот
- В списке задач (/l, «Мои задачи») кнопка **«Открыть менеджер задач»** (WebApp) — если в `.env` задано `MINI_APP_URL=https://taskbot.pldata.io`.

---

## Как это было настроено (справка)

1. **HTTPS для API:** домен pldata.io в Cloudflare, для записи **api** — Proxied, SSL/TLS → **Flexible** (чтобы Cloudflare ходил на origin по HTTP:80, а не на 443 где Xray).
2. **Кнопка в боте:** в `.env` на сервере `MINI_APP_URL=https://taskbot.pldata.io`, перезапуск бота.

## Проверка

- Mini App: https://taskbot.pldata.io/
- API health: https://api.pldata.io/health → `{"status":"ok","service":"telegatask-backend"}`
