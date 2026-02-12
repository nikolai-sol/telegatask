/**
 * LLM Service — Gemini AI operations для скиллов.
 */

import {
  extractTasksWithGemini,
  inferDueDateWithGemini,
  askWithGemini,
  type GeminiTaskExtractionInput,
  type GeminiExtractedTask,
  type AskContextItem,
} from "../../services/gemini";

export class LLMService {
  /** Извлечь задачи из сообщений */
  async extractTasks(
    messages: GeminiTaskExtractionInput[],
    now: Date = new Date()
  ): Promise<GeminiExtractedTask[] | null> {
    return extractTasksWithGemini(messages, now);
  }

  /** Определить дедлайн из текста */
  async inferDueDate(text: string, now: Date = new Date()): Promise<string | null> {
    return inferDueDateWithGemini(text, now);
  }

  /** RAG-ответ по базе знаний */
  async ask(question: string, context: AskContextItem[]): Promise<string | null> {
    return askWithGemini(question, context);
  }

  /** Произвольный запрос к Gemini */
  async generate(prompt: string, json: boolean = false): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[LLM] GEMINI_API_KEY not set");
      return null;
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: json
              ? { responseMimeType: "application/json" }
              : { temperature: 0.3, maxOutputTokens: 2048 },
          }),
        }
      );

      if (!res.ok) {
        const errBody = await res.text();
        console.error(`[LLM] Gemini API error ${res.status}:`, errBody.slice(0, 300));
        return null;
      }

      const data = (await res.json()) as any;
      return (
        data.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text ?? "")
          .join("")
          .trim() ?? null
      );
    } catch (err) {
      console.error("[LLM] Gemini request failed:", err);
      return null;
    }
  }
}
