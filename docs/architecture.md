# Архитектура: telegatask V1

## Компоненты

### Логи и отладка

- **actionLogs** — коллекция в Firestore для аудита действий: task_created, task_status_updated, task_deleted, knowledge_added, team_linked, role_set, permission_updated, project_attached.
- **Debug** — переменные окружения: `DEBUG=1` (подробный лог), `LOG_LEVEL=debug` (verbose режим). Эндпоинты: `/debug/ping-db`, `/debug/status`, `/debug/action-logs`.

1. **Telegram Bot**
   - Принимает сообщения из групповых чатов и лички.
   - Обрабатывает:
     - `/t @user ...` в группах.
     - форварды сообщений в личку.
   - Отправляет запросы в Backend.

2. **Backend (Node.js + TypeScript + Express)**
   - REST API.
   - Бизнес-логика:
     - создание задач,
     - обновление задач,
     - чтение задач.
   - Работает с Firestore (Firebase) через `firebase-admin`.

3. **Firestore**
   - Коллекции:
     - `users` — пользователи Telegram.
     - `chats` — чаты/группы.
     - `tasks` — задачи.

## Потоки данных V1

### 1. /t @user в групповом чате

1. Пользователь пишет в группе `/t @username ...` или `/t` как reply.
2. Telegram → Bot.
3. Bot:
   - определяет:
     - кто дал задачу (fromUser),
     - кому (mentionedUser),
     - текст задачи,
     - chatId / messageId.
4. Bot → Backend (`POST /tasks/from-chat-command`).
5. Backend:
   - сохраняет/обновляет users, chats,
   - создаёт документ в tasks.
6. Bot отвечает в чат: "Задача создана...".

### 2. Форвард сообщения боту в личку

1. Пользователь пересылает сообщение боту в личку.
2. Telegram → Bot.
3. Bot:
   - вытаскивает текст,
   - ищет @username (ответственный),
   - определяет источник (forward_from_chat, message_id).
4. Bot → Backend (`POST /tasks/from-forward`).
5. Backend:
   - сохраняет/обновляет сущности,
   - создаёт задачу:
     - с assignedUser, если был @user,
     - иначе во входящие.
6. Bot отвечает пользователю: "Задача создана..." или "Добавлено во входящие".