// List participants with vote coverage and skew, to pick who to impute.
// Usage: pnpm participants [--min-coverage 0.2] [--max-coverage 0.6] [--min-votes 3] [--sort coverage|pid]
import { parseArgs } from "node:util";
import { loadConversation, voteCounts } from "../src/polis.ts";
import { coverage, filterParticipants } from "../src/select.ts";

const { values: args } = parseArgs({
  options: {
    report: { type: "string" },
    "min-votes": { type: "string", default: "1" },
    "min-coverage": { type: "string", default: "0" },
    "max-coverage": { type: "string", default: "1" },
    sort: { type: "string", default: "coverage" },
  },
});

const conv = loadConversation(args.report);
const ps = filterParticipants(conv, {
  minVotes: Number(args["min-votes"]),
  minCoverage: Number(args["min-coverage"]),
  maxCoverage: Number(args["max-coverage"]),
});
if (args.sort === "coverage") ps.sort((a, b) => b.votes.size - a.votes.size);

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-").padStart(4);
console.log(`${conv.topic} — ${conv.statements.length} statements, ${conv.participants.length} voters\n`);
console.log("  pid  votes  coverage  missing   agree  disagree  pass");
for (const p of ps) {
  const c = voteCounts(p.votes.values());
  const n = p.votes.size;
  console.log(
    `${String(p.pid).padStart(5)}  ${String(n).padStart(5)}  ${pct(n, conv.statements.length).padStart(8)}  ` +
      `${String(conv.statements.length - n).padStart(7)}  ${pct(c.agree, n).padStart(6)}  ${pct(c.disagree, n).padStart(8)}  ${pct(c.pass, n).padStart(4)}`,
  );
}
console.log(`\n${ps.length} participants match. Mean coverage ${pct(ps.reduce((s, p) => s + coverage(conv, p), 0), ps.length)}`);
