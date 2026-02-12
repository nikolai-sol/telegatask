/**
 * Skill System — типы и интерфейсы.
 *
 * Skill = модуль, который:
 * - знает, какие команды/триггеры обслуживает
 * - имеет описание, права доступа, лимиты (paywall)
 * - умеет execute(ctx) и вернуть ответ/действия
 * - может пользоваться общими сервисами
 */

import type { SkillContext } from "../core/context";

// ============================================================
// Trigger types
// ============================================================

/** Команда: /ask, /k, /chats и т.д. */
export interface CommandTrigger {
  type: "command";
  command: string; // без / (например "ask")
  aliases?: string[]; // альтернативные команды
}

/** Callback query: inline-кнопки */
export interface CallbackTrigger {
  type: "callback";
  prefix: string; // e.g. "ctl:" — совпадение по началу callback_data
}

/** Текстовый паттерн: regex или ключевые слова */
export interface TextTrigger {
  type: "text";
  pattern: RegExp;
  /** Приоритет при конфликте (выше = важнее, default 0) */
  priority?: number;
}

/** Событие (cron, system event) */
export interface EventTrigger {
  type: "event";
  event: string; // "cron:scan" | "cron:reminders" | "message:group" и т.д.
}

export type SkillTrigger = CommandTrigger | CallbackTrigger | TextTrigger | EventTrigger;

// ============================================================
// Plan & Permissions
// ============================================================

export type PlanTier = "free" | "pro" | "team" | "enterprise";

export type UserRole = "owner" | "admin" | "member" | "viewer";

export interface SkillPermissions {
  /** Минимальный план для использования */
  minPlan: PlanTier;
  /** Минимальная роль (null = любой) */
  minRole?: UserRole | null;
  /** Работает только в группах? Только в личке? Везде? */
  chatType?: "private" | "group" | "any";
}

// ============================================================
// Skill Result
// ============================================================

export interface SkillMessage {
  text: string;
  parseMode?: "HTML" | "Markdown";
}

export interface SkillAction {
  type: "create_task" | "save_knowledge" | "log_action" | "update_entity" | "send_dm" | "custom";
  payload: Record<string, unknown>;
}

export interface SkillButton {
  text: string;
  callbackData: string;
}

export interface SkillResult {
  /** Сообщения для ответа */
  messages?: SkillMessage[];
  /** Действия для выполнения (задачи, логи, etc.) */
  actions?: SkillAction[];
  /** Inline-кнопки */
  buttons?: SkillButton[][];
  /** Если true — обновить текущее сообщение (editMessageText) */
  editMessage?: boolean;
  /** Ответ на callback query */
  callbackAnswer?: string;
  /** Скилл обработал запрос? (false = передать дальше) */
  handled: boolean;
  /** Не списывать usage (для промежуточных шагов, напр. выбор чата) */
  skipUsageIncrement?: boolean;
}

// ============================================================
// Skill interface
// ============================================================

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Все триггеры, на которые реагирует скилл */
  triggers: SkillTrigger[];
  /** Права доступа и план */
  permissions: SkillPermissions;
  /** Описание для меню бота */
  menuEntry?: {
    command: string;
    description: string;
  };
  /** Клавиатурная кнопка (для reply keyboard) */
  keyboardButton?: string;
}

export interface Skill {
  meta: SkillMeta;
  /** Основной обработчик */
  execute(ctx: SkillContext): Promise<SkillResult>;
  /** Опционально: инициализация при старте (например, запуск cron) */
  onInit?(): Promise<void>;
  /** Опционально: cleanup при остановке */
  onDestroy?(): Promise<void>;
}
