---
name: project-architecture
description: "Полный гид по проекту telegatask: архитектура, skill-система, core, как добавлять новые модули. Читай ПЕРВЫМ при любой работе с проектом."
---

# Telegatask — Архитектура проекта

## Что это

Telegram-бот-ассистент для рекламного агентства (и SaaS-продукт для других агентств).
Управление задачами, база знаний, AI-ответы, авто-сканирование чатов, напоминания, paywall.

---

## Tech Stack

| Что | Чем |
|-----|-----|
| Runtime | Node.js 20 + TypeScript (strict) |
| Bot framework | Telegraf 4.x (long polling) |
| Database | Firestore (firebase-admin) |
| AI | Gemini API (REST, настраиваемая модель) |
| Scheduling | node-cron |
| HTTP | Express 5 (health + debug endpoints) |
| Deploy | PM2 → TimeWeb VPS (Нидерланды, порт SSH 2222) |

---

## Архитектура (два слоя)

```
┌──────────────────────────────────────────────────────────────┐
│                     Telegram Message                         │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   telegataskBot.ts                            │
│  1. logIncomingMessage + storeIncomingMessage                 │
│  2. SkillRouter.handleMessage() ← пробует скиллы ПЕРВЫМ     │
│  3. Legacy handler chain (fallback)                          │
└────────────────────────────┬─────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
┌──────────────────┐ ┌─────────────┐ ┌──────────────┐
│  src/skills/     │ │  src/core/  │ │  src/services│
│  (модули-скиллы) │ │  (ядро)     │ │  (cron jobs) │
└──────────────────┘ └─────────────┘ └──────────────┘
              │              │              │
              └──────────────┼──────────────┘
                             ▼
              ┌──────────────────────────────┐
              │ src/repositories/ (Firestore)│
              │ src/models/ (TypeScript types)│
              └──────────────────────────────┘
```

---

## Структура файлов

```
src/
├── index.ts                        # Entry point: Express + bot init
│
├── bot/
│   └── telegataskBot.ts            # Монолитный бот (~4000 строк)
│                                    # Legacy-хендлеры + SkillRouter интеграция
│
├── skills/                          # ★ SKILL SYSTEM (модульные команды)
│   ├── types.ts                     #   Skill, SkillResult, SkillTrigger, SkillPermissions
│   ├── registry.ts                  #   Регистрация всех скиллов (1 строка на скилл)
│   ├── ask/                         #   /ask — RAG по базе знаний
│   │   ├── index.ts
│   │   └── skill.json
│   ├── knowledge-add/               #   /k — добавление в знания (reply/forward/file_ref)
│   │   ├── index.ts
│   │   └── skill.json
│   ├── knowledge/                   #   /ksearch — поиск по знаниям
│   │   ├── index.ts
│   │   └── skill.json
│   ├── chats-control/               #   /chats + inline-кнопки ctl:*
│   │   ├── index.ts
│   │   └── skill.json
│   └── scan/                        #   /scan_on, /scan_off
│       ├── index.ts
│       └── skill.json
│
├── legacy/                          # Извлечённая логика (без изменений алгоритма)
│   └── knowledge/
│       └── handleKnowledge.ts       #   /k + "важно" follow-up, pendingKnowledgeForwards
│
├── core/                            # ★ CORE (ядро skill-системы)
│   ├── router.ts                    #   SkillRouter — диспетчер скиллов
│   ├── context.ts                   #   SkillContext — обёртка Telegraf ctx
│   ├── permissions.ts               #   Проверка plan/role/chatType
│   ├── usage.ts                     #   Счётчики использования (paywall)
│   └── services/                    #   Общие сервисы для скиллов
│       ├── kb.ts                    #     KBService — база знаний
│       ├── llm.ts                   #     LLMService — Gemini AI
│       └── telegram.ts              #     TelegramService — DM, ссылки
│
├── config/
│   ├── firebase.ts                  # Firebase Admin init
│   └── debug.ts                     # debugLog(), verboseLog()
│
├── models/                          # TypeScript interfaces
│   ├── task.ts                      #   Task + TaskPriority, TaskFollowUp, TaskReminder
│   ├── telegramUser.ts              #   TelegramUser + UserSettings
│   ├── chat.ts                      #   Chat + ChatCaptureMode
│   ├── knowledge.ts                 #   KnowledgeItemV2 + KnowledgeSourceTelegram
│   ├── project.ts
│   └── team.ts
│
├── repositories/                    # Firestore CRUD (docToEntity pattern)
│   ├── taskRepository.ts
│   ├── userRepository.ts
│   ├── chatRepository.ts
│   ├── messageRepository.ts
│   ├── knowledgeRepository.ts
│   ├── projectRepository.ts
│   ├── teamRepository.ts
│   ├── settingsRepository.ts
│   └── actionLogRepository.ts
│
├── services/                        # Фоновые сервисы (cron)
│   ├── gemini.ts                    #   Gemini API (extract, infer, ask)
│   ├── scanner.ts                   #   Auto-scan чатов → задачи
│   ├── reminders.ts                 #   Дедлайны / follow-up / mentions
│   ├── briefing.ts                  #   Утренний бриф / вечерний дайджест
│   └── scheduler.ts                 #   Менеджер cron-задач
│
├── routes/
│   ├── health.ts
│   └── debug.ts                     #   /debug/ping-db, /debug/status, /debug/action-logs
│
└── utils/
    └── telegramLink.ts              #   Генерация ссылок на сообщения Telegram

scripts/
└── deploy.sh                        # Деплой на TimeWeb: rsync + npm build + pm2
```

---

## Skill System — подробно

### Что такое Skill

**Skill** = модуль, который:
- Знает свои триггеры (команды, callbacks, regex, события)
- Имеет план (free/pro/team/enterprise) и роль (owner/admin/member/viewer)
- Выполняет `execute(ctx)` и возвращает `SkillResult`
- Использует общие сервисы: KB, LLM, Telegram

### Жизненный цикл запроса

```
Message → bot.on("message")
  → storeIncomingMessage()
  → SkillRouter.handleMessage()
    → parseCommand() или findByText()
    → resolveEntities() (user + chat из Firestore)
    → buildSkillContext()
    → checkPermissions() (plan, role, chatType)
    → checkUsageLimit() (paywall)
    → skill.execute(ctx)
    → processResult() (messages, buttons, actions)
    → incrementUsage()
  → если не обработано → legacy handler chain
```

### Интерфейс Skill

```typescript
interface Skill {
  meta: {
    id: string;           // "ask", "chats-control"
    name: string;         // "Ask AI"
    description: string;
    version: string;
    triggers: SkillTrigger[];  // command, callback, text, event
    permissions: {
      minPlan: "free" | "pro" | "team" | "enterprise";
      minRole?: "owner" | "admin" | "member" | "viewer" | null;
      chatType?: "private" | "group" | "any";
    };
    menuEntry?: { command: string; description: string };
    keyboardButton?: string;
  };
  execute(ctx: SkillContext): Promise<SkillResult>;
  onInit?(): Promise<void>;    // при старте бота
  onDestroy?(): Promise<void>; // при остановке
}
```

### SkillResult

```typescript
interface SkillResult {
  handled: boolean;          // true = stop, false = pass to next
  messages?: SkillMessage[]; // { text, parseMode }
  buttons?: SkillButton[][]; // inline keyboard rows
  actions?: SkillAction[];   // side effects (log, create task, etc.)
  editMessage?: boolean;     // edit current message instead of reply
  callbackAnswer?: string;   // answer callback query toast
}
```

### SkillContext (что доступно внутри execute)

```typescript
interface SkillContext {
  raw: Context<Update>;      // оригинальный Telegraf ctx
  command: string | null;     // "ask" (без /)
  args: string;              // "what is our budget?" (текст после команды)
  text: string;              // полный текст
  callbackData: string | null;
  user: TelegramUser;        // из Firestore, с settings/timezone
  chat: Chat | null;         // из Firestore, null в личке
  chatType: "private" | "group" | "supergroup" | "channel";
  telegramChatId: number;
  telegramUserId: number;

  // Сервисы
  kb: KBService;             // .search(), .add(), .listByUser()
  llm: LLMService;           // .ask(), .generate(), .extractTasks(), .inferDueDate()
  tg: TelegramService;       // .sendDM(), .buildMessageLink(), .listChats()
}
```

### Типы триггеров

| Тип | Пример | Описание |
|-----|--------|----------|
| `command` | `{ type: "command", command: "ask", aliases: ["q"] }` | Telegram-команда |
| `callback` | `{ type: "callback", prefix: "ctl:" }` | Inline-кнопка (совпадение по началу) |
| `text` | `{ type: "text", pattern: /нужно|сделай/i, priority: 5 }` | Regex по тексту |
| `event` | `{ type: "event", event: "cron:scan" }` | Системное событие |

### Paywall / Usage

- Лимиты по планам в `src/core/usage.ts` (PLAN_LIMITS)
- Счётчики в Firestore: `usageCounters` → `{orgId}:{YYYY-MM}` → `{ counters: { skillId: count } }`
- Router автоматически проверяет лимит перед execute и инкрементирует после

---

## Текущие скиллы

| ID | Команды | Plan | Что делает |
|----|---------|------|------------|
| `ask` | `/ask` | free (10/мес) | RAG-ответ по базе знаний через Gemini |
| `knowledge-add` | `/k` | free | Добавление в знания (текст, reply, forward, file_ref) |
| `knowledge` | `/ksearch` | free | Поиск по базе знаний (keyword + recency) |
| `chats-control` | `/chats` + `ctl:*` | free, admin+ | Панель управления auto-scan чатов |
| `scan` | `/scan_on`, `/scan_off` | free | Вкл/выкл auto-scan в группе |
| `kb-actions` | `kb:*` (callback) | free | Save to KB кнопки |
| `task-actions` | `task:*` (callback) | free | Create task из knowledge |

### Legacy-команды (ещё в telegataskBot.ts, не мигрированы)

`/start`, `/info`, `/status`, `/task`, `/l`, `/my`, `/outbox`, `/my_today`, `/my_overdue`,
`/chat_tasks`, `/all_tasks`, `/done`, `/del`, `/priority`, `/wait`,
`/parse_today`, `/parse_yesterday`, `/search`, `/autoplan`, `/analyze`, `/digest`,
`/projects`, `/set_project`, `/team`, `/link_team`, `/admin`, `/set_role`, `/allow`, `/deny`, `/settings`

---

## Firestore Collections

| Collection | Что хранит |
|------------|-----------|
| `users` | TelegramUser (profile, settings, timezone) |
| `chats` | Chat (type, captureMode, lastScannedAt) |
| `tasks` | Task (priority, status, followUp, reminders) |
| `messages` | ChatMessage (все сообщения из сканируемых чатов) |
| `knowledge` | KnowledgeItemV2 (note, message, file_ref, link, decision) |
| `projects` | Project |
| `teams` | Team (roles, permissions) |
| `settings` | Пользовательские настройки (defaultProject и др.) |
| `actionLogs` | Аудит-лог всех действий |
| `usageCounters` | Счётчики использования для paywall |

---

## Cron Jobs (scheduler.ts)

| Job | Расписание | Что делает |
|-----|-----------|-----------|
| Auto-scan | `*/30 * * * *` | Сканирует чаты → извлекает задачи через Gemini |
| Deadline reminders | `*/5 * * * *` | Уведомления о приближающихся/просроченных дедлайнах |
| Follow-up | `*/15 * * * *` | Напоминания по задачам в статусе "waiting" |
| Unanswered mentions | `*/15 * * * *` | Уведомления о неотвеченных упоминаниях |
| Morning brief | `* * * * *` | Утренняя сводка (9:00 по часовому поясу пользователя) |
| Evening digest | `* * * * *` | Вечерний дайджест (19:00 по часовому поясу) |

---

## Environment Variables

| Переменная | Описание |
|-----------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен бота Telegram |
| `GEMINI_API_KEY` | API-ключ Gemini |
| `GEMINI_MODEL` | Модель Gemini (default: gemini-2.5-flash) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Путь к serviceAccountKey.json |
| `PORT` | Порт HTTP (default: 3000) |
| `DEBUG` | Включить debug-логи (true/false) |
| `LOG_LEVEL` | verbose / debug / info |

---

## Deploy

```bash
# Одна команда:
bash scripts/deploy.sh

# Что делает:
# 1. Проверяет .env и serviceAccountKey.json
# 2. rsync → /opt/telegatask на сервере
# 3. npm install + npm run build
# 4. pm2 delete + pm2 start
```

Сервер: `147.45.132.90`, SSH порт `2222`, пользователь `root`.

---

## Ключевые паттерны и правила

1. **Skill-first**: новые команды — через скиллы, НЕ в telegataskBot.ts
2. **docToEntity()**: каждый репозиторий нормализует документы Firestore с дефолтами
3. **safeLogAction()**: fire-and-forget аудит-лог
4. **ISO strings**: все даты — строки ISO, никогда Firestore Timestamp
5. **Backward compat**: новые поля всегда с дефолтами
6. **Типы**: strict TypeScript, `any` только в крайнем случае
7. **HTML parse_mode**: для форматированных ответов
8. **debugLog()**: для рутинных логов, `console.error()` для ошибок
