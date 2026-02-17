import { Context } from 'telegraf';
import { parseBrief } from '../services/ai.service';
import { createCompany, createAgencyTask } from '../services/firestore.service';

const MINI_APP_URL = process.env.MINI_APP_URL || '';

// Обработчик входящих документов (PDF, DOCX, TXT и т.д.)
export async function handleDocument(ctx: Context) {
  if (!ctx.message || !('document' in ctx.message)) return;

  const doc = ctx.message.document;
  const fileId = doc.file_id;
  const fileName = doc.file_name || 'document';
  const mimeType = doc.mime_type || '';

  const isParseable =
    mimeType.includes('text') ||
    mimeType.includes('pdf') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.txt') ||
    fileName.endsWith('.md');

  await ctx.reply(
    `📄 Получил файл: *${fileName}*\n\nЧто делаем с ним?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📥 Создать тендер + AI анализ', callback_data: `create_tender_${fileId}` }],
          [{ text: '📎 Прикрепить к проекту', callback_data: `attach_file_${fileId}` }],
          [{ text: '⏭ Пропустить', callback_data: 'skip_file' }],
        ],
      },
    }
  );
}

// Callback: создать тендер из файла
// Формат: create_tender_<fileId>
export async function handleCreateTenderFromFile(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const fileId = ctx.callbackQuery.data.replace('create_tender_', '');

  await ctx.answerCbQuery('⏳ Создаю тендер...');

  const company = await createCompany({
    name: 'Тендер из документа',
    type: 'tender',
    status: 'incoming',
    isFire: false,
    createdBy: String(ctx.from!.id),
    members: [String(ctx.from!.id)],
    metadata: { sourceFileId: fileId },
  });

  const openBtn = MINI_APP_URL
    ? [[{
        text: '📋 Открыть в приложении',
        web_app: { url: `${MINI_APP_URL}?startapp=company_${company.id}` },
      }]]
    : [];

  await ctx.editMessageText(
    `📥 *Тендер создан*\n\n*${company.name}*\nID: \`${company.id}\`\n\nДокумент прикреплён. Запусти AI анализ чтобы структурировать бриф.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤖 Запустить AI анализ', callback_data: `ai_tender_${company.id}` }],
          ...openBtn,
        ],
      },
    }
  );
}

// Callback: прикрепить файл к существующему проекту
// Формат: attach_file_<fileId>
export async function handleAttachFile(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const fileId = ctx.callbackQuery.data.replace('attach_file_', '');

  await ctx.answerCbQuery('📎 Укажи ID проекта');
  await ctx.reply(
    `Отправь ID компании/проекта к которому прикрепить файл \`${fileId}\`:`,
    { parse_mode: 'Markdown' }
  );
}

// Callback: пропустить файл
export async function handleSkipFile(ctx: Context) {
  if (!ctx.callbackQuery) return;
  await ctx.answerCbQuery('Пропущено');
  await ctx.deleteMessage();
}
