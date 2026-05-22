import * as fs from "fs";
import { Context } from "telegraf";
import type { Message, Update } from "telegraf/typings/core/types/typegram";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { deriveTeamIdForTaskCreation } from "../../core/deriveTeamIdForTaskCreation";
import { upsertUserFromTelegramPayload } from "../../repositories/userRepository";
import {
  create,
  findActiveByUser,
  findAllByTeam,
  findById,
  setActivePlanForUser,
  update,
  type MediaPlanDoc,
  type MediaPlanDiscussionItem,
} from "./mediaPlanning.repository";
import {
  checkIfDecided,
  continueTheoriesDiscussion,
  generatePlanTitle,
  generateQuestions,
  generateSummary,
  generateStrategy,
  generateTeamTasks,
  generateTheories,
  parseBrief,
  parseTeamTasksIntoBlocks,
  researchBrief,
} from "./mediaPlanning.service";

type MediaPlanningHandlers = {
  handleMessage: (ctx: Context<Update>) => Promise<boolean>;
  handleCallback: (ctx: Context<Update>) => Promise<boolean>;
};

const MSG_ERROR = "Произошла ошибка, попробуй ещё раз 🔄";
const MSG_UNSUPPORTED_BRIEF_FILE = "Поддерживаются PDF, Word и текст";
const MSG_SKIP_HINT = 'Отправь "готово" чтобы пропустить уточнения и перейти к следующему этапу.';
const MSG_ACTIVE_PLAN_IN_PROGRESS =
  "У тебя уже есть активная медиастратегия в работе. Ответь на уточнения в личке бота, и я продолжу текущий план.";
const MP_CMD_RE = /^\/mediaplan(?:@\S+)?(?:\s+([\s\S]*))?$/i;
const TENDERS_CMD_RE = /^\/tenders(?:@\S+)?\s*$/i;
const TENDERS_TEXT_RE = /^покажи\s+тендеры$/i;
const OPUS_TOKEN_THRESHOLD = 50000;
const pendingPlanNameByUser = new Map<number, string>();
const STAGE_ARTIFACTS_ENABLED = String(process.env.MEDIA_PLAN_STAGE_ARTIFACTS || "true").toLowerCase() !== "false";
const ALLOWED_BRIEF_SENDERS = String(process.env.MEDIA_PLAN_ALLOWED_USERS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isInteger(id) && id > 0);
const MIN_BRIEF_LENGTH = 150;

function detectFriendlyError(error: unknown): string {
  const status = Number((error as { status?: unknown })?.status || 0);
  const message = String((error as { message?: unknown })?.message || "").toLowerCase();

  if (message.includes("credit balance is too low") || message.includes("plans & billing")) {
    return "⚠️ Anthropic API недоступен: недостаточно баланса. Пополни баланс и повтори попытку.";
  }

  if (
    status === 403 ||
    message.includes("cloudflare") ||
    message.includes("just a moment") ||
    message.includes("cf_chl")
  ) {
    return "⚠️ Anthropic временно недоступен (403/Cloudflare challenge). Попробуй снова через 1-2 минуты.";
  }

  if (status === 429 || message.includes("overloaded") || message.includes("rate")) {
    return "⚠️ Лимит запросов к модели. Повтори через минуту.";
  }

  return MSG_ERROR;
}

function getMessageText(message: Message | undefined): string {
  if (!message) return "";
  if ("text" in message && typeof message.text === "string") return message.text;
  if ("caption" in message && typeof message.caption === "string") return message.caption;
  return "";
}

function getMessageAttachmentNote(message: Message | undefined): string {
  if (!message) return "";

  const raw = message as unknown as {
    photo?: Array<{ file_id?: unknown; width?: unknown; height?: unknown; file_size?: unknown }>;
    document?: { file_id?: unknown; file_name?: unknown; mime_type?: unknown; file_size?: unknown };
    video?: { file_id?: unknown; duration?: unknown; file_size?: unknown };
    voice?: { file_id?: unknown; duration?: unknown; file_size?: unknown };
    audio?: { file_id?: unknown; duration?: unknown; file_size?: unknown };
    caption?: unknown;
  };

  const caption = typeof raw.caption === "string" ? raw.caption.trim() : "";
  const lines: string[] = [];

  if (Array.isArray(raw.photo) && raw.photo.length) {
    const best = raw.photo[raw.photo.length - 1];
    const fileId = typeof best.file_id === "string" ? best.file_id : "unknown";
    const width = Number(best.width) || 0;
    const height = Number(best.height) || 0;
    const size = Number(best.file_size) || 0;
    lines.push(`[photo fileId=${fileId} size=${width}x${height} bytes=${size}]`);
  }

  if (raw.document && typeof raw.document.file_id === "string") {
    const fileId = raw.document.file_id;
    const fileName = typeof raw.document.file_name === "string" ? raw.document.file_name : "document";
    const mime = typeof raw.document.mime_type === "string" ? raw.document.mime_type : "unknown";
    const size = Number(raw.document.file_size) || 0;
    lines.push(`[document fileId=${fileId} name=${fileName} mime=${mime} bytes=${size}]`);
  }

  if (raw.video && typeof raw.video.file_id === "string") {
    const fileId = raw.video.file_id;
    const duration = Number(raw.video.duration) || 0;
    const size = Number(raw.video.file_size) || 0;
    lines.push(`[video fileId=${fileId} durationSec=${duration} bytes=${size}]`);
  }

  if (raw.voice && typeof raw.voice.file_id === "string") {
    const fileId = raw.voice.file_id;
    const duration = Number(raw.voice.duration) || 0;
    const size = Number(raw.voice.file_size) || 0;
    lines.push(`[voice fileId=${fileId} durationSec=${duration} bytes=${size}]`);
  }

  if (raw.audio && typeof raw.audio.file_id === "string") {
    const fileId = raw.audio.file_id;
    const duration = Number(raw.audio.duration) || 0;
    const size = Number(raw.audio.file_size) || 0;
    lines.push(`[audio fileId=${fileId} durationSec=${duration} bytes=${size}]`);
  }

  if (!lines.length) return "";
  if (caption) lines.push(`caption: ${caption}`);
  return lines.join("\n");
}

function extractClientLabelFromBriefText(briefText: string): string | null {
  const raw = String(briefText || "");
  const m = raw.match(/(?:Компания\s*\/\s*бренд|Компания|Бренд)\s*:\s*([^\n\r]+)/i);
  if (!m?.[1]) return null;
  const label = m[1].trim().slice(0, 80);
  return label || null;
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

  if (normalizedName.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    normalizedName.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (normalizedName.endsWith(".txt") || mimeType === "text/plain") return "txt";

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
    return { text: String(parsed?.value || "").trim(), unsupported: false };
  }

  return { text: buffer.toString("utf-8").trim(), unsupported: false };
}

async function resolveUserAndTeam(ctx: Context<Update>): Promise<{
  userId: string;
  teamId: string;
  telegramUserId: number;
} | null> {
  const from = ctx.from;
  if (!from) return null;

  let chatId: string | null = null;
  const message = ctx.message;
  if (message && "chat" in message) {
    chatId = String(message.chat.id);
  } else {
    const callback = ctx.callbackQuery;
    if (callback && "message" in callback && callback.message && "chat" in callback.message) {
      chatId = String(callback.message.chat.id);
    }
  }
  if (!chatId) return null;

  const user = await upsertUserFromTelegramPayload({
    id: from.id,
    username: from.username ?? undefined,
    first_name: from.first_name ?? undefined,
    last_name: from.last_name ?? undefined,
  });

  const teamId = await deriveTeamIdForTaskCreation({
    telegramChatId: chatId,
    userId: user.id,
  });

  return { userId: user.id, teamId, telegramUserId: from.id };
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of String(text || "").split("\n")) {
    if (current.length + line.length + 1 > maxLength && current) {
      chunks.push(current);
      current = "";
    }
    current += `${line}\n`;
  }

  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [String(text || "")];
}

function prepareBriefText(raw: string): string {
  let cleaned = String(raw || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();

  const briefStart = cleaned.search(/БРИФ|BRIEF|II\.\s+Бриф/i);
  if (briefStart > 0 && briefStart < cleaned.length * 0.4) {
    cleaned = cleaned.slice(briefStart);
    console.log(`[mediaPlan] Skipped legal preamble, brief starts at char ${briefStart}`);
  }

  if (cleaned.length > 10000) {
    console.warn(`Brief truncated from ${cleaned.length} to 10000 chars`);
    cleaned = `${cleaned.slice(0, 10000)}\n[...truncated]`;
  }

  return cleaned;
}

async function sendLongText(
  ctx: Context<Update>,
  chatId: number,
  text: string,
  maxLength = 3900
): Promise<void> {
  const chunks = splitMessage(text, maxLength);
  for (const chunk of chunks) {
    await ctx.telegram.sendMessage(chatId, chunk);
  }
}

function buildSimpleStageHtml(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #222; margin: 0; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 28px 22px 60px; }
    h1 { margin: 0 0 18px; color: #111; font-size: 1.5rem; }
    .meta { color: #666; margin-bottom: 24px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${new Date().toISOString()}</div>
    ${convertMarkdownToHTML(content)}
  </div>
</body>
</html>`;
}

async function sendStageJsonArtifact(
  ctx: Context<Update>,
  telegramUserId: number,
  planId: string,
  stage: string,
  payload: unknown
): Promise<void> {
  if (!STAGE_ARTIFACTS_ENABLED) return;
  const body = JSON.stringify(payload, null, 2);
  const filename = `${stage}-${sanitizeFilename(planId)}.json`;
  await ctx.telegram.sendDocument(
    telegramUserId,
    { source: Buffer.from(body, "utf8"), filename },
    { caption: `📦 Артефакт этапа: ${stage} (JSON)` }
  );
}

async function sendStageHtmlArtifact(
  ctx: Context<Update>,
  telegramUserId: number,
  planId: string,
  stage: string,
  title: string,
  markdownText: string
): Promise<void> {
  if (!STAGE_ARTIFACTS_ENABLED) return;
  const html = buildSimpleStageHtml(title, markdownText);
  const filename = `${stage}-${sanitizeFilename(planId)}.html`;
  await ctx.telegram.sendDocument(
    telegramUserId,
    { source: Buffer.from(html, "utf8"), filename },
    { caption: `📄 Артефакт этапа: ${stage} (HTML)` }
  );
}

function isSkipWord(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "готово" || normalized === "хватит" || normalized === "достаточно";
}

function formatQuestionsList(questions: string[]): string {
  const lines = questions.map((q, idx) => `${idx + 1}. ${q}`);
  return [
    "❓ Нужны уточнения перед стратегией.",
    "",
    "Ответь одним сообщением в личке бота в формате:",
    "1) ...",
    "2) ...",
    "",
    "Вопросы:",
    ...lines,
    "",
    MSG_SKIP_HINT,
  ].join("\n");
}

function parseClarificationAnswers(
  text: string,
  pendingQuestions: string[]
): Array<{ index: number; answer: string }> {
  const total = pendingQuestions.length;
  if (!total) return [];

  const map = new Map<number, string>();
  const re = /(?:^|\n)\s*(\d{1,2})[)\].:-]\s*(.+?)(?=\n\d{1,2}[)\].:-]|\n*$)/gs;
  for (const match of text.matchAll(re)) {
    const index = Number(match[1]) - 1;
    const answer = String(match[2] || "").trim();
    if (!Number.isInteger(index) || index < 0 || index >= total) continue;
    if (!answer) continue;
    map.set(index, answer);
  }

  if (map.size === 0) {
    const chunks = text
      .split(/\n{2,}/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (chunks.length > 0) {
      const usable = Math.min(chunks.length, total);
      for (let i = 0; i < usable; i += 1) {
        map.set(i, chunks[i]);
      }
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, answer]) => ({ index, answer }));
}

async function sendQuestionsBatch(
  telegramUserId: number,
  planId: string,
  ctx: Context<Update>
): Promise<void> {
  const plan = await findById(planId);
  if (!plan) return;

  if (!plan.pendingQuestions?.length) {
    await runSummaryCheck(telegramUserId, planId, ctx);
    return;
  }

  await ctx.telegram.sendMessage(telegramUserId, formatQuestionsList(plan.pendingQuestions));
}

async function runSummaryCheck(telegramUserId: number, planId: string, ctx: Context<Update>): Promise<void> {
  const plan = await findById(planId);
  if (!plan) return;

  await ctx.telegram.sendMessage(telegramUserId, "📝 Формирую сводку...");

  const summaryText = await generateSummary(
    plan.briefSummary,
    plan.researchData,
    plan.clarifications || []
  );

  await update(planId, {
    status: "summary_check",
    summaryText,
  });
  await sendStageHtmlArtifact(ctx, telegramUserId, planId, "summary_check", "Сводка проекта", summaryText);

  if (summaryText.length <= 3900) {
    await ctx.telegram.sendMessage(telegramUserId, summaryText, {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Всё верно, строим стратегию", callback_data: `mp_summary_ok_${planId}` },
          { text: "✏️ Уточнить", callback_data: `mp_summary_edit_${planId}` },
        ]],
      },
    });
    return;
  }

  await sendLongText(ctx, telegramUserId, summaryText);
  await ctx.telegram.sendMessage(telegramUserId, "Подтверди сводку перед стратегиями:", {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Всё верно, строим стратегию", callback_data: `mp_summary_ok_${planId}` },
        { text: "✏️ Уточнить", callback_data: `mp_summary_edit_${planId}` },
      ]],
    },
  });
}

async function runTheories(telegramUserId: number, planId: string, ctx: Context<Update>): Promise<void> {
  const plan = await findById(planId);
  if (!plan) return;

  await ctx.telegram.sendMessage(
    telegramUserId,
    "🧠 Анализирую данные, формирую стратегические теории..."
  );

  const theoriesText = await generateTheories(
    plan.briefSummary,
    plan.researchData,
    plan.clarifications || []
  );
  const title = await generatePlanTitle(plan.briefSummary);

  const discussionHistory: MediaPlanDiscussionItem[] = [
    { role: "assistant", content: theoriesText },
  ];

  await update(planId, {
    theoriesText,
    title,
    status: "theories",
    discussionHistory,
  });
  await sendStageHtmlArtifact(
    ctx,
    telegramUserId,
    planId,
    "theories",
    `Стратегические теории: ${title || planId}`,
    theoriesText
  );

  await sendLongText(ctx, telegramUserId, theoriesText);
}

async function runTeamTasks(telegramUserId: number, planId: string, ctx: Context<Update>): Promise<void> {
  const plan = await findById(planId);
  if (!plan) return;

  await ctx.telegram.sendMessage(telegramUserId, "📋 Формирую задания для команды...");

  const teamTasksText = await generateTeamTasks(
    plan.briefSummary,
    plan.researchData,
    plan.selectedTheory || ""
  );

  const blocks = parseTeamTasksIntoBlocks(teamTasksText);

  await update(planId, {
    teamTasks: blocks,
    status: "team_tasks",
  });
  await sendStageJsonArtifact(ctx, telegramUserId, planId, "team_tasks", {
    planId,
    selectedTheory: plan.selectedTheory || "",
    teamTasks: blocks,
    generatedText: teamTasksText,
  });

  await ctx.telegram.sendMessage(
    telegramUserId,
    "📬 *Задания для команды готовы*\nКаждое сообщение ниже можно переслать нужному специалисту:",
    { parse_mode: "Markdown" }
  );

  if (blocks.targetologist.length) {
    await ctx.telegram.sendMessage(
      telegramUserId,
      `### 🎯 Таргетолог / Медиабайер\n${blocks.targetologist.map((x) => `• ${x}`).join("\n")}\n\n↑ Перешли таргетологу / медиабайеру`
    );
  }
  if (blocks.analyst.length) {
    await ctx.telegram.sendMessage(
      telegramUserId,
      `### 📊 Аналитик\n${blocks.analyst.map((x) => `• ${x}`).join("\n")}\n\n↑ Перешли аналитику`
    );
  }
  if (blocks.account.length) {
    await ctx.telegram.sendMessage(
      telegramUserId,
      `### 👤 Клиент-менеджер / Аккаунт\n${blocks.account.map((x) => `• ${x}`).join("\n")}\n\n↑ Перешли клиент-менеджеру / аккаунту`
    );
  }
  if (blocks.client.length) {
    await ctx.telegram.sendMessage(
      telegramUserId,
      `### 💼 Запросить у клиента\n${blocks.client.map((x) => `• ${x}`).join("\n")}\n\n↑ Запросить у клиента`
    );
  }

  await ctx.telegram.sendMessage(
    telegramUserId,
    "💬 Когда соберете данные от команды — отправьте их мне в свободной форме. Можно несколькими сообщениями."
  );
}

async function estimateInputTokens(plan: MediaPlanDoc): Promise<number> {
  const payload = JSON.stringify({
    original_brief: plan.briefRaw,
    parsed_summary: plan.briefSummary,
    research_data: plan.researchData,
    clarifications: plan.clarifications,
    team_data: plan.teamData,
  });

  return Math.ceil(payload.length / 4);
}

async function runFinalStrategy(telegramUserId: number, planId: string, ctx: Context<Update>): Promise<void> {
  const plan = await findById(planId);
  if (!plan) return;

  const estimatedTokens = await estimateInputTokens(plan);
  if (estimatedTokens > OPUS_TOKEN_THRESHOLD) {
    await ctx.telegram.sendMessage(
      telegramUserId,
      `⚠️ Для генерации финальной стратегии потребуется ~${Math.ceil(estimatedTokens / 1000)}K токенов (большой объем данных).\n\nПродолжаем?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Да, генерируй", callback_data: `mp_build_confirmed_${planId}` },
            { text: "✂️ Сократить данные", callback_data: `mp_trim_${planId}` },
          ]],
        },
      }
    );
    return;
  }

  await runFinalStrategyConfirmed(telegramUserId, planId, ctx);
}

async function runFinalStrategyConfirmed(
  telegramUserId: number,
  planId: string,
  ctx: Context<Update>
): Promise<void> {
  const plan = await findById(planId);
  if (!plan) return;

  await update(planId, { status: "strategy" });
  await ctx.telegram.sendMessage(telegramUserId, "🧠 Создаю финальную стратегию... (~60 сек)");

  const strategyText = await generateStrategy(
    plan.briefRaw,
    plan.briefSummary,
    plan.researchData,
    plan.clarifications || [],
    plan.teamData || ""
  );

  const html = generateStrategyHTML(strategyText, plan);
  const filePath = `/tmp/strategy-${planId}.html`;
  fs.writeFileSync(filePath, html, "utf8");

  await update(planId, { finalStrategy: strategyText, status: "done", isActiveForUser: false });
  await sendStageJsonArtifact(ctx, telegramUserId, planId, "strategy_final", {
    planId,
    title: plan.title || "",
    status: "done",
    strategyText,
  });

  await ctx.telegram.sendDocument(
    telegramUserId,
    { source: filePath, filename: `MediaStrategy-${sanitizeFilename(plan.title || planId)}.html` },
    { caption: "📄 Стратегия готова! Откройте файл в браузере." }
  );

  const chunks = splitMessage(strategyText, 4000);
  for (const chunk of chunks) {
    await ctx.telegram.sendMessage(telegramUserId, chunk);
  }

  await ctx.telegram.sendMessage(telegramUserId, "✅ Медиастратегия сохранена!", {
    reply_markup: {
      inline_keyboard: [[
        { text: "✏️ Скорректировать", callback_data: `mp_edit_${planId}` },
        { text: "📋 Все тендеры", callback_data: "mp_list" },
      ]],
    },
  });

  fs.unlink(filePath, () => {});
}

async function handleTheoriesDiscussion(ctx: Context<Update>, plan: MediaPlanDoc): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const userMessage = getMessageText(message).trim();
  if (!userMessage) return;

  const decided = await checkIfDecided(userMessage);
  const history: MediaPlanDiscussionItem[] = [
    ...(plan.discussionHistory || []),
    { role: "user", content: userMessage },
  ];

  if (decided) {
    await update(plan.id, {
      selectedTheory: userMessage,
      status: "team_tasks",
      discussionHistory: history,
    });
    await runTeamTasks(plan.createdByTelegramId, plan.id, ctx);
    return;
  }

  const reply = await continueTheoriesDiscussion(history, userMessage, Boolean(plan.briefSummary?._geo_russia));
  const updatedHistory: MediaPlanDiscussionItem[] = [...history, { role: "assistant", content: reply }];

  await update(plan.id, { discussionHistory: updatedHistory });
  await sendLongText(ctx, plan.createdByTelegramId, reply);
}

async function handleTeamDataInput(ctx: Context<Update>, plan: MediaPlanDoc): Promise<void> {
  const message = ctx.message;
  if (!message) return;
  const text = getMessageText(message).trim();
  const attachmentNote = getMessageAttachmentNote(message).trim();
  if (!text && !attachmentNote) return;

  const incoming = [text, attachmentNote].filter(Boolean).join("\n");
  const newData = [plan.teamData || "", incoming].filter(Boolean).join("\n\n");
  await update(plan.id, { teamData: newData, status: "pre_strategy" });

  const savedHint = attachmentNote
    ? "✅ Данные и вложение сохранены. Добавить еще или приступаем к стратегии?"
    : "✅ Данные сохранены. Добавить еще или приступаем к стратегии?";

  await ctx.reply(savedHint, {
    reply_markup: {
      inline_keyboard: [[
        { text: "🚀 Создавай стратегию", callback_data: `mp_build_${plan.id}` },
        { text: "➕ Добавить еще", callback_data: `mp_more_${plan.id}` },
      ]],
    },
  });
}

async function handleBriefIntake(ctx: Context<Update>, briefText: string): Promise<void> {
  const resolved = await resolveUserAndTeam(ctx);
  if (!resolved) return;
  const previousActive = await findActiveByUser(resolved.telegramUserId);
  const clientLabel = extractClientLabelFromBriefText(briefText);

  const message = ctx.message;
  const replyOptions =
    message && "message_id" in message
      ? ({ reply_to_message_id: message.message_id } as const)
      : undefined;

  if (clientLabel) {
    await ctx.reply(`📨 Принял бриф для клиента: ${clientLabel}. Создаю новый тендер...`, replyOptions as any);
  } else {
    await ctx.reply(
      "📨 Принял бриф. Не вижу имени клиента в документе, но уже создаю новый тендер.",
      replyOptions as any
    );
  }

  const plan = await create({
    teamId: resolved.teamId,
    createdByUserId: resolved.userId,
    createdByTelegramId: resolved.telegramUserId,
    isActiveForUser: true,
    status: "parsing",
    briefRaw: briefText,
    title: clientLabel || "",
  });
  await setActivePlanForUser(resolved.telegramUserId, plan.id);
  await ctx.telegram.sendMessage(
    resolved.telegramUserId,
    "📄 Бриф получен. Анализирую... (может занять до 2 минут для больших документов)"
  );

  console.log(
    `[mediaplan] plan=${plan.id} userTg=${resolved.telegramUserId} stage=parsing briefChars=${briefText.length}`
  );
  if (previousActive && previousActive.id !== plan.id && previousActive.status !== "done") {
    const titleHint = clientLabel || "новый тендер";
    await ctx.telegram
      .sendMessage(
        resolved.telegramUserId,
        `ℹ️ Активный тендер переключен на: ${titleHint}.`
      )
      .catch(() => {});
  }

  if (!clientLabel) {
    pendingPlanNameByUser.set(resolved.telegramUserId, plan.id);
    await ctx.telegram
      .sendMessage(
        resolved.telegramUserId,
        `✏️ Напиши имя клиента или название тендера для этого брифа одним сообщением.\nЯ присвою его новому тендеру.`
      )
      .catch(() => {});
  }

  const preparedBrief = prepareBriefText(plan.briefRaw);
  const briefSummary = await parseBrief(preparedBrief);
  if (briefSummary?._parse_error) {
    await update(plan.id, { briefSummary, status: "clarifying" });
    await ctx.telegram.sendMessage(
      resolved.telegramUserId,
      "⚠️ Не удалось автоматически разобрать бриф (слишком большой файл).\n\n" +
        "Пожалуйста, скопируйте ключевые данные из брифа:\n" +
        "— Продукт и цель\n— Бюджет\n— ЦА\n— Каналы\n— KPI\n\n" +
        "Или отправьте краткое текстовое описание задачи."
    );
    return;
  }
  await update(plan.id, { briefSummary, status: "researching" });
  console.log(`[mediaplan] plan=${plan.id} stage=researching parsed=ok`);
  await sendStageJsonArtifact(ctx, resolved.telegramUserId, plan.id, "parsing", {
    planId: plan.id,
    briefChars: briefText.length,
    briefSummary,
  });

  await ctx.telegram.sendMessage(resolved.telegramUserId, "🔍 Изучаю рынок и аудиторию...");

  const researchData = await researchBrief(briefSummary);
  await update(plan.id, { researchData, status: "clarifying" });
  console.log(`[mediaplan] plan=${plan.id} stage=clarifying research=ok`);
  await sendStageJsonArtifact(ctx, resolved.telegramUserId, plan.id, "researching", {
    planId: plan.id,
    researchData,
  });

  const questions = await generateQuestions(briefSummary, researchData);
  await update(plan.id, { pendingQuestions: questions });
  console.log(`[mediaplan] plan=${plan.id} clarifying.questions=${questions.length}`);
  await sendStageJsonArtifact(ctx, resolved.telegramUserId, plan.id, "clarifying", {
    planId: plan.id,
    questions,
  });

  await sendQuestionsBatch(resolved.telegramUserId, plan.id, ctx);
}

async function readBriefFromMessageOrReply(
  ctx: Context<Update>,
  message: Message
): Promise<{ brief: string; unsupported: boolean }> {
  const extractedCurrent = await extractTextFromBriefDocument(ctx, message);
  if (extractedCurrent.unsupported) return { brief: "", unsupported: true };

  let brief = (extractedCurrent.text || "").trim();
  if (!brief) {
    brief = getMessageText(message).trim();
  }

  if (!brief) {
    if ("reply_to_message" in message) {
      const repliedMessage = message.reply_to_message as Message;
      const extractedReply = await extractTextFromBriefDocument(ctx, repliedMessage);
      if (extractedReply.unsupported) return { brief: "", unsupported: true };
      brief = (extractedReply.text || "").trim();

      if (!brief) {
        brief = getMessageText(repliedMessage).trim();
      }
    }
  }

  return { brief, unsupported: false };
}

async function handleClarificationAnswer(ctx: Context<Update>, activePlan: MediaPlanDoc): Promise<boolean> {
  const message = ctx.message;
  if (!message) return false;

  const text = getMessageText(message).trim();
  if (!text) {
    const attachmentNote = getMessageAttachmentNote(message).trim();
    if (attachmentNote) {
      await ctx
        .reply(
          "Вижу вложение. Для этапа уточнений нужен текстовый ответ по пунктам (1), 2), ...). Вложение можно добавить на этапе сбора данных команды."
        )
        .catch(() => {});
      return true;
    }
    return false;
  }

  if (isSkipWord(text)) {
    await update(activePlan.id, { pendingQuestions: [] });
    console.log(`[mediaplan] plan=${activePlan.id} clarifying.skip requested`);
    await runSummaryCheck(activePlan.createdByTelegramId, activePlan.id, ctx);
    return true;
  }

  if (!activePlan.pendingQuestions?.length) {
    await runSummaryCheck(activePlan.createdByTelegramId, activePlan.id, ctx);
    return true;
  }

  const parsedAnswers = parseClarificationAnswers(text, activePlan.pendingQuestions);
  if (!parsedAnswers.length) {
    await ctx.reply(formatQuestionsList(activePlan.pendingQuestions)).catch(() => {});
    return true;
  }

  const answeredIndexes = new Set(parsedAnswers.map((x) => x.index));
  const clarifications = [...(activePlan.clarifications || [])];
  for (const item of parsedAnswers) {
    clarifications.push({
      question: activePlan.pendingQuestions[item.index],
      answer: item.answer,
    });
  }

  const remaining = activePlan.pendingQuestions.filter((_, idx) => !answeredIndexes.has(idx));

  await update(activePlan.id, {
    clarifications,
    pendingQuestions: remaining,
  });
  console.log(
    `[mediaplan] plan=${activePlan.id} clarifying.answer saved total=${clarifications.length} remaining=${remaining.length}`
  );

  if (!remaining.length) {
    await runSummaryCheck(activePlan.createdByTelegramId, activePlan.id, ctx);
    return true;
  }

  await ctx.reply(
    `Принял часть ответов. Осталось уточнить ${remaining.length} пункт(а).`
  ).catch(() => {});
  await sendQuestionsBatch(activePlan.createdByTelegramId, activePlan.id, ctx);
  return true;
}

function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    parsing: "⚙️",
    researching: "🔍",
    clarifying: "❓",
    summary_check: "📝",
    summary_editing: "✏️",
    theories: "🧠",
    team_tasks: "📋",
    pre_strategy: "⏳",
    strategy: "✍️",
    done: "✅",
  };
  return map[status] || "•";
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    parsing: "Парсинг",
    researching: "Исследование",
    clarifying: "Уточнения",
    summary_check: "Проверка сводки",
    summary_editing: "Правка сводки",
    theories: "Выбор теории",
    team_tasks: "Сбор данных",
    pre_strategy: "Подтверждение",
    strategy: "Генерация",
    done: "Готово",
  };
  return map[status] || status;
}

async function handleTendersList(ctx: Context<Update>): Promise<void> {
  const resolved = await resolveUserAndTeam(ctx);
  if (!resolved) {
    await ctx.reply("Не удалось определить команду.").catch(() => {});
    return;
  }

  const plans = await findAllByTeam(resolved.teamId);

  if (!plans.length) {
    await ctx
      .reply("Нет активных тендеров. Отправьте бриф в группу медиапланирования чтобы начать.")
      .catch(() => {});
    return;
  }

  const buttons = plans.slice(0, 10).map((p) => [
    {
      text: `${p.isActiveForUser ? "🟢" : statusEmoji(p.status)} ${p.title || "Медиаплан"} — ${statusLabel(p.status)}`,
      callback_data: `mp_activate_${p.id}`,
    },
  ]);

  await ctx.reply("📁 *Тендеры / Медиапланы:*\\nВыбери тендер, который сделать активным.", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleTenderOpen(ctx: Context<Update>, planId: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const plan = await findById(planId);
  if (!plan || plan.createdByTelegramId !== from.id) {
    await ctx.reply("План не найден").catch(() => {});
    return;
  }

  const summary = [
    `📄 *${plan.title || "Медиаплан"}*`,
    `📅 Создан: ${plan.createdAt?.toDate().toLocaleDateString("ru-RU")}`,
    `🔄 Статус: ${statusLabel(plan.status)}`,
    `🛍 Продукт: ${String((plan.briefSummary?.product as string) || "—")}`,
    `💰 Бюджет: ${String((plan.briefSummary?.budget as { total?: unknown } | undefined)?.total || "?")} ${String((plan.briefSummary?.budget as { currency?: unknown } | undefined)?.currency || "")}`,
  ].join("\n");

  const continueButton =
    plan.status !== "done"
      ? [[{ text: "▶️ Продолжить", callback_data: `mp_continue_${planId}` }]]
      : [[{ text: "📄 Скачать стратегию", callback_data: `mp_download_${planId}` }]];

  await ctx.reply(summary, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: continueButton },
  });
}

async function resumePlan(telegramUserId: number, plan: MediaPlanDoc, ctx: Context<Update>): Promise<void> {
  switch (plan.status) {
    case "summary_check":
      await ctx.telegram.sendMessage(
        telegramUserId,
        `${plan.summaryText || "Сводка готова."}\n\nПодтверди или скорректируй.`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Всё верно, строим стратегию", callback_data: `mp_summary_ok_${plan.id}` },
              { text: "✏️ Уточнить", callback_data: `mp_summary_edit_${plan.id}` },
            ]],
          },
        }
      );
      break;
    case "summary_editing":
      await ctx.telegram.sendMessage(
        telegramUserId,
        "Напиши, что нужно скорректировать в сводке, и я обновлю её."
      );
      break;
    case "theories":
      await ctx.telegram.sendMessage(
        telegramUserId,
        `Продолжаем обсуждение стратегии для: ${plan.title || "Медиаплан"}\n\n${plan.theoriesText || ""}`
      );
      break;
    case "team_tasks":
      await ctx.telegram.sendMessage(
        telegramUserId,
        "Жду данные от команды. Отправьте всё что собрали — можно несколькими сообщениями."
      );
      break;
    case "pre_strategy":
      await ctx.telegram.sendMessage(telegramUserId, "Приступаем к созданию стратегии?", {
        reply_markup: {
          inline_keyboard: [[
            { text: "🚀 Да, создавай", callback_data: `mp_build_${plan.id}` },
          ]],
        },
      });
      break;
    case "clarifying":
      await sendQuestionsBatch(telegramUserId, plan.id, ctx);
      break;
    case "strategy":
      await ctx.telegram.sendMessage(telegramUserId, "Стратегия уже генерируется, подожди немного.");
      break;
    case "done":
      if (plan.finalStrategy) {
        const chunks = splitMessage(plan.finalStrategy, 4000);
        for (const chunk of chunks) {
          await ctx.telegram.sendMessage(telegramUserId, chunk);
        }
      }
      break;
    default:
      await ctx.telegram.sendMessage(telegramUserId, `Текущий статус: ${statusLabel(plan.status)}.`);
  }
}

function parsePlanCallback(data: string):
  | {
      action:
        | "edit"
        | "save"
        | "build"
        | "build_confirmed"
        | "trim"
        | "more"
        | "activate"
        | "open"
        | "continue"
        | "download"
        | "summary_ok"
        | "summary_edit"
        | "list";
      planId?: string;
    }
  | null {
  if (data === "mp_list") return { action: "list" };

  const edit = String(data || "").match(/^mp_edit_(.+)$/);
  if (edit?.[1]) return { action: "edit", planId: edit[1] };

  const save = String(data || "").match(/^mp_save_(.+)$/);
  if (save?.[1]) return { action: "save", planId: save[1] };

  const buildConfirmed = String(data || "").match(/^mp_build_confirmed_(.+)$/);
  if (buildConfirmed?.[1]) return { action: "build_confirmed", planId: buildConfirmed[1] };

  const build = String(data || "").match(/^mp_build_(.+)$/);
  if (build?.[1]) return { action: "build", planId: build[1] };

  const trim = String(data || "").match(/^mp_trim_(.+)$/);
  if (trim?.[1]) return { action: "trim", planId: trim[1] };

  const more = String(data || "").match(/^mp_more_(.+)$/);
  if (more?.[1]) return { action: "more", planId: more[1] };

  const activate = String(data || "").match(/^mp_activate_(.+)$/);
  if (activate?.[1]) return { action: "activate", planId: activate[1] };

  const summaryOk = String(data || "").match(/^mp_summary_ok_(.+)$/);
  if (summaryOk?.[1]) return { action: "summary_ok", planId: summaryOk[1] };

  const summaryEdit = String(data || "").match(/^mp_summary_edit_(.+)$/);
  if (summaryEdit?.[1]) return { action: "summary_edit", planId: summaryEdit[1] };

  const open = String(data || "").match(/^mp_open_(.+)$/);
  if (open?.[1]) return { action: "open", planId: open[1] };

  const cont = String(data || "").match(/^mp_continue_(.+)$/);
  if (cont?.[1]) return { action: "continue", planId: cont[1] };

  const download = String(data || "").match(/^mp_download_(.+)$/);
  if (download?.[1]) return { action: "download", planId: download[1] };

  return null;
}

function sanitizeFilename(value: string): string {
  const name = String(value || "").trim() || "MediaStrategy";
  return name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(text: string): string {
  let formatted = escapeHtml(text);
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return formatted;
}

function convertMarkdownToHTML(md: string): string {
  const lines = String(md || "").split(/\r?\n/);
  const parts: string[] = [];
  let i = 0;
  let inList = false;

  const closeList = (): void => {
    if (inList) {
      parts.push("</ul>");
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      closeList();
      i += 1;
      continue;
    }

    if (line.startsWith("|") && i + 1 < lines.length && /^\|[-| :]+\|?$/.test(lines[i + 1].trim())) {
      closeList();
      const tableLines: string[] = [line];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i += 1;
      }
      const headerCells = tableLines[0]
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => `<th>${formatInlineMarkdown(x)}</th>`)
        .join("");

      const bodyRows = tableLines
        .slice(1)
        .map((row) => {
          const cells = row
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => `<td>${formatInlineMarkdown(x)}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");

      parts.push(`<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      parts.push(`<h2>${formatInlineMarkdown(line.replace(/^##\s+/, ""))}</h2>`);
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      parts.push(`<h3>${formatInlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
      i += 1;
      continue;
    }

    if (line.startsWith("#### ")) {
      closeList();
      parts.push(`<h4>${formatInlineMarkdown(line.replace(/^####\s+/, ""))}</h4>`);
      i += 1;
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("• ")) {
      if (!inList) {
        parts.push("<ul>");
        inList = true;
      }
      parts.push(`<li>${formatInlineMarkdown(line.replace(/^[-•]\s+/, ""))}</li>`);
      i += 1;
      continue;
    }

    closeList();
    parts.push(`<p>${formatInlineMarkdown(line)}</p>`);
    i += 1;
  }

  closeList();
  return parts.join("\n");
}

function generateStrategyHTML(markdownContent: string, plan: MediaPlanDoc): string {
  const title = plan.title || String((plan.briefSummary?.product as string) || "Медиастратегия");
  const budget = String((plan.briefSummary?.budget as { total?: unknown } | undefined)?.total || "?");
  const currency = String((plan.briefSummary?.budget as { currency?: unknown } | undefined)?.currency || "");
  const product = String((plan.briefSummary?.product as string) || "—");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f8f9fa; color: #1a1a2e; line-height: 1.7; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              color: white; padding: 48px 64px; }
    .header h1 { font-size: 2.2rem; font-weight: 700; margin-bottom: 8px; }
    .header .meta { opacity: 0.75; font-size: 0.95rem; margin-top: 8px; }
    .content { max-width: 900px; margin: 0 auto; padding: 48px 64px; }
    h2 { font-size: 1.5rem; font-weight: 700; margin: 48px 0 16px;
         padding-bottom: 10px; border-bottom: 3px solid #e63946; }
    h3 { font-size: 1.1rem; font-weight: 600; margin: 24px 0 10px; color: #16213e; }
    h4 { font-size: 1rem; font-weight: 600; margin: 18px 0 8px; color: #16213e; }
    p { margin-bottom: 14px; color: #333; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.88rem; }
    th { background: #1a1a2e; color: white; padding: 10px 14px; text-align: left; }
    td { padding: 10px 14px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:nth-child(even) td { background: #f8f9fa; }
    ul { padding-left: 20px; margin-bottom: 14px; }
    li { margin-bottom: 6px; color: #333; }
    strong { color: #1a1a2e; font-weight: 600; }
    em { color: #666; }
    .footer { text-align: center; padding: 32px; color: #aaa;
              font-size: 0.8rem; border-top: 1px solid #eee; margin-top: 64px; }
    @media (max-width: 768px) {
      .header { padding: 32px 24px; }
      .content { padding: 32px 24px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      Продукт: ${escapeHtml(product)} &nbsp;·&nbsp;
      Бюджет: ${escapeHtml(`${budget} ${currency}`)} &nbsp;·&nbsp;
      ${new Date().toLocaleDateString("ru-RU")}
    </div>
  </div>
  <div class="content">
    ${convertMarkdownToHTML(markdownContent)}
  </div>
  <div class="footer">Сформировано Telegatask AI · ${new Date().toISOString()}</div>
</body>
</html>`;
}

export function registerMediaPlanningHandlers(): MediaPlanningHandlers {
  return {
    async handleCallback(ctx: Context<Update>): Promise<boolean> {
      const callback = ctx.callbackQuery;
      if (!callback || !("data" in callback)) return false;

      const parsed = parsePlanCallback(String(callback.data || ""));
      if (!parsed) return false;

      try {
        const from = ctx.from;
        if (!from) {
          await ctx.answerCbQuery("Нет пользователя").catch(() => {});
          return true;
        }

        if (parsed.action === "list") {
          await ctx.answerCbQuery().catch(() => {});
          await handleTendersList(ctx);
          return true;
        }

        if (!parsed.planId) {
          await ctx.answerCbQuery("План не найден").catch(() => {});
          return true;
        }

        const plan = await findById(parsed.planId);
        if (!plan || plan.createdByTelegramId !== from.id) {
          await ctx.answerCbQuery("План не найден").catch(() => {});
          return true;
        }

        if (parsed.action === "save") {
          await ctx.answerCbQuery("Сохранено").catch(() => {});
          await ctx.reply("💾 План сохранён").catch(() => {});
          return true;
        }

        if (parsed.action === "edit") {
          await update(plan.id, {
            status: "clarifying",
            pendingQuestions: ["Что нужно скорректировать в стратегии? Укажи конкретные изменения."],
          });

          await ctx.answerCbQuery("Ок").catch(() => {});
          await sendQuestionsBatch(from.id, plan.id, ctx);
          return true;
        }

        if (parsed.action === "build") {
          await ctx.answerCbQuery("Запускаю генерацию").catch(() => {});
          await runFinalStrategy(from.id, plan.id, ctx);
          return true;
        }

        if (parsed.action === "build_confirmed") {
          await ctx.answerCbQuery("Запускаю генерацию").catch(() => {});
          await runFinalStrategyConfirmed(from.id, plan.id, ctx);
          return true;
        }

        if (parsed.action === "trim") {
          await update(plan.id, { status: "pre_strategy" });
          await ctx.answerCbQuery("Ок").catch(() => {});
          await ctx.reply(
            "Сократи или переформулируй данные команды одним сообщением, затем снова нажми «Создавай стратегию»."
          ).catch(() => {});
          return true;
        }

        if (parsed.action === "more") {
          await update(plan.id, { status: "team_tasks" });
          await ctx.answerCbQuery("Ожидаю новые данные").catch(() => {});
          await ctx.reply("Отправь дополнительные данные следующим сообщением.").catch(() => {});
          return true;
        }

        if (parsed.action === "activate") {
          await setActivePlanForUser(from.id, plan.id);
          await ctx.answerCbQuery("Активный тендер выбран").catch(() => {});
          await ctx.reply(
            `🟢 Активный тендер: ${plan.title || "Медиаплан"}`
          ).catch(() => {});
          await resumePlan(from.id, { ...plan, isActiveForUser: true }, ctx);
          return true;
        }

        if (parsed.action === "summary_ok") {
          await ctx.answerCbQuery("Отлично!").catch(() => {});
          await runTheories(from.id, plan.id, ctx);
          return true;
        }

        if (parsed.action === "summary_edit") {
          await update(plan.id, { status: "summary_editing" });
          await ctx.answerCbQuery().catch(() => {});
          await ctx.telegram.sendMessage(
            from.id,
            "✏️ Напишите что нужно скорректировать или добавить:"
          );
          return true;
        }

        if (parsed.action === "open") {
          await ctx.answerCbQuery().catch(() => {});
          await handleTenderOpen(ctx, plan.id);
          return true;
        }

        if (parsed.action === "continue") {
          await ctx.answerCbQuery().catch(() => {});
          await setActivePlanForUser(from.id, plan.id);
          await resumePlan(from.id, plan, ctx);
          return true;
        }

        if (parsed.action === "download") {
          await ctx.answerCbQuery().catch(() => {});
          if (!plan.finalStrategy) {
            await ctx.reply("Стратегия еще не готова").catch(() => {});
            return true;
          }
          const html = generateStrategyHTML(plan.finalStrategy, plan);
          const filePath = `/tmp/strategy-${plan.id}.html`;
          fs.writeFileSync(filePath, html, "utf8");
          await ctx.telegram.sendDocument(
            from.id,
            { source: filePath, filename: `MediaStrategy-${sanitizeFilename(plan.title || plan.id)}.html` },
            { caption: "📄 Экспорт стратегии" }
          );
          fs.unlink(filePath, () => {});
          return true;
        }

        await ctx.answerCbQuery("Неизвестное действие").catch(() => {});
        return true;
      } catch (error) {
        console.error("[mediaplan] callback failed", error);
        const msg = detectFriendlyError(error);
        await ctx.answerCbQuery("Ошибка").catch(() => {});
        await ctx.reply(msg).catch(() => {});
        return true;
      }
    },

    async handleMessage(ctx: Context<Update>): Promise<boolean> {
      const message = ctx.message;
      if (!message || !("chat" in message)) return false;

      try {
        const textRaw = getMessageText(message).trim();

        if (TENDERS_CMD_RE.test(textRaw) || TENDERS_TEXT_RE.test(textRaw)) {
          await handleTendersList(ctx);
          return true;
        }

        const testGroupId = String(process.env.MEDIA_PLAN_TEST_GROUP_ID || "").trim();
        const isTestGroup =
          Boolean(testGroupId) && String(message.chat.id) === testGroupId;

        if (isTestGroup) {
          if (ALLOWED_BRIEF_SENDERS.length > 0 && (!ctx.from || !ALLOWED_BRIEF_SENDERS.includes(ctx.from.id))) {
            return false;
          }

          if (textRaw.startsWith("/")) {
            return false;
          }

          const messageAny = message as Message & { document?: unknown; photo?: unknown };
          const hasDocument = Boolean(messageAny.document) || Boolean(messageAny.photo);
          const isLongEnough = textRaw.length >= MIN_BRIEF_LENGTH;
          if (!hasDocument && !isLongEnough) {
            return false;
          }

          const extracted = await readBriefFromMessageOrReply(ctx, message);
          if (extracted.unsupported) {
            await ctx.reply(MSG_UNSUPPORTED_BRIEF_FILE);
            return true;
          }

          if (extracted.brief) {
            await handleBriefIntake(ctx, extracted.brief);
            return true;
          }
        }

        if (message.chat.type === "private" && ctx.from) {
          const textForTitle = textRaw;
          const pendingPlanId = pendingPlanNameByUser.get(ctx.from.id);
          if (pendingPlanId && textForTitle && !textForTitle.startsWith("/")) {
            const looksLikeClarificationPayload =
              /(?:^|\n)\s*1[)\].:-]\s*/.test(textForTitle) || textForTitle.length > 140;
            if (!looksLikeClarificationPayload) {
              await update(pendingPlanId, { title: textForTitle.slice(0, 100) });
              pendingPlanNameByUser.delete(ctx.from.id);
              await ctx.reply(`✅ Название тендера сохранено: ${textForTitle.slice(0, 100)}`).catch(() => {});
              return true;
            }
          }

          const activePlan = await findActiveByUser(ctx.from.id);
          if (activePlan) {
            if (activePlan.status === "clarifying") {
              const handled = await handleClarificationAnswer(ctx, activePlan);
              if (handled) return true;
            }

            if (activePlan.status === "theories") {
              await handleTheoriesDiscussion(ctx, activePlan);
              return true;
            }

            if (activePlan.status === "summary_editing") {
              const correction = getMessageText(message).trim();
              if (!correction) {
                await ctx.reply("Напиши текстом, что поправить в сводке.").catch(() => {});
                return true;
              }

              const updatedClarifications = [
                ...(activePlan.clarifications || []),
                { question: "Корректировка менеджера", answer: correction },
              ];
              await update(activePlan.id, {
                clarifications: updatedClarifications,
                status: "summary_check",
              });
              await runSummaryCheck(ctx.from.id, activePlan.id, ctx);
              return true;
            }

            if (activePlan.status === "team_tasks" || activePlan.status === "pre_strategy") {
              await handleTeamDataInput(ctx, activePlan);
              return true;
            }
          }
        }

        const cmdMatch = textRaw.match(MP_CMD_RE);
        if (!cmdMatch) return false;

        const inlineBrief = (cmdMatch[1] || "").trim();
        if (inlineBrief) {
          await handleBriefIntake(ctx, inlineBrief);
          return true;
        }

        const extracted = await readBriefFromMessageOrReply(ctx, message);
        if (extracted.unsupported) {
          await ctx.reply(MSG_UNSUPPORTED_BRIEF_FILE);
          return true;
        }

        if (!extracted.brief) {
          await ctx.reply(
            "Отправь бриф после команды `/mediaplan` или перешли PDF/DOCX/TXT файлом.",
            { parse_mode: "Markdown" }
          );
          return true;
        }

        await handleBriefIntake(ctx, extracted.brief);
        return true;
      } catch (error) {
        console.error("[mediaplan] message flow failed", error);
        await ctx.reply(detectFriendlyError(error)).catch(() => {});
        return true;
      }
    },
  };
}
