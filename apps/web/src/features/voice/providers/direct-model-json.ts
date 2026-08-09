import { DirectAiProviderError } from "../domain";

export function parseDirectModelJsonObject(rawOutput: string): unknown {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) return invalidOutput();

  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  const jsonText = (fenced?.[1] ?? trimmed).trim();
  if (!jsonText.startsWith("{") || !jsonText.endsWith("}")) {
    return invalidOutput();
  }
  try {
    return JSON.parse(jsonText) as unknown;
  } catch (error) {
    throw new DirectAiProviderError(
      "PLANNER_INVALID_OUTPUT",
      "INVALID_OUTPUT",
      { cause: error },
    );
  }
}

function invalidOutput(): never {
  throw new DirectAiProviderError(
    "PLANNER_INVALID_OUTPUT",
    "INVALID_OUTPUT",
  );
}
