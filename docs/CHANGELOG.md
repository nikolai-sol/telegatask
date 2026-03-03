# Changelog

Формат: Keep a Changelog (адаптированный), даты в формате `YYYY-MM-DD`.

## [Unreleased] - 2026-03-03

Источник: локальные изменения в рабочем дереве (ещё не закоммичены).

### Added

- Media Planning: intake брифа из файлов в Telegram:
  - `.pdf` -> извлечение текста через `pdf-parse`
  - `.docx` -> извлечение текста через `mammoth`
  - `.txt` -> прямое чтение
  - неподдерживаемые форматы -> ответ `Поддерживаются PDF, Word и текст`

### Changed

- Media Planning prompts:
  - обновлён Stage 1 JSON schema (вложенная структура)
  - усилен Stage 2 strategic prompt
- Claude service layer:
  - env names `MEDIA_PLAN_FAST_MODEL` / `MEDIA_PLAN_THINKING_MODEL`
  - retry Stage 1 при невалидном JSON
  - Opus progress UX (immediate + 30s warning message)
- Добавлен `.env.example` с актуальными переменными для mediaplan.

## [2026-03-03]

### Changed

- `be2bacb` — `mediaplan`: migration на Claude Haiku/Opus + prompt cache.

### Added

- `add7ac4` — `mediaplan`: 2-stage flow в боте (summary -> strategy) с сохранением в Firestore.

## [2026-02-17]

### Added

- `c23516e` — merge `refactor/miniapp-modules` (Agency OS layer).
- `9566ee8` — Agency OS foundation: companies/tasks/AI agents/bot skills.

### Changed

- `2e9f0a4` — autoscan interval изменён на 2 часа + manual scan button.

## [2026-02-13]

### Added

- Campaigns backend CRUD + permissions (`b54f79c`).
- Active Team switcher в mini app settings (`de1dc02`).
- Campaign list/details MVP and route wiring (`0d61abf`, `0390f93`).
- Team tasks enrichments: `usersById`, assignee chips, grouping by campaign/project (`93391fa`, `260b394`).
- Budget support в campaigns и finance editing tab (`31b5904`).
- Campaign lifecycle tabs skeleton (`0c8611b`).
- Overbudget warning UI (`aeaba8e`).
- Campaign archive status + archived filter (`04323b3`).
- Bottom tab nav и router-driven mini app layout (`8149639`, `fe356b3`).

### Changed

- Tasks state handling стабилизирован через store/actions (`0efd532`, `ccbb4bb`).
- Team/my scope enforcement на backend (`bc232e0`).
- Telegram task creation: auto `projectId` from chat default project (`7398dd0`).
- Finance tab visibility/edit restrictions by role (`7e88cc7`).
- Campaign list показывает budget summary (`83e95b5`).
- Knowledge flow fixes: `/к` alias, undefined Firestore writes fix (`cc83815`, `bb2147d`).
- Ops: knowledge error logging + `/ops`/`/api/admin/ops` exposure (`190ca00`).

## Notes

- Источник релизов: `git log` текущего репозитория.
- Для production релиза рекомендуется фиксировать версию/тег и ссылку на deploy в этом файле.
