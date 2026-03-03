import { Context, Markup } from "telegraf";
import type { Message, Update } from "telegraf/typings/core/types/typegram";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { deriveTeamIdForTaskCreation } from "../../core/deriveTeamIdForTaskCreation";
import { upsertUserFromTelegramPayload } from "../../repositories/userRepository";
import {
  createMediaPlan,
  findActiveMediaPlanByUser,
  getMediaPlanById,
  updateMediaPlan,
  type MediaPlanDoc,
  type MediaPlanHistoryItem,
} from "./mediaPlanning.repository";
import {
  generateStrategy,
  parseBrief,
  regenerateStrategyWithCorrection,
  updateBriefSummary,
} from "./mediaPlanning.service";
import { formatSummary, type MediaBriefSummary } from "./mediaPlanning.prompts";

type MediaPlanningHandlers = {
  handleMessage: (ctx: Context<Update>) => Promise<boolean>;
  handleCallback: (ctx: Context<Update>) => Promise<boolean>;
};

const MSG_ERROR = "Произошла ошибка, попробуй ещё раз 🔄";
const MSG_UNSUPPORTED_BRIEF_FILE = "Поддерживаются PDF, Word и текст";
const MSG_OPUS_ERROR = "Произошла ошибка при генерации стратегии. Попробуй ещё раз /mediaplan";
const MSG_OPUS_THINKING = "🧠 Передаю стратегу. Обычно занимает 30-60 секунд...";
const MSG_OPUS_SLOW = "⏳ Opus думает над стратегией, это займёт 30-60 секунд...";
const MP_CMD_RE = /^\/mediaplan(?:@\S+)?(?:\s+([\s\S]*))?$/i;

class MediaPlanHandledError extends Error {}

function escapeMd(text: string): string {
  return String(text || "").replace(/([_*\[\]()`])/g, "\\$1");
}

function formatSummaryMarkdown(summary: MediaBriefSummary): string {
  const safe: MediaBriefSummary = {
    target_audience: {
      description: summary.target_audience?.description
        ? escapeMd(summary.target_audience.description)
        : null,
      age: summary.target_audience?.age ? escapeMd(summary.target_audience.age) : null,
      gender: summary.target_audience?.gender ?? null,
      interests: (summary.target_audience?.interests || []).map((x) => escapeMd(x)),
      income: summary.target_audience?.income ? escapeMd(summary.target_audience.income) : null,
    },
    budget: {
      total: Number.isFinite(summary.budget?.total) ? Number(summary.budget.total) : null,
      currency: summary.budget?.currency || "RUB",
      note: summary.budget?.note ? escapeMd(summary.budget.note) : null,
    },
    geo: {
      cities: (summary.geo?.cities || []).map((x) => escapeMd(x)),
      regions: (summary.geo?.regions || []).map((x) => escapeMd(x)),
      type: summary.geo?.type || null,
    },
    channels: (summary.channels || []).map((x) => escapeMd(x)),
    goal: summary.goal ? escapeMd(summary.goal) : null,
    timing: {
      start: summary.timing?.start ? escapeMd(summary.timing.start) : null,
      end: summary.timing?.end ? escapeMd(summary.timing.end) : null,
      duration_weeks: Number.isFinite(summary.timing?.duration_weeks)
        ? Number(summary.timing?.duration_weeks)
        : null,
    },
    kpi: (summary.kpi || []).map((x) => escapeMd(x)),
    product: summary.product ? escapeMd(summary.product) : null,
    unclear: (summary.unclear || []).map((x) => escapeMd(x)),
  };

  return formatSummary(safe).trim();
}

function getMessageText(message: Message | undefined): string {
  if (!message) return "";
  if ("text" in message && typeof message.text === "string") return message.text;
  if ("caption" in message && typeof message.caption === "string") return message.caption;
  return "";
}

function getMessageDocument(message: Message | undefined): {
  fileId: string;
  fileName: string;
  mimeType: string;
} | null {
  if (!message) return null;

  const raw = message as unknown as {
    document?: {
      file_id?: unknown;
      file_name?: unknown;
      mime_type?: unknown;
    };
  };

  const fileId = raw.document?.file_id;
  if (typeof fileId !== "string" || !fileId.trim()) return null;

  const fileName =
    typeof raw.document?.file_name === "string" ? raw.document.file_name.trim() : "";
  const mimeType =
    typeof raw.document?.mime_type === "string" ? raw.document.mime_type.trim().toLowerCase() : "";

  return { fileId, fileName, mimeType };
}

type BriefFileFormat = "pdf" | "docx" | "txt";

function detectBriefFileFormat(fileName: string, mimeType: string): BriefFileFormat | null {
  const normalizedName = fileName.toLowerCase();

  if (
    normalizedName.endsWith(".pdf") ||
    mimeType === "application/pdf"
  ) {
    return "pdf";
  }

  if (
    normalizedName.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  if (
    normalizedName.endsWith(".txt") ||
    mimeType === "text/plain"
  ) {
    return "txt";
  }

  return null;
}

async function downloadTelegramFileBuffer(
  ctx: Context<Update>,
  fileId: string
): Promise<Buffer> {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.toString());
  if (!res.ok) {
    throw new Error(`Failed to download Telegram file: ${res.status}`);
  }
  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}

async function extractTextFromBriefDocument(
  ctx: Context<Update>,
  message: Message | undefined
): Promise<{ text: string | null; unsupported: boolean }> {
  const document = getMessageDocument(message);
  if (!document) return { text: null, unsupported: false };

  const format = detectBriefFileFormat(document.fileName, document.mimeType);
  if (!format) return { text: null, unsupported: true };

  const buffer = await downloadTelegramFileBuffer(ctx, document.fileId);

  if (format === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const parsed = await parser.getText();
      const text = String(parsed?.text || "").trim();
      return { text, unsupported: false };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (format === "docx") {
    const parsed = await mammoth.extractRawText({ buffer });
    const text = String(parsed?.value || "").trim();
    return { text, unsupported: false };
  }

  const text = buffer.toString("utf-8").trim();
  return { text, unsupported: false };
}

function isForwardedMessage(message: Message): boolean {
  const raw = message as unknown as Record<string, unknown>;
  return Boolean(raw.forward_date || raw.forward_origin || raw.is_automatic_forward);
}

function stage1Keyboard(planId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Всё верно, отправляй", `mp_confirm:${planId}`)],
    [Markup.button.callback("✏️ Хочу уточнить", `mp_edit:${planId}`)],
  ]);
}

function stage2Keyboard(planId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Стратегия готова", `mp_strategy_ok:${planId}`)],
    [Markup.button.callback("✏️ Скорректировать", `mp_strategy_edit:${planId}`)],
  ]);
}

async function replyMarkdown(ctx: Context<Update>, text: string, extra: any = {}): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: "Markdown", ...(extra as any) });
  } catch {
    await ctx.reply(text, extra as any);
  }
}

async function editMarkdown(ctx: Context<Update>, text: string, extra: any = {}): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: "Markdown", ...(extra as any) });
  } catch {
    try {
      await ctx.editMessageText(text, extra as any);
    } catch {
      await replyMarkdown(ctx, text, extra);
    }
  }
}

function parseCallback(data: string): { action: string; planId: string | null } | null {
  const allowed = new Set(["mp_confirm", "mp_edit", "mp_strategy_ok", "mp_strategy_edit"]);
  const [action, rawId] = String(data || "").split(":");
  if (!allowed.has(action)) return null;
  return { action, planId: rawId ? rawId.trim() : null };
}

function historyLines(plan: MediaPlanDoc): string[] {
  return (plan.conversationHistory || []).slice(-10).map((h) => `${h.role}: ${h.content}`);
}

function isPrivateChat(ctx: Context<Update>): boolean {
  const message = ctx.message;
  if (!message || !("chat" in message)) return false;
  return message.chat.type === "private";
}

async function resolveUserAndTeam(ctx: Context<Update>): Promise<{ userId: string; teamId: string } | null> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message || !("chat" in message)) return null;

  const user = await upsertUserFromTelegramPayload({
    id: from.id,
    username: from.username ?? undefined,
    first_name: from.first_name ?? undefined,
    last_name: from.last_name ?? undefined,
  });

  const teamId = await deriveTeamIdForTaskCreation({
    telegramChatId: String(message.chat.id),
    userId: user.id,
  });

  return { userId: user.id, teamId };
}

async function renderStage1(ctx: Context<Update>, plan: MediaPlanDoc): Promise<void> {
  const summaryText = formatSummaryMarkdown(plan.briefSummary);
  await replyMarkdown(ctx, summaryText, stage1Keyboard(plan.id));
}

async function renderStrategy(ctx: Context<Update>, planId: string, strategyText: string): Promise<void> {
  await replyMarkdown(ctx, strategyText, stage2Keyboard(planId));
}

async function runWithOpusProgress<T>(ctx: Context<Update>, worker: () => Promise<T>): Promise<T> {
  await replyMarkdown(ctx, MSG_OPUS_THINKING);

  const warningTimer = setTimeout(() => {
    void replyMarkdown(ctx, MSG_OPUS_SLOW);
  }, 30000);

  try {
    return await worker();
  } catch (error) {
    await replyMarkdown(ctx, MSG_OPUS_ERROR);
    throw new MediaPlanHandledError(error instanceof Error ? error.message : "Opus generation failed");
  } finally {
    clearTimeout(warningTimer);
  }
}

async function ensureOwnPlan(userId: string, planId: string | null): Promise<MediaPlanDoc | null> {
  if (planId) {
    const byId = await getMediaPlanById(planId);
    if (byId && byId.createdByUserId === userId) return byId;
    return null;
  }

  const active = await findActiveMediaPlanByUser(userId);
  return active && active.createdByUserId === userId ? active : null;
}

async function startOrRestartPlan(
  ctx: Context<Update>,
  userId: string,
  teamId: string,
  briefRaw: string,
  existingPlan: MediaPlanDoc | null
): Promise<void> {
  const summary = await parseBrief(briefRaw);

  const conversationHistory: MediaPlanHistoryItem[] = [
    { role: "user", content: briefRaw },
    { role: "model", content: JSON.stringify(summary) },
  ];

  if (existingPlan) {
    await updateMediaPlan(existingPlan.id, {
      teamId,
      status: "stage1",
      briefRaw,
      briefSummary: summary,
      conversationHistory,
      finalStrategy: null,
      awaitingInput: null,
    });
    const updated = await getMediaPlanById(existingPlan.id);
    if (updated) {
      await renderStage1(ctx, updated);
      return;
    }
  }

  const plan = await createMediaPlan({
    teamId,
    createdByUserId: userId,
    briefRaw,
    briefSummary: summary,
    conversationHistory,
  });

  await renderStage1(ctx, plan);
}

async function applyStage1Correction(ctx: Context<Update>, plan: MediaPlanDoc, correction: string): Promise<void> {
  const summary = await updateBriefSummary(plan.briefSummary, correction, plan.briefRaw);
  const history: MediaPlanHistoryItem[] = [
    ...(plan.conversationHistory || []),
    { role: "user", content: correction },
    { role: "model", content: JSON.stringify(summary) },
  ];

  await updateMediaPlan(plan.id, {
    status: "stage1",
    briefSummary: summary,
    conversationHistory: history,
    awaitingInput: null,
  });

  const updated = await getMediaPlanById(plan.id);
  if (updated) {
    await renderStage1(ctx, updated);
  }
}

async function confirmStage1AndGenerateStrategy(ctx: Context<Update>, plan: MediaPlanDoc): Promise<void> {
  const historyBefore: MediaPlanHistoryItem[] = [
    ...(plan.conversationHistory || []),
    { role: "user", content: "Подтверждаю summary" },
  ];
  await updateMediaPlan(plan.id, { conversationHistory: historyBefore, awaitingInput: null });

  await editMarkdown(ctx, "✅ Принял. Готовлю стратегию...");

  const strategy = await runWithOpusProgress(ctx, () =>
    generateStrategy(plan.briefSummary, historyLines(plan))
  );
  const historyAfter: MediaPlanHistoryItem[] = [...historyBefore, { role: "model", content: strategy }];

  await updateMediaPlan(plan.id, {
    status: "stage2",
    finalStrategy: strategy,
    conversationHistory: historyAfter,
    awaitingInput: null,
  });

  await renderStrategy(ctx, plan.id, strategy);
}

async function applyStage2Correction(ctx: Context<Update>, plan: MediaPlanDoc, correction: string): Promise<void> {
  const strategy = await runWithOpusProgress(ctx, () =>
    regenerateStrategyWithCorrection(
      plan.briefSummary,
      plan.finalStrategy || "",
      correction,
      historyLines(plan)
    )
  );

  const history: MediaPlanHistoryItem[] = [
    ...(plan.conversationHistory || []),
    { role: "user", content: correction },
    { role: "model", content: strategy },
  ];

  await updateMediaPlan(plan.id, {
    status: "stage2",
    finalStrategy: strategy,
    conversationHistory: history,
    awaitingInput: null,
  });

  await renderStrategy(ctx, plan.id, strategy);
}

export function registerMediaPlanningHandlers(): MediaPlanningHandlers {
  return {
    async handleCallback(ctx: Context<Update>): Promise<boolean> {
      const callback = ctx.callbackQuery;
      if (!callback || !("data" in callback)) return false;

      const parsed = parseCallback(String(callback.data || ""));
      if (!parsed) return false;

      try {
        const from = ctx.from;
        if (!from) {
          await ctx.answerCbQuery("Нет пользователя").catch(() => {});
          return true;
        }

        const user = await upsertUserFromTelegramPayload({
          id: from.id,
          username: from.username ?? undefined,
          first_name: from.first_name ?? undefined,
          last_name: from.last_name ?? undefined,
        });

        const plan = await ensureOwnPlan(user.id, parsed.planId);
        if (!plan) {
          await ctx.answerCbQuery("План не найден").catch(() => {});
          return true;
        }

        if (parsed.action === "mp_edit") {
          await updateMediaPlan(plan.id, { awaitingInput: "stage1" });
          await editMarkdown(
            ctx,
            "✏️ Напиши, что исправить в брифе одним сообщением. Я обновлю summary и покажу снова."
          );
          await ctx.answerCbQuery("Ок").catch(() => {});
          return true;
        }

        if (parsed.action === "mp_confirm") {
          await ctx.answerCbQuery("Готовлю стратегию...").catch(() => {});
          await confirmStage1AndGenerateStrategy(ctx, plan);
          return true;
        }

        if (parsed.action === "mp_strategy_edit") {
          await updateMediaPlan(plan.id, { awaitingInput: "stage2" });
          await editMarkdown(
            ctx,
            "✏️ Напиши, что скорректировать в стратегии. Я пересоберу полный вариант."
          );
          await ctx.answerCbQuery("Ок").catch(() => {});
          return true;
        }

        if (parsed.action === "mp_strategy_ok") {
          await updateMediaPlan(plan.id, { status: "done", awaitingInput: null });
          await editMarkdown(ctx, "✅ Медиаплан сохранён 💾");
          await ctx.answerCbQuery("Сохранено").catch(() => {});
          return true;
        }

        return false;
      } catch (error) {
        console.error("[mediaplan] callback failed", error);
        if (error instanceof MediaPlanHandledError) {
          await ctx.answerCbQuery("Ошибка").catch(() => {});
          return true;
        }
        await ctx.answerCbQuery("Ошибка").catch(() => {});
        await replyMarkdown(ctx, MSG_ERROR);
        return true;
      }
    },

    async handleMessage(ctx: Context<Update>): Promise<boolean> {
      const message = ctx.message;
      if (!message || !("chat" in message)) return false;

      const textRaw = getMessageText(message).trim();
      const isMediaplanCommand = MP_CMD_RE.test(textRaw);

      // MVP scope: only in private chat to avoid intercepting group workstreams.
      if (!isPrivateChat(ctx) && !isMediaplanCommand) {
        return false;
      }

      // Let other commands pass through when flow is active.
      if (textRaw.startsWith("/") && !isMediaplanCommand) {
        return false;
      }

      try {
        const resolved = await resolveUserAndTeam(ctx);
        if (!resolved) return false;
        const { userId, teamId } = resolved;

        const active = await findActiveMediaPlanByUser(userId);

        // 1) /mediaplan [brief]
        const cmdMatch = textRaw.match(MP_CMD_RE);
        if (cmdMatch) {
          const inlineBrief = (cmdMatch[1] || "").trim();
          let brief = inlineBrief;

          if (!brief) {
            const extractedCurrent = await extractTextFromBriefDocument(ctx, message);
            if (extractedCurrent.unsupported) {
              await replyMarkdown(ctx, MSG_UNSUPPORTED_BRIEF_FILE);
              return true;
            }
            brief = (extractedCurrent.text || "").trim();
          }

          if (!brief && "reply_to_message" in message) {
            const repliedMessage = message.reply_to_message as Message;
            brief = getMessageText(repliedMessage).trim();
            if (!brief) {
              const extractedReply = await extractTextFromBriefDocument(ctx, repliedMessage);
              if (extractedReply.unsupported) {
                await replyMarkdown(ctx, MSG_UNSUPPORTED_BRIEF_FILE);
                return true;
              }
              brief = (extractedReply.text || "").trim();
            }
          }

          if (!brief) {
            await replyMarkdown(
              ctx,
              "Отправь бриф после команды `/mediaplan` или просто перешли бриф в личку бота."
            );
            return true;
          }

          await startOrRestartPlan(ctx, userId, teamId, brief, active);
          return true;
        }

        // 2) Forwarded brief starts flow when no active plan.
        if (!active && isForwardedMessage(message)) {
          let forwardedBrief = textRaw;

          if (!forwardedBrief) {
            const extractedForwarded = await extractTextFromBriefDocument(ctx, message);
            if (extractedForwarded.unsupported) {
              await replyMarkdown(ctx, MSG_UNSUPPORTED_BRIEF_FILE);
              return true;
            }
            forwardedBrief = (extractedForwarded.text || "").trim();
          }

          if (forwardedBrief) {
            await startOrRestartPlan(ctx, userId, teamId, forwardedBrief, null);
            return true;
          }
        }

        if (!active) return false;

        // 3) Active flow continuation.
        if (active.status === "stage1") {
          if (!textRaw) {
            await replyMarkdown(ctx, "Пришли уточнение текстом, и я обновлю summary.");
            return true;
          }
          await applyStage1Correction(ctx, active, textRaw);
          return true;
        }

        if (active.status === "stage2") {
          if (active.awaitingInput !== "stage2") {
            await replyMarkdown(ctx, "Чтобы изменить стратегию, нажми кнопку ✏️ *Скорректировать* под последним вариантом.");
            return true;
          }

          if (!textRaw) {
            await replyMarkdown(ctx, "Напиши текстом, что нужно скорректировать.");
            return true;
          }

          await applyStage2Correction(ctx, active, textRaw);
          return true;
        }

        return false;
      } catch (error) {
        console.error("[mediaplan] message flow failed", error);
        if (error instanceof MediaPlanHandledError) {
          return true;
        }
        await replyMarkdown(ctx, MSG_ERROR);
        return true;
      }
    },
  };
}
