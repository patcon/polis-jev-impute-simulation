// Shared prompt plumbing. The prompts themselves live in src/prompts/, one file per version.
// Never edit a registered version in place: copy it to a new file, change it, and register it,
// so old runs stay reproducible with `--prompt <version>`.
import type { ChoiceQuestion, EntryType } from "@typesafe-ai/sdk";
import type { Conversation } from "./polis.ts";
import type { Vote } from "./types.ts";
import { VOTES } from "./types.ts";

export interface PromptVersion {
  version: string;
  /** One line on what changed vs. the previous version. */
  description: string;
  buildState(conv: Conversation, visible: Map<number, Vote>): EntryType;
  buildQuestion(statement: string, order: Vote[]): ChoiceQuestion;
}

/** Option orderings: rotations of [agree, disagree, pass] so each option leads once. */
export function orderings(n: number): Vote[][] {
  return Array.from({ length: n }, (_, i) => VOTES.map((_, j) => VOTES[(i + j) % VOTES.length]!));
}

export const questionId = (tid: number, rotation: number) => `t${tid}_r${rotation}`;

export function parseQuestionId(id: string): { tid: number; rotation: number } {
  const m = /^t(\d+)_r(\d+)$/.exec(id);
  if (!m) throw new Error(`bad question id ${id}`);
  return { tid: Number(m[1]), rotation: Number(m[2]) };
}

/** Rough token estimate (~4 chars/token). Real counts come back in `usage`. */
export const estimateTokens = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4);
