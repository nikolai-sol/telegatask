import { Context } from 'telegraf';
import { createAgencyTask, updateAgencyTaskStatus, updateAgencyTaskFire } from '../services/firestore.service';

// /task <название> — создаёт Ops задачу (без companyId = Inbox)
export async function handleQuickTask(ctx: Context) {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const title = text.replace(/^\/task\s*/i, '').trim();

  if (!title) {
    await ctx.reply(
      'Укажи название задачи:\n`/task Ответить юристам`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const task = await createAgencyTask({
    title,
    status: 'todo',
    priority: 'normal',
    isFire: false,
    createdBy: String(ctx.from!.id),
  });

  await ctx.reply(
    `✅ *Задача добавлена в Inbox*\n\n${task.title}\nID: \`${task.id}\``,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔥 Fire', callback_data: `fire_task_${task.id}` },
            { text: '✅ Done', callback_data: `done_task_${task.id}` },
          ],
        ],
      },
    }
  );
}

// Callback: пометить задачу как Fire
// Формат: fire_task_<taskId>
export async function handleFireTask(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const taskId = ctx.callbackQuery.data.replace('fire_task_', '');

  await updateAgencyTaskFire(taskId, true);
  await ctx.answerCbQuery('🔥 Задача помечена как Fire');
  await ctx.editMessageText(
    (ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message
      ? ctx.callbackQuery.message.text
      : '') + '\n\n🔥 *FIRE*',
    { parse_mode: 'Markdown' }
  );
}

// Callback: завершить задачу
// Формат: done_task_<taskId>
export async function handleDoneTask(ctx: Context) {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
  const taskId = ctx.callbackQuery.data.replace('done_task_', '');

  await updateAgencyTaskStatus(taskId, 'done');
  await ctx.answerCbQuery('✅ Задача выполнена');
  await ctx.editMessageText(
    (ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message
      ? ctx.callbackQuery.message.text
      : '') + '\n\n~~Выполнена~~',
    { parse_mode: 'Markdown' }
  );
}
