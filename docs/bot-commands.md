# Telegatask Bot — Command Reference (Draft)

Черновик для пошаговой реализации. Для каждой команды указаны: назначение, входные данные, минимум логики, где хранить/читать в Firestore. При внедрении держим все команды доступными через кнопки (reply_keyboard/inline) в 1:1 чатах.

---

## Общие / сервисные

- `/start` — регистрирует пользователя, сохраняет Telegram (users). Ответ: приветствие + кнопки.
  - Input: `ctx.from`, `ctx.chat`.
  - Firestore: `users` upsert по `telegramId`.
- `` — выдать краткий список команд + кнопки.
  - Input: none.
  - Firestore: нет.
- `/profile` — показать мои проекты/роли/статус.
  - Input: `ctx.from`.
  - Firestore: `users`, `teams`, `projects` (по userId).
- `/connect` — сгенерировать magic-link/код для веба.
  - Input: `ctx.from`.
  - Firestore: `users` (сохранить одноразовый токен/expiry).

## Задачи

- `/t` (`/newtask`) — создать задачу из текста/реплая.
  - Input: текст или reply, optional @assignees, optional дата.
  - Firestore: `tasks` (sourceChatId/Title, createdBy, assignees[], dueDate, description, title="").
- `/my` — мои задачи (assignee = user).
  - Firestore: `tasks` query by `assignedUserId` (включая username-*), statuses active.
- `/my_today` — мои на сегодня.
  - Firestore: `tasks` filter by assignee + dueDate = сегодня.
- `/my_overdue` — мои просроченные.
  - Firestore: `tasks` filter by assignee + dueDate < now + not done.
- `/outbox` — задачи, которые я поставил.
  - Firestore: `tasks` filter by `createdByUserId`.
- `/done <id|num>` — отметить выполненной.
  - Firestore: `tasks` update status -> done.
- `/edit <id|num>` — изменить (дедлайн/исполнитель/статус).
  - Firestore: `tasks` update fields.
- `/search <query>` — поиск по тексту (позже: проброс в ИИ).
  - Firestore: первично — client-side фильтр; далее — ИИ/поиск.

## Проекты и команды

- `/projects` — список проектов для чата/команды.
  - Firestore: `projects` filtered by `teamId`/`chatId`.
- `/setproject <id>` — выбрать проект по умолчанию для чата.
  - Firestore: `chats` or `teams` settings: defaultProjectId.
- `/link_team <teamId>` — привязать чат к команде (только админ).
  - Firestore: `teams` <-> `chats` link.
- `/team` — инфо о команде, роли.
  - Firestore: `teams`, `users` (roles map).

## AI-функции (позже проброс в ИИ-слой)

- `/autoplan` — сгенерировать план задач по брифу.
- `/analyze` — анализ переписки (последние N сообщений) -> предложения задач.
- `/digest` — дайджест за день/неделю по чату/проекту.
  - Firestore: читаем `tasks`, `chats`, `projects`; сохранять сгенерированное в `knowledge` (опционально).

## Админские

- `/admin` — показать админ-действия.
- `/setrole @user role` — owner/admin/member/read_only.
  - Firestore: `teams` roles map.
- `/allow @user create|assign|edit`
- `/deny @user create|assign|edit`
  - Firestore: `teams` permissions map.
- `/settings` — флаги: enable_ai, digests_on, default_project, privacy.

## Knowledge

- `/k <text>` — записать заметку/брейндамп.
  - Input: текст или reply/forward; сохранять источник.
  - Firestore: `knowledge` {content, createdByUserId, sourceChatId/Title, sourceMessageId, createdAt, updatedAt}.

---

## Пошаговый план внедрения (итеративно)

1) **Сервисный скелет**: `/start`, `/help`, кнопки в 1:1 (reply_keyboard), базовый лог контекстов. Убедиться в регистрации пользователя (users) и кэшировании username/telegramId.
2) **Базовые задачи**: `/t` с парсингом @assignees и dueDate, `/my`, `/outbox`, `/done`, `/l` (уже есть) → привести к новым названиям (`/my`, `/outbox`, `/done`). Добавить кнопки: "Мои", "Исходящие", "Добавить".
3) **Фильтры по срокам**: `/my_today`, `/my_overdue`, доработать dueDate парсер. Добавить кнопки "Сегодня", "Просроченные".
4) **Knowledge**: стабилизировать `/k` (уже есть), добавить кнопки "Знания".
5) **Проекты/команды**: `/projects`, `/setproject`, `/team`, `/link_team` (хотя бы чтение/заглушки). Кэшировать выбор проекта per chat.
6) **Редактирование задач**: `/edit` (deadline/assignees/status) + кнопки "Править".
7) **Поиск/ИИ**: `/search`, `/analyze`, `/autoplan`, `/digest` — прокинуть в ИИ-слой (флаги enable_ai).
8) **Админ**: `/admin`, `/setrole`, `/allow`, `/deny`, `/settings` — проверки ролей, хранение в `teams`.
9) **UX**: добавить inline-кнопки на ответах бота (Done, Edit, Add to Knowledge), полноценную клавиатуру в личке.

Каждый шаг: сначала скелет хэндлера (валидации, минимум Firestore), потом прогон автоответов/кнопок, затем интеграция с ИИ где требуется.
