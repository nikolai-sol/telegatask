/**
 * Agency Skill — Agency OS команды для бота.
 *
 * Команды:
 *   /tender new <название>   — создать тендер
 *   /tender list             — список активных тендеров
 *   /campaign new <название> — создать кампанию
 *   /campaign list           — список активных кампаний
 *   /task <название>         — создать Ops задачу в Inbox
 *   /status                  — Agency OS статус (сводка)
 *   /agencystart             — Agency OS приветствие
 *
 * Callbacks:
 *   ai_tender_<id>           — запуск AI для тендера
 *   fire_task_<id>           — пометить задачу как Fire
 *   done_task_<id>           — завершить задачу
 *   create_tender_<fileId>   — создать тендер из файла
 *   attach_file_<fileId>     — прикрепить файл
 *   skip_file                — пропустить файл
 *   status_<companyId>_<s>   — сменить статус компании
 */

import type { Skill, SkillResult } from "../types";
import type { SkillContext } from "../../core/context";
import {
  createCompany,
  getCompaniesByType,
  updateCompanyStatus,
  createAgencyTask,
  updateAgencyTaskStatus,
  updateAgencyTaskFire,
} from "../../services/firestore.service";

const MINI_APP_URL = process.env.MINI_APP_URL || '';

// ============================================================
// Handlers
// ============================================================

async function handleTender(ctx: SkillContext): Promise<SkillResult> {
  const sub = ctx.args.trim();                // "new <name>" or "list"

  // /tender list
  if (sub.startsWith('list')) {
    const companies = await getCompaniesByType('tender');
    const active = companies.filter(c => !['won', 'lost'].includes(c.status as string));
    if (!active.length) {
      return ok('Активных тендеров нет.');
    }
    const lines = active.map(c => `• *${c.name}* — ${c.status}`).join('\n');
    return ok(`📥 *Активные тендеры (${active.length})*\n\n${lines}`);
  }

  // /tender new <name>
  const name = sub.replace(/^new\s*/i, '').trim() || 'Новый тендер';
  const company = await createCompany({
    name,
    type: 'tender',
    status: 'incoming',
    isFire: false,
    createdBy: String(ctx.telegramUserId),
    members: [String(ctx.telegramUserId)],
    metadata: {},
  });

  const openRow = MINI_APP_URL
    ? [{ text: '📋 Открыть в приложении', callbackData: `_webappurl_company_${company.id}` }]
    : [];

  return {
    handled: true,
    messages: [{
      text: `📥 *Тендер создан*\n\n*${company.name}*\nСтатус: Incoming\n\nID: \`${company.id}\``,
      parseMode: 'Markdown',
    }],
    buttons: [
      [{ text: '🤖 Запустить AI анализ', callbackData: `ai_tender_${company.id}` }],
      ...(openRow.length ? [openRow] : []),
    ],
  };
}

async function handleCampaign(ctx: SkillContext): Promise<SkillResult> {
  const sub = ctx.args.trim();

  // /campaign list
  if (sub.startsWith('list')) {
    const companies = await getCompaniesByType('campaign');
    const active = companies.filter(c => c.status !== 'completed');
    if (!active.length) {
      return ok('Активных кампаний нет.');
    }
    const lines = active.map(c => `• *${c.name}* — ${c.status}`).join('\n');
    return ok(`🟢 *Активные кампании (${active.length})*\n\n${lines}`);
  }

  // /campaign new <name>
  const name = sub.replace(/^new\s*/i, '').trim() || 'Новая кампания';
  const company = await createCompany({
    name,
    type: 'campaign',
    status: 'active',
    isFire: false,
    createdBy: String(ctx.telegramUserId),
    members: [String(ctx.telegramUserId)],
    metadata: {},
  });

  return {
    handled: true,
    messages: [{
      text: `🟢 *Кампания создана*\n\n*${company.name}*\nСтатус: Active\n\nID: \`${company.id}\``,
      parseMode: 'Markdown',
    }],
  };
}

async function handleTask(ctx: SkillContext): Promise<SkillResult> {
  const title = ctx.args.trim();
  if (!title) {
    return ok('Укажи название задачи: `/task Ответить юристам`');
  }

  const task = await createAgencyTask({
    title,
    status: 'todo',
    priority: 'normal',
    isFire: false,
    createdBy: String(ctx.telegramUserId),
  });

  return {
    handled: true,
    messages: [{
      text: `✅ *Задача добавлена в Inbox*\n\n${task.title}`,
      parseMode: 'Markdown',
    }],
    buttons: [[
      { text: '🔥 Fire', callbackData: `fire_task_${task.id}` },
      { text: '✅ Done', callbackData: `done_task_${task.id}` },
    ]],
  };
}

async function handleStatus(ctx: SkillContext): Promise<SkillResult> {
  const [tenders, campaigns] = await Promise.all([
    getCompaniesByType('tender'),
    getCompaniesByType('campaign'),
  ]);
  const activeTenders = tenders.filter(c => !['won', 'lost'].includes(c.status as string));
  const activeCampaigns = campaigns.filter(c => c.status !== 'completed');

  const text =
    `*Agency OS — Статус*\n\n` +
    `📥 Тендеры (активных): ${activeTenders.length}\n` +
    `🟢 Кампании (активных): ${activeCampaigns.length}\n\n` +
    (activeTenders.length
      ? `*Тендеры:*\n${activeTenders.slice(0, 5).map(c => `• ${c.name} — ${c.status}`).join('\n')}\n\n`
      : '') +
    (activeCampaigns.length
      ? `*Кампании:*\n${activeCampaigns.slice(0, 5).map(c => `• ${c.name} — ${c.status}`).join('\n')}`
      : '');

  return ok(text);
}

async function handleAgencyStart(ctx: SkillContext): Promise<SkillResult> {
  const name = ctx.user.displayName || 'коллега';
  return ok(
    `👋 *Agency OS* — привет, ${name}!\n\n` +
    `Команды:\n` +
    `/tender new <название> — создать тендер\n` +
    `/tender list — список тендеров\n` +
    `/campaign new <название> — создать кампанию\n` +
    `/campaign list — список кампаний\n` +
    `/task <название> — быстрая задача в Inbox\n` +
    `/status — сводка Agency OS`
  );
}

// ---- Callbacks ----------------------------------------------

async function handleCallback(ctx: SkillContext): Promise<SkillResult> {
  const data = ctx.callbackData || '';

  // 🤖 AI анализ тендера
  if (data.startsWith('ai_tender_')) {
    const companyId = data.slice('ai_tender_'.length);
    return {
      handled: true,
      callbackAnswer: '🤖 AI агент готов',
      messages: [{
        text:
          `🤖 *Tender AI агент*\n\nКонтекст загружен для проекта \`${companyId}\`.\n\n` +
          `Отправь бриф или задай вопрос командой:\n\`/ask tender ${companyId} <текст>\``,
        parseMode: 'Markdown',
      }],
    };
  }

  // 🔥 Fire задача
  if (data.startsWith('fire_task_')) {
    const taskId = data.slice('fire_task_'.length);
    await updateAgencyTaskFire(taskId, true);
    return { handled: true, callbackAnswer: '🔥 Задача помечена как Fire' };
  }

  // ✅ Done задача
  if (data.startsWith('done_task_')) {
    const taskId = data.slice('done_task_'.length);
    await updateAgencyTaskStatus(taskId, 'done');
    return { handled: true, callbackAnswer: '✅ Выполнено' };
  }

  // 📄 Создать тендер из файла
  if (data.startsWith('create_tender_')) {
    const fileId = data.slice('create_tender_'.length);
    const company = await createCompany({
      name: 'Тендер из документа',
      type: 'tender',
      status: 'incoming',
      isFire: false,
      createdBy: String(ctx.telegramUserId),
      members: [String(ctx.telegramUserId)],
      metadata: { sourceFileId: fileId },
    });
    return {
      handled: true,
      callbackAnswer: '📥 Тендер создан',
      messages: [{
        text:
          `📥 *Тендер создан*\n\nID: \`${company.id}\`\n\n` +
          `Документ прикреплён. Запусти AI анализ чтобы структурировать бриф.`,
        parseMode: 'Markdown',
      }],
      buttons: [[{ text: '🤖 Запустить AI анализ', callbackData: `ai_tender_${company.id}` }]],
    };
  }

  // ⏭ Пропустить файл
  if (data === 'skip_file') {
    return { handled: true, callbackAnswer: 'Пропущено' };
  }

  // Смена статуса: status_<companyId>_<newStatus>
  if (data.startsWith('status_')) {
    const parts = data.split('_');
    const companyId = parts[1];
    const newStatus = parts.slice(2).join('_');
    if (companyId && newStatus) {
      await updateCompanyStatus(companyId, newStatus);
      return {
        handled: true,
        callbackAnswer: `✅ Статус: ${newStatus}`,
        editMessage: true,
        messages: [{ text: `Статус обновлён: *${newStatus}*`, parseMode: 'Markdown' }],
      };
    }
  }

  return { handled: false };
}

// ============================================================
// Helpers
// ============================================================

function ok(text: string): SkillResult {
  return { handled: true, messages: [{ text, parseMode: 'Markdown' }] };
}

// ============================================================
// Skill definition
// ============================================================

export const agencySkill: Skill = {
  meta: {
    id: 'agency',
    name: 'Agency OS',
    description: 'Управление тендерами, кампаниями и задачами Agency OS',
    version: '1.0.0',
    triggers: [
      { type: 'command', command: 'tender', aliases: [] },
      { type: 'command', command: 'campaign' },
      { type: 'command', command: 'task' },
      { type: 'command', command: 'status' },
      { type: 'command', command: 'agencystart' },
      { type: 'callback', prefix: 'ai_tender_' },
      { type: 'callback', prefix: 'fire_task_' },
      { type: 'callback', prefix: 'done_task_' },
      { type: 'callback', prefix: 'create_tender_' },
      { type: 'callback', prefix: 'attach_file_' },
      { type: 'callback', prefix: 'skip_file' },
      { type: 'callback', prefix: 'status_' },
    ],
    permissions: {
      minPlan: 'free',
      minRole: 'member',
      chatType: 'any',
    },
    menuEntry: { command: 'status', description: 'Agency OS — сводка по тендерам и кампаниям' },
  },

  async execute(ctx: SkillContext): Promise<SkillResult> {
    if (ctx.triggerType === 'callback') {
      return handleCallback(ctx);
    }

    switch (ctx.command) {
      case 'tender':      return handleTender(ctx);
      case 'campaign':    return handleCampaign(ctx);
      case 'task':        return handleTask(ctx);
      case 'status':      return handleStatus(ctx);
      case 'agencystart': return handleAgencyStart(ctx);
      default:            return { handled: false };
    }
  },
};
