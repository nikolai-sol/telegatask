/**
 * Команды бота и русские алиасы.
 * Используется для isCommand() и setMyCommands.
 */

/** Каноническое имя (en) → русские алиасы */
export const COMMAND_RU_ALIASES: Record<string, string[]> = {
  start: ["старт"],
  task: ["задача", "новая"],
  l: ["список", "сводка"],
  my: ["мои"],
  outbox: ["исходящие"],
  my_today: ["сегодня"],
  my_overdue: ["просрочено"],
  chat_tasks: ["задачи_чата"],
  all_tasks: ["все_задачи"],
  parse_today: ["разбор_сегодня"],
  parse_yesterday: ["разбор_вчера"],
  done: ["готово", "сделано"],
  del: ["удалить"],
  priority: ["приоритет"],
  wait: ["ожидание", "жди"],
  chats: ["чаты"],
  scan_on: ["скан_вкл"],
  scan_off: ["скан_выкл"],
  k: ["знания", "в_знания", "к"],
  ksearch: ["поиск"],
  ask: ["спроси", "вопрос"],
  status: ["статус"],
  info: ["справка", "помощь"],
  help: ["помощь"],
  projects: ["проекты"],
  setproject: ["проект"],
  team: ["команда"],
  link_team: ["привязать_команду"],
  admin: ["админ"],
  setrole: ["роль"],
  allow: ["разрешить"],
  deny: ["запретить"],
  settings: ["настройки"],
  search: ["искать"],
  autoplan: ["автоплан"],
  analyze: ["анализ"],
  digest: ["дайджест"],
  newtask: ["новая"],
};

/** Все варианты команды (канонический + алиасы) */
export function getCommandVariants(canonical: string): string[] {
  const aliases = COMMAND_RU_ALIASES[canonical] ?? [];
  return [canonical, ...aliases];
}
