type GeminiContentPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiContentPart[];
  };
};

export type GeminiTaskExtractionInput = {
  messageId: number;
  fromUsername?: string | null;
  fromDisplayName?: string | null;
  text: string;
};

export type GeminiExtractedTask = {
  messageId: number;
  description: string;
  assignees?: string[] | null;
  dueDate?: string | null;
};

function extractJsonPayload(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseDueDateValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export async function inferDueDateWithGemini(
  text: string,
  now: Date
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt =
    "Ты — помощник, который извлекает срок задачи из текста.\n" +
    `Текущая дата/время (ISO): ${now.toISOString()}.\n` +
    "Верни ТОЛЬКО JSON вида: {\"dueDate\":\"<ISO8601>\"} или {\"dueDate\":null}.\n" +
    "Если срок не указан — null. Если срок относительный — пересчитай от текущей даты.\n" +
    "Текст:\n" +
    text;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini request failed", res.status);
      return null;
    }

    const data = (await res.json()) as { candidates?: GeminiCandidate[] };
    const textPart =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    const jsonText = extractJsonPayload(textPart);
    if (!jsonText) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as { dueDate?: unknown };
    return parseDueDateValue(parsed.dueDate);
  } catch (error) {
    console.error("Gemini due date parse failed", error);
    return null;
  }
}

export async function extractTasksWithGemini(
  messages: GeminiTaskExtractionInput[],
  now: Date
): Promise<GeminiExtractedTask[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!messages.length) {
    return [];
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const lines = messages.map((msg) => {
    const author = msg.fromUsername
      ? `@${msg.fromUsername}`
      : msg.fromDisplayName || "user";
    return `[id:${msg.messageId}] ${author}: ${msg.text}`;
  });

  const prompt =
    "Ты выделяешь задачи из сообщений чата.\n" +
    `Текущая дата/время (ISO): ${now.toISOString()}.\n` +
    "Верни ТОЛЬКО JSON массив задач. Формат элемента:\n" +
    "{\"messageId\":123,\"description\":\"...\",\"assignees\":[\"username\"],\"dueDate\":\"<ISO8601>|null\"}.\n" +
    "Если задача не содержит упоминаний, assignees = [].\n" +
    "Если срок не указан — dueDate = null.\n" +
    "Не придумывай задачи, используй только текст сообщений.\n" +
    "Сообщения:\n" +
    lines.join("\n");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini task extraction failed", res.status);
      return null;
    }

    const data = (await res.json()) as { candidates?: GeminiCandidate[] };
    const textPart =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    const jsonText = extractJsonPayload(textPart);
    if (!jsonText) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as GeminiExtractedTask[];
    }
    if (parsed && typeof parsed === "object" && "tasks" in parsed) {
      const tasks = (parsed as { tasks?: unknown }).tasks;
      if (Array.isArray(tasks)) {
        return tasks as GeminiExtractedTask[];
      }
    }

    return null;
  } catch (error) {
    console.error("Gemini task extraction failed", error);
    return null;
  }
}

export type AskContextItem = { id: string; text: string; source?: string };

export async function askWithGemini(
  question: string,
  contextItems: AskContextItem[]
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const contextLines = contextItems.map(
    (c) => `[id:${c.id}] ${c.source ? `(source: ${c.source}) ` : ""}${c.text}`
  );

  const systemPrompt =
    "Ты — ассистент, отвечающий по базе знаний пользователя. " +
    "Отвечай кратко, опираясь только на приведённый контекст. " +
    "Если в контексте нет нужной информации — честно скажи «Не найдено» или «В базе нет данных». " +
    "Не придумывай факты.";

  const userPrompt =
    "Контекст из базы знаний:\n" +
    (contextLines.length ? contextLines.join("\n\n") : "(пусто)") +
    "\n\nВопрос: " +
    question;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini ask failed", res.status);
      return null;
    }

    const data = (await res.json()) as { candidates?: GeminiCandidate[] };
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? null
    );
  } catch (error) {
    console.error("Gemini ask failed", error);
    return null;
  }
}
