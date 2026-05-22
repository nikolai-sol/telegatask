# Agency OS — Техническое задание для Claude Code

## Контекст проекта

Telegram-first операционная система для digital агентства. Три независимых flow:
- **Tender** — от брифа до стратегии (Incoming → Structuring → Execution → Final → Won/Lost)
- **Campaign** — активная работа с клиентом (Active → Optimization → Reporting → Ongoing)
- **Operational** — ежедневная текучка (Inbox задачи)

Архитектура: Telegram Bot + Mini App + Backend API + AI (три агента, один LLM endpoint).

---

## Задача 1: Аудит текущей реализации

> Выполни аудит всего репозитория. Проверь соответствие текущего кода архитектурным требованиям ниже.

### 1.1 Структура проекта — что должно быть

```
/
├── bot/                    # Telegram Bot (Telegraf.js или Grammy)
│   ├── commands/           # /start, /tender, /campaign, /task, /status
│   ├── handlers/           # file handler, callback handler, message handler
│   ├── middlewares/        # auth, rate limit, logging
│   └── index.ts
│
├── api/                    # Backend REST API (Fastify или Express)
│   ├── routes/
│   │   ├── companies.ts    # CRUD для Company (tender/campaign/internal)
│   │   ├── tasks.ts        # CRUD для Task
│   │   ├── users.ts        # управление командой
│   │   └── ai.ts           # AI endpoints
│   ├── services/
│   │   ├── tender.service.ts
│   │   ├── campaign.service.ts
│   │   ├── ops.service.ts
│   │   └── ai.service.ts   # единый AI сервис с тремя режимами
│   └── index.ts
│
├── miniapp/                # React + Vite (Telegram Mini App)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx        # My Focus + Tenders + Campaigns + Inbox
│   │   │   ├── TenderDetail.tsx
│   │   │   ├── CampaignDetail.tsx
│   │   │   └── TaskList.tsx
│   │   ├── components/
│   │   └── hooks/
│   │       └── useTelegram.ts  # WebApp API wrapper
│   └── index.html
│
├── db/
│   ├── migrations/         # SQL миграции
│   └── schema.sql          # полная схема БД
│
└── shared/
    └── types/              # общие TypeScript типы
```

### 1.2 Чеклист аудита

Для каждого пункта ответь: ✅ Реализовано / ⚠️ Частично / ❌ Отсутствует / 🔄 Иначе реализовано

**Bot layer:**
- [ ] Бот принимает файлы (PDF/DOCX) и сохраняет через Bot API file download
- [ ] Команды: /start, /tender new, /campaign, /task, /status
- [ ] InlineKeyboard кнопки для смены статуса компании
- [ ] Deeplink поддержка: `?startapp=company_{id}` открывает Mini App на нужной карточке
- [ ] Webhook настроен (не polling — для production)
- [ ] Middleware: проверка telegram_user_id перед каждым запросом

**API layer:**
- [ ] Endpoint: `POST /companies` с полем `type: 'tender' | 'campaign' | 'internal'`
- [ ] Endpoint: `POST /companies/:id/convert` (Tender → Campaign)
- [ ] Endpoint: `PATCH /companies/:id/status`
- [ ] Endpoint: `POST /ai/analyze` — принимает `{mode: 'tender'|'campaign'|'ops', context: {}, prompt: string}`
- [ ] JWT или Telegram initData верификация на всех защищённых роутах
- [ ] Rate limiting на AI endpoints

**Database:**
- [ ] Таблица `companies` с полем `type` и `status`
- [ ] Таблица `tasks` с FK на `company_id` (nullable для ops задач)
- [ ] Таблица `users` с полем `telegram_id`
- [ ] Связь users ↔ companies (staffing)
- [ ] Поле `ai_context` или отдельная таблица для AI памяти

**Mini App:**
- [ ] `window.Telegram.WebApp.ready()` вызывается при старте
- [ ] Верификация initData на сервере (не только на клиенте)
- [ ] `WebApp.BackButton` обрабатывается
- [ ] `WebApp.themeParams` используется для цветов (адаптация под тему)
- [ ] Нет обращений к `localStorage` для чувствительных данных
- [ ] Platform detection: `WebApp.platform` (ios/android/tdesktop/web)

**AI layer:**
- [ ] Один AI сервис / один LLM endpoint
- [ ] Три системных промпта: TENDER_SYSTEM_PROMPT, CAMPAIGN_SYSTEM_PROMPT, OPS_SYSTEM_PROMPT
- [ ] Контекст AI не смешивается между разными Company
- [ ] Файлы передаются в AI через текстовый парсинг (не binary)

---

## Задача 2: Исправления и доработки

> После аудита — исправь критические несоответствия. Приоритеты:

### Приоритет 1 (Critical — без этого не работает)

1. **Company type field** — если в БД нет поля `type`, добавь миграцию:
```sql
ALTER TABLE companies ADD COLUMN type VARCHAR(20) 
  NOT NULL DEFAULT 'internal' 
  CHECK (type IN ('tender', 'campaign', 'internal'));

ALTER TABLE companies ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active';
```

2. **Telegram initData verification** — на каждом API endpoint должна быть функция:
```typescript
function verifyTelegramWebAppData(initData: string, botToken: string): boolean {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');
  
  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  return calculatedHash === hash;
}
```

3. **AI mode routing** — единый сервис с автовыбором промпта:
```typescript
type AIMode = 'tender' | 'campaign' | 'ops';

async function runAgent(mode: AIMode, context: CompanyContext, userMessage: string) {
  const systemPrompts: Record<AIMode, string> = {
    tender: TENDER_SYSTEM_PROMPT,
    campaign: CAMPAIGN_SYSTEM_PROMPT,
    ops: OPS_SYSTEM_PROMPT,
  };
  
  return await llm.complete({
    system: systemPrompts[mode],
    messages: buildContextMessages(context, userMessage),
  });
}
```

### Приоритет 2 (Important — нужно для MVP)

4. **Convert Tender → Campaign endpoint**:
```typescript
// POST /api/companies/:id/convert
// Создаёт новую Campaign, копирует документы и задачи (если указано)
// Статус оригинального Tender меняется на 'won'
```

5. **Mini App Home screen** — четыре секции:
   - My Focus (задачи с флагом `is_priority = true` или `is_fire = true`)
   - Tenders (companies where type = 'tender', кроме won/lost)
   - Campaigns (companies where type = 'campaign', status = 'active')
   - Inbox (tasks where company_id IS NULL)

6. **Bot file handler** — при получении документа:
```
user → документ боту
→ бот скачивает file через getFile API
→ сохраняет в storage (S3 / локально)  
→ если это бриф → предлагает создать Tender и запустить AI парсинг
→ уведомление с кнопкой "Открыть в приложении"
```

### Приоритет 3 (Nice to have — можно после MVP)

7. Staffing: таблица `company_members` (user_id, company_id, role)
8. Fire priority flag на задачах и компаниях
9. Telegram Notifications queue (BullMQ + Redis)

---

## Задача 3: Схема базы данных (эталон)

> Если схема БД не соответствует — создай миграцию для приведения к этому виду.

```sql
-- Пользователи (члены команды)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'member', -- owner, admin, member
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Компании / проекты (центральная сущность)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('tender', 'campaign', 'internal')),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  -- Для tender: incoming|structuring|execution|final|won|lost
  -- Для campaign: active|optimization|reporting|ongoing|completed
  -- Для internal: active|completed
  client_name VARCHAR(255),
  description TEXT,
  is_fire BOOLEAN DEFAULT FALSE,   -- высокий приоритет
  created_by UUID REFERENCES users(id),
  converted_from UUID REFERENCES companies(id), -- если Campaign из Tender
  metadata JSONB DEFAULT '{}',     -- гибкие поля без миграций
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Задачи
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL = Ops задача
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  title VARCHAR(1000) NOT NULL,
  description TEXT,
  status VARCHAR(30) DEFAULT 'todo', -- todo|in_progress|done|blocked
  priority VARCHAR(20) DEFAULT 'normal', -- low|normal|high|fire
  due_date TIMESTAMPTZ,
  is_fire BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Документы / ссылки
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  title VARCHAR(500),
  type VARCHAR(50), -- link|file|brief|strategy|mediaplan|report
  url TEXT,                        -- Google Drive, Notion, Figma etc.
  file_telegram_id VARCHAR(255),   -- Telegram file_id если загружен через бот
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI контекст (история по компании, не по пользователю)
CREATE TABLE ai_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL, -- tender|campaign|ops
  messages JSONB DEFAULT '[]',  -- [{role, content, timestamp}]
  summary TEXT,                 -- краткое summary для передачи между сессиями
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staffing (кто работает на каком проекте)
CREATE TABLE company_members (
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member', -- lead|member|observer
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id)
);

-- Индексы для производительности
CREATE INDEX idx_companies_type ON companies(type);
CREATE INDEX idx_companies_status ON companies(status);
CREATE INDEX idx_tasks_company_id ON tasks(company_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_is_fire ON tasks(is_fire) WHERE is_fire = TRUE;
```

---

## Задача 4: AI System Prompts (создать файл)

> Создай файл `api/services/ai-prompts.ts` с тремя промптами:

```typescript
export const TENDER_SYSTEM_PROMPT = `
Ты — Tender Agent для digital агентства.

Твоя роль: помогать структурировать тендерные брифы, формировать стратегию и медиаплан.

При анализе брифа извлекай:
- Цели клиента (KPI, бизнес-задачи)
- Целевая аудитория
- Бюджет и сроки
- Каналы коммуникации
- Конкуренты (если упомянуты)

Формируй список задач для команды по этапам:
1. Structuring (анализ и вопросы к клиенту)
2. Execution (подготовка стратегии и медиаплана)
3. Final (финализация и отправка)

Отвечай структурированно. Используй markdown. Будь конкретным.
Контекст: только данные текущего тендера. Не смешивай с другими проектами.
`.trim();

export const CAMPAIGN_SYSTEM_PROMPT = `
Ты — Campaign Agent для digital агентства.

Твоя роль: управлять текущей рекламной кампанией, анализировать гипотезы, 
контролировать дедлайны и помогать с отчётами.

Фокусируйся на:
- Статусе выполнения задач
- Гипотезах и их результатах
- Дедлайнах и приоритетах
- Качестве коммуникации с клиентом

Всегда указывай следующий конкретный шаг.
Контекст: только данные текущей кампании.
`.trim();

export const OPS_SYSTEM_PROMPT = `
Ты — Ops Agent, ежедневный ассистент команды агентства.

Твоя роль: помогать с операционными задачами, структурировать мысли, 
помогать в написании ответов, разбивать большие задачи на подзадачи.

Ты личный productivity ассистент. Доступ к стратегическим документам кампаний — нет.
Фокус: конкретные действия, быстрые ответы, структура.
`.trim();
```

---

## Задача 5: Mini App — useTelegram hook

> Создай или проверь наличие хука `miniapp/src/hooks/useTelegram.ts`:

```typescript
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    Telegram: {
      WebApp: TelegramWebApp;
    };
  }
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function useTelegram() {
  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    tg?.ready();
    tg?.expand(); // разворачиваем на полный экран
  }, []);

  const user: TelegramUser | null = tg?.initDataUnsafe?.user ?? null;
  const initData: string = tg?.initData ?? '';
  const platform: string = tg?.platform ?? 'unknown';
  const colorScheme: 'light' | 'dark' = tg?.colorScheme ?? 'light';
  const themeParams = tg?.themeParams ?? {};

  const openLink = (url: string) => tg?.openLink(url);
  const showAlert = (msg: string) => tg?.showAlert(msg);
  const showConfirm = (msg: string, cb: (ok: boolean) => void) => tg?.showConfirm(msg, cb);
  const haptic = (type: 'light' | 'medium' | 'heavy' = 'light') =>
    tg?.HapticFeedback?.impactOccurred(type);

  const closeApp = () => tg?.close();
  const showBackButton = (onClick: () => void) => {
    tg?.BackButton?.show();
    tg?.BackButton?.onClick(onClick);
  };
  const hideBackButton = () => tg?.BackButton?.hide();

  return {
    tg,
    user,
    initData,
    platform,
    colorScheme,
    themeParams,
    openLink,
    showAlert,
    showConfirm,
    haptic,
    closeApp,
    showBackButton,
    hideBackButton,
  };
}
```

---

## Финальный отчёт

После выполнения всех задач — предоставь:

1. **Аудит** — таблица с результатами по каждому пункту чеклиста
2. **Что исправлено** — список изменений с названиями файлов
3. **Что осталось** — список нерешённых проблем с оценкой сложности (S/M/L)
4. **Следующий шаг** — рекомендация что делать после этого PR

---

*Версия ТЗ: 1.0 | Agency OS | Telegram-first*
