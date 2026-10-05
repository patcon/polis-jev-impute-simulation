import type { ParticipantResult, Prediction, Probs, Run, Vote } from "../src/types.ts";
import { VOTES } from "../src/types.ts";

// Every runs/<id>/run.json, loaded on demand. New runs appear on reload.
const runLoaders = import.meta.glob<Run>("../runs/*/run.json", { import: "default" });
const runIds = Object.keys(runLoaders)
  .map((p) => p.split("/").at(-2)!)
  .sort()
  .reverse();
const loaderFor = (id: string) => runLoaders[`../runs/${id}/run.json`]!;

// ---- UI state (run/pid/tab mirrored in the URL hash) --------------------------
type Tab = "imputed" | "holdout" | "votes";
const ui = {
  runId: "",
  pid: -1,
  tab: "imputed" as Tab,
  sort: { key: "confidence", dir: -1 },
  voteFilter: "all" as Vote | "all",
  minConf: 0,
  onlyInconsistent: false,
  listQuery: "",
  listSort: "coverage" as "coverage" | "pid" | "accuracy",
  calibBy: "probability" as "probability" | "confidence",
};
let run: Run | null = null;
let textOf = new Map<number, string>();

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  ui.runId = h.get("run") && runIds.includes(h.get("run")!) ? h.get("run")! : (runIds[0] ?? "");
  ui.pid = h.has("pid") ? Number(h.get("pid")) : -1;
  ui.tab = (h.get("tab") as Tab) || "imputed";
}
function writeHash() {
  const h = new URLSearchParams({ run: ui.runId, ...(ui.pid >= 0 ? { pid: String(ui.pid) } : {}), tab: ui.tab });
  history.replaceState(null, "", `#${h}`);
}

// ---- helpers ------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x: number, digits = 0) => `${(100 * x).toFixed(digits)}%`;
const LABEL: Record<Vote, string> = { agree: "Agree", disagree: "Disagree", pass: "Pass" };
const ORDER: Vote[] = ["agree", "pass", "disagree"]; // diverging display order: agree · neutral · disagree

const topProb = (p: Prediction) => p.probabilities[p.choice];
const voteTag = (v: Vote) => `<span class="vote ${v}">${LABEL[v]}</span>`;

function counts(votes: Iterable<Vote>): Probs {
  const c: Probs = { agree: 0, disagree: 0, pass: 0 };
  for (const v of votes) c[v]++;
  return c;
}

/** Stacked agree/pass/disagree bar. `vals` are counts or probabilities. */
function stack(vals: Probs, opts: { tall?: boolean; tip?: string } = {}) {
  const total = VOTES.reduce((s, v) => s + vals[v], 0) || 1;
  const segs = ORDER.filter((v) => vals[v] > 0)
    .map((v) => `<span class="${v}-bg" style="flex:${vals[v] / total}"></span>`)
    .join("");
  const tip =
    opts.tip ??
    ORDER.map((v) => `${LABEL[v]}: ${Number.isInteger(vals[v]) && total > 1.0001 ? `${vals[v]} (${pct(vals[v] / total)})` : pct(vals[v], 1)}`).join("<br>");
  return `<div class="stack${opts.tall ? " tall" : ""}" data-tip="${esc(tip)}">${segs}</div>`;
}

const legend = () =>
  `<div class="legend">${ORDER.map((v) => `<span><i class="${v}-bg"></i>${LABEL[v]}</span>`).join("")}</div>`;

/** Holdout baseline: predict the participant's most common vote among the votes Jev could see. */
function ownMajorityHits(p: ParticipantResult) {
  const hidden = new Set(p.holdout.map((h) => h.tid));
  const c = counts(Object.entries(p.votes).filter(([tid]) => !hidden.has(Number(tid))).map(([, v]) => v));
  const guess = VOTES.reduce((a, b) => (c[b] > c[a] ? b : a));
  return p.holdout.filter((h) => h.actual === guess).length;
}

// ---- run summary ----------------------------------------------------------------
function renderSummary() {
  if (!run) return;
  const r = run;
  const holdouts = r.participants.flatMap((p) => p.holdout);
  const imputed = r.participants.flatMap((p) => p.imputed);
  const errs = r.participants.reduce((s, p) => s + p.errors.length, 0);
  const hits = holdouts.filter((h) => h.choice === h.actual).length;
  const baseHits = r.participants.reduce((s, p) => s + ownMajorityHits(p), 0);
  const consistent = [...holdouts, ...imputed].filter((p) => p.orderConsistent).length;
  const nPred = holdouts.length + imputed.length;

  const meta = `<div class="card">
    <h2>${esc(r.conversation.topic)}</h2>
    <div class="meta">
      <div><b>${esc(r.options.selection)}</b></div>
      <div>Prompt <b>${esc(r.options.promptVersion)}</b> · model <b>${esc(r.modelsUsed.join(", ") || r.options.model)}</b></div>
      <div>${r.options.rotations} option orderings · seed ${r.options.seed} · holdout ${pct(r.options.holdout)}</div>
      <div>${new Date(r.createdAt).toLocaleString()}</div>
    </div></div>`;

  const cost = `<div class="card">
    <div class="meta">Cost</div><div class="big">$${r.totals.costUsd.toFixed(4)}</div>
    <div class="meta">${r.totals.inputTokens.toLocaleString()} input tokens (est. ${r.totals.estimatedInputTokens.toLocaleString()})<br>
    ${r.totals.requests} requests · ${(r.totals.durationMs / 1000).toFixed(1)}s
    ${errs ? `<br><span class="err">${errs} failed requests</span>` : ""}<br>
    Order-consistent: <b>${nPred ? pct(consistent / nPred) : "–"}</b> of ${nPred} predictions</div></div>`;

  const dist = `<div class="card">
    <div class="meta">Vote mix across selected participants</div>${legend()}
    <div class="skew-row" style="grid-template-columns:70px 1fr"><span class="lbl">Real</span>${stack(counts(r.participants.flatMap((p) => Object.values(p.votes))))}</div>
    <div class="skew-row" style="grid-template-columns:70px 1fr"><span class="lbl">Imputed</span>${stack(counts(imputed.map((p) => p.choice)))}</div>
  </div>`;

  let holdoutCards = "";
  if (holdouts.length) {
    holdoutCards = `<div class="card">
      <div class="meta">Holdout accuracy</div>
      <div class="big">${pct(hits / holdouts.length)}</div>
      <div class="meta">${hits}/${holdouts.length} hidden votes predicted correctly<br>
      Baseline (always predict the participant's most common vote): <b>${pct(baseHits / holdouts.length)}</b></div>
    </div>
    <div class="card">${calibration(holdouts)}</div>
    <div class="card">${confusion(holdouts)}</div>`;
  }
  $("run-summary").innerHTML = meta + cost + dist + holdoutCards;
  $("run-summary").querySelectorAll<HTMLButtonElement>("[data-calib]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.calibBy = b.dataset.calib as typeof ui.calibBy;
      renderSummary();
    }),
  );
}

function calibration(holdouts: Prediction[]) {
  const byProb = ui.calibBy === "probability";
  const edges = byProb ? [1 / 3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001] : [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const val = (h: Prediction) => (byProb ? topProb(h) : h.confidence);
  const rows = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]!;
    const inB = holdouts.filter((h) => val(h) >= lo && val(h) < hi);
    const acc = inB.length ? inB.filter((h) => h.choice === h.actual).length / inB.length : 0;
    const mean = inB.length ? inB.reduce((s, h) => s + topProb(h), 0) / inB.length : 0;
    const tip = `${inB.length} predictions<br>accuracy ${pct(acc)}${inB.length ? `<br>mean predicted probability ${pct(mean)}` : ""}`;
    return `<div class="calib-row" data-tip="${esc(tip)}">
      <span>${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}</span>
      <div class="calib-track">${inB.length ? `<div class="calib-fill" style="width:${acc * 100}%"></div>` : ""}
        ${byProb && inB.length ? `<div class="calib-ideal" style="left:calc(${mean * 100}% - 1px)"></div>` : ""}</div>
      <span>${inB.length ? `${pct(acc)} · n=${inB.length}` : "–"}</span></div>`;
  });
  return `<div class="meta" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
      Holdout accuracy by ${byProb ? "top probability" : "Jev confidence"}
      <span><button data-calib="probability" aria-pressed="${byProb}">prob</button>
      <button data-calib="confidence" aria-pressed="${!byProb}">confidence</button></span></div>
    <div class="calib" style="margin-top:8px">${rows.join("")}</div>
    ${byProb ? `<div class="meta" style="margin-top:6px">Bar = accuracy; tick = mean predicted probability. Calibrated if they line up.</div>` : ""}`;
}

function confusion(holdouts: Prediction[]) {
  const head = ORDER.map((v) => `<th>${LABEL[v]}</th>`).join("");
  const rows = ORDER.map((actual) => {
    const cells = ORDER.map((pred) => {
      const n = holdouts.filter((h) => h.actual === actual && h.choice === pred).length;
      return `<td class="${actual === pred ? "hit" : ""}">${n}</td>`;
    }).join("");
    return `<tr><th>${LABEL[actual]}</th>${cells}</tr>`;
  }).join("");
  return `<div class="meta">Holdout: actual (rows) × predicted (columns)</div>
    <table class="confusion" style="margin-top:8px"><tr><th></th>${head}</tr>${rows}</table>`;
}

// ---- participant list -------------------------------------------------------------
function accuracy(p: ParticipantResult) {
  return p.holdout.length ? p.holdout.filter((h) => h.choice === h.actual).length / p.holdout.length : -1;
}

function renderList() {
  if (!run) return;
  const q = ui.listQuery.trim();
  const ps = run.participants
    .filter((p) => !q || String(p.pid).startsWith(q))
    .sort((a, b) =>
      ui.listSort === "pid" ? a.pid - b.pid : ui.listSort === "accuracy" ? accuracy(b) - accuracy(a) : b.coverage - a.coverage,
    );
  const sortBtn = (k: typeof ui.listSort, label: string) =>
    `<button data-lsort="${k}" aria-pressed="${ui.listSort === k}">${label}</button>`;
  const rows = ps
    .map((p) => {
      const acc = accuracy(p);
      return `<div class="p-row" data-pid="${p.pid}" aria-current="${p.pid === ui.pid}">
        <span>#${p.pid}</span>
        <div>${stack(counts(Object.values(p.votes)))}<div class="sub">${Object.keys(p.votes).length} votes · ${pct(p.coverage)} coverage${p.errors.length ? ' · <span class="err">errors</span>' : ""}</div></div>
        <span class="sub" style="text-align:right" title="holdout accuracy">${acc >= 0 ? pct(acc) : ""}</span>
      </div>`;
    })
    .join("");
  $("participant-list").innerHTML = `<div class="controls">
      <input type="search" id="pid-search" placeholder="pid…" value="${esc(ui.listQuery)}">
      ${sortBtn("coverage", "coverage")}${sortBtn("pid", "pid")}${run.options.holdout ? sortBtn("accuracy", "accuracy") : ""}
    </div>${rows || '<div class="empty">No participants</div>'}`;

  const search = $("pid-search") as HTMLInputElement;
  search.addEventListener("input", () => {
    ui.listQuery = search.value;
    renderList();
    ($("pid-search") as HTMLInputElement).focus();
  });
  $("participant-list").querySelectorAll<HTMLElement>("[data-lsort]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.listSort = b.dataset.lsort as typeof ui.listSort;
      renderList();
    }),
  );
  $("participant-list").querySelectorAll<HTMLElement>(".p-row").forEach((row) =>
    row.addEventListener("click", () => {
      ui.pid = Number(row.dataset.pid);
      writeHash();
      renderList();
      renderDetail();
    }),
  );
}

// ---- participant detail -------------------------------------------------------------
function renderDetail() {
  const el = $("participant-detail");
  const p = run?.participants.find((x) => x.pid === ui.pid);
  if (!run || !p) {
    el.innerHTML = `<div class="card empty">Pick a participant</div>`;
    return;
  }
  if (ui.tab === "holdout" && !p.holdout.length) ui.tab = "imputed";
  const nVotes = Object.keys(p.votes).length;
  const real = counts(Object.values(p.votes));
  const imp = counts(p.imputed.map((x) => x.choice));
  const skewTip = (c: Probs) => {
    const n = VOTES.reduce((s, v) => s + c[v], 0);
    return ORDER.map((v) => `${LABEL[v]} ${c[v]} (${n ? pct(c[v] / n) : "0%"})`).join(" · ");
  };
  const tabBtn = (t: Tab, label: string, n: number) =>
    n || t === "imputed" ? `<button data-tab="${t}" aria-pressed="${ui.tab === t}">${label} (${n})</button>` : "";

  el.innerHTML = `<div class="card">
    <h2>Participant #${p.pid}</h2>
    <div class="meta">${nVotes} votes · ${pct(p.coverage)} coverage · ${p.imputed.length} imputed${p.holdout.length ? ` · holdout ${pct(accuracy(p))} (${p.holdout.filter((h) => h.choice === h.actual).length}/${p.holdout.length}), own-majority baseline ${pct(ownMajorityHits(p) / p.holdout.length)}` : ""}</div>
    ${p.errors.map((e) => `<div class="err">${esc(e)}</div>`).join("")}
    ${legend()}
    <div class="skew-row"><span class="lbl">Real votes</span>${stack(real, { tall: true })}<span class="meta">${skewTip(real)}</span></div>
    ${p.imputed.length ? `<div class="skew-row"><span class="lbl">Imputed</span>${stack(imp, { tall: true })}<span class="meta">${skewTip(imp)}</span></div>` : ""}
    <div class="tabs">${tabBtn("imputed", "Imputed", p.imputed.length)}${tabBtn("holdout", "Holdout", p.holdout.length)}${tabBtn("votes", "Real votes", nVotes)}</div>
    <div id="tab-body"></div>
  </div>`;
  el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.tab = b.dataset.tab as Tab;
      writeHash();
      renderDetail();
    }),
  );
  if (ui.tab === "votes") renderVotes(p);
  else renderPredictions(ui.tab === "holdout" ? p.holdout : p.imputed, ui.tab === "holdout");
}

function renderVotes(p: ParticipantResult) {
  const by = (v: Vote) =>
    Object.entries(p.votes)
      .filter(([, x]) => x === v)
      .map(([tid]) => Number(tid))
      .sort((a, b) => a - b);
  $("tab-body").innerHTML = `<div class="vote-lists">${ORDER.map((v) => {
    const tids = by(v);
    return `<div><h3>${voteTag(v)} ${tids.length}</h3><ul>${tids
      .map((tid) => `<li>${esc(textOf.get(tid) ?? "")} <span class="tid">#${tid}</span></li>`)
      .join("")}</ul></div>`;
  }).join("")}</div>`;
}

function renderPredictions(preds: Prediction[], isHoldout: boolean) {
  const key = ui.sort.key;
  const sortVal = (x: Prediction): number | string =>
    key === "tid" ? x.tid : key === "choice" ? ORDER.indexOf(x.choice) : key === "top" ? topProb(x) : key === "agree" ? x.probabilities.agree : key === "hit" ? Number(x.choice === x.actual) : x.confidence;
  const rows = preds
    .filter((x) => ui.voteFilter === "all" || x.choice === ui.voteFilter)
    .filter((x) => x.confidence >= ui.minConf)
    .filter((x) => !ui.onlyInconsistent || !x.orderConsistent)
    .sort((a, b) => {
      const va = sortVal(a), vb = sortVal(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * ui.sort.dir;
    });

  const th = (k: string, label: string) =>
    `<th data-sort="${k}">${label}${ui.sort.key === k ? (ui.sort.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const filterBtn = (v: Vote | "all") =>
    `<button data-vf="${v}" aria-pressed="${ui.voteFilter === v}">${v === "all" ? "All" : LABEL[v]}</button>`;
  const rotTip = (x: Prediction) =>
    x.rotations
      .map((r) => `order ${r.order.map((o) => o[0]!.toUpperCase()).join("")}: ${LABEL[r.choice]} (conf ${r.confidence.toFixed(2)}) — ${ORDER.map((v) => `${v[0]!.toUpperCase()} ${pct(r.probabilities[v])}`).join(" ")}`)
      .join("<br>");

  $("tab-body").innerHTML = `
    <div class="toolbar">
      ${(["all", ...ORDER] as const).map(filterBtn).join("")}
      <label>min confidence <input type="range" id="min-conf" min="0" max="1" step="0.05" value="${ui.minConf}"> <b>${ui.minConf.toFixed(2)}</b></label>
      <label><input type="checkbox" id="only-inc" ${ui.onlyInconsistent ? "checked" : ""}> only order-inconsistent</label>
      <span>${rows.length} of ${preds.length}</span>
    </div>
    <div class="tbl-wrap"><table>
      <tr>${th("tid", "#")}<th>Statement</th>${th("choice", "Predicted")}${isHoldout ? `<th>Actual</th>${th("hit", "")}` : ""}${th("agree", "Probabilities")}${th("top", "Top p")}${th("confidence", "Conf.")}</tr>
      ${rows
        .map(
          (x) => `<tr>
        <td class="tid">${x.tid}</td>
        <td>${esc(textOf.get(x.tid) ?? "")}${x.orderConsistent ? "" : ` <span class="flag" data-tip="${esc(rotTip(x))}">orderings disagree</span>`}</td>
        <td>${voteTag(x.choice)}</td>
        ${isHoldout ? `<td>${x.actual ? voteTag(x.actual) : ""}</td><td>${x.choice === x.actual ? '<span class="hit">✓</span>' : '<span class="miss">✗</span>'}</td>` : ""}
        <td class="bar">${stack(x.probabilities, { tip: `${ORDER.map((v) => `${LABEL[v]}: ${pct(x.probabilities[v], 1)}`).join("<br>")}<br><br>${rotTip(x)}` })}</td>
        <td class="num">${pct(topProb(x))}</td>
        <td class="num">${x.confidence.toFixed(2)}</td></tr>`,
        )
        .join("")}
    </table></div>`;

  const body = $("tab-body");
  body.querySelectorAll<HTMLElement>("[data-sort]").forEach((h) =>
    h.addEventListener("click", () => {
      const k = h.dataset.sort!;
      ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : -1 };
      renderPredictions(preds, isHoldout);
    }),
  );
  body.querySelectorAll<HTMLElement>("[data-vf]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.voteFilter = b.dataset.vf as Vote | "all";
      renderPredictions(preds, isHoldout);
    }),
  );
  const slider = $("min-conf") as HTMLInputElement;
  slider.addEventListener("change", () => {
    ui.minConf = Number(slider.value);
    renderPredictions(preds, isHoldout);
  });
  ($("only-inc") as HTMLInputElement).addEventListener("change", (e) => {
    ui.onlyInconsistent = (e.target as HTMLInputElement).checked;
    renderPredictions(preds, isHoldout);
  });
}

// ---- tooltip (one global handler for every [data-tip]) ----------------------------
const tooltip = $("tooltip");
document.addEventListener("mousemove", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
  if (!t) {
    tooltip.hidden = true;
    return;
  }
  tooltip.innerHTML = t.dataset.tip!;
  tooltip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tooltip.offsetWidth - 8);
  const y = e.clientY + 14 + tooltip.offsetHeight > innerHeight ? e.clientY - tooltip.offsetHeight - 10 : e.clientY + 14;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
});

// ---- boot ---------------------------------------------------------------------------
async function loadRun() {
  if (!ui.runId) {
    $("run-summary").innerHTML = `<div class="card empty">No runs yet. Try <code>pnpm impute --participant 93 --holdout 0.2</code></div>`;
    return;
  }
  run = await loaderFor(ui.runId)();
  textOf = new Map(run.statements.map((s) => [s.tid, s.text]));
  if (!run.participants.some((p) => p.pid === ui.pid)) ui.pid = run.participants[0]?.pid ?? -1;
  writeHash();
  renderSummary();
  renderList();
  renderDetail();
}

readHash();
const select = $("run-select") as HTMLSelectElement;
select.innerHTML = runIds.map((id) => `<option value="${id}" ${id === ui.runId ? "selected" : ""}>${id}</option>`).join("");
select.addEventListener("change", () => {
  ui.runId = select.value;
  ui.pid = -1;
  loadRun();
});
loadRun();
