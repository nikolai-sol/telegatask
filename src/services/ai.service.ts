import { getOrCreateAIContext, appendAIMessage } from './firestore.service';
import type { AIMode, Company, AIContext } from '../types/agency';
import {
  TENDER_SYSTEM_PROMPT as TENDER_PROMPT,
  CAMPAIGN_SYSTEM_PROMPT as CAMPAIGN_PROMPT,
  OPS_SYSTEM_PROMPT as OPS_PROMPT,
} from './ai-prompts';

// ============================================================
// Gemini HTTP helpers (same pattern as src/services/gemini.ts)
// ============================================================

type GeminiContentPart = { text?: string };
type GeminiCandidate = { content?: { parts?: GeminiContentPart[] } };
type GeminiResponse = { candidates?: GeminiCandidate[] };

type GeminiMessage = {
  role: 'user' | 'model';
  parts: { text: string }[];
};

function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

async function callGemini(params: {
  systemInstruction: string;
  history: GeminiMessage[];
  userMessage: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const apiKey = geminiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const model = geminiModel();

  const body = {
    system_instruction: { parts: [{ text: params.systemInstruction }] },
    contents: [
      ...params.history,
      { role: 'user', parts: [{ text: params.userMessage }] },
    ],
    generationConfig: {
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxOutputTokens ?? 2048,
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini request failed ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as GeminiResponse;
  return (
    data.candidates?.[0]?.content?.parts
      ?.map(p => p.text ?? '')
      .join('')
      .trim() ?? ''
  );
}

// ============================================================
// System Prompts — импортированы из ai-prompts.ts
// ============================================================

const SYSTEM_PROMPTS: Record<AIMode, string> = {
  tender: TENDER_PROMPT,
  campaign: CAMPAIGN_PROMPT,
  ops: OPS_PROMPT,
};

// ============================================================
// Build system prompt with company context
// ============================================================

function buildSystemPrompt(
  mode: AIMode,
  company?: Partial<Company>,
  context?: AIContext
): string {
  let prompt = SYSTEM_PROMPTS[mode];

  if (company) {
    prompt += '\n\n---\nКОНТЕКСТ ПРОЕКТА:\n';
    if (company.name) prompt += `Название: ${company.name}\n`;
    if (company.clientName) prompt += `Клиент: ${company.clientName}\n`;
    if (company.status) prompt += `Статус: ${company.status}\n`;
    if (company.description) prompt += `Описание: ${company.description}\n`;
  }

  if (context?.summary) {
    prompt += `\n---\nКРАТКОЕ РЕЗЮМЕ ПРЕДЫДУЩИХ ОБСУЖДЕНИЙ:\n${context.summary}`;
  }

  return prompt;
}

// ============================================================
// Main Agent Runner
// ============================================================

export async function runAgent(params: {
  mode: AIMode;
  companyId: string;
  userMessage: string;
  companyContext?: Partial<Company>;
}): Promise<string> {
  const { mode, companyId, userMessage, companyContext } = params;

  const aiContext = await getOrCreateAIContext(companyId, mode);
  const recentMessages = aiContext.messages.slice(-20);

  const systemWithContext = buildSystemPrompt(mode, companyContext, aiContext);

  // Build history for Gemini (user/model turns alternating)
  const history: GeminiMessage[] = recentMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const responseText = await callGemini({
    systemInstruction: systemWithContext,
    history,
    userMessage,
  });

  await appendAIMessage(aiContext.id, { role: 'user', content: userMessage });
  await appendAIMessage(aiContext.id, { role: 'assistant', content: responseText });

  return responseText;
}

// ============================================================
// Brief Parser (для Tender Agent)
// ============================================================

export async function parseBrief(briefText: string): Promise<{
  goals: string[];
  audience: string;
  budget?: string;
  timeline?: string;
  channels: string[];
  questions: string[];
  tasks: string[];
}> {
  const prompt = `
Проанализируй этот бриф и верни ТОЛЬКО JSON без markdown:
{
  "goals": ["цель 1", "цель 2"],
  "audience": "описание ЦА",
  "budget": "бюджет если указан",
  "timeline": "сроки если указаны",
  "channels": ["канал 1", "канал 2"],
  "questions": ["что нужно уточнить у клиента 1", "2"],
  "tasks": ["конкретная задача для команды 1", "2", "3"]
}

БРИФ:
${briefText}
  `.trim();

  try {
    const text = await callGemini({
      systemInstruction: 'Ты парсер брифов. Возвращай только валидный JSON.',
      history: [],
      userMessage: prompt,
      temperature: 0.2,
    });

    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      goals: [],
      audience: '',
      channels: [],
      questions: ['Не удалось распарсить бриф автоматически'],
      tasks: ['Изучить бриф вручную'],
    };
  }
}
