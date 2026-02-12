---
name: add-gemini-feature
description: Add a new Gemini AI feature to telegatask. Use when the user asks for AI analysis, extraction, summarization, classification, or any LLM-powered capability.
---

# Adding a Gemini AI Feature

## File
`src/services/gemini.ts`

## Pattern

```typescript
export async function myGeminiFunction(
  input: string,
  context?: SomeContext[]
): Promise<MyResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt = "System instruction...\n\n" + "User input:\n" + input;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            // For structured JSON output:
            responseMimeType: "application/json",
            // For free-text output:
            // temperature: 0.3,
            // maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!res.ok) {
      console.error("Gemini request failed", res.status);
      return null;
    }

    const data = (await res.json()) as { candidates?: GeminiCandidate[] };
    const textPart = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "").join("").trim() ?? "";

    // Parse JSON or return text
    return JSON.parse(textPart) as MyResult;
  } catch (error) {
    console.error("Gemini call failed", error);
    return null;
  }
}
```

## Conventions

- Always check `GEMINI_API_KEY` first, return null if missing
- Use `responseMimeType: "application/json"` for structured extraction
- Use `temperature: 0.3` + `maxOutputTokens` for free-text answers
- All prompts in Russian (target audience)
- `extractJsonPayload()` helper available for parsing JSON from text
- Model configurable via `GEMINI_MODEL` env var
- Graceful fallback: if AI fails, feature degrades, doesn't crash
