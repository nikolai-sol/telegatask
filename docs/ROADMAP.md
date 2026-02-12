# Telegatask — Полный план развития

> Ассистент для рекламных агентств → коммерческий SaaS-продукт

---

## Контекст

Владелец рекламного агентства. Бот — личный ассистент:
- Ведёт задачи, которые поставлены коллегам
- Следит за сроками, напоминает
- Видит все чаты, в которых добавлен
- Сам вытаскивает задачи из переписки каждые 30 мин
- Хранит знания, файлы, решения
- Отвечает на вопросы по базе знаний

Коммерческий продукт: SaaS для других агентств с биллингом.

---

## Архитектура данных (Firestore)

### Коллекции

```
organizations         # Организация (агентство)
  ├── id
  ├── name
  ├── ownerId         # FK -> users
  ├── plan            # free | pro | team | enterprise
  ├── planExpiresAt
  ├── limits          # { tasks, knowledge, aiCalls, chats, members }
  ├── billingEmail
  ├── createdAt, updatedAt

users                 # Пользователи
  ├── id
  ├── telegramId
  ├── username
  ├── displayName
  ├── organizationId  # FK -> organizations
  ├── role            # owner | admin | member | viewer
  ├── timezone        # для напоминаний
  ├── settings        # { morningBrief, eveningDigest, remindBefore }
  ├── createdAt, updatedAt

chats                 # Telegram чаты/группы
  ├── id
  ├── telegramChatId
  ├── title
  ├── type
  ├── organizationId  # FK -> organizations
  ├── captureMode     # off | mention_only | full | auto_scan
  ├── scanInterval    # 30 (мин) — для auto_scan
  ├── lastScannedAt   # ISO — когда последний раз сканировали
  ├── defaultProjectId
  ├── createdAt, updatedAt

projects              # Проекты (клиенты агентства)
  ├── id
  ├── name
  ├── description
  ├── organizationId
  ├── chatIds[]
  ├── teamMemberIds[]
  ├── createdAt, updatedAt

tasks                 # Задачи
  ├── id
  ├── organizationId
  ├── projectId
  ├── sourceType      # chat_command | chat_auto | forward | scan | manual
  ├── sourceChatId, sourceChatTitle, sourceMessageId
  ├── createdByUserId
  ├── assignedUserId
  ├── title
  ├── description
  ├── status          # incoming | new | in_progress | waiting | done | cancelled
  ├── priority        # low | normal | high | urgent
  ├── dueDate
  ├── reminders[]     # [{ at: ISO, sent: bool }]
  ├── watchers[]      # userId[] — кто хочет уведомление о статусе
  ├── tags[]
  ├── followUp        # { enabled: bool, checkAfter: ISO, lastChecked: ISO }
  ├── createdAt, updatedAt

knowledge             # База знаний v2
  ├── (как есть — type, text, source, fileMeta, tags, etc.)
  ├── organizationId
  ├── projectId

messages              # Логированные сообщения чатов (для scan)
  ├── (как есть)
  ├── organizationId

actionLogs            # Аудит
  ├── (как есть)
  ├── organizationId

subscriptions         # Подписки / биллинг
  ├── id
  ├── organizationId
  ├── plan
  ├── status          # active | cancelled | past_due | trialing
  ├── startsAt, expiresAt
  ├── paymentProvider  # stripe | yookassa | manual
  ├── externalId       # stripe subscription id
  ├── createdAt, updatedAt

usageCounters         # Ежедневные счётчики
  ├── id              # orgId:2026-02-11
  ├── organizationId
  ├── date
  ├── tasksCreated
  ├── knowledgeAdded
  ├── aiCalls
  ├── scansRun
```

---

## Фичи по фазам

### Фаза 1 — Ассистент для тебя (2–3 недели)

#### 1.1 Auto-scan чатов каждые 30 мин
- Cron-job (node-cron или setInterval)
- Для каждого чата с `captureMode: "auto_scan"`:
  - Берёт сообщения из `messages` за последние 30 мин
  - Отправляет в Gemini → извлечение задач
  - Дедупликация по sourceMessageId
  - Создание задач
- Результат: бот сам находит задачи в чатах

#### 1.2 Напоминания и follow-up
- **Cron каждую минуту**: проверка `tasks.reminders` и `tasks.followUp`
- Типы напоминаний:
  - За N часов до дедлайна (настраивается в `users.settings.remindBefore`)
  - Просроченные: утром + каждые 4 часа
  - Follow-up: "ты попросил @user X — ответа нет уже 24ч"
- Доставка: сообщение в личку бота

#### 1.3 Утренний бриф / вечерний дайджест
- **Утро (9:00 по timezone)**: в личку приходит:
  - Задачи на сегодня
  - Просроченные
  - Ожидают ответа (follow-up)
  - Важное из знаний за вчера
- **Вечер (19:00)**: сводка дня:
  - Сколько задач создано / закрыто
  - Незакрытые от коллег
  - Активность по чатам

#### 1.4 "Кто не ответил"
- Если я назначил задачу (outbox) и за N часов не было обновления/ответа:
  - Бот шлёт мне: "⏰ Задача X для @user — нет ответа уже 24ч"
- Настраиваемый порог: 4ч / 12ч / 24ч / 48ч

#### 1.5 "Мне не ответили"
- Если в чате мне задали вопрос (@mention или reply) и я не ответил:
  - Бот шлёт мне: "💬 @user спросил в чате X — ты не ответил (2ч назад)"
- Реализация: при сканировании сообщений ищем mentions текущего пользователя без reply

#### 1.6 Приоритеты и статус waiting
- `priority`: low | normal | high | urgent
- `status: waiting` — я жду от кого-то
- Команды:
  - `/priority <id> high`
  - `/wait <id>` — переводит в waiting + включает follow-up

---

### Фаза 2 — Мультипользователь + организации (1–2 недели)

#### 2.1 Организации
- `/register_org <name>` — создать организацию
- `/invite @user` — добавить участника
- Все задачи, знания, чаты привязаны к `organizationId`
- Пользователь видит только данные своей организации

#### 2.2 Роли внутри организации
- **owner** — всё
- **admin** — управление задачами/проектами всех
- **member** — свои задачи + назначенные
- **viewer** — только просмотр

#### 2.3 Проекты = клиенты агентства
- `/project_create <name>` — создать проект
- `/project_link <chatId>` — привязать чат к проекту
- Задачи из чата автоматически попадают в проект
- Фильтры: `/tasks_project <id>`

---

### Фаза 3 — Коммерциализация (2–3 недели)

#### 3.1 Тарифные планы

```
Free (бесплатно):
  - 1 пользователь
  - 3 чата
  - 50 задач/мес
  - 20 знаний/мес
  - 10 AI-запросов/мес
  - Без auto-scan
  - Без напоминаний

Pro ($9/мес):
  - 1 пользователь
  - 15 чатов
  - Безлимит задач
  - 200 знаний/мес
  - 100 AI-запросов/мес
  - Auto-scan каждые 30 мин
  - Напоминания + бриф
  - Follow-up

Team ($29/мес):
  - До 10 пользователей
  - Безлимит чатов
  - Безлимит задач и знаний
  - 500 AI-запросов/мес
  - Проекты
  - Роли и права
  - Дайджесты

Enterprise (custom):
  - Безлимит всего
  - Приоритетная поддержка
  - Кастомные интеграции
  - SLA
```

#### 3.2 Биллинг
- **Платёжка**: YooKassa (РФ) + Stripe (мир)
- Коллекция `subscriptions` + `usageCounters`
- Middleware: перед каждым действием проверка лимита
- При превышении: "Лимит исчерпан. Перейдите на Pro: /upgrade"

#### 3.3 Onboarding
- `/start` → проверка: есть ли org?
  - Нет → предложить создать или получить инвайт
  - Да → показать dashboard
- Wizard: добавь бота в чат → выбери режим → первый скан

#### 3.4 Команды биллинга
- `/plan` — текущий тариф и использование
- `/upgrade` — выбор тарифа
- `/usage` — сколько использовано за месяц

---

### Фаза 3.5 — Знания и файлы (см. [PLAN-KNOWLEDGE-INDEXING.md](PLAN-KNOWLEDGE-INDEXING.md))

- Auto-save файлов в чатах → knowledge (file_ref) ✅ сделано
- Индексация содержимого PDF/Word для поиска — план в PLAN-KNOWLEDGE-INDEXING.md

---

### Фаза 4 — AI-агент (2 недели)

#### 4.1 /digest — реальный дайджест
- Gemini суммаризует: задачи + сообщения + знания за период
- Формат: ключевые решения, блокеры, метрики

#### 4.2 /analyze — анализ чата
- "О чём говорили", "какие риски", "кто активен", "что забыли"

#### 4.3 /autoplan — план из брифа
- Бриф клиента → структура: цели, KPI, каналы, гипотезы, задачи, сроки

#### 4.4 Умная классификация входящих
- Форвард в личку → бот сам определяет:
  - Это задача? → кнопки "Создать задачу"
  - Это знание? → "Сохранить в знания"
  - Это вопрос? → "Ответить позже" (reminder)

---

### Фаза 5 — Веб-дашборд (опционально, позже)

- Канбан-доска задач
- Календарь дедлайнов
- Аналитика: загруженность команды, скорость закрытия
- Управление организацией и биллингом
- Подключение через `/connect` → magic link

---

## Технический стек

| Компонент | Технология |
|-----------|------------|
| Runtime | Node.js 20 + TypeScript |
| Bot framework | Telegraf |
| Database | Firestore |
| AI | Gemini API (2.5 Flash) |
| Scheduling | node-cron |
| Process manager | PM2 |
| Server | TimeWeb VPS (Голландия) |
| Payments RU | YooKassa |
| Payments INT | Stripe |
| Web (позже) | Next.js или React |

---

## Приоритет реализации

```
Сейчас (Фаза 1):
  1. Auto-scan чатов каждые 30 мин        ← критично
  2. Напоминания по дедлайнам             ← критично
  3. Follow-up "кто не ответил"           ← критично
  4. "Мне не ответили"                    ← критично
  5. Утренний бриф                        ← важно
  6. Приоритеты + /wait                   ← полезно

Далее (Фаза 2):
  7. Организации
  8. Роли
  9. Проекты

Потом (Фаза 3):
  10. Тарифы + middleware
  11. Биллинг (YooKassa/Stripe)
  12. Onboarding

Позже (Фаза 4-5):
  13. AI-агент (digest, analyze, autoplan)
  14. Веб-дашборд
```
