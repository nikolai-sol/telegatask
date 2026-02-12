---
description: "Telegatask coding conventions. Auto-applied to all src/**/*.ts files."
globs: ["src/**/*.ts"]
---

# Telegatask — Правила и конвенции

## Первое что нужно прочитать

При любой работе с проектом — сначала прочитай `.cursor/skills/project-architecture/SKILL.md`.
Там полная структура, описание skill-системы, Firestore коллекции, cron jobs, deploy.

## Добавление новых команд → ЧЕРЕЗ СКИЛЛЫ

**НЕ добавляй хендлеры в `telegataskBot.ts`!**
Используй skill-систему: `.cursor/skills/add-skill/SKILL.md`.

Кратко:
1. `src/skills/my-skill/index.ts` — реализация `Skill`
2. `src/skills/my-skill/skill.json` — метаданные
3. Одна строка в `src/skills/registry.ts`
4. telegataskBot.ts трогать НЕ нужно

## TypeScript

- Strict mode, `any` только в крайнем случае
- ISO strings для всех дат (никогда Firestore Timestamp)
- Optional: `field?: Type | null`
- Экспортировать type aliases для string unions

## Legacy Handlers (telegataskBot.ts)

- Return `Promise<boolean>` — true = handled
- `isCommand(text, "name")` для проверки команд
- HTML parse_mode
- `safeLogAction()` для аудит-лога
- Новые хендлеры — перед `handleStubCommands` в цепочке

## Repositories

- Всегда `docToEntity()` нормализатор
- Новые поля — с дефолтами для обратной совместимости
- Никогда весь collection — `.where()` + `.limit()`

## Services

- Bot instance через setter (не конструктор)
- Все cron callbacks — в try/catch
- `debugLog()` для рутинного, `console.error()` для ошибок

## Naming

| Что | Формат | Пример |
|-----|--------|--------|
| Models | singular PascalCase | `Task`, `Chat` |
| Repositories | `entityRepository.ts` | `taskRepository.ts` |
| Services | descriptive | `scanner.ts`, `reminders.ts` |
| Skills | kebab-case folder | `chats-control/`, `ask/` |
| Commands | snake_case в Telegram | `my_today`, `scan_on` |

## Deploy

- `npx tsc --noEmit` ПЕРЕД деплоем
- `bash scripts/deploy.sh`
- PM2 стартует из `/opt/telegatask`

## Skill-система (файлы)

```
src/skills/types.ts       — интерфейсы Skill, SkillResult, SkillTrigger
src/skills/registry.ts    — регистрация (добавь import + router.register)
src/core/router.ts        — SkillRouter (диспетчер)
src/core/context.ts       — SkillContext (обёртка ctx)
src/core/permissions.ts   — проверка plan/role
src/core/usage.ts         — paywall-счётчики (PLAN_LIMITS)
src/core/services/        — KB, LLM, Telegram сервисы
```
