// Participant selection + seeded randomness, shared by the CLI scripts.
import type { Conversation, Participant } from "./polis.ts";

/** Deterministic PRNG so samples and holdout picks are reproducible from --seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface Filter {
  minVotes: number;
  minCoverage: number;
  maxCoverage: number;
}

export const coverage = (conv: Conversation, p: Participant) => p.votes.size / conv.statements.length;

export function filterParticipants(conv: Conversation, f: Filter): Participant[] {
  return conv.participants.filter((p) => {
    const c = coverage(conv, p);
    return p.votes.size >= f.minVotes && c >= f.minCoverage && c <= f.maxCoverage;
  });
}
