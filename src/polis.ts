// Load a Polis report export (CSV) into typed structures.
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import type { Vote } from "./types.ts";

export const DEFAULT_REPORT_ID = "r4zdxrdscmukmkakmbz3k";
export const dataDir = (reportId: string) => `data/${reportId}`;

export interface Statement {
  tid: number;
  text: string;
  authorId: number;
  /** Polis moderation: -1 rejected, 0 unmoderated, 1 accepted. */
  moderated: number;
}

export interface Participant {
  pid: number;
  /** Latest vote per statement (only on included statements). */
  votes: Map<number, Vote>;
}

export interface Conversation {
  reportId: string;
  topic: string;
  description: string;
  /** Statements eligible for imputation (moderated-out ones excluded). */
  statements: Statement[];
  participants: Participant[];
}

// Export convention: agree=+1; disagree=-1; pass=0
const VOTE_FROM_EXPORT: Record<string, Vote> = { "1": "agree", "-1": "disagree", "0": "pass" };

function readCsv(path: string): Record<string, string>[] {
  return parse(readFileSync(path, "utf8"), { columns: true, skip_empty_lines: true });
}

export function loadConversation(reportId = DEFAULT_REPORT_ID): Conversation {
  const dir = dataDir(reportId);

  // summary.csv is key,value rows (no header)
  const summary = Object.fromEntries(
    (parse(readFileSync(`${dir}/summary.csv`, "utf8")) as string[][]).map(([k, v]) => [k, v ?? ""]),
  );

  const statements: Statement[] = readCsv(`${dir}/comments.csv`)
    .map((r) => ({
      tid: Number(r["comment-id"]),
      text: (r["comment-body"] ?? "").trim(),
      authorId: Number(r["author-id"]),
      moderated: Number(r["moderated"]),
    }))
    .filter((s) => s.moderated !== -1 && s.text)
    .sort((a, b) => a.tid - b.tid);
  const included = new Set(statements.map((s) => s.tid));

  // votes.csv can hold several rows per (voter, comment) if a vote changed; keep the latest.
  const latest = new Map<string, { ts: number; vote: Vote }>();
  for (const r of readCsv(`${dir}/votes.csv`)) {
    const tid = Number(r["comment-id"]);
    if (!included.has(tid)) continue;
    const vote = VOTE_FROM_EXPORT[r["vote"] ?? ""];
    if (!vote) continue;
    const key = `${r["voter-id"]}:${tid}`;
    const ts = Number(r["timestamp"]);
    const prev = latest.get(key);
    if (!prev || ts >= prev.ts) latest.set(key, { ts, vote });
  }

  const byPid = new Map<number, Map<number, Vote>>();
  for (const [key, { vote }] of latest) {
    const [pid, tid] = key.split(":").map(Number) as [number, number];
    if (!byPid.has(pid)) byPid.set(pid, new Map());
    byPid.get(pid)!.set(tid, vote);
  }

  const participants = [...byPid.entries()]
    .map(([pid, votes]) => ({ pid, votes }))
    .sort((a, b) => a.pid - b.pid);

  return {
    reportId,
    topic: summary["topic"] ?? "",
    description: summary["conversation-description"] ?? "",
    statements,
    participants,
  };
}

export function voteCounts(votes: Iterable<Vote>) {
  const c = { agree: 0, disagree: 0, pass: 0 };
  for (const v of votes) c[v]++;
  return c;
}
