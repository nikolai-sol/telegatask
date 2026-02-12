---
name: add-bot-command
description: Add a new Telegram bot command to telegatask. Use when the user asks to add a command, handler, or bot feature. Covers handler, callback_query, BOT_COMMANDS, keyboard, help text, and message chain integration.
---

# Adding a Bot Command

## File
`src/bot/telegataskBot.ts`

## Steps

### 1. Create handler function

Place before `BOT_COMMANDS` constant (~line 3710).

```typescript
async function handleMyCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!isCommand(message.text, "mycommand")) return false;

  // Your logic here
  await ctx.reply("Response", { parse_mode: "HTML" });
  return true;
}
```

### 2. Register in message chain

In `initTelegataskBot()` → `bot.on("message", ...)`, add before `handleStubCommands`:

```typescript
const handledMyCommand = await handleMyCommand(ctx);
if (handledMyCommand) return;
```

### 3. Add to BOT_COMMANDS

```typescript
{ command: "mycommand", description: "Описание для меню" },
```

### 4. Add to keyboard (if needed)

In `buildMainMenuKeyboard()`:
```typescript
["/mycommand"],
```

### 5. Add to help text

In `handleInfo()` help text string.

### 6. If command has inline buttons

Add callback handler function and register in `bot.on("callback_query", ...)`:
```typescript
const handledMy = await handleMyCallbackHandler(ctx);
if (handledMy) return;
```

Callback data format: `prefix:action:param` (e.g. `ctl:scan:chatId:on`).

## Conventions

- Handler returns `Promise<boolean>` — `true` if handled
- Use `isCommand(text, "name")` for matching
- Use `safeLogAction(...)` for audit trail
- HTML parse_mode for formatted replies
- Import new repos/services at top of file
