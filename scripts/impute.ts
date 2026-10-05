// Impute votes with Jev for selected participants, optionally with a holdout check.
//
// Selection (pick one):
//   --participant 3,17       specific pids
//   --sample 10              random N from the filtered set
//   --all                    everyone in the filtered set
// Filters:   --min-votes 3  --min-coverage 0  --max-coverage 1
// Modes:     --holdout 0.2 (fraction of real votes to hide & predict; 0 = off)
//            --no-impute (holdout only)  --rotations 3 (option orderings per question)
// Prompt:    --prompt <version> (default: latest; --list-prompts to see all)
// Other:     --seed 1  --label name  --model jev-latest  --concurrency 8  --dry-run  --yes
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { TypeSafeClient, type ChoiceQuestion } from "@typesafe-ai/sdk";
import { loadConversation, voteCounts, type Participant } from "../src/polis.ts";
import { estimateTokens, orderings, parseQuestionId, questionId } from "../src/prompt.ts";
import { DEFAULT_PROMPT, PROMPTS, getPrompt } from "../src/prompts/index.ts";
import { coverage, filterParticipants, rng, shuffle } from "../src/select.ts";
import type { ParticipantResult, Prediction, Probs, RotationAnswer, Run, Vote } from "../src/types.ts";
import { VOTES } from "../src/types.ts";

const USD_PER_TOKEN = 0.042 / 1_000_000; // jev-1.13 input price; output is free
const MAX_REQUEST_TOKENS = 48_000; // under the 64k request limit, with margin for the rough estimate
const MIN_VOTES_FOR_HOLDOUT = 5;

const { values: args } = parseArgs({
  options: {
    report: { type: "string" },
    participant: { type: "string" },
    sample: { type: "string" },
    all: { type: "boolean", default: false },
    "min-votes": { type: "string", default: "3" },
    "min-coverage": { type: "string", default: "0" },
    "max-coverage": { type: "string", default: "1" },
    holdout: { type: "string", default: "0" },
    "no-impute": { type: "boolean", default: false },
    rotations: { type: "string", default: "3" },
    seed: { type: "string", default: "1" },
    label: { type: "string" },
    prompt: { type: "string" },
    "list-prompts": { type: "boolean", default: false },
    model: { type: "string", default: "jev-latest" },
    concurrency: { type: "string", default: "8" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
});

try {
  process.loadEnvFile();
} catch {}

if (args["list-prompts"]) {
  for (const p of PROMPTS) console.log(`${p === DEFAULT_PROMPT ? "*" : " "} ${p.version.padEnd(20)} ${p.description}`);
  process.exit(0);
}
let prompt = DEFAULT_PROMPT;
try {
  if (args.prompt) prompt = getPrompt(args.prompt);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const conv = loadConversation(args.report);
const seed = Number(args.seed);
const rand = rng(seed);
const holdoutFrac = Number(args.holdout);
const doImpute = !args["no-impute"];
const orders = orderings(Number(args.rotations));
const textOf = new Map(conv.statements.map((s) => [s.tid, s.text]));

// ---- Select participants ----------------------------------------------------
let selected: Participant[];
let selection: string;
if (args.participant) {
  const pids = args.participant.split(",").map(Number);
  selected = pids.map((pid) => {
    const p = conv.participants.find((x) => x.pid === pid);
    if (!p) throw new Error(`No participant ${pid}`);
    return p;
  });
  selection = `participant ${pids.join(",")}`;
} else {
  const pool = filterParticipants(conv, {
    minVotes: Number(args["min-votes"]),
    minCoverage: Number(args["min-coverage"]),
    maxCoverage: Number(args["max-coverage"]),
  });
  const filterDesc = `min-votes ${args["min-votes"]}, coverage ${args["min-coverage"]}–${args["max-coverage"]}`;
  if (args.sample) {
    selected = shuffle(pool, rand).slice(0, Number(args.sample)).sort((a, b) => a.pid - b.pid);
    selection = `sample ${args.sample} of ${pool.length} (${filterDesc}, seed ${seed})`;
  } else if (args.all) {
    selected = pool;
    selection = `all ${pool.length} (${filterDesc})`;
  } else {
    console.error("Choose --participant <pids>, --sample <n>, or --all");
    process.exit(1);
  }
}
if (!selected.length) {
  console.error("No participants matched.");
  process.exit(1);
}

// ---- Plan requests ----------------------------------------------------------
interface PlannedRequest {
  pid: number;
  kind: "impute" | "holdout";
  state: ReturnType<typeof prompt.buildState>;
  questions: Record<string, ChoiceQuestion>;
  estimatedTokens: number;
}

function plan(pid: number, kind: PlannedRequest["kind"], visible: Map<number, Vote>, targets: number[]): PlannedRequest[] {
  const state = prompt.buildState(conv, visible);
  const stateTokens = estimateTokens(state);
  const out: PlannedRequest[] = [];
  let questions: Record<string, ChoiceQuestion> = {};
  let tokens = stateTokens;
  for (const tid of targets) {
    const qs = orders.map((order, r) => [questionId(tid, r), prompt.buildQuestion(textOf.get(tid)!, order)] as const);
    const qTokens = qs.reduce((s, [, q]) => s + estimateTokens(q), 0);
    if (Object.keys(questions).length && tokens + qTokens > MAX_REQUEST_TOKENS) {
      out.push({ pid, kind, state, questions, estimatedTokens: tokens });
      questions = {};
      tokens = stateTokens;
    }
    for (const [id, q] of qs) questions[id] = q;
    tokens += qTokens;
  }
  if (Object.keys(questions).length) out.push({ pid, kind, state, questions, estimatedTokens: tokens });
  return out;
}

const hiddenByPid = new Map<number, number[]>();
const requests: PlannedRequest[] = [];
for (const p of selected) {
  const voted = [...p.votes.keys()];
  if (doImpute) {
    const blanks = conv.statements.map((s) => s.tid).filter((tid) => !p.votes.has(tid));
    requests.push(...plan(p.pid, "impute", p.votes, blanks));
  }
  if (holdoutFrac > 0 && voted.length >= MIN_VOTES_FOR_HOLDOUT) {
    const hidden = shuffle(voted, rand)
      .slice(0, Math.max(1, Math.round(voted.length * holdoutFrac)))
      .sort((a, b) => a - b);
    hiddenByPid.set(p.pid, hidden);
    const visible = new Map([...p.votes].filter(([tid]) => !hidden.includes(tid)));
    requests.push(...plan(p.pid, "holdout", visible, hidden));
  }
}

// ---- Show the plan ----------------------------------------------------------
const pct = (n: number, d: number) => `${d ? Math.round((100 * n) / d) : 0}%`;
const estTokens = requests.reduce((s, r) => s + r.estimatedTokens, 0);
const nQuestions = (kind: string) =>
  requests.filter((r) => r.kind === kind).reduce((s, r) => s + Object.keys(r.questions).length, 0) / orders.length;

console.log(`\n${conv.topic} — ${conv.statements.length} statements`);
console.log(`Prompt ${prompt.version} · model ${args.model} · ${orders.length} option orderings per statement\n`);

if (selected.length <= 3) {
  for (const p of selected) {
    const c = voteCounts(p.votes.values());
    const n = p.votes.size;
    console.log(`Participant ${p.pid}: ${n} votes (${pct(n, conv.statements.length)} coverage)`);
    console.log(`  agree ${c.agree} (${pct(c.agree, n)}) · disagree ${c.disagree} (${pct(c.disagree, n)}) · pass ${c.pass} (${pct(c.pass, n)})`);
    if (doImpute) {
      const blanks = conv.statements.filter((s) => !p.votes.has(s.tid));
      console.log(`  ${blanks.length} unvoted statements:`);
      for (const s of blanks) console.log(`    [${s.tid}] ${s.text.slice(0, 110)}${s.text.length > 110 ? "…" : ""}`);
    }
    const hidden = hiddenByPid.get(p.pid);
    if (hidden) console.log(`  holdout: hiding ${hidden.length} real votes`);
    console.log();
  }
} else {
  const covs = selected.map((p) => coverage(conv, p)).sort((a, b) => a - b);
  console.log(`Selection: ${selection}`);
  console.log(`  coverage min ${pct(covs[0]!, 1)} · median ${pct(covs[Math.floor(covs.length / 2)]!, 1)} · max ${pct(covs.at(-1)!, 1)}\n`);
}

console.log(`Requests:        ${requests.length}`);
if (doImpute) console.log(`Blanks to fill:  ${nQuestions("impute")}`);
if (holdoutFrac > 0) console.log(`Holdout votes:   ${nQuestions("holdout")}`);
console.log(`Input tokens:    ~${estTokens.toLocaleString()} (estimate)`);
console.log(`Estimated cost:  ~$${(estTokens * USD_PER_TOKEN).toFixed(4)}\n`);

if (args["dry-run"]) process.exit(0);

if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set (put it in .env).");
  process.exit(1);
}
if (!args.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = (await rl.question("Run? [y/N] ")).trim().toLowerCase() === "y";
  rl.close();
  if (!ok) process.exit(0);
}

// ---- Execute ----------------------------------------------------------------
const createdAt = new Date();
const runId = `${createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19)}${args.label ? `_${args.label}` : ""}`;
const runDir = `runs/${runId}`;
await mkdir(runDir, { recursive: true });
const rawPath = `${runDir}/raw.jsonl`;

const client = new TypeSafeClient({ defaultModel: args.model, timeout: 60_000 });
const answers = new Map<string, RotationAnswer>(); // `${kind}:${pid}:${tid}:${r}` → answer
const errors = new Map<number, string[]>();
const modelsUsed = new Set<string>();
let inputTokens = 0;
let done = 0;
const t0 = Date.now();

async function execute(req: PlannedRequest) {
  const started = Date.now();
  try {
    const res = await client.systemOne({ state: req.state, questions: req.questions });
    modelsUsed.add(res.model);
    inputTokens += res.usage.input_tokens;
    for (const [id, a] of Object.entries(res.answers)) {
      const { tid, rotation } = parseQuestionId(id);
      if (a.type !== "choice") continue;
      answers.set(`${req.kind}:${req.pid}:${tid}:${rotation}`, {
        order: orders[rotation]!,
        choice: a.choice as Vote,
        confidence: a.confidence,
        probabilities: a.probabilities as Probs,
      });
    }
    await appendFile(rawPath, JSON.stringify({ pid: req.pid, kind: req.kind, ms: Date.now() - started, request: { model: args.model, state: req.state, questions: req.questions }, response: res }) + "\n");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!errors.has(req.pid)) errors.set(req.pid, []);
    errors.get(req.pid)!.push(`${req.kind}: ${msg}`);
    await appendFile(rawPath, JSON.stringify({ pid: req.pid, kind: req.kind, ms: Date.now() - started, request: { model: args.model, state: req.state, questions: req.questions }, error: msg }) + "\n");
  }
  done++;
  process.stdout.write(`\r${done}/${requests.length} requests`);
}

const queue = [...requests];
await Promise.all(
  Array.from({ length: Number(args.concurrency) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) await execute(r);
  }),
);
console.log();

// ---- Assemble results ---------------------------------------------------------
function predict(kind: string, pid: number, tid: number, actual?: Vote): Prediction | null {
  const rotations = orders.map((_, r) => answers.get(`${kind}:${pid}:${tid}:${r}`)).filter((a): a is RotationAnswer => !!a);
  if (!rotations.length) return null;
  const probabilities = Object.fromEntries(
    VOTES.map((v) => [v, rotations.reduce((s, a) => s + a.probabilities[v], 0) / rotations.length]),
  ) as Probs;
  const choice = VOTES.reduce((best, v) => (probabilities[v] > probabilities[best] ? v : best));
  return {
    tid,
    probabilities,
    choice,
    confidence: rotations.reduce((s, a) => s + a.confidence, 0) / rotations.length,
    orderConsistent: rotations.every((a) => a.choice === rotations[0]!.choice),
    rotations,
    ...(actual ? { actual } : {}),
  };
}

const participants: ParticipantResult[] = selected.map((p) => ({
  pid: p.pid,
  votes: Object.fromEntries(p.votes),
  coverage: coverage(conv, p),
  imputed: doImpute
    ? conv.statements.filter((s) => !p.votes.has(s.tid)).map((s) => predict("impute", p.pid, s.tid)).filter((x): x is Prediction => !!x)
    : [],
  holdout: (hiddenByPid.get(p.pid) ?? []).map((tid) => predict("holdout", p.pid, tid, p.votes.get(tid))).filter((x): x is Prediction => !!x),
  errors: errors.get(p.pid) ?? [],
}));

const run: Run = {
  id: runId,
  createdAt: createdAt.toISOString(),
  label: args.label ?? "",
  conversation: { reportId: conv.reportId, topic: conv.topic, description: conv.description },
  options: {
    promptVersion: prompt.version,
    model: args.model,
    rotations: orders.length,
    holdout: holdoutFrac,
    impute: doImpute,
    seed,
    selection,
  },
  modelsUsed: [...modelsUsed],
  statements: conv.statements.map(({ tid, text }) => ({ tid, text })),
  participants,
  totals: {
    requests: requests.length,
    estimatedInputTokens: estTokens,
    inputTokens,
    costUsd: inputTokens * USD_PER_TOKEN,
    durationMs: Date.now() - t0,
  },
};
await writeFile(`${runDir}/run.json`, JSON.stringify(run, null, 1));

// ---- Summary ----------------------------------------------------------------
const holdouts = participants.flatMap((p) => p.holdout);
const nErr = [...errors.values()].flat().length;
console.log(`\nSaved ${runDir}/run.json (+ raw.jsonl)`);
console.log(`Input tokens: ${inputTokens.toLocaleString()} actual vs ~${estTokens.toLocaleString()} estimated · cost $${run.totals.costUsd.toFixed(4)}`);
if (holdouts.length) {
  const hits = holdouts.filter((h) => h.choice === h.actual).length;
  console.log(`Holdout accuracy: ${hits}/${holdouts.length} (${pct(hits, holdouts.length)})`);
}
if (nErr) console.log(`⚠ ${nErr} failed requests — see run.json participant errors`);
console.log(`Explore: pnpm explore`);
