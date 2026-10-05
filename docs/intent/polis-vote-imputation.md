# Intent: Polis vote imputation with Jev

Confirmed 2026-10-04 via interview.

- **Outcome:** A TypeScript project where pnpm scripts call TypeSafe's Jev to impute AGREE / DISAGREE / PASS (with per-option probabilities + confidence) on statements participants didn't vote on, using the Polis export for report `r4zdxrdscmukmkakmbz3k` (#TransportNewNormal: 118 statements, 163 voters).
- **Run scope:** single participant, a subsample (N participants, filterable by vote-coverage %, or random), or the whole conversation. Every run prints a token/cost estimate before spending. Holdout (hide some real votes, predict, compare) is a flag on any run.
- **Prompt (v1):** state = the participant's real votes as "statement → vote" lines; one Choice question per blank; one request per participant. Shuffle option order to check Jev's first-option bias. Prompt is meant to iterate.
- **Storage:** each run → JSON in `runs/` (requests, responses, model version, tokens, cost, timestamp), committed to git for comparison across prompt versions.
- **Review:** a small Vite site that reads the run JSON — pick run + participant → see who they are (skew, agreed/disagreed/passed statements) → browse imputed votes sorted/filtered by confidence → holdout accuracy vs. confidence, per participant and run-wide.
- **Success:** quickly judge whether imputed votes feel consistent with the person, and whether Jev's confidence means anything, both individually and across the conversation.
- **Constraint:** fast to a usable result. Jev is only called from scripts, never from the Vite site, so the API key stays in `.env`. Cost is negligible (~$0.03 for the whole conversation at $0.042/Mtok input).
- **Out of scope:** hosting/deploying the site, feeding results back into Polis, other conversations (for now), any automated prompt-optimization loop.
