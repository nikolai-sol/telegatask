/**
 * Router — центральный диспетчер скиллов.
 *
 * Получает сообщение/callback → определяет скилл → проверяет права → выполняет.
 */

import type { Context } from "telegraf";
import type { Update } from "telegraf/typings/core/types/typegram";
import type { Skill, SkillResult, SkillTrigger } from "../skills/types";
import type { SkillContext } from "./context";
import { buildSkillContext } from "./context";
import { checkPermissions } from "./permissions";
import { incrementUsage, checkUsageLimit } from "./usage";
import { upsertUserFromTelegramPayload } from "../repositories/userRepository";
import { upsertChatFromTelegramPayload, getChatByTelegramId } from "../repositories/chatRepository";
import { debugLog } from "../config/debug";
import type { KBService } from "./services/kb";
import type { LLMService } from "./services/llm";
import type { TelegramService } from "./services/telegram";
import { Markup } from "telegraf";

export class SkillRouter {
  private skills: Skill[] = [];
  private services: {
    kb: KBService;
    llm: LLMService;
    tg: TelegramService;
  };

  constructor(services: { kb: KBService; llm: LLMService; tg: TelegramService }) {
    this.services = services;
  }

  /** Зарегистрировать скилл */
  register(skill: Skill): void {
    this.skills.push(skill);
    debugLog(`[router] Registered skill: ${skill.meta.id} (${skill.meta.triggers.length} triggers)`);
  }

  /** Все зарегистрированные скиллы */
  getSkills(): Skill[] {
    return [...this.skills];
  }

  /** Команды для меню бота */
  getBotCommands(): { command: string; description: string }[] {
    return this.skills
      .filter((s) => s.meta.menuEntry)
      .map((s) => s.meta.menuEntry!);
  }

  /** Кнопки для reply keyboard */
  getKeyboardButtons(): string[][] {
    const buttons = this.skills
      .filter((s) => s.meta.keyboardButton)
      .map((s) => s.meta.keyboardButton!);

    // Group by 2
    const rows: string[][] = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }
    return rows;
  }

  /** Init all skills */
  async initAll(): Promise<void> {
    for (const skill of this.skills) {
      if (skill.onInit) {
        try {
          await skill.onInit();
          debugLog(`[router] Initialized skill: ${skill.meta.id}`);
        } catch (error) {
          console.error(`[router] Failed to init skill ${skill.meta.id}`, error);
        }
      }
    }
  }

  /** Destroy all skills */
  async destroyAll(): Promise<void> {
    for (const skill of this.skills) {
      if (skill.onDestroy) {
        try {
          await skill.onDestroy();
        } catch (error) {
          console.error(`[router] Failed to destroy skill ${skill.meta.id}`, error);
        }
      }
    }
  }

  // ============================================================
  // Message routing
  // ============================================================

  /**
   * Обработать входящее сообщение. Возвращает true если скилл обработал.
   */
  async handleMessage(rawCtx: Context<Update>): Promise<boolean> {
    const message = rawCtx.message;
    if (!message || !("chat" in message)) return false;

    const text = "text" in message ? message.text ?? "" : "";
    const command = this.parseCommand(text);

    // Find matching skill
    const skill = command
      ? this.findByCommand(command)
      : this.findByText(text);

    if (!skill) return false;

    return this.executeSkill(skill, rawCtx);
  }

  /**
   * Обработать callback query. Возвращает true если скилл обработал.
   */
  async handleCallback(rawCtx: Context<Update>): Promise<boolean> {
    const callback = rawCtx.callbackQuery;
    if (!callback || !("data" in callback)) return false;

    const data = callback.data || "";
    const skill = this.findByCallback(data);
    if (!skill) return false;

    return this.executeSkill(skill, rawCtx);
  }

  // ============================================================
  // Core execution
  // ============================================================

  private async executeSkill(skill: Skill, rawCtx: Context<Update>): Promise<boolean> {
    try {
      // 1. Resolve user & chat
      const { user, chat } = await this.resolveEntities(rawCtx);

      // 2. Build context
      const ctx = buildSkillContext(rawCtx, user, chat, this.services);

      // 3. Check permissions
      const permCheck = checkPermissions(
        skill.meta.permissions,
        user,
        chat,
        ctx.chatType,
        "free", // TODO: resolve from organization
        "owner" // TODO: resolve from team
      );

      if (!permCheck.allowed) {
        await rawCtx.reply(permCheck.reason || "Нет доступа.");
        return true;
      }

      // 4. Check usage limits
      const orgId = "default"; // TODO: resolve from user's organization
      const usageCheck = await checkUsageLimit(orgId, skill.meta.id, "free");
      if (!usageCheck.allowed) {
        await rawCtx.reply(
          `⚠️ Лимит исчерпан: ${usageCheck.current}/${usageCheck.limit} за месяц.\n` +
          `Перейдите на Pro: /upgrade`
        );
        return true;
      }

      // 5. Execute
      debugLog(`[router] Executing skill: ${skill.meta.id}`);
      const result = await skill.execute(ctx);

      // 6. Process result
      if (result.handled) {
        await this.processResult(rawCtx, result);
        // 7. Track usage (unless skipped, e.g. "choose chat" step)
        if (!result.skipUsageIncrement) {
          await incrementUsage(orgId, skill.meta.id);
        }
      }

      return result.handled;
    } catch (error) {
      console.error(`[router] Skill ${skill.meta.id} failed`, error);
      try {
        await rawCtx.reply("Произошла ошибка. Попробуйте позже.");
      } catch {}
      return true;
    }
  }

  // ============================================================
  // Result processing
  // ============================================================

  private async processResult(rawCtx: Context<Update>, result: SkillResult): Promise<void> {
    // Callback answer
    if (result.callbackAnswer && rawCtx.callbackQuery) {
      await rawCtx.answerCbQuery(result.callbackAnswer).catch(() => {});
    }

    // Messages
    if (result.messages?.length) {
      for (const msg of result.messages) {
        const opts: Record<string, unknown> = {};
        if (msg.parseMode) opts.parse_mode = msg.parseMode;

        // Attach buttons to last message
        if (result.buttons?.length && msg === result.messages[result.messages.length - 1]) {
          const keyboard = Markup.inlineKeyboard(
            result.buttons.map((row) =>
              row.map((btn) => Markup.button.callback(btn.text, btn.callbackData))
            )
          );
          Object.assign(opts, keyboard);
        }

        if (result.editMessage && rawCtx.callbackQuery) {
          await rawCtx.editMessageText(msg.text, opts as any).catch(() => {});
        } else {
          await rawCtx.reply(msg.text, opts as any);
        }
      }
    }

    // Actions
    if (result.actions?.length) {
      for (const action of result.actions) {
        await this.processAction(action);
      }
    }
  }

  private async processAction(action: { type: string; payload: Record<string, unknown> }): Promise<void> {
    if (!action) return;
    switch (action.type) {
      case "log_action": {
        const { logAction } = await import("../repositories/actionLogRepository");
        await logAction(action.payload as any).catch(() => {});
        break;
      }
      // Other action types handled by skills directly
      default:
        debugLog(`[router] Unhandled action type: ${action.type}`);
    }
  }

  // ============================================================
  // Matching
  // ============================================================

  private parseCommand(text: string): string | null {
    // \w не совпадает с кириллицей — используем [^\s@]+ для RU/EN команд
    const match = text.match(/^\/([^\s@]+)(?:@\S+)?/);
    return match ? match[1].trim().toLowerCase() : null;
  }

  private findByCommand(command: string): Skill | undefined {
    return this.skills.find((s) =>
      s.meta.triggers.some(
        (t) =>
          t.type === "command" &&
          (t.command === command || t.aliases?.includes(command))
      )
    );
  }

  private findByCallback(data: string): Skill | undefined {
    return this.skills.find((s) =>
      s.meta.triggers.some(
        (t) => t.type === "callback" && data.startsWith(t.prefix)
      )
    );
  }

  private findByText(text: string): Skill | undefined {
    const matches = this.skills
      .filter((s) =>
        s.meta.triggers.some((t) => t.type === "text" && t.pattern.test(text))
      )
      .sort((a, b) => {
        const aPriority = Math.max(
          ...a.meta.triggers
            .filter((t): t is Extract<SkillTrigger, { type: "text" }> => t.type === "text")
            .map((t) => t.priority ?? 0)
        );
        const bPriority = Math.max(
          ...b.meta.triggers
            .filter((t): t is Extract<SkillTrigger, { type: "text" }> => t.type === "text")
            .map((t) => t.priority ?? 0)
        );
        return bPriority - aPriority;
      });

    return matches[0];
  }

  // ============================================================
  // Entity resolution
  // ============================================================

  private async resolveEntities(rawCtx: Context<Update>) {
    const from = rawCtx.from;
    const message = rawCtx.message;
    const callbackMessage = rawCtx.callbackQuery && "message" in rawCtx.callbackQuery ? rawCtx.callbackQuery.message : null;

    const chatInfo = message && "chat" in message
      ? message.chat
      : callbackMessage && "chat" in callbackMessage
        ? callbackMessage.chat
        : null;

    // User
    const user = from
      ? await upsertUserFromTelegramPayload({
          id: from.id,
          username: from.username ?? undefined,
          first_name: from.first_name ?? undefined,
          last_name: from.last_name ?? undefined,
        })
      : {
          id: "unknown",
          telegramId: 0,
          username: null,
          displayName: "Unknown",
          timezone: null,
          settings: {
            morningBriefEnabled: true,
            eveningDigestEnabled: true,
            remindBeforeHours: 2,
            followUpAfterHours: 24,
            unansweredMentionHours: 4,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

    // Chat
    let chat = null;
    if (chatInfo && chatInfo.type !== "private") {
      chat = await getChatByTelegramId(chatInfo.id);
      if (!chat) {
        chat = await upsertChatFromTelegramPayload({
          id: chatInfo.id,
          title: "title" in chatInfo ? chatInfo.title : undefined,
          type: chatInfo.type as any,
        });
      }
    }

    return { user, chat };
  }
}
