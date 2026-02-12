# Mini App и домен pldata.io

## Что уже сделано

- **taskbot.pldata.io** → GitHub Pages (Mini App), HTTPS работает.
- **api.pldata.io** → A‑запись на сервер, Nginx на порту 80 проксирует на бота (порт 3000).  
  Сейчас доступен только **HTTP**: `http://api.pldata.io/health`.

## Чтобы Mini App работал из Telegram

1. **Включи HTTPS для API** (браузер не пускает запросы с HTTPS‑страницы на HTTP‑API).  
   Самый простой вариант — **Cloudflare**:
   - Добавь домен **pldata.io** в Cloudflare (или поддомен).
   - Для записи **api** (api.pldata.io) включи **Proxy** (оранжевое облако).
   - Режим SSL: **Flexible** (Cloudflare ↔ пользователь по HTTPS, Cloudflare ↔ твой сервер по HTTP на порт 80).

   После этого будет работать **https://api.pldata.io**.

2. **Кнопка «Открыть менеджер задач» в боте**  
   В `.env` на сервере добавь:
   ```bash
   MINI_APP_URL=https://taskbot.pldata.io
   ```
   И перезапусти бота (или сделай деплой).

## Проверка

- Mini App: https://taskbot.pldata.io/
- API по HTTP: http://api.pldata.io/health  
- После настройки Cloudflare: https://api.pldata.io/health
