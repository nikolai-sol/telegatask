import { Telegraf, Context, Markup } from "telegraf";
import type {
  Chat as TelegramChat,
  Message,
  MessageEntity,
  Update,
  User as TelegramUserPayload,
} from "telegraf/typings/core/types/typegram";
import {
  upsertUserFromTelegramPayload,
  upsertUserByUsername,
  getUserById,
} from "../repositories/userRepository";
import {
  upsertChatFromTelegramPayload,
  getChatById,
  getChatByTelegramId,
  listChats,
  setChatCaptureMode,
} from "../repositories/chatRepository";
import {
  createTask,
  getTaskById,
  getTasksByAssignee,
  getTasksByAssigneeIds,
  getTasksByCreator,
  getTasksByChatId,
  getAllTasks,
  getTasksBySourceMessage,
  updateTaskStatus,
  updateTaskPriority,
  updateTaskFollowUp,
} from "../repositories/taskRepository";
import type { TelegramUser } from "../models/telegramUser";
import type { Task } from "../models/task";
import { deleteTask } from "../repositories/taskRepository";
import {
  addKnowledgeEntry,
  listKnowledgeByUser,
  listKnowledgeForSearch,
} from "../repositories/knowledgeRepository";
import {
  listProjectsByChatId,
  listProjectsByTeamId,
  getProjectById,
  attachChatToProject,
} from "../repositories/projectRepository";
import {
  getTeamByChatId,
  createTeam,
  linkChatToTeam,
  getTeamById,
  setRole,
  updatePermissions,
} from "../repositories/teamRepository";
import { setDefaultProjectForChat } from "../repositories/settingsRepository";
import {
  extractTasksWithGemini,
  inferDueDateWithGemini,
  askWithGemini,
} from "../services/gemini";
import {
  listMessagesByChatAndTime,
  upsertChatMessage,
  type ChatMessage,
} from "../repositories/messageRepository";
import { logAction } from "../repositories/actionLogRepository";
import { debugLog, verboseLog } from "../config/debug";
import type { KnowledgeSourceTelegram } from "../models/knowledge";
import { buildTelegramMessageLink, formatSourceFallback } from "../utils/telegramLink";
import { extractFileRefFromMessage } from "../utils/fileRef";
import { startScheduler, stopScheduler } from "../services/scheduler";
import { autoSaveFilesToKnowledge } from "../services/autoSaveFiles";
import { getCommandVariants } from "../config/commands";
import type { TaskPriority } from "../models/task";
import { SkillRouter } from "../core/router";
import { KBService } from "../core/services/kb";
import { LLMService } from "../core/services/llm";
import { TelegramService } from "../core/services/telegram";
import { registerAllSkills } from "../skills/registry";
import {
  pendingKnowledgeForwards,
  handleKnowledgeImportantFollowup,
} from "../legacy/knowledge/handleKnowledge";

let skillRouter: SkillRouter | null = null;

type SortMode = "date" | "project";
type CachedList = {
  assignedOrdered: Task[];
  outbox: Task[];
  mode: SortMode;
};

type ParsePeriod = "today" | "yesterday";

type MentionEntity = MessageEntity.CommonMessageEntity & {
  type: "mention" | "text_mention";
  user?: TelegramUserPayload;
};

let bot: Telegraf<Context<Update>> | null = null;
const userTaskCache = new Map<number, CachedList>();
const pendingForwardTasks = new Map<
  number,
  {
    assignees: TelegramUser[];
    mentionUsernames: string[];
    sourceChatId: string | null;
    sourceChatTitle: string | null;
    createdByUserId: string;
  }
>();
const userLabelCache = new Map<string, string>();

function assertToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }
  return token;
}

function safeLogAction(
  action: Parameters<typeof logAction>[0]["action"],
  params: Omit<Parameters<typeof logAction>[0], "action">
): void {
  logAction({ action, ...params }).catch((err) =>
    console.error("[actionLog] failed to log", action, err)
  );
}

const STOP_WORDS = new Set(["и", "в", "на", "с", "по", "для", "из", "к", "о", "у", "это", "что", "как", "the", "a", "an", "is", "are", "of", "to", "in"]);

function extractSearchKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\wа-яё\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function getMessageText(message?: Message): string | null {
  if (!message) {
    return null;
  }
  if ("text" in message && message.text) {
    return message.text;
  }
  if ("caption" in message && message.caption) {
    return message.caption;
  }
  return null;
}

function truncateTitle(text: string): string {
  return text.length > 80 ? text.slice(0, 80) : text;
}

function setTime(date: Date, hours: number, minutes: number = 0): Date {
  const copy = new Date(date);
  copy.setHours(hours, minutes, 0, 0);
  return copy;
}

function nextWeekday(targetDay: number): Date {
  const now = new Date();
  const currentDay = now.getDay(); // 0 (Sun) - 6 (Sat)
  let daysAhead = targetDay - currentDay;
  if (daysAhead <= 0) {
    daysAhead += 7;
  }
  const result = new Date(now);
  result.setDate(now.getDate() + daysAhead);
  return result;
}

function parseDueDate(text: string): string | null {
  if (!text) return null;

  const lower = text.toLowerCase();
  const now = new Date();

  // "через пару часов" или "через X час/часа/часов"
  const hoursMatch = lower.match(/через\s+(пару|две|два|\d+)\s+час/);
  if (hoursMatch) {
    const value = hoursMatch[1];
    const hours =
      value === "пару" || value === "две" || value === "два"
        ? 2
        : parseInt(value, 10);
    const date = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return date.toISOString();
  }

  // "в среду", "в понедельник" и т.п.
  const weekdays: Record<string, number> = {
    понедельник: 1,
    вторник: 2,
    среду: 3,
    среда: 3,
    четверг: 4,
    пятницу: 5,
    пятница: 5,
    субботу: 6,
    суббота: 6,
    воскресенье: 0,
    воскресеньея: 0,
    воскресеньеь: 0,
    воскресеньеё: 0,
    воскресеньею: 0,
    воскресеньеяь: 0,
    воскресеньеяё: 0,
  };

  const weekdayMatch = lower.match(
    /\b(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресень[еия])\b/,
  );

  const hasMorning = lower.includes("утром") || lower.includes("с утра");

  let baseDate: Date | null = null;

  if (weekdayMatch) {
    const dayWord = weekdayMatch[1];
    const targetDay = weekdays[dayWord];
    if (typeof targetDay === "number") {
      baseDate = nextWeekday(targetDay);
    }
  } else if (lower.includes("завтра")) {
    baseDate = new Date(now);
    baseDate.setDate(now.getDate() + 1);
  }

  // Время: "в 15", "в 15:30", "в 15 часов/часа", с пометками утра/вечера/дня
  const timeMatch = lower.match(
    /в\s+(\d{1,2})(?::(\d{2}))?(?:\s*час[аов]?)?(?:\s*(утра|вечера|ночи|дня))?/,
  );

  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3];

    if (meridiem === "вечера" || meridiem === "ночи" || meridiem === "дня") {
      if (hour < 12) {
        hour += 12;
      }
    }

    if (baseDate) {
      const withTime = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate(),
        hour,
        minute,
        0,
        0
      );
      return withTime.toISOString();
    }
  }

  if (baseDate) {
    // Если есть день, но нет времени — ставим 10:00
    const morning = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      10,
      0,
      0,
      0
    );
    return morning.toISOString();
  }

  // "утром" без дня -> завтра утром
  if (hasMorning) {
    const date = new Date(now);
    date.setDate(now.getDate() + 1);
    const morning = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      10,
      0,
      0,
      0
    );
    return morning.toISOString();
  }

  return null;
}

async function resolveDueDate(text: string): Promise<string | null> {
  if (!text) {
    return null;
  }

  const parsed = parseDueDate(text);
  if (parsed) {
    return parsed;
  }

  return inferDueDateWithGemini(text, new Date());
}

function getMessageEntities(message?: Message): MessageEntity[] | undefined {
  if (!message) {
    return undefined;
  }
  if ("entities" in message && message.entities) {
    return message.entities;
  }
  if ("caption_entities" in message && message.caption_entities) {
    return message.caption_entities;
  }
  return undefined;
}

function containsBotMention(
  mentions: { mentionText: string }[],
  botUsername?: string
): boolean {
  if (!botUsername) {
    return false;
  }
  const botHandle = `@${botUsername}`.toLowerCase();
  return mentions.some((m) => m.mentionText.toLowerCase() === botHandle);
}

function looksLikeTaskText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\bзадач[аеи]?\b/.test(lower) ||
    /\bнужно\b/.test(lower) ||
    /\bсделай\b/.test(lower)
  );
}

function getPeriodRange(period: ParsePeriod): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (period === "yesterday") {
    start.setDate(start.getDate() - 1);
  }

  if (period === "today") {
    end.setDate(start.getDate() + 1);
  } else {
    end.setDate(start.getDate() + 1);
  }

  return { start, end };
}

function buildChatSelectionKeyboard(chats: { id: string; title: string }[], period: ParsePeriod) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  const maxChats = 12;
  const trimmed = chats.slice(0, maxChats);

  for (let i = 0; i < trimmed.length; i += 2) {
    const row: ReturnType<typeof Markup.button.callback>[] = [];
    const first = trimmed[i];
    const second = trimmed[i + 1];
    row.push(
      Markup.button.callback(
        first.title || "Без названия",
        `parse:${period}:${first.id}`
      )
    );
    if (second) {
      row.push(
        Markup.button.callback(
          second.title || "Без названия",
          `parse:${period}:${second.id}`
        )
      );
    }
    rows.push(row);
  }

  return Markup.inlineKeyboard(rows);
}

function getPeriodLabel(period: ParsePeriod): string {
  return period === "today" ? "сегодня" : "вчера";
}

type ParsedTaskCandidate = {
  messageId: number;
  description: string;
  assignees: string[];
  dueDate: string | null;
};

async function extractTasksFromMessages(
  messages: ChatMessage[],
  botUsername?: string
): Promise<ParsedTaskCandidate[]> {
  const now = new Date();
  const geminiInput = messages.map((msg) => ({
    messageId: msg.messageId,
    fromUsername: msg.fromUsername,
    fromDisplayName: msg.fromDisplayName,
    text: msg.text,
  }));

  const geminiTasks = await extractTasksWithGemini(geminiInput, now);
  if (geminiTasks && geminiTasks.length) {
    return geminiTasks
      .filter((task) => typeof task.messageId === "number")
      .map((task) => ({
        messageId: task.messageId,
        description: task.description || "",
        assignees: (task.assignees || []).map((name) =>
          name.replace(/^@/, "")
        ),
        dueDate: task.dueDate ? parseDate(task.dueDate)?.toISOString() ?? null : null,
      }));
  }

  const botHandle = botUsername ? `@${botUsername}`.toLowerCase() : null;
  const fallback: ParsedTaskCandidate[] = [];

  messages.forEach((msg) => {
    if (!msg.text || msg.text.trim().startsWith("/")) {
      return;
    }

    const hasMentions = msg.mentionUsernames.length > 0;
    if (!hasMentions && !looksLikeTaskText(msg.text)) {
      return;
    }

    const assignees = msg.mentionUsernames.filter((name) => {
      if (!botHandle) return true;
      return `@${name}`.toLowerCase() !== botHandle;
    });

    fallback.push({
      messageId: msg.messageId,
      description: msg.text.trim(),
      assignees,
      dueDate: parseDueDate(msg.text),
    });
  });

  return fallback;
}

function logIncomingMessage(ctx: Context<Update>): void {
  const message = ctx.message;

  if (!message || !("chat" in message)) {
    return;
  }

  const text = getMessageText(message);

  verboseLog("[bot] incoming", {
    chatId: message.chat.id,
    chatType: message.chat.type,
    from: ctx.from?.id ?? null,
    text: text ? text.slice(0, 200) : null,
  });
}

async function storeIncomingMessage(ctx: Context<Update>): Promise<void> {
  const message = ctx.message;
  if (!message || !("chat" in message)) {
    return;
  }

  if (message.chat.type !== "group" && message.chat.type !== "supergroup") {
    return;
  }

  if (!ctx.from) {
    return;
  }

  const text = getMessageText(message);
  if (!text) {
    return;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const chat = await upsertChatFromTelegramPayload({
      id: message.chat.id,
      title: "title" in message.chat ? message.chat.title : undefined,
      type: message.chat.type,
    });

    const entities = getMessageEntities(message);
    const mentions = extractMentions(text, entities);
    const mentionUsernames = mentions
      .map((m) => m.mentionText.replace(/^@/, ""))
      .filter(Boolean);

    const createdAt = new Date(message.date * 1000).toISOString();

    await upsertChatMessage({
      telegramChatId: message.chat.id,
      messageId: message.message_id,
      chatTitle: chat.title,
      fromUserId: user.id,
      fromUsername: user.username ?? null,
      fromDisplayName: user.displayName,
      text,
      mentionUsernames,
      createdAt,
    });
  } catch (error) {
    console.error("Failed to store incoming message", error);
  }
}

function formatUserLabel(user: TelegramUser): string {
  return user.username ? `@${user.username}` : user.displayName;
}

async function resolveUserLabel(userId: string | null): Promise<string> {
  if (!userId) {
    return "—";
  }

  const cached = userLabelCache.get(userId);
  if (cached) {
    return cached;
  }

  const user = await getUserById(userId);
  const label = user ? formatUserLabel(user) : userId;
  userLabelCache.set(userId, label);
  return label;
}

function formatUsername(username?: string): string | null {
  return username ? `@${username}` : null;
}

function getChatTitle(chat?: TelegramChat | null): string | null {
  if (chat && "title" in chat && chat.title) {
    return chat.title;
  }
  return null;
}

function buildMainMenuKeyboard() {
  return Markup.keyboard([
    ["/task", "/l"],
    ["/my", "/outbox"],
    ["/my_today", "/my_overdue"],
    ["/chat_tasks", "/all_tasks"],
    ["/parse_today", "/parse_yesterday"],
    ["/priority", "/wait"],
    ["/chats"],
    ["/k"],
    ["/ksearch", "/ask"],
    ["/done", "/del"],
    ["/status"],
    ["/info"],
  ]).resize();
}

async function sendMainMenu(ctx: Context<Update>): Promise<void> {
  const message = ctx.message;
  if (message && "chat" in message && message.chat.type === "private") {
    await ctx.reply("Выберите действие:", buildMainMenuKeyboard());
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function isToday(date: Date, now: Date): boolean {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  const copy = [...tasks];
  if (mode === "project") {
    return copy.sort((a, b) => {
      const titleA = (a.sourceChatTitle || "").toLowerCase();
      const titleB = (b.sourceChatTitle || "").toLowerCase();
      if (titleA === titleB) {
        const dueA = parseDate(a.dueDate);
        const dueB = parseDate(b.dueDate);
        if (dueA && dueB) return dueA.getTime() - dueB.getTime();
        if (dueA) return -1;
        if (dueB) return 1;
        return (a.createdAt || "").localeCompare(b.createdAt || "");
      }
      return titleA.localeCompare(titleB);
    });
  }

  // default: date
  return copy.sort((a, b) => {
    const dueA = parseDate(a.dueDate);
    const dueB = parseDate(b.dueDate);
    if (dueA && dueB) return dueA.getTime() - dueB.getTime();
    if (dueA) return -1;
    if (dueB) return 1;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

function formatDueLabel(dueDate?: string | null): string {
  if (!dueDate) return "";
  const d = parseDate(dueDate);
  if (!d) return "";
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return ` (до ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())})`;
}

function formatTaskList(
  tasks: Task[],
  heading: string,
  mode: SortMode = "date"
): { text: string; ordered: Task[] } {
  if (!tasks.length) {
    return { text: `${heading}: нет активных задач.`, ordered: [] };
  }

  const ordered = sortTasks(tasks, mode);
  const lines = ordered.map((t, idx) => {
    const desc =
      t.description && t.description.length > 120
        ? `${t.description.slice(0, 120)}…`
        : t.description;
    const dueLabel = formatDueLabel(t.dueDate);
    return `${idx + 1}. [${t.status}]${dueLabel} ${desc} (id=${t.id})`;
  });

  return {
    text: `${heading}\n${lines.join("\n")}`,
    ordered,
  };
}

async function formatTaskFlowList(
  tasks: Task[],
  heading: string,
  includeChat: boolean = false
): Promise<string> {
  if (!tasks.length) {
    return `${heading}: нет активных задач.`;
  }

  const ordered = sortTasks(tasks, "date");
  const lines: string[] = [];

  for (let idx = 0; idx < ordered.length; idx += 1) {
    const task = ordered[idx];
    const fromLabel = await resolveUserLabel(task.createdByUserId);
    const toLabel = await resolveUserLabel(task.assignedUserId ?? null);
    const dueLabel = formatDueLabel(task.dueDate);
    const desc =
      task.description && task.description.length > 120
        ? `${task.description.slice(0, 120)}…`
        : task.description || "(без описания)";
    const chatLabel =
      includeChat && task.sourceChatTitle
        ? ` [${task.sourceChatTitle}]`
        : "";

    lines.push(
      `${idx + 1}. [${task.status}]${dueLabel} ${fromLabel} → ${toLabel}${chatLabel}: ${desc} (id=${task.id})`
    );
  }

  return `${heading}\n${lines.join("\n")}`;
}

function summarizeTasks(
  assigned: Task[],
  outbox: Task[],
  mode: SortMode
): { text: string; orderedAssigned: Task[] } {
  const now = new Date();
  const orderedAssigned = sortTasks(assigned, mode);
  const orderedOutbox = sortTasks(outbox, mode);

  const overdue: Task[] = [];
  const today: Task[] = [];
  const rest: Task[] = [];

  orderedAssigned.forEach((t) => {
    const due = parseDate(t.dueDate);
    if (due) {
      if (due.getTime() < now.getTime() && t.status !== "done") {
        overdue.push(t);
      } else if (isToday(due, now)) {
        today.push(t);
      } else {
        rest.push(t);
      }
    } else {
      rest.push(t);
    }
  });

  let idx = 1;
  const formatLine = (t: Task): string => {
    const desc =
      t.description && t.description.length > 120
        ? `${t.description.slice(0, 120)}…`
        : t.description;
    const dueLabel = formatDueLabel(t.dueDate);
    return `${idx++}. [${t.status}]${dueLabel} ${desc} (id=${t.id})`;
  };

  const assignedParts: string[] = [];
  if (overdue.length) {
    assignedParts.push("⚠️ Мне: просроченные");
    overdue.forEach((t) => assignedParts.push(formatLine(t)));
  }
  if (today.length) {
    assignedParts.push("📅 Мне: сегодня");
    today.forEach((t) => assignedParts.push(formatLine(t)));
  }
  if (rest.length) {
    assignedParts.push("🗂️ Мне: остальные");
    rest.forEach((t) => assignedParts.push(formatLine(t)));
  }

  const outOverdue: Task[] = [];
  const outToday: Task[] = [];
  const outRest: Task[] = [];

  orderedOutbox.forEach((t) => {
    const due = parseDate(t.dueDate);
    if (due) {
      if (due.getTime() < now.getTime() && t.status !== "done") {
        outOverdue.push(t);
      } else if (isToday(due, now)) {
        outToday.push(t);
      } else {
        outRest.push(t);
      }
    } else {
      outRest.push(t);
    }
  });

  const formatOutbox = (t: Task): string => {
    const desc =
      t.description && t.description.length > 120
        ? `${t.description.slice(0, 120)}…`
        : t.description;
    const dueLabel = formatDueLabel(t.dueDate);
    return `- [${t.status}]${dueLabel} ${desc} (id=${t.id})`;
  };

  const outboxParts: string[] = [];
  if (outOverdue.length) {
    outboxParts.push("⚠️ Я поставил: просроченные");
    outOverdue.forEach((t) => outboxParts.push(formatOutbox(t)));
  }
  if (outToday.length) {
    outboxParts.push("📅 Я поставил: сегодня");
    outToday.forEach((t) => outboxParts.push(formatOutbox(t)));
  }
  if (outRest.length) {
    outboxParts.push("🗂️ Я поставил: остальные");
    outRest.forEach((t) => outboxParts.push(formatOutbox(t)));
  }

  const sections = [];
  if (assignedParts.length) sections.push(assignedParts.join("\n"));
  if (outboxParts.length) sections.push(outboxParts.join("\n"));
  if (!sections.length) {
    sections.push("У вас нет активных задач.");
  }

  return {
    text: sections.join("\n\n"),
    orderedAssigned,
  };
}

function buildListSortKeyboard(mode: SortMode) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        mode === "date" ? "✅ По дате" : "По дате",
        "sort_date"
      ),
      Markup.button.callback(
        mode === "project" ? "✅ По проекту" : "По проекту",
        "sort_project"
      ),
    ],
  ]);
}

/** Извлечь task id из строк вида (id=xxx) */
function extractTaskIdsFromText(text: string): string[] {
  const ids: string[] = [];
  const re = /\(id=([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) ids.push(m[1]);
  return ids;
}

/** Клавиатура: кнопки Выполнено/Удалить для задач + сортировка (макс 20 задач) */
function buildTaskListWithActionsKeyboard(
  taskIds: string[],
  sortMode: SortMode
) {
  const MAX_TASKS = 20;
  const ids = taskIds.slice(0, MAX_TASKS);
  const rows: any[][] = [];

  // Mini App button (if configured)
  const miniAppUrl = process.env.MINI_APP_URL;
  if (miniAppUrl) {
    rows.push([{ text: "📋 Открыть менеджер задач", web_app: { url: miniAppUrl } }]);
  }

  for (const id of ids) {
    rows.push([
      Markup.button.callback("✅ Выполнено", `task:done:${id}`),
      Markup.button.callback("🗑 Удалить", `task:del:${id}`),
    ]);
  }

  rows.push([
    Markup.button.callback(
      sortMode === "date" ? "✅ По дате" : "По дате",
      "sort_date"
    ),
    Markup.button.callback(
      sortMode === "project" ? "✅ По проекту" : "По проекту",
      "sort_project"
    ),
  ]);
  return Markup.inlineKeyboard(rows);
}

async function handleStart(ctx: Context<Update>): Promise<void> {
  const helpText =
    "👋 <b>Привет! Я — ваш ассистент по задачам.</b>\n\n" +
    "Что я умею:\n" +
    "📋 Создавать и отслеживать задачи\n" +
    "🔍 Автоматически сканировать чаты каждые 30 мин\n" +
    "🔔 Напоминать о дедлайнах\n" +
    "📋 Follow-up: кто не ответил\n" +
    "💬 Напоминать о неотвеченных mentions\n" +
    "☀️ Утренний бриф / 🌙 Вечерний дайджест\n" +
    "📚 База знаний + RAG-ответы\n\n" +
    "<b>Быстрый старт:</b>\n" +
    "В группе: /t @user задача или /scan_on для авто-сканирования\n" +
    "В личке: перешли сообщение или /task\n\n" +
    "/info — полный список команд";

  await ctx.reply(helpText, { parse_mode: "HTML" });
  await sendMainMenu(ctx);
}

function isTCommandMessage(
  message: Message
): { text: string; entities?: MessageEntity[] } | null {
  if ("text" in message && message.text) {
    const text = message.text.trim();
    if (/^\/t\b/i.test(text)) {
      return { text, entities: (message as Message.TextMessage).entities };
    }
  }
  return null;
}

function isCommand(text: string, nameOrNames: string | string[]): boolean {
  const names =
    Array.isArray(nameOrNames)
      ? nameOrNames
      : getCommandVariants(nameOrNames);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // \b не работает с кириллицей — используем (?:\s|$) для границы команды
  const pattern = new RegExp(`^/(${escaped})(?:@\\S+)?(?:\\s|$)`, "i");
  return pattern.test(text.trim());
}

function extractMentions(
  text: string | null,
  entities?: MessageEntity[]
): { entity: MentionEntity; mentionText: string }[] {
  const mentions: { entity: MentionEntity; mentionText: string }[] = [];

  if (text && entities && entities.length) {
    entities.forEach((entity) => {
      if (
        entity.type === "mention" ||
        entity.type === "text_mention"
      ) {
        const mentionEntity = entity as MentionEntity;
        const mentionText = text.substring(
          mentionEntity.offset,
          mentionEntity.offset + mentionEntity.length
        );
        mentions.push({ entity: mentionEntity, mentionText });
      }
    });
  }

  if (text && mentions.length === 0) {
    const regex = /@\w+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const mentionText = match[0];
      const entity: MentionEntity = {
        type: "mention",
        offset: match.index ?? 0,
        length: mentionText.length,
      } as MentionEntity;
      mentions.push({ entity, mentionText });
    }
  }

  // Уникализируем по тексту упоминания
  const unique = new Map<string, { entity: MentionEntity; mentionText: string }>();
  mentions.forEach((m) => {
    const key = m.mentionText.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, m);
    }
  });

  return Array.from(unique.values());
}

function stripCommandAndMentions(
  text: string,
  mentionTexts: string[],
  commandPattern: RegExp = /^\/t(?:@\S+)?\s*/i
): string {
  let result = text.replace(commandPattern, "");
  mentionTexts.forEach((m) => {
    result = result.replace(m, "");
  });
  return result.trim();
}

function stripMentions(text: string, mentionTexts: string[]): string {
  let result = text;
  mentionTexts.forEach((m) => {
    result = result.replace(m, "");
  });
  return result.trim();
}

async function resolveMentionedUser(
  _ctx: Context<Update>,
  mention: MentionEntity,
  mentionText: string
): Promise<{
  username?: string;
  user: TelegramUser | null;
}> {
  if (mention.user) {
    const user = await upsertUserFromTelegramPayload({
      id: mention.user.id,
      username: mention.user.username ?? undefined,
      first_name: mention.user.first_name ?? undefined,
      last_name: mention.user.last_name ?? undefined,
    });

    return { username: user.username ?? undefined, user };
  }

  const username = mentionText.replace(/^@/, "");
  const user = await upsertUserByUsername(username);
  return { username: user.username ?? username, user };
}

async function handleChatCommand(ctx: Context<Update>): Promise<void> {
  const message = ctx.message;

  if (!message || !("chat" in message) || message.chat.type === "private") {
    return;
  }

  const command = isTCommandMessage(message);
  if (!command) {
    return;
  }

  const chatType = message.chat.type;
  if (chatType !== "group" && chatType !== "supergroup") {
    return;
  }

  if (!ctx.from) {
    return;
  }

  try {
    debugLog("[bot] /t command message", {
      chatId: message.chat.id,
      chatType,
      from: ctx.from.id,
      text: command.text,
    });

    const createdByUser = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const chat = await upsertChatFromTelegramPayload({
      id: message.chat.id,
      title: "title" in message.chat ? message.chat.title : undefined,
      type: chatType,
    });

    const mentions = extractMentions(command.text, command.entities);
    const resolvedAssignees: TelegramUser[] = [];
    const mentionUsernames: string[] = [];

    for (const mention of mentions) {
      const resolved = await resolveMentionedUser(
        ctx,
        mention.entity,
        mention.mentionText
      );
      if (resolved.user) {
        resolvedAssignees.push(resolved.user);
      }
      if (resolved.username) {
        mentionUsernames.push(resolved.username);
      }
    }

    const repliedMessage = "reply_to_message" in message
      ? message.reply_to_message
      : undefined;

    const replyText = getMessageText(repliedMessage);
    const description = replyText
      ? replyText.trim()
      : stripCommandAndMentions(
          command.text,
          mentions.map((m) => m.mentionText)
        );

    const title = "";
    const dueDate = await resolveDueDate(description);

    const tasks = [];
    if (resolvedAssignees.length > 0) {
      for (const assignee of resolvedAssignees) {
        const task = await createTask({
          sourceType: "chat_command",
          sourceChatId: chat.id,
          sourceChatTitle: "title" in message.chat ? message.chat.title ?? null : null,
          sourceMessageId: repliedMessage?.message_id ?? message.message_id,
          createdByUserId: createdByUser.id,
          assignedUserId: assignee.id,
          title,
          description,
          status: "new",
          dueDate,
        });
        tasks.push(task);
      }
    } else {
      const task = await createTask({
        sourceType: "chat_command",
        sourceChatId: chat.id,
        sourceChatTitle: "title" in message.chat ? message.chat.title ?? null : null,
        sourceMessageId: repliedMessage?.message_id ?? message.message_id,
        createdByUserId: createdByUser.id,
        assignedUserId: null,
        title,
        description,
        status: "incoming",
        dueDate,
      });
      tasks.push(task);
    }

    console.log("Created task(s) from /t command", tasks);
    tasks.forEach((t) =>
      safeLogAction("task_created", {
        userId: createdByUser.id,
        targetId: t.id,
        targetType: "task",
        payload: { assignedUserId: t.assignedUserId, sourceType: t.sourceType },
      })
    );

    const createdByLabel = formatUserLabel(createdByUser);
    if (resolvedAssignees.length > 0) {
      const assigneesList = resolvedAssignees
        .map((u) => formatUserLabel(u))
        .join(", ");
      await ctx.reply(
        `Принял задачу от ${createdByLabel} и поставил её: ${assigneesList}`
      );
    } else if (mentionUsernames.length > 0) {
      const mentionsList = mentionUsernames
        .map((u) => formatUsername(u))
        .filter(Boolean)
        .join(", ");
      await ctx.reply(
        `Принял задачу от ${createdByLabel}. Не смог назначить ${mentionsList}, добавил во входящие`
      );
    } else {
      await ctx.reply(
        `Принял задачу от ${createdByLabel} и добавил её во входящие`
      );
    }
  } catch (error) {
    console.error("Failed to handle /t command", error);
  }
}

async function handleAutoTaskFromChat(ctx: Context<Update>): Promise<void> {
  const message = ctx.message;

  if (!message || !("chat" in message)) {
    return;
  }

  if (message.chat.type === "private") {
    return;
  }

  if (!ctx.from) {
    return;
  }

  if (ctx.botInfo && ctx.from.id === ctx.botInfo.id) {
    return;
  }

  const text = getMessageText(message);
  if (!text) {
    return;
  }

  if (text.trim().startsWith("/")) {
    return;
  }

  const entities = getMessageEntities(message);
  const mentions = extractMentions(text, entities);
  const botUsername = ctx.botInfo?.username;
  const botHandle = botUsername ? `@${botUsername}`.toLowerCase() : null;
  const botMentioned = containsBotMention(mentions, botUsername);
  const keywordTriggered = looksLikeTaskText(text);

  if (!botMentioned && !keywordTriggered) {
    return;
  }

  try {
    const createdByUser = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const chat = await upsertChatFromTelegramPayload({
      id: message.chat.id,
      title: "title" in message.chat ? message.chat.title : undefined,
      type: message.chat.type,
    });

    const assigneeMentions = botHandle
      ? mentions.filter((m) => m.mentionText.toLowerCase() !== botHandle)
      : mentions;

    const resolvedAssignees: TelegramUser[] = [];
    const mentionUsernames: string[] = [];

    for (const mention of assigneeMentions) {
      const resolved = await resolveMentionedUser(
        ctx,
        mention.entity,
        mention.mentionText
      );
      if (resolved.user) {
        resolvedAssignees.push(resolved.user);
      }
      if (resolved.username) {
        mentionUsernames.push(resolved.username);
      }
    }

    const repliedMessage = "reply_to_message" in message
      ? message.reply_to_message
      : undefined;
    const replyText = getMessageText(repliedMessage);

    const description = replyText
      ? replyText.trim()
      : stripMentions(text, mentions.map((m) => m.mentionText));

    if (!description) {
      return;
    }

    const dueDate = await resolveDueDate(description);
    const tasks = [];

    if (resolvedAssignees.length > 0) {
      for (const assignee of resolvedAssignees) {
        const task = await createTask({
          sourceType: "chat_auto",
          sourceChatId: chat.id,
          sourceChatTitle: chat.title,
          sourceMessageId: repliedMessage?.message_id ?? message.message_id,
          createdByUserId: createdByUser.id,
          assignedUserId: assignee.id,
          title: "",
          description,
          status: "new",
          dueDate,
        });
        tasks.push(task);
      }
    } else {
      const task = await createTask({
        sourceType: "chat_auto",
        sourceChatId: chat.id,
        sourceChatTitle: chat.title,
        sourceMessageId: repliedMessage?.message_id ?? message.message_id,
        createdByUserId: createdByUser.id,
        assignedUserId: null,
        title: "",
        description,
        status: "incoming",
        dueDate,
      });
      tasks.push(task);
    }

    console.log("Created task(s) from chat auto trigger", tasks);
    tasks.forEach((t) =>
      safeLogAction("task_created", {
        userId: createdByUser.id,
        targetId: t.id,
        targetType: "task",
        payload: { assignedUserId: t.assignedUserId, sourceType: t.sourceType },
      })
    );

    const createdByLabel = formatUserLabel(createdByUser);
    if (resolvedAssignees.length > 0) {
      const assigneesList = resolvedAssignees
        .map((u) => formatUserLabel(u))
        .join(", ");
      await ctx.reply(
        `Принял задачу от ${createdByLabel} и поставил её: ${assigneesList}`
      );
    } else if (mentionUsernames.length > 0) {
      const mentionsList = mentionUsernames
        .map((u) => formatUsername(u))
        .filter(Boolean)
        .join(", ");
      await ctx.reply(
        `Принял задачу от ${createdByLabel}. Не смог назначить ${mentionsList}, добавил во входящие`
      );
    } else {
      await ctx.reply(
        `Принял задачу от ${createdByLabel} и добавил её во входящие`
      );
    }
  } catch (error) {
    console.error("Failed to handle auto task", error);
  }
}

async function handleForwardedMessage(ctx: Context<Update>): Promise<void> {
  const message = ctx.message;

  if (!message || !("chat" in message) || message.chat.type !== "private") {
    return;
  }

  if (!("forward_from" in message) && !("forward_from_chat" in message)) {
    return;
  }

  const forwardedMessage = message as Message & {
    forward_from?: TelegramUserPayload;
    forward_from_chat?: TelegramChat;
    forward_from_message_id?: number;
    entities?: MessageEntity[];
    caption_entities?: MessageEntity[];
  };

  const forwardFromChat = forwardedMessage.forward_from_chat ?? null;

  const hasForwardUser = Boolean(forwardedMessage.forward_from);

  if (!hasForwardUser && !forwardFromChat) {
    return;
  }

  const text = getMessageText(message);
  const fileRef = extractFileRefFromMessage(forwardedMessage);
  const normalizedText = (text ?? "").trim();
  const commandMatch = normalizedText.match(/^\/(\w+)/);

  if (!ctx.from) {
    return;
  }

  try {
    debugLog("[bot] forward detected", {
      from: ctx.from.id,
      hasForwardUser,
      forwardFromChatId: forwardFromChat?.id ?? null,
      text: normalizedText,
      hasFileRef: Boolean(fileRef),
    });

    const author = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    let sourceChatId: string | null = null;
    let sourceChatTitle: string | null = null;

    if (forwardFromChat) {
      const chat = await upsertChatFromTelegramPayload({
        id: forwardFromChat.id,
        title: "title" in forwardFromChat ? forwardFromChat.title : undefined,
        type: forwardFromChat.type,
      });
      sourceChatId = chat.id;
      sourceChatTitle = chat.title;
    }

    const entities =
      forwardedMessage.entities ||
      forwardedMessage.caption_entities ||
      [];

    const pending = pendingForwardTasks.get(ctx.from.id);
    const isCommandT = commandMatch?.[1]?.toLowerCase() === "t";

    pendingKnowledgeForwards.set(ctx.from.id, {
      content: normalizedText,
      sourceChatId,
      sourceChatTitle: sourceChatTitle ?? getChatTitle(forwardFromChat),
      sourceMessageId: forwardedMessage.forward_from_message_id ?? null,
      fileRef,
    });

    if (!normalizedText) {
      if (fileRef) {
        await ctx.reply("Файл получен. Отправьте /k или /k! чтобы сохранить его в базу знаний.");
      }
      return;
    }

    // Если есть отложенное назначение и новое сообщение не команда /t — используем его как описание
    if (pending && !isCommandT) {
      const mentions = extractMentions(text, entities);
      const combinedAssignees = [...pending.assignees];
      const combinedUsernames = [...pending.mentionUsernames];

      for (const mention of mentions) {
        const resolved = await resolveMentionedUser(
          ctx,
          mention.entity,
          mention.mentionText
        );
        if (resolved.user && !combinedAssignees.find((u) => u.id === resolved.user!.id)) {
          combinedAssignees.push(resolved.user);
        }
        if (resolved.username && !combinedUsernames.includes(resolved.username)) {
          combinedUsernames.push(resolved.username);
        }
      }

      const description = normalizedText;
      const title = "";
      const dueDate = await resolveDueDate(description);

      const tasks = [];
      if (combinedAssignees.length > 0) {
        for (const assignee of combinedAssignees) {
          const task = await createTask({
            sourceType: "forward",
            sourceChatId: pending.sourceChatId,
            sourceChatTitle: pending.sourceChatTitle,
            sourceMessageId: forwardedMessage.forward_from_message_id ?? null,
            createdByUserId: pending.createdByUserId,
            assignedUserId: assignee.id,
            title,
            description,
            status: "new",
            dueDate,
          });
          tasks.push(task);
        }
      } else {
        const task = await createTask({
          sourceType: "forward",
          sourceChatId: pending.sourceChatId,
          sourceChatTitle: pending.sourceChatTitle,
          sourceMessageId: forwardedMessage.forward_from_message_id ?? null,
          createdByUserId: pending.createdByUserId,
          assignedUserId: null,
          title,
          description,
          status: "incoming",
          dueDate,
        });
        tasks.push(task);
      }

      pendingForwardTasks.delete(ctx.from.id);
      pendingKnowledgeForwards.delete(ctx.from.id);
      console.log("Created task(s) from pending forward", tasks);
      tasks.forEach((t) =>
        safeLogAction("task_created", {
          userId: pending.createdByUserId,
          targetId: t.id,
          targetType: "task",
          payload: { assignedUserId: t.assignedUserId, sourceType: "forward" },
        })
      );

      if (combinedAssignees.length > 0) {
        const assigneesList = combinedAssignees
          .map((u) => formatUserLabel(u))
          .join(", ");
        await ctx.reply(`Создал задачу для: ${assigneesList}`);
      } else if (combinedUsernames.length > 0) {
        const mentionsList = combinedUsernames
          .map((u) => formatUsername(u))
          .filter(Boolean)
          .join(", ");
        await ctx.reply(
          `Добавил во входящие, не смог назначить ${mentionsList}`
        );
      } else {
        await ctx.reply("Добавил во входящие без ответственного");
      }

      return;
    }

    // Если в тексте есть команда (кроме /t), не создаём задачи из форварда
    if (commandMatch && commandMatch[1].toLowerCase() !== "t") {
      return;
    }

    const mentions = extractMentions(normalizedText, entities);
    const shouldCreateTask =
      isCommandT || mentions.length > 0 || looksLikeTaskText(normalizedText);

    if (!shouldCreateTask) {
      await ctx.reply(
        "Похоже на материал для базы знаний. Напишите \"это важно\" или используйте /k, либо /t чтобы сделать задачу."
      );
      return;
    }
    const resolvedAssignees: TelegramUser[] = [];
    const mentionUsernames: string[] = [];

    for (const mention of mentions) {
      const resolved = await resolveMentionedUser(
        ctx,
        mention.entity,
        mention.mentionText
      );
      if (resolved.user) {
        resolvedAssignees.push(resolved.user);
      }
      if (resolved.username) {
        mentionUsernames.push(resolved.username);
      }
    }

    const description = normalizedText;
    const title = "";
    const dueDate = await resolveDueDate(description);

    const tasks = [];
    if (resolvedAssignees.length > 0) {
      // Если это /t и нет описания кроме команды — ждём следующее сообщение как текст задачи
      const stripped = stripCommandAndMentions(
        normalizedText,
        mentions.map((m) => m.mentionText)
      );

      if (isCommandT && !stripped) {
        pendingForwardTasks.set(ctx.from.id, {
          assignees: resolvedAssignees,
          mentionUsernames,
          sourceChatId,
          sourceChatTitle,
          createdByUserId: author.id,
        });
        await ctx.reply(
          "Принял исполнителей из форварда, пришли текст задачи следующим сообщением."
        );
        return;
      }

      for (const assignee of resolvedAssignees) {
        const task = await createTask({
          sourceType: "forward",
          sourceChatId,
          sourceChatTitle,
          sourceMessageId: forwardedMessage.forward_from_message_id ?? null,
          createdByUserId: author.id,
          assignedUserId: assignee.id,
          title,
          description,
          status: "new",
          dueDate,
        });
        tasks.push(task);
      }
    } else {
      const task = await createTask({
        sourceType: "forward",
        sourceChatId,
        sourceChatTitle,
        sourceMessageId: forwardedMessage.forward_from_message_id ?? null,
        createdByUserId: author.id,
        assignedUserId: null,
        title,
        description,
        status: "incoming",
        dueDate,
      });
      tasks.push(task);
    }

    console.log("Created task(s) from forward", tasks);
    tasks.forEach((t) =>
      safeLogAction("task_created", {
        userId: author.id,
        targetId: t.id,
        targetType: "task",
        payload: { assignedUserId: t.assignedUserId, sourceType: "forward" },
      })
    );
    pendingKnowledgeForwards.delete(ctx.from.id);

    if (resolvedAssignees.length > 0) {
      const assigneesList = resolvedAssignees
        .map((u) => formatUserLabel(u))
        .join(", ");
      await ctx.reply(`Создал задачу для: ${assigneesList}`);
    } else if (mentionUsernames.length > 0) {
      const mentionsList = mentionUsernames
        .map((u) => formatUsername(u))
        .filter(Boolean)
        .join(", ");
      await ctx.reply(
        `Добавил во входящие, не смог назначить ${mentionsList}`
      );
    } else {
      await ctx.reply("Добавил во входящие без ответственного");
    }
  } catch (error) {
    console.error("Failed to handle forwarded message", error);
  }
}

async function handleListTasks(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "l")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const assigneeIds = [user.id];
    if (user.username) {
      assigneeIds.push(`username-${user.username.toLowerCase()}`);
    }

    const assigned = await getTasksByAssigneeIds(assigneeIds);
    const outbox = await getTasksByCreator(user.id);

    const { text, orderedAssigned } = summarizeTasks(
      assigned,
      outbox,
      "date"
    );

    userTaskCache.set(ctx.from.id, {
      assignedOrdered: orderedAssigned,
      outbox,
      mode: "date",
    });

    const MAX_LEN = 4000;
    const sortMode = "date";
    if (text.length <= MAX_LEN) {
      const ids = extractTaskIdsFromText(text);
      const keyboard = buildTaskListWithActionsKeyboard(ids, sortMode);
      await ctx.telegram.sendMessage(ctx.from.id, text, keyboard);
    } else {
      const parts: string[] = [];
      let rest = text;
      while (rest.length > MAX_LEN) {
        const chunk = rest.slice(0, MAX_LEN);
        const lastNewline = chunk.lastIndexOf("\n");
        const cut = lastNewline > MAX_LEN / 2 ? lastNewline + 1 : MAX_LEN;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest) parts.push(rest);
      for (let i = 0; i < parts.length; i++) {
        const ids = extractTaskIdsFromText(parts[i]);
        const opts = buildTaskListWithActionsKeyboard(ids, sortMode);
        await ctx.telegram.sendMessage(ctx.from.id, parts[i], opts);
      }
    }

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил список задач в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /l command", error);
    await ctx.reply("Не удалось получить список задач.");
  }

  return true;
}

async function handleDoneCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "done")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  const parts = message.text.trim().split(/\s+/);
  const arg = parts[1];

  if (!arg) {
    await ctx.reply("Укажите id или номер задачи: /done <id|номер>");
    return true;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const cachedTasks = userTaskCache.get(ctx.from.id)?.assignedOrdered ?? [];
    let taskId: string | null = null;

    if (/^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1;
      if (idx >= 0 && idx < cachedTasks.length) {
        taskId = cachedTasks[idx].id;
      }
    } else {
      taskId = arg;
    }

    if (!taskId) {
      await ctx.reply("Не понял номер задачи. Сначала запросите /l.");
      return true;
    }

    const task = await getTaskById(taskId);

    if (!task) {
      await ctx.reply("Задача не найдена.");
      return true;
    }

    if (task.assignedUserId && task.assignedUserId !== user.id) {
      await ctx.reply("Эта задача назначена другому пользователю.");
      return true;
    }

    await updateTaskStatus(taskId, "done");
    safeLogAction("task_status_updated", {
      userId: user.id,
      targetId: taskId,
      targetType: "task",
      payload: { previousStatus: task.status, newStatus: "done" },
    });
    await ctx.reply(`Отметил задачу выполненной: ${taskId}`);
    userTaskCache.delete(ctx.from.id);
  } catch (error) {
    console.error("Failed to handle /done command", error);
    await ctx.reply("Не удалось обновить задачу.");
  }

  return true;
}

async function handleDeleteCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "del")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  const parts = message.text.trim().split(/\s+/);
  const arg = parts[1];

  if (!arg) {
    await ctx.reply("Укажите id или номер задачи: /del <id|номер>");
    return true;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const cachedTasks = userTaskCache.get(ctx.from.id)?.assignedOrdered ?? [];
    let taskId: string | null = null;

    if (/^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1;
      if (idx >= 0 && idx < cachedTasks.length) {
        taskId = cachedTasks[idx].id;
      }
    } else {
      taskId = arg;
    }

    if (!taskId) {
      await ctx.reply("Не понял номер задачи. Сначала запросите /l.");
      return true;
    }

    const task = await getTaskById(taskId);

    if (!task) {
      await ctx.reply("Задача не найдена.");
      return true;
    }

    if (task.assignedUserId && task.assignedUserId !== user.id) {
      await ctx.reply("Эта задача назначена другому пользователю.");
      return true;
    }

    await deleteTask(taskId);
    safeLogAction("task_deleted", {
      userId: user.id,
      targetId: taskId,
      targetType: "task",
      payload: { status: task.status },
    });
    await ctx.reply(`Удалил задачу: ${taskId}`);
    userTaskCache.delete(ctx.from.id);
  } catch (error) {
    console.error("Failed to handle /del command", error);
    await ctx.reply("Не удалось удалить задачу.");
  }

  return true;
}

async function handleInfo(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "info")) {
    return false;
  }

  const helpText =
    "📋 <b>Команды:</b>\n\n" +
    "<b>Задачи:</b>\n" +
    "/task — создать задачу\n" +
    "/l — список задач (сводка)\n" +
    "/my — мои задачи\n" +
    "/outbox — задачи, которые я поставил\n" +
    "/my_today — задачи на сегодня\n" +
    "/my_overdue — просроченные\n" +
    "/chat_tasks — задачи чата\n" +
    "/all_tasks — все задачи\n" +
    "/done <id> — выполнена\n" +
    "/del <id> — удалить\n" +
    "/priority <id> <low|normal|high|urgent> — приоритет\n" +
    "/wait <id> — в ожидание + follow-up\n\n" +
    "<b>Auto-scan:</b>\n" +
    "/chats — 🎛 центр управления чатами (вкл/выкл scan)\n" +
    "/scan_on — включить scan (в группе)\n" +
    "/scan_off — выключить scan (в группе)\n" +
    "/parse_today — разобрать вручную за сегодня\n" +
    "/parse_yesterday — за вчера\n\n" +
    "<b>Знания:</b>\n" +
    "/k <текст> — в базу знаний\n" +
    "/ksearch <текст> — поиск\n" +
    "/ask <вопрос> — ответ по базе (RAG)\n\n" +
    "<b>Уведомления (авто):</b>\n" +
    "🔔 Напоминания о дедлайнах\n" +
    "📋 Follow-up: кто не ответил\n" +
    "💬 Мне не ответили\n" +
    "☀️ Утренний бриф (9:00)\n" +
    "🌙 Вечерний дайджест (19:00)\n\n" +
    "/status — состояние бота";

  await ctx.reply(helpText, { parse_mode: "HTML" });
  await sendMainMenu(ctx);
  return true;
}

async function handleHelp(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "help")) {
    return false;
  }

  return handleInfo(ctx);
}

async function handleKnowledgeSearch(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "ksearch")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  const query = message.text.replace(/^\/ksearch(?:@\S+)?\s*/i, "").trim();
  if (!query) {
    await ctx.reply("Укажите запрос: /ksearch <текст>");
    return true;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const scope: { userId: string; chatId?: string; telegramChatId?: number; teamId?: string; limit: number } = {
      userId: user.id,
      limit: 500,
    };
    if (message.chat.type !== "private" && "chat" in message) {
      const chat = await upsertChatFromTelegramPayload({
        id: message.chat.id,
        title: "title" in message.chat ? message.chat.title : undefined,
        type: message.chat.type as "group" | "supergroup",
      });
      scope.chatId = chat.id;
      scope.telegramChatId = message.chat.id;
      const team = await getTeamByChatId(message.chat.id.toString());
      if (team) scope.teamId = team.id;
    }

    const items = await listKnowledgeForSearch(scope);
    const keywords = extractSearchKeywords(query);
    const searchTerms = keywords.length > 0 ? keywords : [query.toLowerCase()];
    const scored = items
      .map((item) => {
        const textLower = item.text.toLowerCase();
        const matchCount = searchTerms.filter((kw) => textLower.includes(kw)).length;
        if (matchCount === 0) return null;
        const recencyScore = new Date(item.createdAt).getTime();
        return { item, matchCount, recencyScore, score: matchCount * 10 + Math.log(1 + recencyScore / 1e12) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    const limit = 10;
    const trimmed = scored.slice(0, limit).map((s) => s.item);

    if (!trimmed.length) {
      await ctx.reply("В базе знаний совпадений не найдено.");
      return true;
    }

    const lines = trimmed.map((item, idx) => {
      const prefix = item.importance === "important" ? "⭐ " : "";
      const typeLabel = `[${item.type}]`;
      const excerpt = item.text.length > 120 ? `${item.text.slice(0, 120)}…` : item.text;
      const srcLink = buildTelegramMessageLink(item.source);
      const srcText = srcLink ? srcLink : formatSourceFallback(item.source, item.sourceChatTitle);
      return `${idx + 1}. ${prefix}${typeLabel} ${excerpt} (id=${item.id.slice(0, 8)})\n   Source: ${srcText}`;
    });

    const header =
      scored.length > limit
        ? `Найдено ${scored.length}. Топ ${limit}:`
        : `Найдено ${scored.length}:`;
    const text = `${header}\n${lines.join("\n")}`;

    safeLogAction("knowledge_search", { userId: user.id, payload: { query, hits: trimmed.length } });
    await ctx.telegram.sendMessage(ctx.from.id, text);

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил результаты поиска в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /ksearch", error);
    await ctx.reply("Не удалось выполнить поиск по базе знаний.");
  }

  return true;
}

function ensureAdmin(team: any, userId: string): boolean {
  const role = team?.roles?.[userId];
  return role === "owner" || role === "admin";
}

function isSuperAdminFromEnv(username?: string | null): boolean {
  const raw = process.env.SUPERADMINS || "";
  if (!raw) return false;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)
  );
  if (!username) return false;
  return set.has(username.replace(/^@/, "").toLowerCase());
}

function resolveCommandMention(
  ctx: Context<Update>,
  text: string,
  entities?: MessageEntity[]
): Promise<{ username?: string; user: TelegramUser | null }> {
  const mentions = extractMentions(text, entities);
  if (mentions.length === 0) {
    return Promise.resolve({ user: null, username: undefined });
  }
  return resolveMentionedUser(ctx, mentions[0].entity, mentions[0].mentionText);
}

async function handleAdmin(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "admin")) {
    return false;
  }

  if (!ctx.chat || !ctx.from) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });
    const team = await getTeamByChatId(chatId);
    if (!team) {
      await ctx.reply("Команда не привязана. Используйте /link_team.");
      return true;
    }

    const isAdmin = ensureAdmin(team, user.id) || isSuperAdminFromEnv(user.username ?? null);
    if (!isAdmin) {
      await ctx.reply("Недостаточно прав. Нужен owner/admin команды.");
      return true;
    }

    await ctx.reply(
      "Админ-команды:\n" +
        "/setrole @user owner|admin|member|read_only — назначить роль\n" +
        "/allow @user create|assign|edit — выдать право\n" +
        "/deny @user create|assign|edit — забрать право\n" +
        "/settings — базовые настройки"
    );
  } catch (error) {
    console.error("Failed to handle /admin", error);
    await ctx.reply("Не удалось открыть админ-меню.");
  }

  return true;
}

async function handleSetRole(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "setrole")) {
    return false;
  }

  if (!ctx.chat || !ctx.from) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  const parts = message.text.trim().split(/\s+/);
  // Support: /setrole @user role  OR  /setrole <teamId> @user role (useful in private)
  const role = parts[parts.length - 1] as
    | "owner"
    | "admin"
    | "member"
    | "read_only"
    | undefined;

  if (!role || !["owner", "admin", "member", "read_only"].includes(role)) {
    await ctx.reply("Укажите роль: /setrole @user owner|admin|member|read_only");
    return true;
  }

  try {
    const actor = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });
    const possibleTeamId = parts.length >= 4 ? parts[1] : null;
    const team = possibleTeamId ? await getTeamById(possibleTeamId) : await getTeamByChatId(chatId);
    if (!team) {
      await ctx.reply("Команда не привязана. Используйте /link_team.");
      return true;
    }

    if (!ensureAdmin(team, actor.id) && !isSuperAdminFromEnv(actor.username ?? null)) {
      await ctx.reply("Недостаточно прав. Нужен owner/admin команды.");
      return true;
    }

    const resolved = await resolveCommandMention(
      ctx,
      message.text,
      (message as Message.TextMessage).entities
    );

    if (!resolved.user) {
      await ctx.reply("Не удалось определить пользователя для роли.");
      return true;
    }

    await setRole(team.id, resolved.user.id, role);
    safeLogAction("role_set", {
      userId: actor.id,
      targetId: resolved.user.id,
      targetType: "user",
      payload: { teamId: team.id, role },
    });
    await ctx.reply(
      `Роль ${role} назначена для ${formatUserLabel(resolved.user)}`
    );
  } catch (error) {
    console.error("Failed to handle /setrole", error);
    await ctx.reply("Не удалось назначить роль.");
  }

  return true;
}

async function handleAllowDeny(
  ctx: Context<Update>,
  kind: "allow" | "deny"
): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, kind)) {
    return false;
  }

  if (!ctx.chat || !ctx.from) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  const parts = message.text.trim().split(/\s+/);
  // Support: /allow @user create|assign|edit  OR  /allow <teamId> @user create|assign|edit
  const action = parts[parts.length - 1] as "create" | "assign" | "edit" | undefined;

  if (!action || !["create", "assign", "edit"].includes(action)) {
    await ctx.reply(`Укажите право: /${kind} @user create|assign|edit`);
    return true;
  }

  try {
    const actor = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });
    const possibleTeamId = parts.length >= 4 ? parts[1] : null;
    const team = possibleTeamId ? await getTeamById(possibleTeamId) : await getTeamByChatId(chatId);
    if (!team) {
      await ctx.reply("Команда не привязана. Используйте /link_team.");
      return true;
    }

    if (!ensureAdmin(team, actor.id) && !isSuperAdminFromEnv(actor.username ?? null)) {
      await ctx.reply("Недостаточно прав. Нужен owner/admin команды.");
      return true;
    }

    const resolved = await resolveCommandMention(
      ctx,
      message.text,
      (message as Message.TextMessage).entities
    );

    if (!resolved.user) {
      await ctx.reply("Не удалось определить пользователя для прав.");
      return true;
    }

    const payload: { create?: boolean; assign?: boolean; edit?: boolean } = {};
    payload[action] = kind === "allow";

    await updatePermissions(team.id, resolved.user.id, payload);
    safeLogAction("permission_updated", {
      userId: actor.id,
      targetId: resolved.user.id,
      targetType: "user",
      payload: { teamId: team.id, kind, action },
    });
    await ctx.reply(
      `${kind === "allow" ? "Выдал" : "Снял"} право ${action} для ${formatUserLabel(
        resolved.user
      )}`
    );
  } catch (error) {
    console.error(`Failed to handle /${kind} command`, error);
    await ctx.reply("Не удалось обновить права.");
  }

  return true;
}

async function handleSettings(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "settings")) {
    return false;
  }

  if (!ctx.chat || !ctx.from) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  try {
    const actor = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });
    const team = await getTeamByChatId(chatId);
    if (!team) {
      await ctx.reply("Команда не привязана. Используйте /link_team.");
      return true;
    }

    if (!ensureAdmin(team, actor.id) && !isSuperAdminFromEnv(actor.username ?? null)) {
      await ctx.reply("Недостаточно прав. Нужен owner/admin команды.");
      return true;
    }

    await ctx.reply(
      "Настройки (черновик):\n- defaultProjectId для чата через /setproject\n- роли через /setrole\n- права через /allow /deny\n(доп. настройки появятся позже)"
    );
  } catch (error) {
    console.error("Failed to handle /settings", error);
    await ctx.reply("Не удалось получить настройки.");
  }

  return true;
}

async function handleProjects(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "projects")) {
    return false;
  }

  if (!ctx.chat) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  try {
    const team = await getTeamByChatId(chatId);
    let projects = await listProjectsByChatId(chatId);

    if (!projects.length && team) {
      projects = await listProjectsByTeamId(team.id);
    }

    if (!projects.length) {
      await ctx.reply("Проектов для этого чата пока нет.");
      return true;
    }

    const lines = projects.map(
      (p) => `- ${p.name}${p.description ? ` — ${p.description}` : ""} (id=${p.id})`
    );
    await ctx.reply(`Проекты:\n${lines.join("\n")}`);
  } catch (error) {
    console.error("Failed to handle /projects", error);
    await ctx.reply("Не удалось получить список проектов.");
  }

  return true;
}

async function handleSetProject(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "setproject")) {
    return false;
  }

  if (!ctx.chat) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  const parts = message.text.trim().split(/\s+/);
  const projectId = parts[1];

  if (!projectId) {
    await ctx.reply("Укажите id проекта: /setproject <projectId>");
    return true;
  }

  try {
    const project = await getProjectById(projectId);
    if (!project) {
      await ctx.reply("Проект не найден.");
      return true;
    }

    await attachChatToProject(projectId, chatId);
    await setDefaultProjectForChat(chatId, projectId);
    const userId = ctx.from
      ? (await upsertUserFromTelegramPayload({
          id: ctx.from.id,
          username: ctx.from.username ?? undefined,
          first_name: ctx.from.first_name ?? undefined,
          last_name: ctx.from.last_name ?? undefined,
        })).id
      : null;
    safeLogAction("project_attached", {
      userId,
      targetId: projectId,
      targetType: "project",
      payload: { chatId },
    });

    await ctx.reply(
      `Проект по умолчанию для этого чата установлен: ${project.name} (id=${project.id})`
    );
  } catch (error) {
    console.error("Failed to handle /setproject", error);
    await ctx.reply("Не удалось установить проект по умолчанию.");
  }

  return true;
}

async function handleTeam(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "team")) {
    return false;
  }

  if (!ctx.chat) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  try {
    const team = await getTeamByChatId(chatId);
    if (!team) {
      await ctx.reply("Команда для этого чата не привязана.");
      return true;
    }

    const info = [
      `Команда: ${team.name} (id=${team.id})`,
      `Чаты: ${(team.chatIds ?? []).length}`,
      `Проекты: ${(team.projectIds ?? []).length}`,
    ];

    await ctx.reply(info.join("\n"));
  } catch (error) {
    console.error("Failed to handle /team", error);
    await ctx.reply("Не удалось получить информацию о команде.");
  }

  return true;
}

async function handleLinkTeam(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "link_team")) {
    return false;
  }

  if (!ctx.chat) return false;

  const chatId = "id" in ctx.chat ? ctx.chat.id.toString() : "";
  if (!chatId) return false;

  const parts = message.text.trim().split(/\s+/);
  const teamId = parts[1];

  try {
    if (teamId) {
      const existing = await getTeamById(teamId);
      if (!existing) {
        await ctx.reply("Команда с таким id не найдена.");
        return true;
      }
      await linkChatToTeam(teamId, chatId);
      const linkUser = ctx.from ? (await upsertUserFromTelegramPayload({ id: ctx.from.id, username: ctx.from.username ?? undefined, first_name: ctx.from.first_name ?? undefined, last_name: ctx.from.last_name ?? undefined })).id : null;
      safeLogAction("team_linked", {
        userId: linkUser,
        targetId: teamId,
        targetType: "team",
        payload: { chatId },
      });
      await ctx.reply(`Чат привязан к команде: ${existing.name} (id=${existing.id})`);
      return true;
    }

    const newTeam = await createTeam(`Team-${chatId}`, chatId);
    const createUser = ctx.from ? (await upsertUserFromTelegramPayload({ id: ctx.from.id, username: ctx.from.username ?? undefined, first_name: ctx.from.first_name ?? undefined, last_name: ctx.from.last_name ?? undefined })).id : null;
    if (createUser) {
      // Bootstrap: creator becomes owner of the newly created team.
      await setRole(newTeam.id, createUser, "owner");
    }
    safeLogAction("team_linked", {
      userId: createUser,
      targetId: newTeam.id,
      targetType: "team",
      payload: { chatId, created: true },
    });
    await ctx.reply(`Создал новую команду и привязал чат: ${newTeam.name} (id=${newTeam.id})`);
  } catch (error) {
    console.error("Failed to handle /link_team", error);
    await ctx.reply("Не удалось привязать чат к команде.");
  }

  return true;
}

async function handleTaskCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  const isTask = isCommand(message.text, "task") || isCommand(message.text, "newtask");
  if (!isTask) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  const repliedMessage = "reply_to_message" in message
    ? message.reply_to_message
    : undefined;

  const replyText = getMessageText(repliedMessage);

  const mentions = extractMentions(message.text, (message as Message.TextMessage).entities);

  const description = replyText
    ? replyText.trim()
    : stripCommandAndMentions(
        message.text,
        mentions.map((m) => m.mentionText),
        /^\/(?:task|newtask)(?:@\S+)?\s*/i
      );

  if (!description) {
    await ctx.reply("Нужно указать текст задачи после /task или ответить на сообщение.");
    return true;
  }

  try {
    const createdByUser = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    let sourceChatId: string | null = null;
    let sourceChatTitle: string | null = null;

    if ("chat" in message && message.chat.type !== "private") {
      const chat = await upsertChatFromTelegramPayload({
        id: message.chat.id,
        title: "title" in message.chat ? message.chat.title : undefined,
        type: message.chat.type,
      });
      sourceChatId = chat.id;
      sourceChatTitle = chat.title;
    }

    const resolvedAssignees: TelegramUser[] = [];
    const mentionUsernames: string[] = [];

    for (const mention of mentions) {
      const resolved = await resolveMentionedUser(
        ctx,
        mention.entity,
        mention.mentionText
      );
      if (resolved.user) {
        resolvedAssignees.push(resolved.user);
      }
      if (resolved.username) {
        mentionUsernames.push(resolved.username);
      }
    }

    const dueDate = await resolveDueDate(description);
    const tasks = [];

    if (resolvedAssignees.length > 0) {
      for (const assignee of resolvedAssignees) {
        const task = await createTask({
          sourceType: "chat_command",
          sourceChatId,
          sourceChatTitle,
          sourceMessageId: repliedMessage?.message_id ?? message.message_id,
          createdByUserId: createdByUser.id,
          assignedUserId: assignee.id,
          title: "",
          description,
          status: "new",
          dueDate,
        });
        tasks.push(task);
      }
    } else {
      const task = await createTask({
        sourceType: "chat_command",
        sourceChatId,
        sourceChatTitle,
        sourceMessageId: repliedMessage?.message_id ?? message.message_id,
        createdByUserId: createdByUser.id,
        assignedUserId: null,
        title: "",
        description,
        status: "incoming",
        dueDate,
      });
      tasks.push(task);
    }

    console.log("Created task(s) from /task", tasks);
    tasks.forEach((t) =>
      safeLogAction("task_created", {
        userId: createdByUser.id,
        targetId: t.id,
        targetType: "task",
        payload: { assignedUserId: t.assignedUserId, sourceType: t.sourceType },
      })
    );

    if (resolvedAssignees.length > 0) {
      const assigneesList = resolvedAssignees
        .map((u) => formatUserLabel(u))
        .join(", ");
      await ctx.reply(`Создал задачу для: ${assigneesList}`);
    } else if (mentionUsernames.length > 0) {
      const mentionsList = mentionUsernames
        .map((u) => formatUsername(u))
        .filter(Boolean)
        .join(", ");
      await ctx.reply(
        `Добавил во входящие, не смог назначить ${mentionsList}`
      );
    } else {
      await ctx.reply("Добавил во входящие без ответственного");
    }
  } catch (error) {
    console.error("Failed to handle /task command", error);
    await ctx.reply("Не удалось создать задачу.");
  }

  return true;
}

async function handleMyTasks(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "my")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const assigneeIds = [user.id];
    if (user.username) {
      assigneeIds.push(`username-${user.username.toLowerCase()}`);
    }

    const assigned = await getTasksByAssigneeIds(assigneeIds);
    const outbox = await getTasksByCreator(user.id);

    const { text, ordered } = formatTaskList(assigned, "Мои задачи");

    userTaskCache.set(ctx.from.id, {
      assignedOrdered: ordered,
      outbox,
      mode: "date",
    });

    const ids = ordered.map((t) => t.id);
    const keyboard = buildTaskListWithActionsKeyboard(ids, "date");
    await ctx.telegram.sendMessage(ctx.from.id, text, keyboard);

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил список задач в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /my", error);
    await ctx.reply("Не удалось получить задачи.");
  }

  return true;
}

async function handleMyToday(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "my_today")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const assigneeIds = [user.id];
    if (user.username) {
      assigneeIds.push(`username-${user.username.toLowerCase()}`);
    }

    const assigned = await getTasksByAssigneeIds(assigneeIds);
    const today = assigned.filter((t) => {
      const due = parseDate(t.dueDate);
      return due && isToday(due, new Date()) && t.status !== "done";
    });

    const { text, ordered } = formatTaskList(today, "Мои задачи на сегодня");

    userTaskCache.set(ctx.from.id, {
      assignedOrdered: ordered,
      outbox: [],
      mode: "date",
    });

    await ctx.telegram.sendMessage(ctx.from.id, text);

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил список задач на сегодня в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /my_today", error);
    await ctx.reply("Не удалось получить задачи.");
  }

  return true;
}

async function handleMyOverdue(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "my_overdue")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const assigneeIds = [user.id];
    if (user.username) {
      assigneeIds.push(`username-${user.username.toLowerCase()}`);
    }

    const assigned = await getTasksByAssigneeIds(assigneeIds);
    const now = new Date();
    const overdue = assigned.filter((t) => {
      const due = parseDate(t.dueDate);
      return due && due.getTime() < now.getTime() && t.status !== "done";
    });

    const { text, ordered } = formatTaskList(overdue, "Мои просроченные");

    userTaskCache.set(ctx.from.id, {
      assignedOrdered: ordered,
      outbox: [],
      mode: "date",
    });

    await ctx.telegram.sendMessage(ctx.from.id, text);

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил просроченные задачи в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /my_overdue", error);
    await ctx.reply("Не удалось получить задачи.");
  }

  return true;
}

async function handleOutbox(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "outbox")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    const assigneeIds = [user.id];
    if (user.username) {
      assigneeIds.push(`username-${user.username.toLowerCase()}`);
    }

    const assigned = await getTasksByAssigneeIds(assigneeIds);
    const outbox = await getTasksByCreator(user.id);

    const outboxText = formatTaskList(outbox, "Я поставил", "date");

    userTaskCache.set(ctx.from.id, {
      assignedOrdered: sortTasks(assigned, "date"),
      outbox: outboxText.ordered,
      mode: "date",
    });

    await ctx.telegram.sendMessage(ctx.from.id, outboxText.text);

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил исходящие задачи в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /outbox", error);
    await ctx.reply("Не удалось получить исходящие задачи.");
  }

  return true;
}

async function handleStatus(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "status")) {
    return false;
  }

  const chatType = "chat" in message ? message.chat.type : "unknown";
  const chatTitle =
    "chat" in message ? (message.chat.type === "private" ? "личка" : getChatTitle(message.chat) || "без названия") : "—";
  const botName = ctx.botInfo?.username ? `@${ctx.botInfo.username}` : "бот";
  const geminiStatus = process.env.GEMINI_API_KEY ? "включен" : "выключен";

  const text =
    `Статус бота:\n` +
    `- Бот: ${botName}\n` +
    `- Чат: ${chatTitle} (${chatType})\n` +
    `- Gemini: ${geminiStatus}\n` +
    `- Логи сообщений: только группы/супергруппы\n` +
    `Чтобы бот видел все сообщения в группе, отключите privacy в @BotFather (/setprivacy -> Disable).`;

  await ctx.reply(text);
  return true;
}

async function handleParseCommand(
  ctx: Context<Update>,
  period: ParsePeriod
): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  const commandName = period === "today" ? "parse_today" : "parse_yesterday";
  if (!isCommand(message.text, commandName)) {
    return false;
  }

  try {
    const chats = await listChats(30);
    const candidates = chats
      .filter((chat) => chat.type === "group" || chat.type === "supergroup")
      .map((chat) => ({
        id: chat.id,
        title: chat.title || "Без названия",
      }));

    if (!candidates.length) {
      await ctx.reply("Нет доступных чатов для разбора. Добавьте бота в группу.");
      return true;
    }

    const label = getPeriodLabel(period);
    await ctx.reply(
      `Выберите чат для разбора (${label}):`,
      buildChatSelectionKeyboard(candidates, period)
    );
  } catch (error) {
    console.error("Failed to handle parse command", error);
    await ctx.reply("Не удалось получить список чатов.");
  }

  return true;
}

async function handleParseChatCallback(
  ctx: Context<Update>
): Promise<boolean> {
  const callback = ctx.callbackQuery;
  if (!callback || !("data" in callback)) {
    return false;
  }

  const data = callback.data || "";
  if (!data.startsWith("parse:")) {
    return false;
  }

  const parts = data.split(":");
  if (parts.length !== 3) {
    await ctx.answerCbQuery("Некорректные данные.");
    return true;
  }

  const period = parts[1] as ParsePeriod;
  const chatId = parts[2];
  if (period !== "today" && period !== "yesterday") {
    await ctx.answerCbQuery("Неизвестный период.");
    return true;
  }

  try {
    const chat = await getChatById(chatId);
    if (!chat) {
      await ctx.answerCbQuery("Чат не найден.");
      return true;
    }

    const { start, end } = getPeriodRange(period);
    const messages = await listMessagesByChatAndTime(
      chat.telegramChatId,
      start.toISOString(),
      end.toISOString(),
      200
    );

    if (!messages.length) {
      await ctx.reply(
        "Сообщений за выбранный период нет. Проверьте, что privacy отключен и бот видит чат."
      );
      await ctx.answerCbQuery();
      return true;
    }

    const maxMessages = 80;
    const messageWindow =
      messages.length > maxMessages
        ? messages.slice(messages.length - maxMessages)
        : messages;

    const parsedTasks = await extractTasksFromMessages(
      messageWindow,
      ctx.botInfo?.username
    );

    if (!parsedTasks.length) {
      await ctx.reply("Не нашёл задач в сообщениях за период.");
      await ctx.answerCbQuery();
      return true;
    }

    const messageMap = new Map<number, ChatMessage>();
    messages.forEach((msg) => messageMap.set(msg.messageId, msg));

    let createdCount = 0;
    let skippedCount = 0;

    for (const task of parsedTasks) {
      const sourceMessage = messageMap.get(task.messageId);
      if (!sourceMessage) {
        skippedCount += 1;
        continue;
      }
      if (sourceMessage.text.trim().startsWith("/")) {
        skippedCount += 1;
        continue;
      }

      const existing = await getTasksBySourceMessage(
        chat.id,
        task.messageId
      );
      if (existing.length > 0) {
        skippedCount += 1;
        continue;
      }

      const description = task.description?.trim() || sourceMessage.text.trim();
      const dueDate = task.dueDate || (await resolveDueDate(description));
      const assignees = task.assignees.filter(Boolean);

      if (assignees.length > 0) {
        for (const username of assignees) {
          const assignee = await upsertUserByUsername(username);
          const created = await createTask({
            sourceType: "chat_auto",
            sourceChatId: chat.id,
            sourceChatTitle: chat.title,
            sourceMessageId: task.messageId,
            createdByUserId: sourceMessage.fromUserId,
            assignedUserId: assignee.id,
            title: "",
            description,
            status: "new",
            dueDate,
          });
          safeLogAction("task_created", {
            userId: sourceMessage.fromUserId,
            targetId: created.id,
            targetType: "task",
            payload: { assignedUserId: assignee.id, sourceType: "chat_auto", source: "parse" },
          });
          createdCount += 1;
        }
      } else {
        const created = await createTask({
          sourceType: "chat_auto",
          sourceChatId: chat.id,
          sourceChatTitle: chat.title,
          sourceMessageId: task.messageId,
          createdByUserId: sourceMessage.fromUserId,
          assignedUserId: null,
          title: "",
          description,
          status: "incoming",
          dueDate,
        });
        safeLogAction("task_created", {
          userId: sourceMessage.fromUserId,
          targetId: created.id,
          targetType: "task",
          payload: { sourceType: "chat_auto", source: "parse" },
        });
        createdCount += 1;
      }
    }

    const label = getPeriodLabel(period);
    await ctx.reply(
      `Разбор чата "${chat.title || "без названия"}" (${label}): создано задач: ${createdCount}, пропущено: ${skippedCount}.`
    );
    await ctx.answerCbQuery();
  } catch (error) {
    console.error("Failed to parse chat", error);
    await ctx.reply("Не удалось разобрать чат.");
    await ctx.answerCbQuery();
  }

  return true;
}

async function handleChatTasks(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "chat_tasks")) {
    return false;
  }

  if (!ctx.chat || !ctx.from) {
    return false;
  }

  if (message.chat.type === "private") {
    await ctx.reply("Команда доступна только в групповых чатах.");
    return true;
  }

  try {
    const chat = await upsertChatFromTelegramPayload({
      id: message.chat.id,
      title: "title" in message.chat ? message.chat.title : undefined,
      type: message.chat.type,
    });

    const tasks = await getTasksByChatId(chat.id);
    const heading = `Задачи из чата ${chat.title || "без названия"}`;
    const text = await formatTaskFlowList(tasks, heading, false);

    await ctx.telegram.sendMessage(ctx.from.id, text);
    await ctx.reply("Отправил список задач по чату в личку.");
  } catch (error) {
    console.error("Failed to handle /chat_tasks", error);
    await ctx.reply("Не удалось получить задачи по чату.");
  }

  return true;
}

async function handleAllTasks(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "all_tasks")) {
    return false;
  }

  if (!ctx.from) {
    return false;
  }

  try {
    const tasks = await getAllTasks();
    const text = await formatTaskFlowList(tasks, "Все активные задачи", true);

    await ctx.telegram.sendMessage(ctx.from.id, text);

    if (message.chat.type !== "private") {
      await ctx.reply("Отправил список задач в личку.");
    }
  } catch (error) {
    console.error("Failed to handle /all_tasks", error);
    await ctx.reply("Не удалось получить список задач.");
  }

  return true;
}

async function handleAsk(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "ask")) {
    return false;
  }

  const question = message.text.replace(/^\/ask(?:@\S+)?\s*/i, "").trim();
  if (!question) {
    await ctx.reply("Укажите вопрос: /ask <вопрос>");
    return true;
  }

  if (!ctx.from) return false;

  try {
    const user = await upsertUserFromTelegramPayload({
      id: ctx.from.id,
      username: ctx.from.username ?? undefined,
      first_name: ctx.from.first_name ?? undefined,
      last_name: ctx.from.last_name ?? undefined,
    });

    let scope: { userId: string; chatId?: string; telegramChatId?: number; teamId?: string; limit?: number } = {
      userId: user.id,
      limit: 500,
    };
    if (message.chat.type !== "private" && "chat" in message) {
      const chat = await upsertChatFromTelegramPayload({
        id: message.chat.id,
        title: "title" in message.chat ? message.chat.title : undefined,
        type: message.chat.type as "group" | "supergroup",
      });
      scope.chatId = chat.id;
      scope.telegramChatId = message.chat.id;
      const team = await getTeamByChatId(message.chat.id.toString());
      if (team) scope.teamId = team.id;
    }

    const items = await listKnowledgeForSearch(scope);
    const keywords = extractSearchKeywords(question);
    const searchTerms = keywords.length > 0 ? keywords : [question.toLowerCase()];
    const scored = items
      .map((item) => {
        const textLower = item.text.toLowerCase();
        const matchCount = searchTerms.filter((kw) => textLower.includes(kw)).length;
        if (matchCount === 0) return null;
        const recencyScore = new Date(item.createdAt).getTime();
        return { item, score: matchCount * 10 + Math.log(1 + recencyScore / 1e12) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    const top10 = scored.slice(0, 10).map((s) => s.item);

    const contextItems = top10.map((c) => ({
      id: c.id.slice(0, 8),
      text: c.text.slice(0, 500),
      source: c.sourceChatTitle || buildTelegramMessageLink(c.source) || undefined,
    }));

    const answer = await askWithGemini(question, contextItems);

    if (!answer) {
      await ctx.reply("Gemini недоступен. Укажите GEMINI_API_KEY.");
      return true;
    }

    const sourceLines = top10.slice(0, 5).map((item, i) => {
      const link = buildTelegramMessageLink(item.source);
      const src = link || formatSourceFallback(item.source, item.sourceChatTitle);
      return `${i + 1}. ${item.text.slice(0, 80)}… — ${src}`;
    });
    const sourcesBlock = sourceLines.length ? "\n\nSources:\n" + sourceLines.join("\n") : "";

    safeLogAction("ask_executed", { userId: user.id, payload: { question: question.slice(0, 100), hitsCount: top10.length } });
    await ctx.reply(answer + sourcesBlock);
  } catch (error) {
    console.error("Failed to handle /ask", error);
    await ctx.reply("Не удалось выполнить запрос.");
  }

  return true;
}

async function handleSearch(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "search")) {
    return false;
  }

  const query = message.text.replace(/^\/search(?:@\S+)?\s*/i, "").trim();

  if (!query) {
    await ctx.reply("Укажите текст запроса: /search <запрос>");
    return true;
  }

  await ctx.reply(
    `Принял запрос на поиск: "${query}". Поиск через ИИ пока не подключён.`
  );

  return true;
}

async function handleAutoplan(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "autoplan")) {
    return false;
  }

  const brief = message.text.replace(/^\/autoplan(?:@\S+)?\s*/i, "").trim();

  if (!brief) {
    await ctx.reply("Укажите бриф: /autoplan <описание проекта>");
    return true;
  }

  await ctx.reply(
    "Принял запрос на автоплан. Генерация через ИИ будет подключена позже."
  );

  return true;
}

async function handleAnalyze(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "analyze")) {
    return false;
  }

  await ctx.reply(
    "Принял запрос на анализ переписки. ИИ-анализ будет подключён позже."
  );

  return true;
}

async function handleDigest(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  if (!isCommand(message.text, "digest")) {
    return false;
  }

  await ctx.reply(
    "Digest доступен. Если видите это сообщение — skill router не обработал команду. Проверьте деплой и pm2 restart telegatask."
  );

  return true;
}

const stubCommands: Record<string, string> = {
  edit: "Редактирование задач — в разработке. Пока обновляйте вручную через БД.",
  settings: "Настройки бота для команды — в разработке.",
};

async function handleStubCommands(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return false;
  }

  const match = message.text.trim().match(/^\/(\w+)/);
  if (!match) {
    return false;
  }

  const cmd = match[1].toLowerCase();
  const text = stubCommands[cmd];
  if (!text) {
    return false;
  }

  await ctx.reply(text);
  return true;
}

async function handleSortCallback(ctx: Context<Update>): Promise<void> {
  const callback = ctx.callbackQuery;
  if (!callback || !("data" in callback)) return;

  const data = callback.data;
  if (data !== "sort_date" && data !== "sort_project") return;

  const mode: SortMode = data === "sort_project" ? "project" : "date";
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const cached = userTaskCache.get(userId);
    if (!cached) {
      await ctx.answerCbQuery("Сначала запросите /l");
      return;
    }

    const { text, orderedAssigned } = summarizeTasks(
      cached.assignedOrdered,
      cached.outbox,
      mode
    );

    userTaskCache.set(userId, {
      assignedOrdered: orderedAssigned,
      outbox: cached.outbox,
      mode,
    });

    const MAX_LEN = 4000;
    const ids = extractTaskIdsFromText(text);
    const keyboard = buildTaskListWithActionsKeyboard(ids, mode);

    if (text.length <= MAX_LEN) {
      try {
        await ctx.editMessageText(text, keyboard);
      } catch (editErr) {
        console.error("Failed to edit task list", editErr);
        await ctx.reply(text, keyboard);
      }
    } else {
      const parts: string[] = [];
      let rest = text;
      while (rest.length > MAX_LEN) {
        const cut = rest.lastIndexOf("\n", MAX_LEN);
        const pos = cut > MAX_LEN / 2 ? cut + 1 : MAX_LEN;
        parts.push(rest.slice(0, pos));
        rest = rest.slice(pos);
      }
      if (rest) parts.push(rest);
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      const chatId = ctx.chat?.id ?? ctx.from?.id;
      if (chatId) {
        for (let i = 0; i < parts.length; i++) {
          const partIds = extractTaskIdsFromText(parts[i]);
          const partKb = buildTaskListWithActionsKeyboard(partIds, mode);
          await ctx.telegram.sendMessage(chatId, parts[i], partKb);
        }
      }
    }
  } catch (error) {
    console.error("handleSortCallback failed", error);
    await ctx.answerCbQuery("Ошибка при сортировке").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
}

// ============================================================
// Scan On/Off — включить/выключить auto-scan для чата
// (работает и в группе, и из личного чата через /chats)
// ============================================================

async function handleScanOn(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!isCommand(message.text, "scan_on")) return false;

  if (!message.chat || (message.chat.type !== "group" && message.chat.type !== "supergroup")) {
    await ctx.reply("Команда /scan_on работает в групповых чатах.\nДля управления из личного чата используйте /chats");
    return true;
  }

  try {
    const chat = await upsertChatFromTelegramPayload({
      id: message.chat.id,
      title: "title" in message.chat ? message.chat.title : undefined,
      type: message.chat.type,
    });

    await setChatCaptureMode(chat.id, "auto_scan");
    await ctx.reply(
      "✅ Auto-scan включён для этого чата.\n" +
      "Бот будет каждые 30 мин анализировать сообщения и создавать задачи.\n\n" +
      "Управление: /chats (в личке)"
    );
    debugLog(`[scan] Auto-scan enabled for chat ${chat.id} ("${chat.title}")`);
  } catch (error) {
    console.error("Failed to enable scan", error);
    await ctx.reply("Ошибка при включении auto-scan.");
  }

  return true;
}

async function handleScanOff(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!isCommand(message.text, "scan_off")) return false;

  if (!message.chat || (message.chat.type !== "group" && message.chat.type !== "supergroup")) {
    await ctx.reply("Команда /scan_off работает в групповых чатах.\nДля управления из личного чата используйте /chats");
    return true;
  }

  try {
    const chat = await upsertChatFromTelegramPayload({
      id: message.chat.id,
      title: "title" in message.chat ? message.chat.title : undefined,
      type: message.chat.type,
    });

    await setChatCaptureMode(chat.id, "off");
    await ctx.reply("🔕 Auto-scan выключен.\nУправление: /chats (в личке)");
    debugLog(`[scan] Auto-scan disabled for chat ${chat.id} ("${chat.title}")`);
  } catch (error) {
    console.error("Failed to disable scan", error);
    await ctx.reply("Ошибка при выключении auto-scan.");
  }

  return true;
}

// ============================================================
// /chats — Центр управления чатами (из личного чата)
// ============================================================

function buildChatsControlPanel(chats: import("../models/chat").Chat[]) {
  const groupChats = chats.filter(
    (c) => c.type === "group" || c.type === "supergroup"
  );

  if (!groupChats.length) {
    return { text: "📭 Нет чатов.\nДобавьте бота в групповой чат — он появится здесь.", buttons: null };
  }

  const lines = groupChats.map((chat, i) => {
    const icon = chat.captureMode === "auto_scan" ? "🟢" : "⚪";
    const mode = chat.captureMode === "auto_scan" ? "SCAN ON" : "scan off";
    const lastScan = chat.lastScannedAt
      ? `последний скан: ${formatShortDate(chat.lastScannedAt)}`
      : "ещё не сканировался";
    return `${i + 1}. ${icon} <b>${escapeHtml(chat.title || "Без названия")}</b>\n   ${mode} · ${lastScan}`;
  });

  const text =
    `🎛 <b>Центр управления чатами</b>\n\n` +
    lines.join("\n\n") +
    `\n\n` +
    `Нажмите кнопку чтобы включить/выключить auto-scan:`;

  const buttons = groupChats.map((chat) => {
    const isOn = chat.captureMode === "auto_scan";
    const label = isOn
      ? `🔕 Выкл: ${(chat.title || "Без названия").slice(0, 25)}`
      : `🟢 Вкл: ${(chat.title || "Без названия").slice(0, 25)}`;
    return [Markup.button.callback(label, `ctl:scan:${chat.id}:${isOn ? "off" : "on"}`)];
  });

  // Кнопки "Включить все" / "Выключить все" / "Обновить"
  const hasAnyOn = groupChats.some((c) => c.captureMode === "auto_scan");
  const hasAnyOff = groupChats.some((c) => c.captureMode !== "auto_scan");

  const bottomRow = [];
  if (hasAnyOff) bottomRow.push(Markup.button.callback("🟢 Все ON", "ctl:scan_all:on"));
  if (hasAnyOn) bottomRow.push(Markup.button.callback("🔕 Все OFF", "ctl:scan_all:off"));
  bottomRow.push(Markup.button.callback("🔄 Обновить", "ctl:refresh"));
  buttons.push(bottomRow);

  return { text, buttons: Markup.inlineKeyboard(buttons) };
}

async function handleChatsCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!isCommand(message.text, "chats")) return false;

  try {
    const chats = await listChats(50);
    const { text, buttons } = buildChatsControlPanel(chats);

    if (buttons) {
      await ctx.reply(text, { parse_mode: "HTML", ...buttons });
    } else {
      await ctx.reply(text, { parse_mode: "HTML" });
    }
  } catch (error) {
    console.error("Failed to list chats", error);
    await ctx.reply("Ошибка при загрузке списка чатов.");
  }

  return true;
}

/** Callback handler для кнопок центра управления чатами */
async function handleControlPanelCallback(ctx: Context<Update>): Promise<boolean> {
  const callback = ctx.callbackQuery;
  if (!callback || !("data" in callback)) return false;

  const data = callback.data || "";
  if (!data.startsWith("ctl:")) return false;

  try {
    // ctl:scan:<chatId>:<on|off>
    if (data.startsWith("ctl:scan:") && !data.startsWith("ctl:scan_all:")) {
      const parts = data.split(":");
      if (parts.length !== 4) {
        await ctx.answerCbQuery("Ошибка.");
        return true;
      }
      const chatId = parts[2];
      const action = parts[3]; // "on" or "off"

      const newMode = action === "on" ? "auto_scan" as const : "off" as const;
      await setChatCaptureMode(chatId, newMode);

      const chat = await getChatById(chatId);
      const label = chat?.title || "чат";
      await ctx.answerCbQuery(
        action === "on"
          ? `✅ Scan ON: ${label}`
          : `🔕 Scan OFF: ${label}`
      );

      // Обновляем панель
      await refreshControlPanel(ctx);
      return true;
    }

    // ctl:scan_all:<on|off>
    if (data.startsWith("ctl:scan_all:")) {
      const action = data.split(":")[2]; // "on" or "off"
      const chats = await listChats(50);
      const groupChats = chats.filter(
        (c) => c.type === "group" || c.type === "supergroup"
      );

      const newMode = action === "on" ? "auto_scan" as const : "off" as const;
      for (const chat of groupChats) {
        await setChatCaptureMode(chat.id, newMode);
      }

      await ctx.answerCbQuery(
        action === "on"
          ? `✅ Scan включён для ${groupChats.length} чатов`
          : `🔕 Scan выключен для ${groupChats.length} чатов`
      );

      await refreshControlPanel(ctx);
      return true;
    }

    // ctl:refresh
    if (data === "ctl:refresh") {
      await ctx.answerCbQuery("Обновлено");
      await refreshControlPanel(ctx);
      return true;
    }
  } catch (error) {
    console.error("Failed to handle control panel callback", error);
    await ctx.answerCbQuery("Ошибка.");
  }

  return true;
}

/** Обновить сообщение с панелью управления */
async function refreshControlPanel(ctx: Context<Update>): Promise<void> {
  try {
    const chats = await listChats(50);
    const { text, buttons } = buildChatsControlPanel(chats);

    if (buttons) {
      await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
    } else {
      await ctx.editMessageText(text, { parse_mode: "HTML" });
    }
  } catch (error) {
    // editMessageText может упасть если текст не изменился
    debugLog("[chats] Failed to refresh control panel", error);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    });
  } catch {
    return iso;
  }
}

// ============================================================
// Priority — /priority <id|номер> <low|normal|high|urgent>
// ============================================================

async function handlePriorityCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!isCommand(message.text, "priority")) return false;

  const parts = message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    await ctx.reply("Использование: /priority <id|номер> <low|normal|high|urgent>");
    return true;
  }

  const taskIdOrNum = parts[1];
  const priorityStr = parts[2].toLowerCase();

  const validPriorities: TaskPriority[] = ["low", "normal", "high", "urgent"];
  if (!validPriorities.includes(priorityStr as TaskPriority)) {
    await ctx.reply(`Неверный приоритет. Допустимые: ${validPriorities.join(", ")}`);
    return true;
  }

  try {
    const task = await getTaskById(taskIdOrNum);
    if (!task) {
      await ctx.reply("Задача не найдена.");
      return true;
    }

    await updateTaskPriority(task.id, priorityStr as TaskPriority);
    const labels: Record<string, string> = {
      low: "🟢 low",
      normal: "⚪ normal",
      high: "🟠 high",
      urgent: "🔴 urgent",
    };
    await ctx.reply(`Приоритет задачи обновлён: ${labels[priorityStr]}\n${task.description.slice(0, 100)}`);
  } catch (error) {
    console.error("Failed to update priority", error);
    await ctx.reply("Ошибка при обновлении приоритета.");
  }

  return true;
}

// ============================================================
// Wait — /wait <id|номер> — перевести в статус "waiting"
// ============================================================

async function handleWaitCommand(ctx: Context<Update>): Promise<boolean> {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) return false;
  if (!isCommand(message.text, "wait")) return false;

  const parts = message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply("Использование: /wait <id задачи>\nПереводит задачу в статус «ожидание» + включает follow-up.");
    return true;
  }

  const taskId = parts[1];

  try {
    const task = await getTaskById(taskId);
    if (!task) {
      await ctx.reply("Задача не найдена.");
      return true;
    }

    await updateTaskStatus(task.id, "waiting");
    await updateTaskFollowUp(task.id, {
      enabled: true,
      checkAfterHours: 24,
      lastCheckedAt: new Date().toISOString(),
      lastNotifiedAt: null,
    });

    await ctx.reply(
      `⏳ Задача переведена в статус «ожидание».\n` +
      `Follow-up: бот напомнит если нет ответа через 24ч.\n` +
      `${task.description.slice(0, 100)}`
    );
  } catch (error) {
    console.error("Failed to set wait status", error);
    await ctx.reply("Ошибка при обновлении статуса.");
  }

  return true;
}

/** Команды по умолчанию (en + ru пользователи без своей локали) */
const BOT_COMMANDS = [
  { command: "start", description: "Приветствие и меню" },
  { command: "task", description: "Создать задачу" },
  { command: "l", description: "Список задач (сводка)" },
  { command: "my", description: "Мои задачи" },
  { command: "outbox", description: "Задачи, которые я поставил" },
  { command: "my_today", description: "На сегодня" },
  { command: "my_overdue", description: "Просроченные" },
  { command: "chat_tasks", description: "Задачи чата" },
  { command: "all_tasks", description: "Все задачи" },
  { command: "parse_today", description: "Разбор за сегодня" },
  { command: "parse_yesterday", description: "Разбор за вчера" },
  { command: "done", description: "Отметить выполненной" },
  { command: "del", description: "Удалить задачу" },
  { command: "priority", description: "Приоритет задачи" },
  { command: "wait", description: "В ожидание + follow-up" },
  { command: "chats", description: "Центр управления чатами" },
  { command: "scan_on", description: "Включить auto-scan (в группе)" },
  { command: "scan_off", description: "Выключить auto-scan (в группе)" },
  { command: "k", description: "В знания" },
  { command: "ksearch", description: "Поиск по знаниям" },
  { command: "ask", description: "Вопрос по базе (RAG)" },
  { command: "digest", description: "Дайджест по чату" },
  { command: "status", description: "Статус бота" },
  { command: "info", description: "Справка" },
];

/** Русские команды (меню для ru-локали) */
const BOT_COMMANDS_RU = [
  { command: "start", description: "Приветствие и меню" },
  { command: "task", description: "Создать задачу" },
  { command: "l", description: "Список задач (сводка)" },
  { command: "my", description: "Мои задачи" },
  { command: "outbox", description: "Задачи, которые я поставил" },
  { command: "my_today", description: "На сегодня" },
  { command: "my_overdue", description: "Просроченные" },
  { command: "chat_tasks", description: "Задачи чата" },
  { command: "all_tasks", description: "Все задачи" },
  { command: "parse_today", description: "Разбор за сегодня" },
  { command: "parse_yesterday", description: "Разбор за вчера" },
  { command: "done", description: "Отметить выполненной" },
  { command: "del", description: "Удалить задачу" },
  { command: "priority", description: "Приоритет задачи" },
  { command: "wait", description: "В ожидание + follow-up" },
  { command: "chats", description: "Центр управления чатами" },
  { command: "scan_on", description: "Включить auto-scan (в группе)" },
  { command: "scan_off", description: "Выключить auto-scan (в группе)" },
  { command: "k", description: "В знания" },
  { command: "ksearch", description: "Поиск по знаниям" },
  { command: "ask", description: "Вопрос по базе (RAG)" },
  { command: "digest", description: "Дайджест по чату" },
  { command: "status", description: "Статус бота" },
  { command: "info", description: "Справка" },
];

async function setBotCommandsMenu(): Promise<void> {
  if (!bot) return;
  try {
    await bot.telegram.setMyCommands(BOT_COMMANDS);
    await bot.telegram.setMyCommands(BOT_COMMANDS_RU, { language_code: "ru" });
    console.log("Bot commands menu set (default + ru)");
  } catch (e) {
    console.error("Failed to set bot commands", e);
  }
}

export function initTelegataskBot(): void {
  const token = assertToken();

  bot = new Telegraf(token);

  // Initialize skill router
  const tgService = new TelegramService();
  tgService.setBot(bot);
  skillRouter = new SkillRouter({
    kb: new KBService(),
    llm: new LLMService(),
    tg: tgService,
  });
  registerAllSkills(skillRouter);

  bot.start(handleStart);
  bot.on("callback_query", async (ctx) => {
    try {
      if (skillRouter) {
        const handled = await skillRouter.handleCallback(ctx);
        if (handled) return;
      }

      const handledControl = await handleControlPanelCallback(ctx);
      if (handledControl) return;

      const handledParse = await handleParseChatCallback(ctx);
      if (!handledParse) {
        await handleSortCallback(ctx);
      }
    } catch (error) {
      console.error("[bot] callback_query error", error);
      await ctx.answerCbQuery("Ошибка").catch(() => {});
    }
  });
  bot.on("message", async (ctx) => {
    logIncomingMessage(ctx);
    await storeIncomingMessage(ctx);
    await autoSaveFilesToKnowledge(ctx);
    try {
      // Try skill router first (for migrated commands)
      if (skillRouter) {
        const handled = await skillRouter.handleMessage(ctx);
        if (handled) return;
      }

      const handledInfo = await handleInfo(ctx);
      if (handledInfo) {
        return;
      }

      const handledHelp = await handleHelp(ctx);
      if (handledHelp) {
        return;
      }

      const handledStatus = await handleStatus(ctx);
      if (handledStatus) {
        return;
      }

      const handledImportantKnowledge = await handleKnowledgeImportantFollowup(ctx);
      if (handledImportantKnowledge) {
        return;
      }

      const handledList = await handleListTasks(ctx);
      if (handledList) {
        return;
      }

      const handledDone = await handleDoneCommand(ctx);
      if (handledDone) {
        return;
      }

      const handledDelete = await handleDeleteCommand(ctx);
      if (handledDelete) {
        return;
      }

      const handledProjects = await handleProjects(ctx);
      if (handledProjects) {
        return;
      }

      const handledSetProject = await handleSetProject(ctx);
      if (handledSetProject) {
        return;
      }

      const handledTeam = await handleTeam(ctx);
      if (handledTeam) {
        return;
      }

      const handledLinkTeam = await handleLinkTeam(ctx);
      if (handledLinkTeam) {
        return;
      }

      const handledAdmin = await handleAdmin(ctx);
      if (handledAdmin) {
        return;
      }

      const handledSetRole = await handleSetRole(ctx);
      if (handledSetRole) {
        return;
      }

      const handledAllow = await handleAllowDeny(ctx, "allow");
      if (handledAllow) {
        return;
      }

      const handledDeny = await handleAllowDeny(ctx, "deny");
      if (handledDeny) {
        return;
      }

      const handledSettings = await handleSettings(ctx);
      if (handledSettings) {
        return;
      }

      const handledTask = await handleTaskCommand(ctx);
      if (handledTask) {
        return;
      }

      const handledMy = await handleMyTasks(ctx);
      if (handledMy) {
        return;
      }

      const handledMyToday = await handleMyToday(ctx);
      if (handledMyToday) {
        return;
      }

      const handledMyOverdue = await handleMyOverdue(ctx);
      if (handledMyOverdue) {
        return;
      }

      const handledOutbox = await handleOutbox(ctx);
      if (handledOutbox) {
        return;
      }

      const handledParseToday = await handleParseCommand(ctx, "today");
      if (handledParseToday) {
        return;
      }

      const handledParseYesterday = await handleParseCommand(ctx, "yesterday");
      if (handledParseYesterday) {
        return;
      }

      const handledChatTasks = await handleChatTasks(ctx);
      if (handledChatTasks) {
        return;
      }

      const handledAllTasks = await handleAllTasks(ctx);
      if (handledAllTasks) {
        return;
      }

      const handledKnowledgeSearch = await handleKnowledgeSearch(ctx);
      if (handledKnowledgeSearch) {
        return;
      }

      const handledAsk = await handleAsk(ctx);
      if (handledAsk) {
        return;
      }

      const handledSearch = await handleSearch(ctx);
      if (handledSearch) {
        return;
      }

      const handledAutoplan = await handleAutoplan(ctx);
      if (handledAutoplan) {
        return;
      }

      const handledAnalyze = await handleAnalyze(ctx);
      if (handledAnalyze) {
        return;
      }

      const handledDigest = await handleDigest(ctx);
      if (handledDigest) {
        return;
      }

      const handledChats = await handleChatsCommand(ctx);
      if (handledChats) {
        return;
      }

      const handledScanOn = await handleScanOn(ctx);
      if (handledScanOn) {
        return;
      }

      const handledScanOff = await handleScanOff(ctx);
      if (handledScanOff) {
        return;
      }

      const handledPriority = await handlePriorityCommand(ctx);
      if (handledPriority) {
        return;
      }

      const handledWait = await handleWaitCommand(ctx);
      if (handledWait) {
        return;
      }

      const handledStub = await handleStubCommands(ctx);
      if (handledStub) {
        return;
      }

      await handleAutoTaskFromChat(ctx);
      await handleChatCommand(ctx);
      await handleForwardedMessage(ctx);
    } catch (error) {
      console.error("[bot] unhandled error", error);
    }
  });

  bot
    .launch()
    .then(async () => {
      console.log("telegatask bot launched (long polling)");
      await setBotCommandsMenu();
      if (skillRouter) {
        await skillRouter.initAll();
        console.log("[skills] All skills initialized");
      }
      startScheduler(bot!);
    })
    .catch((error) => {
      console.error("Failed to launch telegatask bot", error);
    });
}

export async function stopTelegataskBot(): Promise<void> {
  stopScheduler();
  if (skillRouter) {
    await skillRouter.destroyAll();
    skillRouter = null;
  }
  if (bot) {
    bot.stop("Shutting down telegatask bot");
  }
}
