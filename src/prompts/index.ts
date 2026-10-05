// Registry of prompt versions. The last entry is the default for `pnpm impute`.
import type { PromptVersion } from "../prompt.ts";
import { v1 } from "./v1-vote-lines.ts";
import { v2 } from "./v2-pass-meanings.ts";

export const PROMPTS: PromptVersion[] = [v1, v2];

export const DEFAULT_PROMPT = PROMPTS.at(-1)!;

export function getPrompt(version: string): PromptVersion {
  const p = PROMPTS.find((x) => x.version === version);
  if (!p) throw new Error(`Unknown prompt "${version}". Available: ${PROMPTS.map((x) => x.version).join(", ")}`);
  return p;
}
