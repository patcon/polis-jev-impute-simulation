// v2: same as v1, but PASS spells out the many things a Polis pass can signal.
import type { PromptVersion } from "../prompt.ts";
import type { Vote } from "../types.ts";
import { v1 } from "./v1-vote-lines.ts";

const CRITERIA: Record<Vote, string | { what: string; can_signal: string[] }> = {
  agree: "The participant would vote AGREE on this statement.",
  disagree: "The participant would vote DISAGREE on this statement.",
  pass: {
    what: "The participant would vote PASS on this statement instead of agreeing or disagreeing.",
    can_signal: [
      "I don't know.",
      "I don't have an opinion.",
      "I need more information.",
      "I don't want to answer.",
      "This statement makes me think too hard and I want to move on.",
      "I abstain.",
      "I have thoughts I'd rather keep private.",
      "Agree and disagree don't fit my intentions for this statement.",
      "I both agree and disagree.",
      "This statement contains multiple ideas.",
      "I don't feel strongly.",
      "This isn't that important to me.",
    ],
  },
};

export const v2: PromptVersion = {
  version: "v2-pass-meanings",
  description: "v1 + PASS criterion lists the many things a Polis pass can signal.",

  buildState: v1.buildState,

  buildQuestion(statement, order) {
    return { ...v1.buildQuestion(statement, order), criteria: Object.fromEntries(order.map((v) => [v, CRITERIA[v]])) };
  },
};
