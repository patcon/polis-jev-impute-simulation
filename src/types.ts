// Shared types between the scripts (which write runs) and the Vite site (which reads them).

export type Vote = "agree" | "disagree" | "pass";
export const VOTES: readonly Vote[] = ["agree", "disagree", "pass"];

export type Probs = Record<Vote, number>;

/** One Choice answer for one option ordering. */
export interface RotationAnswer {
  order: Vote[];
  choice: Vote;
  confidence: number;
  probabilities: Probs;
}

export interface Prediction {
  tid: number;
  /** Mean of probabilities across option orderings. */
  probabilities: Probs;
  choice: Vote;
  /** Mean of Jev's per-ordering confidence. */
  confidence: number;
  /** True if every ordering picked the same option. */
  orderConsistent: boolean;
  rotations: RotationAnswer[];
  /** Holdout only: the participant's real vote. */
  actual?: Vote;
}

export interface ParticipantResult {
  pid: number;
  /** Real votes by tid (full history, including held-out ones). */
  votes: Record<number, Vote>;
  /** Votes / eligible statements. */
  coverage: number;
  /** Predictions for statements the participant never voted on. */
  imputed: Prediction[];
  /** Predictions for real votes that were hidden from the state. */
  holdout: Prediction[];
  errors: string[];
}

export interface RunOptions {
  promptVersion: string;
  model: string;
  rotations: number;
  holdout: number;
  impute: boolean;
  seed: number;
  selection: string;
}

export interface Run {
  id: string;
  createdAt: string;
  label: string;
  conversation: { reportId: string; topic: string; description: string };
  options: RunOptions;
  /** Model version(s) that actually answered. */
  modelsUsed: string[];
  statements: { tid: number; text: string }[];
  participants: ParticipantResult[];
  totals: {
    requests: number;
    estimatedInputTokens: number;
    inputTokens: number;
    costUsd: number;
    durationMs: number;
  };
}
