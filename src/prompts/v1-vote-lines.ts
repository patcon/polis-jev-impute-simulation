// v1: the participant's real votes as "statement → VOTE" lines; one Choice per target statement.
import type { PromptVersion } from "../prompt.ts";
import type { Vote } from "../types.ts";

const VOTE_LABEL: Record<Vote, string> = { agree: "AGREE", disagree: "DISAGREE", pass: "PASS" };

const CRITERIA: Record<Vote, string> = {
  agree: "The participant would vote AGREE on this statement.",
  disagree: "The participant would vote DISAGREE on this statement.",
  pass: "The participant would vote PASS: unsure, neutral, or no opinion on this statement.",
};

export const v1: PromptVersion = {
  version: "v1-vote-lines",
  description: "Vote lines in state; one-line criteria per option.",

  buildState(conv, visible) {
    const text = new Map(conv.statements.map((s) => [s.tid, s.text]));
    return {
      conversation: {
        topic: conv.topic,
        description: conv.description,
      },
      // One line per statement the participant voted on, followed by their vote.
      participant_votes: [...visible.entries()]
        .sort(([a], [b]) => a - b)
        .map(([tid, vote]) => `${text.get(tid)} → ${VOTE_LABEL[vote]}`),
    };
  },

  buildQuestion(statement, order) {
    return {
      type: "choice",
      instructions: {
        task:
          "In a Polis conversation, a participant voted AGREE, DISAGREE, or PASS on the statements in `participant_votes`. " +
          "Based on those votes, predict how this same participant would vote on the new statement below.",
        new_statement: statement,
      },
      criteria: Object.fromEntries(order.map((v) => [v, CRITERIA[v]])),
    };
  },
};
