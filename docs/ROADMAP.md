# Telegatask — Roadmap (Actual)

Обновлено: 2026-03-03

## Статус сейчас

Telegatask уже работает как team-first платформа (бот + mini app), а не как ранний single-user MVP.

### Реализовано в `main`

- Team isolation на backend:
  - задачи, кампании, проекты и знания привязаны к `teamId`
  - `activeTeamId` у пользователя + API для переключения команды
- Tasks API и права:
  - `GET /api/tasks?scope=my|team`
  - `viewer` получает `403` на `scope=team`
  - возврат `usersById`, `projectsById` для UI
- Campaigns backend:
  - CRUD `/api/campaigns`
  - role-based permissions (viewer/project/account/owner)
  - status `archived` + `includeArchived=1`
  - бюджетные поля (`plannedBudget`, `spent`, `currency`)
- Telegram task creation:
  - автоприсвоение `teamId`
  - автоприсвоение `projectId` из `chat.defaultProjectId` для задач из групповых чатов
- Mini App (modular):
  - hash router: `#/tasks`, `#/campaigns`, `#/campaigns/:id`, `#/settings`
  - нижняя навигация (Tasks/Campaigns/Settings)
  - Tasks: My/Team scope, группировка campaign/project, swipe/actions, virtual list, sticky headers
  - Campaigns: список, детали, lifecycle tabs, finance tab, archive flow
  - Settings: выбор `activeTeam`
- Ops / ошибки:
  - логирование части ошибок в `actionLogs`
  - `/ops` и `/api/admin/ops` показывают состояние и recent errors
- Media Planning MVP:
  - flow `/mediaplan`: stage1 summary + stage2 strategy
  - переход на Claude (Haiku/Opus) + prompt caching

## Актуальная модель данных (факт)

Основные коллекции, которые реально используются сейчас:

- `users` (вкл. `activeTeamId`)
- `teams`
- `teamMembers`
- `chats` (вкл. `defaultProjectId`)
- `projects` (`teamId`)
- `tasks` (`teamId`, `campaignId`, `projectId`)
- `campaigns` (`teamId`, budget fields, archived status)
- `knowledge` (`teamId`, `projectId`)
- `messages`
- `actionLogs`
- `mediaPlans`
- `companies`, `companyMembers` (Agency OS слой)

## Phases: факт и план

### Фаза A — Core Team Platform

Статус: `in progress`

Сделано:
- team/role модель
- active team switch
- team-scoped tasks API
- campaigns API + permissions
- team/project admin skills

Осталось:
- единый permission middleware (сейчас проверки размазаны по роутам)
- централизованный audit для всех 4xx/5xx
- закрыть расхождение терминов `organization/company/team` в коде и docs

### Фаза B — Mini App Productization

Статус: `in progress`

Сделано:
- модульная архитектура mini app
- router + pages
- production UI задач (cards, grouped list, virtual list, sheets, swipe)
- campaigns list/details + finance + archive
- settings active team

Осталось:
- campaigns details edit flow (brief/tasks/finance/team) без prompt-based временных действий
- admin ops экран в mini app
- E2E smoke checks для ключевых пользовательских сценариев

### Фаза C — Bot Workflow Automation

Статус: `in progress`

Сделано:
- scan scheduler + manual trigger
- knowledge auto-save
- media planning MVP (chat flow)

Осталось:
- reminder/follow-up слой по roadmap (полный вариант)
- morning/evening brief в прод-конфигурации
- устойчивые retry/backoff для long-running задач

### Фаза D — SaaS/Commercial

Статус: `planned`

В планах:
- billing/limits middleware
- subscriptions и usage enforcement
- onboarding wizard для команд
- multi-tenant hardening и аналитика

## Media Planning (отдельный трек)

Статус: `in progress`

Сделано:
- `/mediaplan` 2-stage flow
- stage confirmation/edit loop
- сохранение в `mediaPlans`

В работе:
- Claude prompt/schema update
- обработка файлов брифа (PDF/DOCX/TXT)

Дальше:
- изолированный storage ассетов брифа
- structured output validation/report
- экспорт медиаплана в knowledge/project context

## Технический долг (приоритет)

1. Унифицировать доменную терминологию (`team/company/organization`).
2. Довести docs до статуса “code-first source of truth”.
3. Добавить интеграционные тесты на permissions (tasks/campaigns/mediaPlan).
4. Завести release process: changelog + tag + deploy note в одном потоке.

## Следующие 2 итерации

### Итерация 1

- Завершить документирование и release discipline:
  - `ROADMAP` (факт + план)
  - `CHANGELOG` (релизы + unreleased)
- Довести mediaplan file intake (PDF/DOCX/TXT) до прод-проверки
- Добавить admin ops экран в mini app (read-only)

### Итерация 2

- Расширить campaign lifecycle (team/brief/tasks/finance/report)
- Вынести permissions в единый слой
- Подготовить биллинг foundation (`usageCounters`, limits middleware)

## Источники истины

- По фичам: `docs/CHANGELOG.md`
- По плану: `docs/ROADMAP.md`
- По API/реализации: `src/routes/api.ts`, `src/repositories/*`
- По mini app: `mini-app/modules/*`
