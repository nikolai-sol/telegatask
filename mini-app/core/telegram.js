/**
 * telegram.js — централизованный хелпер для Telegram WebApp API.
 *
 * Vanilla JS аналог React-хука useTelegram.
 * Используй этот модуль вместо прямых обращений к window.Telegram.WebApp
 * чтобы иметь единую точку входа и возможность мокировать в dev-режиме.
 *
 * Использование:
 *   import { tgUser, tgHaptic, tgShowBack, tgHideBack, startCompanyId } from './core/telegram.js';
 */

const tg = window.Telegram?.WebApp ?? null;

// Инициализация — вызывается один раз при старте приложения
if (tg) {
  tg.ready();
  tg.expand();
}

// ---- User ---------------------------------------------------

/**
 * Текущий пользователь из Telegram initData.
 * @type {{ id: number, first_name: string, last_name?: string, username?: string } | null}
 */
export const tgUser = tg?.initDataUnsafe?.user ?? null;

/** Raw initData строка для X-Telegram-Init-Data заголовка */
export const tgInitData = tg?.initData ?? '';

/** Платформа: 'ios' | 'android' | 'web' | 'unknown' */
export const tgPlatform = tg?.platform ?? 'unknown';

/** Цветовая схема: 'light' | 'dark' */
export const tgColorScheme = tg?.colorScheme ?? 'light';

// ---- Deeplink -----------------------------------------------

/**
 * Если Mini App открыт через deeplink ?startapp=company_<id>,
 * возвращает companyId (строку). Иначе null.
 *
 * Пример deeplink: https://t.me/<bot>/<app>?startapp=company_abc123
 */
export const startCompanyId = (() => {
  const param = tg?.initDataUnsafe?.start_param ?? null;
  return param?.startsWith('company_') ? param.slice('company_'.length) : null;
})();

// ---- Haptic Feedback ----------------------------------------

/**
 * Тактильная отдача.
 * @param {'light' | 'medium' | 'heavy'} type
 */
export function tgHaptic(type = 'light') {
  tg?.HapticFeedback?.impactOccurred(type);
}

// ---- Back Button --------------------------------------------

/**
 * Показать кнопку «Назад» с обработчиком.
 * Возвращает функцию-cleanup для снятия обработчика.
 * @param {() => void} onClick
 * @returns {() => void} cleanup
 */
export function tgShowBack(onClick) {
  if (!tg?.BackButton) return () => {};
  tg.BackButton.show();
  tg.BackButton.onClick(onClick);
  return () => {
    tg.BackButton.offClick(onClick);
    tg.BackButton.hide();
  };
}

/** Скрыть кнопку «Назад» */
export function tgHideBack() {
  tg?.BackButton?.hide();
}

// ---- Main Button --------------------------------------------

/**
 * Показать главную кнопку внизу экрана.
 * @param {{ text: string, color?: string, onClick: () => void }} opts
 * @returns {() => void} cleanup
 */
export function tgShowMainButton({ text, color, onClick }) {
  if (!tg?.MainButton) return () => {};
  tg.MainButton.setText(text);
  if (color) tg.MainButton.setParams({ color });
  tg.MainButton.show();
  tg.MainButton.onClick(onClick);
  return () => {
    tg.MainButton.offClick(onClick);
    tg.MainButton.hide();
  };
}

// ---- Theme --------------------------------------------------

/**
 * Цвета темы Telegram (если поддерживается).
 * @returns {{ bg: string, text: string, hint: string, link: string, button: string, buttonText: string }}
 */
export function tgThemeColors() {
  const p = tg?.themeParams ?? {};
  return {
    bg: p.bg_color ?? '#ffffff',
    text: p.text_color ?? '#000000',
    hint: p.hint_color ?? '#999999',
    link: p.link_color ?? '#2481cc',
    button: p.button_color ?? '#2481cc',
    buttonText: p.button_text_color ?? '#ffffff',
  };
}

// ---- API Base Detection -------------------------------------

/**
 * Определяет base URL для API (тот же алгоритм что в main.js).
 * Выделено сюда для переиспользования в модулях без дублирования.
 * @returns {string}
 */
export function detectApiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta?.content) return meta.content;

  const startParam = tg?.initDataUnsafe?.start_param ?? '';
  if (startParam.startsWith('api_')) {
    try {
      return atob(startParam.slice(4));
    } catch {
      // ignore
    }
  }

  return '';
}
