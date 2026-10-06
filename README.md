# polis-jev-imputate-simulation

Impute missing Polis votes (AGREE / DISAGREE / PASS) with [TypeSafe's Jev](https://docs.typesafe.ai), then explore whether the results feel consistent with each participant. Intent: [docs/intent/polis-vote-imputation.md](docs/intent/polis-vote-imputation.md).

## Setup

```sh
pnpm install
cp .env.example .env   # add TYPESAFE_API_KEY
pnpm fetch-data        # already committed for r4zdxrdscmukmkakmbz3k; pass another report id to fetch one
```

## Pick participants

```sh
pnpm participants --min-votes 3                      # coverage, missing count, agree/disagree/pass skew
pnpm participants --min-coverage 0.3 --max-coverage 0.7
```

## Impute

Every run prints the plan (profile, unvoted statements, token + cost estimate) and asks before spending. Add `--dry-run` to only see the plan.

```sh
pnpm impute --participant 93 --holdout 0.2           # one participant, plus a holdout check
pnpm impute --sample 10 --min-coverage 0.3 --holdout 0.2 --seed 2
pnpm impute --all --holdout 0.2 --label full         # whole conversation (~$0.47 with v2, ~$0.28 with v1)
```

| Flag | Meaning |
| --- | --- |
| `--holdout 0.2` | Hide 20% of each participant's real votes (≥5 votes), predict them, compare |
| `--no-impute` | Holdout only, skip the real blanks |
| `--prompt v1-vote-lines` | Prompt version to use (default: latest; `--list-prompts` lists them) |
| `--rotations 3` | Ask each statement once per option ordering (Jev leans toward the first option); results are averaged and disagreement is flagged |
| `--seed`, `--label`, `--model`, `--concurrency`, `--yes` | Reproducibility, run naming, model pin (e.g. `jev-1.13.0`), parallelism, skip the confirm prompt |

Each run is saved to `runs/<timestamp>_<label>/`:
- `run.json`: results per participant (real votes, imputed, holdout) + options + token/cost totals. Read by the explorer.
- `raw.jsonl`: every request and response, verbatim.

Commit runs so prompt versions can be compared over time.

## Explore

```sh
pnpm explore
```

Pick a run, then a participant: their vote skew, the statements they agreed with, disagreed with, and passed on, and their imputed votes (sortable and filterable by confidence). Holdout runs add accuracy, a calibration view (does a 0.8 probability mean right 80% of the time?), a confusion matrix, and a baseline of "always predict their most common vote".

## Changing the prompt

Each prompt version is its own file in [`src/prompts/`](src/prompts/), registered in `src/prompts/index.ts` (the last entry is the default). Don't edit a registered version in place: copy it, change the copy, and register it as a new version, so older runs can still be reproduced.

```sh
pnpm impute --list-prompts
pnpm impute --participant 93 --holdout 0.2 --prompt v1-vote-lines
```

The version is recorded on each run and shown in the explorer.
