/**
 * Scheduler — управляет всеми cron-задачами.
 *
 * - Auto-scan чатов: каждые 30 мин
 * - Deadline reminders: каждые 5 мин
 * - Follow-up: каждые 30 мин
 * - Unanswered mentions: каждые 15 мин
 * - Morning briefs: каждую минуту (проверяет timezone)
 * - Evening digests: каждую минуту (проверяет timezone)
 */

import cron from "node-cron";
import { Telegraf } from "telegraf";
import { runAutoScan } from "./scanner";
import {
  checkDeadlineReminders,
  checkFollowUps,
  checkUnansweredMentions,
  setRemindersBotInstance,
} from "./reminders";
import {
  sendMorningBriefs,
  sendEveningDigests,
  setBriefingBotInstance,
} from "./briefing";
import { debugLog } from "../config/debug";

const jobs: ReturnType<typeof cron.schedule>[] = [];

/**
 * Запустить все cron-задачи. Вызывается после bot.launch().
 */
export function startScheduler(bot: Telegraf): void {
  // Передаём bot instance в сервисы
  setRemindersBotInstance(bot);
  setBriefingBotInstance(bot);

  console.log("[scheduler] Starting cron jobs...");

  // 1. Auto-scan чатов — каждые 30 мин
  jobs.push(
    cron.schedule("*/30 * * * *", async () => {
      debugLog("[scheduler] Running auto-scan...");
      try {
        const results = await runAutoScan();
        const total = results.reduce((s, r) => s + r.tasksCreated, 0);
        if (total > 0) {
          // Уведомляем всех пользователей о найденных задачах
          await notifyScanResults(bot, results);
        }
      } catch (error) {
        console.error("[scheduler] Auto-scan cron failed", error);
      }
    })
  );

  // 2. Deadline reminders — каждые 5 мин
  jobs.push(
    cron.schedule("*/5 * * * *", async () => {
      debugLog("[scheduler] Checking deadline reminders...");
      try {
        const count = await checkDeadlineReminders();
        if (count > 0) debugLog(`[scheduler] Sent ${count} deadline reminders`);
      } catch (error) {
        console.error("[scheduler] Deadline reminders cron failed", error);
      }
    })
  );

  // 3. Follow-up — каждые 30 мин
  jobs.push(
    cron.schedule("15,45 * * * *", async () => {
      debugLog("[scheduler] Checking follow-ups...");
      try {
        const count = await checkFollowUps();
        if (count > 0) debugLog(`[scheduler] Sent ${count} follow-up notifications`);
      } catch (error) {
        console.error("[scheduler] Follow-up cron failed", error);
      }
    })
  );

  // 4. Unanswered mentions — каждые 15 мин
  jobs.push(
    cron.schedule("3,18,33,48 * * * *", async () => {
      debugLog("[scheduler] Checking unanswered mentions...");
      try {
        const count = await checkUnansweredMentions();
        if (count > 0) debugLog(`[scheduler] Sent ${count} unanswered mention notifications`);
      } catch (error) {
        console.error("[scheduler] Unanswered mentions cron failed", error);
      }
    })
  );

  // 5. Morning briefs — каждую минуту (проверяет timezone внутри)
  jobs.push(
    cron.schedule("* * * * *", async () => {
      try {
        await sendMorningBriefs();
      } catch (error) {
        console.error("[scheduler] Morning briefs cron failed", error);
      }
    })
  );

  // 6. Evening digests — каждую минуту (проверяет timezone внутри)
  jobs.push(
    cron.schedule("* * * * *", async () => {
      try {
        await sendEveningDigests();
      } catch (error) {
        console.error("[scheduler] Evening digests cron failed", error);
      }
    })
  );

  console.log(`[scheduler] ${jobs.length} cron jobs started`);
}

/**
 * Остановить все cron-задачи.
 */
export function stopScheduler(): void {
  jobs.forEach((job) => job.stop());
  jobs.length = 0;
  console.log("[scheduler] All cron jobs stopped");
}

/**
 * Уведомить пользователей о результатах auto-scan.
 * Шлём тем, у кого появились новые задачи.
 */
async function notifyScanResults(
  bot: Telegraf,
  results: { chatId: string; chatTitle: string; tasksCreated: number }[]
): Promise<void> {
  const withTasks = results.filter((r) => r.tasksCreated > 0);
  if (!withTasks.length) return;

  // Формируем сводку
  const lines = withTasks.map(
    (r) => `• "${r.chatTitle}": ${r.tasksCreated} задач`
  );
  const summary =
    `🔍 <b>Auto-scan завершён</b>\n\n` +
    `Найдено новых задач:\n` +
    lines.join("\n") +
    `\n\nПосмотреть: /my или /all_tasks`;

  // Шлём всем активным пользователям (тем, кто имеет telegramId > 0)
  // В будущем: только owner/admin организации
  try {
    const { listAllUsers } = await import("../repositories/userRepository");
    const users = await listAllUsers();
    for (const user of users) {
      if (user.telegramId > 0) {
        try {
          await bot.telegram.sendMessage(user.telegramId, summary, {
            parse_mode: "HTML",
          });
        } catch {
          // user may not have started bot
        }
      }
    }
  } catch (error) {
    debugLog("[scheduler] Failed to send scan notifications", error);
  }
}
