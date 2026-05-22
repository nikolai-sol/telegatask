# Agency OS — Knowledge Layer
# ТЗ для Claude Code v3
# Репо: https://github.com/nikolai-sol/telegatask

## Контекст

Уже реализовано (из аудита):
- ✅ `companies` / `agency_tasks` / `ai_contexts` коллекции
- ✅ `src/types/agency.ts` — типы Agency OS
- ✅ `src/services/ai.service.ts` — три агента (tender/campaign/ops)
- ✅ `src/commands/company.command.ts` — /tender, /campaign
- ✅ `src/commands/task.command.ts` — /task
- ✅ `src/handlers/file.handler.ts` — базовый file handler
- ✅ `src/api/routes.ts` — /agency/* endpoints
- ✅ `mini-app/core/telegram.js` — Telegram WebApp module
- ✅ Существующие skills (/k, /ask, /ksearch) — НЕ трогать

Задача этого PR: надстроить Knowledge Layer поверх существующего кода.
Не переписывать /k, /ask, /ksearch — расширить их под Agency OS модель.

---

## Задача 1: Новые типы — добавить в src/types/agency.ts

Добавь в конец существующего файла `src/types/agency.ts`:

```typescript
// ============================================================
// KNOWLEDGE LAYER TYPES
// ============================================================

// Тип документа/знания
export type KnowledgeType =
  | 'brief'          // бриф от клиента
  | 'strategy'       // стратегия агентства
  | 'mediaplan'      // медиаплан
  | 'link'           // ссылка (Drive, Figma, Notion, etc.)
  | 'agreement'      // устная договорённость зафиксированная текстом
  | 'best_practice'  // best practice агентства
  | 'platform_spec'  // ТТ площадки (Facebook Ads, TikTok, etc.)
  | 'case'           // успешный кейс
  | 'template'       // шаблон
  | 'note';          // произвольная заметка

// Уровень знания: привязано к проекту или глобальное
export type KnowledgeScope = 'company' | 'agency';

// Основная сущность базы знаний
export interface KnowledgeItem {
  id: string;

  // Привязка
  scope: KnowledgeScope;
  companyId?: string;    // если scope = 'company'
  taskId?: string;       // опционально привязка к задаче

  // Содержимое
  type: KnowledgeType;
  title: string;
  content?: string;      // текст: договорённость, извлечённый текст из PDF, заметка
  url?: string;          // ссылка: Drive, Figma, Notion, etc.
  extractedText?: string; // текст извлечённый из PDF/DOCX (для AI)
  summary?: string;      // краткое резюме (генерирует AI)

  // Файл из Telegram (если загружен напрямую)
  telegramFileId?: string;
  telegramFileName?: string;
  mimeType?: string;

  // Метаданные
  tags: string[];
  isImportant: boolean;  // /k! — помечено важным
  addedBy: string;       // telegramId пользователя
  source: 'telegram_file' | 'telegram_text' | 'telegram_link' | 'bot_command';

  createdAt: Date;
  updatedAt: Date;
}

// Глобальная база знаний агентства (ТТ, best practices)
export interface AgencyKnowledgeItem extends KnowledgeItem {
  scope: 'agency';
  platform?: string;     // 'facebook' | 'tiktok' | 'google' | 'ooh' | etc.
  category?: string;     // категория для навигации
  version?: string;      // версия документа (ТТ обновляются)
  validUntil?: Date;     // актуально до (для ТТ площадок)
}

// Результат поиска
export interface KnowledgeSearchResult {
  item: KnowledgeItem;
  relevanceScore: number;  // 0-1, простой keyword match
  matchedIn: ('title' | 'content' | 'tags' | 'summary')[];
}

// Контекст для AI — что передаётся агенту
export interface AIKnowledgeContext {
  companyDocuments: KnowledgeItem[];    // документы проекта
  agencyKnowledge: KnowledgeItem[];     // релевантные глобальные знания
  totalTokenEstimate: number;           // примерный размер контекста
}
```

---

## Задача 2: Firestore коллекции — добавить две новые

### 2.1 Создай `src/services/knowledge.service.ts`

```typescript
import { getFirestore, Timestamp, FieldValue, Query } from 'firebase-admin/firestore';
import type {
  KnowledgeItem, KnowledgeType, KnowledgeScope,
  KnowledgeSearchResult, AIKnowledgeContext
} from '../types/agency';

const db = getFirestore();

// ============================================================
// КОЛЛЕКЦИИ:
// knowledge_items    — документы привязанные к Company
// agency_knowledge   — глобальная БЗ агентства (ТТ, best practices)
// ============================================================

// ---- CREATE ------------------------------------------------

export async function addKnowledgeItem(
  data: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<KnowledgeItem> {
  // Выбираем коллекцию по scope
  const collection = data.scope === 'agency' ? 'agency_knowledge' : 'knowledge_items';

  const ref = db.collection(collection).doc();
  const now = Timestamp.now();
  const item = { ...data, createdAt: now, updatedAt: now };
  await ref.set(item);

  return {
    id: ref.id,
    ...item,
    createdAt: now.toDate(),
    updatedAt: now.toDate(),
  };
}

// ---- READ --------------------------------------------------

// Все документы конкретного проекта
export async function getCompanyKnowledge(companyId: string): Promise<KnowledgeItem[]> {
  const snap = await db.collection('knowledge_items')
    .where('companyId', '==', companyId)
    .orderBy('createdAt', 'desc')
    .get();

  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as KnowledgeItem);
}

// Только важные документы проекта (для AI контекста)
export async function getCompanyKnowledgeForAI(
  companyId: string,
  maxItems = 10
): Promise<KnowledgeItem[]> {
  // Сначала важные
  const importantSnap = await db.collection('knowledge_items')
    .where('companyId', '==', companyId)
    .where('isImportant', '==', true)
    .orderBy('createdAt', 'desc')
    .limit(maxItems)
    .get();

  const important = importantSnap.docs.map(d => ({ id: d.id, ...d.data() }) as KnowledgeItem);

  // Добавляем остальные если важных мало
  if (important.length < maxItems) {
    const restSnap = await db.collection('knowledge_items')
      .where('companyId', '==', companyId)
      .where('isImportant', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(maxItems - important.length)
      .get();

    const rest = restSnap.docs.map(d => ({ id: d.id, ...d.data() }) as KnowledgeItem);
    return [...important, ...rest];
  }

  return important;
}

// Глобальная БЗ агентства — по платформе или категории
export async function getAgencyKnowledge(params?: {
  platform?: string;
  category?: string;
  limit?: number;
}): Promise<KnowledgeItem[]> {
  let query: Query = db.collection('agency_knowledge')
    .orderBy('createdAt', 'desc');

  if (params?.platform) {
    query = query.where('platform', '==', params.platform);
  }
  if (params?.category) {
    query = query.where('category', '==', params.category);
  }

  const snap = await query.limit(params?.limit ?? 20).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as KnowledgeItem);
}

// ---- SEARCH ------------------------------------------------

// Простой keyword search — без vector store, работает через Firestore
// Для агентства 10-20 проектов этого достаточно
export async function searchKnowledge(params: {
  query: string;
  companyId?: string;
  scope?: KnowledgeScope;
  types?: KnowledgeType[];
  limit?: number;
}): Promise<KnowledgeSearchResult[]> {
  const { query, companyId, scope, limit = 10 } = params;
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 2);

  // Определяем коллекцию
  const collections: string[] = [];
  if (!scope || scope === 'company') collections.push('knowledge_items');
  if (!scope || scope === 'agency') collections.push('agency_knowledge');

  const allItems: KnowledgeItem[] = [];

  for (const col of collections) {
    let q: Query = db.collection(col).orderBy('createdAt', 'desc').limit(100);
    if (companyId && col === 'knowledge_items') {
      q = q.where('companyId', '==', companyId);
    }
    const snap = await q.get();
    allItems.push(...snap.docs.map(d => ({ id: d.id, ...d.data() }) as KnowledgeItem));
  }

  // Scoring: keyword matching по title, tags, content, summary
  const results: KnowledgeSearchResult[] = allItems
    .map(item => {
      let score = 0;
      const matched: KnowledgeSearchResult['matchedIn'] = [];

      const titleLower = item.title.toLowerCase();
      const contentLower = (item.content ?? '').toLowerCase();
      const summaryLower = (item.summary ?? '').toLowerCase();
      const tagsLower = item.tags.map(t => t.toLowerCase()).join(' ');

      for (const token of queryTokens) {
        if (titleLower.includes(token)) { score += 3; if (!matched.includes('title')) matched.push('title'); }
        if (tagsLower.includes(token)) { score += 2; if (!matched.includes('tags')) matched.push('tags'); }
        if (summaryLower.includes(token)) { score += 1.5; if (!matched.includes('summary')) matched.push('summary'); }
        if (contentLower.includes(token)) { score += 1; if (!matched.includes('content')) matched.push('content'); }
      }

      // Буст для важных документов
      if (item.isImportant) score *= 1.5;

      return { item, relevanceScore: score, matchedIn: matched };
    })
    .filter(r => r.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  return results;
}

// ---- AI CONTEXT BUILDER ------------------------------------

// Собирает контекст для AI агента: документы проекта + релевантная глобальная БЗ
export async function buildAIKnowledgeContext(
  companyId: string,
  userQuery?: string
): Promise<AIKnowledgeContext> {
  const [companyDocs, agencyDocs] = await Promise.all([
    getCompanyKnowledgeForAI(companyId, 10),
    // Если есть запрос — ищем релевантное из глобальной БЗ
    userQuery
      ? searchKnowledge({ query: userQuery, scope: 'agency', limit: 5 }).then(r => r.map(r => r.item))
      : getAgencyKnowledge({ limit: 5 }),
  ]);

  // Примерный подсчёт токенов (1 токен ≈ 4 символа)
  const totalText = [...companyDocs, ...agencyDocs]
    .map(d => `${d.title} ${d.content ?? ''} ${d.summary ?? ''}`)
    .join(' ');
  const totalTokenEstimate = Math.ceil(totalText.length / 4);

  return {
    companyDocuments: companyDocs,
    agencyKnowledge: agencyDocs,
    totalTokenEstimate,
  };
}

// ---- UPDATE / DELETE ----------------------------------------

export async function updateKnowledgeItem(
  id: string,
  scope: KnowledgeScope,
  updates: Partial<KnowledgeItem>
): Promise<void> {
  const collection = scope === 'agency' ? 'agency_knowledge' : 'knowledge_items';
  await db.collection(collection).doc(id).update({
    ...updates,
    updatedAt: Timestamp.now(),
  });
}

export async function deleteKnowledgeItem(id: string, scope: KnowledgeScope): Promise<void> {
  const collection = scope === 'agency' ? 'agency_knowledge' : 'knowledge_items';
  await db.collection(collection).doc(id).delete();
}
```

---

## Задача 3: PDF/DOCX парсинг — добавить в file handler

### 3.1 Установи зависимости

```bash
npm install pdf-parse mammoth
npm install --save-dev @types/pdf-parse
```

### 3.2 Создай `src/utils/document-parser.ts`

```typescript
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { Telegraf } from 'telegraf';

// Максимум символов текста для хранения в Firestore
// (Firestore лимит документа 1MB, оставляем запас)
const MAX_TEXT_LENGTH = 50_000;

export interface ParsedDocument {
  text: string;           // извлечённый текст
  truncated: boolean;     // был ли обрезан
  pageCount?: number;     // для PDF
  wordCount: number;
}

// Скачиваем файл из Telegram и возвращаем Buffer
export async function downloadTelegramFile(
  bot: Telegraf,
  fileId: string
): Promise<Buffer> {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Парсим PDF
export async function parsePDF(buffer: Buffer): Promise<ParsedDocument> {
  const data = await pdfParse(buffer);
  const text = data.text.trim();
  const truncated = text.length > MAX_TEXT_LENGTH;

  return {
    text: truncated ? text.slice(0, MAX_TEXT_LENGTH) + '\n[...текст обрезан]' : text,
    truncated,
    pageCount: data.numpages,
    wordCount: text.split(/\s+/).length,
  };
}

// Парсим DOCX
export async function parseDOCX(buffer: Buffer): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  const truncated = text.length > MAX_TEXT_LENGTH;

  return {
    text: truncated ? text.slice(0, MAX_TEXT_LENGTH) + '\n[...текст обрезан]' : text,
    truncated,
    wordCount: text.split(/\s+/).length,
  };
}

// Универсальный парсер — выбирает по MIME type
export async function parseDocument(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedDocument | null> {
  if (mimeType === 'application/pdf') return parsePDF(buffer);
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return parseDOCX(buffer);
  }
  // Остальные типы (изображения, таблицы) — не парсим текст
  return null;
}

// Генерируем теги из текста (простая эвристика)
export function extractTags(text: string, filename: string): string[] {
  const tags: string[] = [];
  const textLower = text.toLowerCase();
  const filenameLower = filename.toLowerCase();

  // Из имени файла
  const nameWords = filenameLower
    .replace(/[._-]/g, ' ')
    .replace(/\.(pdf|docx|doc)$/, '')
    .split(/\s+/)
    .filter(w => w.length > 3);
  tags.push(...nameWords.slice(0, 3));

  // Из содержимого — ключевые слова агентства
  const keywords = [
    'бриф', 'brief', 'стратегия', 'strategy', 'медиаплан', 'mediaplan',
    'бюджет', 'budget', 'кампания', 'campaign', 'тендер', 'tender',
    'клиент', 'client', 'kpi', 'цель', 'аудитория', 'audience',
    'facebook', 'tiktok', 'google', 'instagram', 'youtube', 'ooh',
  ];
  for (const keyword of keywords) {
    if (textLower.includes(keyword) && !tags.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return [...new Set(tags)].slice(0, 8); // максимум 8 тегов
}
```

### 3.3 Обнови `src/handlers/file.handler.ts`

Замени существующий `handleCreateTenderFromFile` и добавь `handleDocumentUpload`:

```typescript
import { Context } from 'telegraf';
import {
  downloadTelegramFile,
  parseDocument,
  extractTags,
} from '../utils/document-parser';
import { addKnowledgeItem } from '../services/knowledge.service';
import { createCompany } from '../services/firestore.service';
import { generateBriefSummary } from '../services/ai.service';

// Главный обработчик — срабатывает на любой документ отправленный боту
export async function handleDocument(ctx: Context) {
  if (!ctx.message || !('document' in ctx.message)) return;

  const doc = ctx.message.document;
  const fileName = doc.file_name ?? 'document';
  const mimeType = doc.mime_type ?? '';
  const fileId = doc.file_id;

  const isParseable = ['application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    .includes(mimeType);

  await ctx.reply(
    `📄 *${fileName}*\n${isParseable ? '✅ Могу извлечь текст' : '📎 Сохраню как ссылку'}\n\nЧто делаем?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📥 Создать тендер из брифа', callback_data: `kb_tender_${fileId}` }],
          [{ text: '📚 Добавить в базу знаний агентства', callback_data: `kb_agency_${fileId}` }],
          [{ text: '🔗 Просто сохранить ссылку', callback_data: `kb_ref_${fileId}` }],
        ],
      },
    }
  );
}

// Создать тендер из документа (бриф)
export async function handleTenderFromDoc(ctx: Context, fileId: string) {
  await ctx.answerCbQuery('⏳ Обрабатываю документ...');

  const processingMsg = await ctx.reply('📄 Извлекаю текст из документа...');

  try {
    // Скачиваем и парсим файл
    const buffer = await downloadTelegramFile(ctx.telegram as any, fileId);

    // Определяем тип по fileId (в реальности нужно хранить mimeType в callback_data или сессии)
    // Для MVP пробуем PDF, если не получится — DOCX
    let parsed = await parseDocument(buffer, 'application/pdf')
      ?? await parseDocument(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const userId = String(ctx.from!.id);
    let tenderName = 'Тендер из документа';
    let summary = '';
    const tags = parsed ? extractTags(parsed.text, 'brief') : ['бриф'];

    if (parsed?.text) {
      // Генерируем название и резюме через AI
      try {
        const aiResult = await generateBriefSummary(parsed.text);
        tenderName = aiResult.title ?? tenderName;
        summary = aiResult.summary ?? '';
      } catch {
        // AI не сработал — продолжаем без него
      }
    }

    // Создаём тендер
    const company = await createCompany({
      name: tenderName,
      type: 'tender',
      status: 'incoming',
      isFire: false,
      createdBy: userId,
      members: [userId],
      metadata: { sourceBriefFileId: fileId },
    });

    // Сохраняем документ в базу знаний привязанный к тендеру
    await addKnowledgeItem({
      scope: 'company',
      companyId: company.id,
      type: 'brief',
      title: `Бриф: ${tenderName}`,
      content: parsed?.text,
      extractedText: parsed?.text,
      summary,
      telegramFileId: fileId,
      tags,
      isImportant: true,
      addedBy: userId,
      source: 'telegram_file',
    });

    await ctx.telegram.deleteMessage(ctx.chat!.id, processingMsg.message_id);
    await ctx.reply(
      `✅ *Тендер создан*\n\n*${tenderName}*\n\n${summary ? `📋 ${summary}\n\n` : ''}` +
      `${parsed?.wordCount ? `📊 ${parsed.wordCount} слов извлечено из документа\n` : ''}` +
      `Теги: ${tags.map(t => `#${t}`).join(' ')}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🤖 AI анализ брифа', callback_data: `ai_tender_${company.id}` }],
            [{ text: '📋 Открыть тендер', web_app: {
              url: `${process.env.MINI_APP_URL}?startapp=company_${company.id}`
            }}],
          ],
        },
      }
    );
  } catch (err) {
    console.error('handleTenderFromDoc error:', err);
    await ctx.telegram.deleteMessage(ctx.chat!.id, processingMsg.message_id);
    await ctx.reply('❌ Не удалось обработать документ. Попробуй отправить текст брифа напрямую.');
  }
}

// Добавить в глобальную базу знаний агентства (ТТ, best practices)
export async function handleAddToAgencyKnowledge(ctx: Context, fileId: string) {
  await ctx.answerCbQuery('📚 Добавляю в базу знаний...');

  await ctx.reply(
    'Уточни тип документа:',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📐 ТТ площадки', callback_data: `kb_type_platform_spec_${fileId}` }],
          [{ text: '💡 Best practice', callback_data: `kb_type_best_practice_${fileId}` }],
          [{ text: '📑 Шаблон', callback_data: `kb_type_template_${fileId}` }],
          [{ text: '🏆 Кейс', callback_data: `kb_type_case_${fileId}` }],
        ],
      },
    }
  );
}
```

---

## Задача 4: Обновить AI сервис — добавить знания в контекст

### 4.1 Обнови `src/services/ai.service.ts`

Добавь функцию `generateBriefSummary` и обнови `buildSystemPrompt`:

```typescript
// Добавить импорт:
import { buildAIKnowledgeContext } from './knowledge.service';
import type { AIKnowledgeContext } from '../types/agency';

// Добавить функцию генерации резюме брифа:
export async function generateBriefSummary(briefText: string): Promise<{
  title: string;
  summary: string;
}> {
  const prompt = `
Проанализируй этот бриф и верни JSON (только JSON):
{
  "title": "краткое название тендера/проекта (до 60 символов)",
  "summary": "2-3 предложения: кто клиент, что хотят, ключевые параметры"
}

БРИФ:
${briefText.slice(0, 5000)}
`.trim();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

  try {
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    return { title: 'Новый тендер', summary: '' };
  }
}

// Обновить функцию runAgent — добавить знания в контекст:
export async function runAgent(params: {
  mode: AIMode;
  companyId: string;
  userMessage: string;
  companyContext?: Partial<Company>;
}): Promise<string> {
  const { mode, companyId, userMessage, companyContext } = params;

  const [aiContext, knowledgeContext] = await Promise.all([
    getOrCreateAIContext(companyId, mode),
    // Получаем документы проекта для AI контекста
    mode !== 'ops' ? buildAIKnowledgeContext(companyId, userMessage) : Promise.resolve(null),
  ]);

  const recentMessages = aiContext.messages.slice(-20);

  // Системный промпт теперь включает документы проекта
  const systemWithContext = buildSystemPromptWithKnowledge(
    mode,
    companyContext,
    aiContext,
    knowledgeContext
  );

  // ... остальной код runAgent без изменений
}

// Новая версия buildSystemPrompt с базой знаний:
function buildSystemPromptWithKnowledge(
  mode: AIMode,
  company?: Partial<Company>,
  context?: AIContext,
  knowledge?: AIKnowledgeContext | null
): string {
  let prompt = SYSTEM_PROMPTS[mode];

  if (company) {
    prompt += `\n\n---\nПРОЕКТ:\n`;
    if (company.name) prompt += `Название: ${company.name}\n`;
    if (company.clientName) prompt += `Клиент: ${company.clientName}\n`;
    if (company.status) prompt += `Статус: ${company.status}\n`;
    if (company.description) prompt += `Описание: ${company.description}\n`;
  }

  // Добавляем документы проекта
  if (knowledge?.companyDocuments?.length) {
    prompt += `\n\n---\nДОКУМЕНТЫ ПРОЕКТА:\n`;
    for (const doc of knowledge.companyDocuments) {
      prompt += `\n[${doc.type.toUpperCase()}] ${doc.title}\n`;
      if (doc.summary) prompt += `Резюме: ${doc.summary}\n`;
      if (doc.content && doc.content.length < 3000) {
        prompt += `Содержимое:\n${doc.content}\n`;
      } else if (doc.content) {
        prompt += `Фрагмент:\n${doc.content.slice(0, 2000)}...\n`;
      }
      if (doc.url) prompt += `Ссылка: ${doc.url}\n`;
    }
  }

  // Добавляем релевантные знания агентства
  if (knowledge?.agencyKnowledge?.length) {
    prompt += `\n\n---\nБАЗА ЗНАНИЙ АГЕНТСТВА:\n`;
    for (const doc of knowledge.agencyKnowledge) {
      prompt += `\n[${doc.type.toUpperCase()}] ${doc.title}\n`;
      if (doc.summary) prompt += `${doc.summary}\n`;
    }
  }

  if (context?.summary) {
    prompt += `\n\n---\nРЕЗЮМЕ ПРЕДЫДУЩИХ ОБСУЖДЕНИЙ:\n${context.summary}`;
  }

  return prompt;
}
```

---

## Задача 5: Обновить существующую команду /k

### 5.1 Найди файл с командой /k (скорее всего src/skills/ или src/commands/)

Добавь поддержку привязки к Company. Команда /k должна понимать контекст:

```typescript
// Новый формат команды /k:
// /k <текст>                    — добавить в личную БЗ (как раньше)
// /k #tender_<id> <текст>       — привязать к тендеру
// /k #campaign_<id> <текст>     — привязать к кампании
// /k! <текст>                   — важное (как раньше) + записать в agency_knowledge
// /k https://... <title>        — ссылка

// При получении команды /k — проверяем контекст сессии пользователя:
// если пользователь "внутри" какого-то Company (последнее взаимодействие) →
// предложить привязать к нему

// Добавь в обработчик /k:
async function handleKCommand(ctx: Context, text: string) {
  const userId = String(ctx.from!.id);
  const isImportant = text.startsWith('!') || ctx.message?.text?.startsWith('/k!');
  const cleanText = text.replace(/^!/, '').trim();

  // Определяем тип контента
  const urlMatch = cleanText.match(/^(https?:\/\/\S+)\s*(.*)?$/);
  const companyMatch = cleanText.match(/^#(tender|campaign|internal)_(\S+)\s+(.+)$/);

  let item: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>;

  if (urlMatch) {
    // Это ссылка
    item = {
      scope: 'company',  // если есть companyId — company, иначе agency
      type: 'link',
      title: urlMatch[2] || urlMatch[1],
      url: urlMatch[1],
      tags: extractTagsFromUrl(urlMatch[1]),
      isImportant,
      addedBy: userId,
      source: 'telegram_link',
    };
  } else if (companyMatch) {
    // Привязка к конкретному проекту
    item = {
      scope: 'company',
      companyId: companyMatch[2],
      type: 'agreement',
      title: companyMatch[3].slice(0, 100),
      content: companyMatch[3],
      tags: [],
      isImportant,
      addedBy: userId,
      source: 'telegram_text',
    };
  } else {
    // Обычная заметка
    item = {
      scope: isImportant ? 'agency' : 'company',
      type: isImportant ? 'best_practice' : 'note',
      title: cleanText.slice(0, 100),
      content: cleanText,
      tags: [],
      isImportant,
      addedBy: userId,
      source: 'telegram_text',
    };
  }

  await addKnowledgeItem(item);

  // Сохраняем и в старую KB для обратной совместимости
  // (вызови существующую функцию сохранения в Knowledge)
}

function extractTagsFromUrl(url: string): string[] {
  const tags: string[] = [];
  if (url.includes('drive.google')) tags.push('google-drive');
  if (url.includes('figma.com')) tags.push('figma');
  if (url.includes('notion.so') || url.includes('notion.site')) tags.push('notion');
  if (url.includes('docs.google')) tags.push('google-docs');
  return tags;
}
```

---

## Задача 6: API endpoints для Knowledge

### 6.1 Добавь в `src/api/routes.ts` — после существующих /agency/* роутов:

```typescript
// GET /agency/knowledge?companyId=&scope=&q=
router.get('/knowledge', async (req, res) => {
  const { companyId, scope, q, type } = req.query as Record<string, string>;

  if (q) {
    const results = await searchKnowledge({
      query: q,
      companyId,
      scope: scope as KnowledgeScope,
      limit: 20,
    });
    return res.json(results);
  }

  if (companyId) {
    const items = await getCompanyKnowledge(companyId);
    return res.json(items);
  }

  const items = await getAgencyKnowledge({ limit: 50 });
  res.json(items);
});

// POST /agency/knowledge — добавить документ/ссылку через API
router.post('/knowledge', async (req, res) => {
  const item = await addKnowledgeItem(req.body);
  res.json(item);
});

// DELETE /agency/knowledge/:id
router.delete('/knowledge/:id', async (req, res) => {
  const { scope = 'company' } = req.query as { scope: KnowledgeScope };
  await deleteKnowledgeItem(req.params.id, scope);
  res.json({ ok: true });
});
```

---

## Задача 7: Firestore indexes — добавить в firestore.indexes.json

```json
{
  "indexes": [
    {
      "collectionGroup": "knowledge_items",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "companyId", "order": "ASCENDING" },
        { "fieldPath": "isImportant", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "knowledge_items",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "companyId", "order": "ASCENDING" },
        { "fieldPath": "isImportant", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "agency_knowledge",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "platform", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "agency_knowledge",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

## Задача 8: Mini App — Knowledge UI

### В mini-app добавь модуль `mini-app/modules/knowledge/`

```
mini-app/modules/knowledge/
  knowledge.js        — API calls к /agency/knowledge
  KnowledgeList.js    — список документов проекта
  KnowledgeSearch.js  — поиск по базе знаний
```

**knowledge.js:**
```javascript
import { getInitData } from '../../core/telegram.js';

const API_BASE = '/agency';

export async function getCompanyKnowledge(companyId) {
  const res = await fetch(`${API_BASE}/knowledge?companyId=${companyId}`, {
    headers: { 'x-telegram-init-data': getInitData() },
  });
  return res.json();
}

export async function searchKnowledge(query, companyId) {
  const params = new URLSearchParams({ q: query });
  if (companyId) params.set('companyId', companyId);

  const res = await fetch(`${API_BASE}/knowledge?${params}`, {
    headers: { 'x-telegram-init-data': getInitData() },
  });
  return res.json();
}

export async function addLink(url, title, companyId) {
  const res = await fetch(`${API_BASE}/knowledge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': getInitData(),
    },
    body: JSON.stringify({
      scope: companyId ? 'company' : 'agency',
      companyId,
      type: 'link',
      title: title || url,
      url,
      tags: [],
      isImportant: false,
      source: 'telegram_link',
    }),
  });
  return res.json();
}
```

---

## Задача 9: Финальный аудит Knowledge Layer

После всех изменений заполни:

| Компонент | Статус | Файл |
|-----------|--------|------|
| `KnowledgeItem` тип | ? | src/types/agency.ts |
| `knowledge.service.ts` | ? | src/services/ |
| `document-parser.ts` | ? | src/utils/ |
| `pdf-parse` + `mammoth` установлены | ? | package.json |
| file.handler.ts обновлён | ? | src/handlers/ |
| `generateBriefSummary` в ai.service | ? | src/services/ |
| `runAgent` использует знания | ? | src/services/ |
| /k команда обновлена | ? | src/commands/ или src/skills/ |
| API /agency/knowledge | ? | src/api/routes.ts |
| Firestore indexes добавлены | ? | firestore.indexes.json |
| Mini App knowledge модуль | ? | mini-app/modules/ |

### Что НЕ менять
- Существующие collections: `tasks`, `campaigns`, `knowledge` (старые)
- Существующие skills: /k, /ksearch, /ask, /digest — только расширить /k
- `firebase.json`, `.firebaserc`

---

## ENV — проверь что есть

```env
TELEGRAM_BOT_TOKEN=...
GEMINI_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
MINI_APP_URL=https://your-miniapp.web.app
NODE_ENV=development
```

---

*v3 | Agency OS — Knowledge Layer | Firebase edition*
