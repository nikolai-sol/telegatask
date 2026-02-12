---
name: tasks-ui
description: Replace per-task inline buttons in Telegram task list commands (/my, /l, /chat_tasks, /all_tasks) with a single paginated inline keyboard (tasksui:* callbacks) and session state.
---

# Tasks UI (Pagination + One Keyboard)

## Goal

For bot task list messages, avoid inline buttons per task. Render only text (5 tasks/page) and attach a single inline keyboard (max 2 rows) that supports:

- `tasksui:page:prev` / `tasksui:page:next`
- `tasksui:select:N` (1..5)
- `tasksui:done`
- `tasksui:delete`
- `tasksui:refresh`

## Where

File: `src/bot/telegataskBot.ts`

## Implementation Checklist

1. Add an in-memory session store keyed by `chatId:messageId`:
- current page
- full list items (store `taskId` and any display metadata)
- selected index on page
- session owner (telegramId and internal userId)
- optional `kind` and `chatDocId` for refresh

2. Add keyboard builder that always returns 2 rows:
- Row 1: `◀`, `page/pages` (also acts as refresh), `▶`, `✅`, `🗑`
- Row 2: `1..5` with selected highlight (use `✓N`)

3. Add callback handler `handleTasksUiCallback`:
- validate session exists and caller is owner
- page/select updates should `editMessageText` with new text+keyboard
- done/delete should apply to selected `taskId`, then refresh the list and re-render

4. Update commands:
- `/l`, `/my`, `/chat_tasks`, `/all_tasks` should send only the paginated view with the new keyboard
- keep `/done <num|id>` and `/del <num|id>` working (optional)

5. Keep a legacy handler for old callbacks (`task:done:*`, `task:del:*`) if old messages may exist.

## Notes

- Default page size: 5 items.
- Prefer optimistic UX: after mutations, refresh list to reflect filters (active-only lists should drop done tasks).
- Enforce permissions for done/delete: creator/assignee or superadmin.
