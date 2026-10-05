// Download a Polis report export into data/<reportId>/.
// Usage: pnpm fetch-data [reportId]
import { mkdir, writeFile } from "node:fs/promises";
import { DEFAULT_REPORT_ID, dataDir } from "../src/polis.ts";

const reportId = process.argv[2] ?? DEFAULT_REPORT_ID;
const files = ["summary", "comments", "votes", "participant-votes"];
const dir = dataDir(reportId);
await mkdir(dir, { recursive: true });

for (const f of files) {
  const url = `https://pol.is/api/v3/reportExport/${reportId}/${f}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  await writeFile(`${dir}/${f}.csv`, await res.text());
  console.log(`✓ ${f}.csv`);
}
