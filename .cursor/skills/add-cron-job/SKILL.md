---
name: add-cron-job
description: Add a new scheduled cron job to telegatask. Use when the user asks for periodic tasks, background jobs, timed notifications, or scheduled automation.
---

# Adding a Cron Job

## Architecture

```
src/services/myService.ts     — Business logic
src/services/scheduler.ts     — Registers cron schedule
```

## Step 1: Service function (src/services/myService.ts)

```typescript
import { Telegraf } from "telegraf";
import { debugLog } from "../config/debug";

let botInstance: Telegraf | null = null;

export function setMyServiceBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

export async function runMyJob(): Promise<number> {
  let processed = 0;
  try {
    // ... your logic ...
    debugLog(`[myService] Processed ${processed} items`);
  } catch (error) {
    console.error("[myService] Job failed", error);
  }
  return processed;
}
```

## Step 2: Register in scheduler (src/services/scheduler.ts)

1. Import the service and its bot setter
2. In `startScheduler()`: call `setMyServiceBotInstance(bot)`
3. Add cron schedule:

```typescript
jobs.push(
  cron.schedule("*/15 * * * *", async () => {
    try {
      await runMyJob();
    } catch (error) {
      console.error("[scheduler] My job cron failed", error);
    }
  })
);
```

## Cron schedule cheatsheet

| Pattern | Meaning |
|---------|---------|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `*/30 * * * *` | Every 30 minutes |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 9:00 |
| `15,45 * * * *` | At :15 and :45 |

## Sending DMs to users

```typescript
await botInstance.telegram.sendMessage(telegramId, text, { parse_mode: "HTML" });
```

## Conventions

- Always wrap cron callback in try/catch
- Use `debugLog()` for routine output, `console.error()` for failures
- Log action with `logAction()` for audit trail
- Bot instance passed via setter, not constructor
