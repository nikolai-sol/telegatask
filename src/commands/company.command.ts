import { Context } from 'telegraf';
import {
  createCompany,
  getCompaniesByType,
  updateCompanyStatus,
} from '../services/firestore.service';

const MINI_APP_URL = process.env.MINI_APP_URL || '';

// /tender new <название>
export async function handleNewTender(ctx: Context) {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const name = text.replace(/^\/tender\s+new\s*/i, '').trim() || 'Новый тендер';

  const company = await createCompany({
    name,
    type: 'tender',
    status: 'incoming',
    isFire: false,
    createdBy: String(ctx.from!.id),
    members: [String(ctx.from!.id)],
    metadata: {},
  });

  await ctx.reply(
    `📥 *Тендер создан*\n\n*${company.name}*\nСтатус: Incoming\n\nID: \`${company.id}\``,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤖 Запустить AI анализ', callback_data: `ai_tender_${company.id}` }],
          ...(MINI_APP_URL
            ? [[{
                text: '📋 Открыть в приложении',
                web_app: { url: `${MINI_APP_URL}?startapp=company_${company.id}` },
              }]]
            : []),
        ],
      },
    }
  );
}

// /campaign new <название>
export async function handleNewCampaign(ctx: Context) {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const name = text.replace(/^\/campaign\s+new\s*/i, '').trim() || 'Новая кампания';

  const company = await createCompany({
    name,
    type: 'campaign',
    status: 'active',
    isFire: false,
    createdBy: String(ctx.from!.id),
    members: [String(ctx.from!.id)],
    metadata: {},
  });

  await ctx.reply(
    `🟢 *Кампания создана*\n\n*${company.name}*\nСтатус: Active\n\nID: \`${company.id}\``,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          ...(MINI_APP_URL
            ? [[{
                text: '📋 Открыть',
                web_app: { url: `${MINI_APP_URL}?startapp=company_${company.id}` },
              }]]
            : []),
        ],
      },
    }
  );
}

// /tenders — список активных тендеров
export async function handleListTenders(ctx: Context) {
  const companies = await getCompaniesByType('tender');
  const active = companies.filter(c => !['won', 'lost'].includes(c.status));

  if (!active.length) {
    await ctx.reply('Активных тендеров нет.');
    return;
  }

  const lines = active.map(c => `• *${c.name}* — ${c.status} \`${c.id}\``);
  await ctx.reply(`📥 *Активные тендеры (${active.length})*\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
  });
}

// /campaigns list — список активных кампаний
export async function handleListCampaigns(ctx: Context) {
  const companies = await getCompaniesByType('campaign');
  const active = companies.filter(c => c.status !== 'completed');

  if (!active.length) {
    await ctx.reply('Активных кампаний нет.');
    return;
  }

  const lines = active.map(c => `• *${c.name}* — ${c.status} \`${c.id}\``);
  await ctx.reply(`🟢 *Активные кампании (${active.length})*\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
  });
}

// Callback: смена статуса через inline кнопки
// Формат callback_data: status_<companyId>_<newStatus>
export async function handleStatusChange(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const parts = ctx.callbackQuery.data.split('_');
  // parts: ['status', companyId, newStatus]
  const companyId = parts[1];
  const newStatus = parts.slice(2).join('_');

  if (!companyId || !newStatus) {
    await ctx.answerCbQuery('Неверный формат');
    return;
  }

  await updateCompanyStatus(companyId, newStatus);
  await ctx.answerCbQuery(`✅ Статус изменён: ${newStatus}`);
  await ctx.editMessageText(`Статус обновлён: *${newStatus}*`, { parse_mode: 'Markdown' });
}

// Callback: запуск AI агента для тендера
// Формат callback_data: ai_tender_<companyId>
export async function handleAITenderCallback(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const companyId = ctx.callbackQuery.data.replace('ai_tender_', '');

  await ctx.answerCbQuery('🤖 AI агент запущен...');
  await ctx.reply(
    `🤖 *Tender AI агент готов*\n\nОтправь бриф или задай вопрос по тендеру \`${companyId}\`.\n\nДля отправки брифа используй команду:\n\`/ask tender ${companyId} <текст>\``,
    { parse_mode: 'Markdown' }
  );
}
