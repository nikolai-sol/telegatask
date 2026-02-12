# Skill: Add a new Bot Skill

## When to use
When adding a new modular skill (command, callback, or text trigger) to the telegatask bot.

## Architecture
Skills live in `src/skills/<skill-name>/` and follow a standard structure:
- `index.ts` — implements the `Skill` interface
- `skill.json` — metadata (human-readable, not used at runtime)

All skills are registered in `src/skills/registry.ts`.

## Step-by-step
### 1. Create the skill folder
```
src/skills/my-skill/
  index.ts
  skill.json
```

### 2. Implement the Skill interface (index.ts)

```typescript
import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";

export const mySkill: Skill = {
  meta: {
    id: "my-skill",
    name: "My Skill",
    description: "What it does",
    version: "1.0.0",
    triggers: [
      { type: "command", command: "mycommand", aliases: ["моя_команда"] },
      // Русские алиасы добавляй в aliases; см. src/config/commands.ts
      // { type: "callback", prefix: "myskill:" },
      // { type: "text", pattern: /regex/, priority: 0 },
    ],
    permissions: {
      minPlan: "free",  // "free" | "pro" | "team" | "enterprise"
      minRole: null,     // "owner" | "admin" | "member" | "viewer" | null
      chatType: "any",   // "private" | "group" | "any"
    },
    menuEntry: {
      command: "mycommand",
      description: "Description in bot menu",
    },
    keyboardButton: "/mycommand",  // optional
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    // ctx.args — arguments after /command
    // ctx.user — TelegramUser from Firestore
    // ctx.chat — Chat from Firestore (null in private)
    // ctx.kb — KBService (search, add)
    // ctx.llm — LLMService (ask, extractTasks, generate)
    // ctx.tg — TelegramService (sendDM, buildMessageLink)
    // ctx.raw — original Telegraf context

    return {
      handled: true,
      messages: [{ text: "Hello!", parseMode: "HTML" }],
      // buttons: [[{ text: "Click", callbackData: "myskill:click" }]],
      // actions: [{ type: "log_action", payload: { action: "...", userId: ctx.user.id } }],
    };
  },
};
```

### 3. Create skill.json (metadata)
```json
{
  "id": "my-skill",
  "name": "My Skill",
  "description": "What it does",
  "version": "1.0.0",
  "triggers": ["command:/mycommand"],
  "plan": "free",
  "author": "telegatask"
}
```

### 4. Русские команды
Добавь алиас в `src/config/commands.ts` (COMMAND_RU_ALIASES) и в BOT_COMMANDS_RU в telegataskBot.ts, если нужна русская команда в меню.

### 5. Register in registry.ts
```typescript
// src/skills/registry.ts
import { mySkill } from "./my-skill";

export function registerAllSkills(router: SkillRouter): void {
  // ... existing skills ...
  router.register(mySkill);
}
```

### 6. No need to touch telegataskBot.ts!
The router automatically dispatches commands/callbacks to the matching skill.

## Available Services (via SkillContext)

| Service | Method | Description |
|---------|--------|-------------|
| `ctx.kb` | `.search(scope)` | Search knowledge base |
| `ctx.kb` | `.add(params)` | Add knowledge entry |
| `ctx.llm` | `.ask(question, context)` | RAG answer |
| `ctx.llm` | `.generate(prompt)` | Free-form Gemini |
| `ctx.llm` | `.extractTasks(messages)` | Extract tasks from text |
| `ctx.tg` | `.sendDM(userId, text)` | Send private message |
| `ctx.tg` | `.buildMessageLink(source)` | Telegram link |
| `ctx.tg` | `.listChats()` | All known chats |

## SkillResult fields

| Field | Type | Description |
|-------|------|-------------|
| `handled` | `boolean` | true = stop processing |
| `messages` | `SkillMessage[]` | Reply messages |
| `buttons` | `SkillButton[][]` | Inline keyboard rows |
| `actions` | `SkillAction[]` | Side effects (log, etc.) |
| `editMessage` | `boolean` | Edit instead of reply |
| `callbackAnswer` | `string` | Answer callback query |

## Permissions & Paywall
- `minPlan`: minimum plan required (usage tracked automatically)
- `minRole`: minimum role in team
- `chatType`: where the command works
- Usage limits configured in `src/core/usage.ts` (PLAN_LIMITS)

## Checklist
- [ ] Created `src/skills/<name>/index.ts`
- [ ] Created `src/skills/<name>/skill.json`
- [ ] Registered in `src/skills/registry.ts`
- [ ] `npx tsc --noEmit` passes
- [ ] Tested in Telegram
