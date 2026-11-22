// Runs the real script embedded in action.yml against fixture repos and a saved copy of the public JSON.
// Zero network, zero model calls: the data URL is a file:// URL.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const yml = fs.readFileSync(path.join(root, "..", "action.yml"), "utf8");

// The one file is the product: pull the inline Python out of the composite step exactly as the runner would.
function script() {
  const start = yml.indexOf("python3 - <<'PY'\n");
  const end = yml.indexOf("\n        PY\n", start);
  assert.ok(start > 0 && end > start, "inline script not found in action.yml");
  return yml.slice(start + "python3 - <<'PY'\n".length, end).split("\n").map((l) => l.replace(/^ {8}/, "")).join("\n");
}
const SCRIPT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mpg-")), "guard.py");
fs.writeFileSync(SCRIPT_FILE, script());
const DATA = "file://" + path.join(root, "fixtures/guard-data.json");

// node_modules is gitignored, so the "must be skipped" file is made here, not committed.
const NM = path.join(root, "fixtures/repo-sample/node_modules/x");
fs.mkdirSync(NM, { recursive: true });
fs.writeFileSync(path.join(NM, "ignored.js"), 'const model = "openai/gpt-5-pro";\n');
// Same for the .env.example fixture (release scanners refuse to ship any env-named file).
fs.writeFileSync(path.join(root, "fixtures/repo-sample/.env.example"), "OPENROUTER_API_KEY=\nDEFAULT_MODEL=openai/gpt-6.1-terra\n");

function run(repo, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpg-run-"));
  const summary = path.join(dir, "summary.md");
  const output = path.join(dir, "output.txt");
  fs.writeFileSync(summary, "");
  fs.writeFileSync(output, "");
  const r = spawnSync("python3", ["-I", SCRIPT_FILE], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_WORKSPACE: path.join(root, "fixtures", repo), GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, GUARD_PATHS: ".", GUARD_DATA_URL: DATA, GUARD_TASK: "", GUARD_FAIL_RETIRED: "false", GUARD_FAIL_UNLISTED: "false", ...env },
  });
  const outputs = Object.fromEntries(fs.readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("=")));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, summary: fs.readFileSync(summary, "utf8"), outputs };
}

test("action.yml is a composite action with the documented inputs and outputs", () => {
  assert.match(yml, /using: composite/);
  for (const k of ["paths:", "task:", "fail-on-retired:", "fail-on-unlisted:", "data-url:", "pinned:", "retired:", "unlisted:", "beaten:"]) assert.ok(yml.includes("  " + k), k);
  assert.ok(!/OPENROUTER_API_KEY|api[_-]?key|secrets\.|Authorization/i.test(yml), "the action never takes a key");
});

test("sample repo: finds every pinned id across py, ts, yaml and .env.example, skips node_modules and markdown", () => {
  const r = run("repo-sample");
  assert.equal(r.status, 0, r.stderr);
  for (const id of ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini", "google/gemini-2.5-flash", "openai/gpt-4o", "openai/gpt-6.1-terra"]) assert.ok(r.summary.includes("`" + id + "`"), id);
  assert.ok(!r.summary.includes("gpt-5-pro"), "node_modules and .md files are not scanned");
  assert.ok(r.summary.includes("`src/classify.py:5`"), "file and line are shown");
  assert.equal(r.outputs.pinned, "6");
  assert.equal(r.outputs.retired, "0");
  assert.equal(r.outputs.unlisted, "0");
});

test("sample repo: a pinned model beaten on cost names the cheapest passing model and a utm_source=action verdict link", () => {
  const r = run("repo-sample");
  assert.equal(r.outputs.beaten, "2"); // gpt-6.1-sol and gpt-6.1-terra are both beaten on cost in at least one verdict
  const row = r.summary.split("\n").find((l) => l.includes("`openai/gpt-6.1-sol`"));
  assert.match(row, /\*\*[a-z0-9\-/.]+\*\* passed at \$[0-9.]+ \([0-9]+% less\)/);
  assert.match(row, /\(https:\/\/clearbar\.grain64\.com\/verdicts\/[a-z0-9-]+\/\?utm_source=action\)/);
  assert.match(r.summary, /### Cheapest model that passed, per public verdict/);
  assert.equal((r.summary.match(/utm_source=action/g) || []).length >= 6, true);
  assert.ok(!r.summary.includes("utm_source=action#"), "no stray fragment");
});

test("an id no verdict tested is listed with its price and a pointer to the table", () => {
  const r = run("repo-sample");
  const row = r.summary.split("\n").find((l) => l.includes("`openai/gpt-4o`"));
  assert.match(row, /\$2\.5 \/ \$10 per Mtok in\/out/);
  assert.match(row, /not in a published verdict/);
});

test("a bare provider id resolves to its base model even when a variant shares the dated slug", () => {
  const r = run("repo-sample");
  const row = r.summary.split("\n").find((l) => l.includes("`openai/gpt-4o-mini`"));
  assert.match(row, /`src\/summarise\.ts:2`/); // pinned as 'gpt-4o-mini'
  assert.match(row, /\| listed \|/);
});

test("deprecated repo: expiring and retired ids are flagged, warnings carry file and line, output counts match", () => {
  const r = run("repo-deprecated");
  assert.equal(r.status, 0);
  assert.equal(r.outputs.pinned, "3");
  assert.equal(r.outputs.retired, "3");
  assert.equal(r.outputs.unlisted, "0");
  assert.match(r.summary, /`openai\/gpt-5-pro` \| `agent.py:2` \| \*\*expires 2026-12-11\*\*/);
  assert.match(r.summary, /`openai\/gpt-5-mini:batch`.*expires 2026-12-11/);
  assert.match(r.summary, /`openai\/gpt-4\.1-nano`.*\*\*retired\*\*/);
  assert.match(r.stdout, /::warning file=agent\.py,line=2::openai\/gpt-5-pro/);
});

test("fail-on-retired: true fails on a retired or expiring id, passes a clean repo, and ignores unlisted ids", () => {
  assert.equal(run("repo-deprecated", { GUARD_FAIL_RETIRED: "true" }).status, 1);
  assert.equal(run("repo-sample", { GUARD_FAIL_RETIRED: "true" }).status, 0);
  assert.equal(run("repo-unknown", { GUARD_FAIL_RETIRED: "true" }).status, 0);
});

test("fail-on-unlisted: true fails on an id missing from the price list and ignores retired ones", () => {
  assert.equal(run("repo-unknown", { GUARD_FAIL_UNLISTED: "true" }).status, 1);
  assert.equal(run("repo-deprecated", { GUARD_FAIL_UNLISTED: "true" }).status, 0);
  assert.equal(run("repo-sample", { GUARD_FAIL_UNLISTED: "true" }).status, 0);
});

test("unknown repo: ids missing from the price list are reported, not guessed; file names are not ids", () => {
  const r = run("repo-unknown");
  assert.equal(r.status, 0);
  assert.match(r.summary, /`openai\/gpt-3\.5-turbo`.*not on the 2026-11-22 price list/);
  assert.match(r.summary, /`claude-3-5-haiku-typo-9`.*not on the/);
  assert.ok(r.summary.includes("`openai/gpt-4o-mini`"));
  assert.ok(!r.summary.includes("gpt-4o-mini.json"), "a file name is not a model id");
  assert.equal(r.outputs.pinned, "3");
  assert.equal(r.outputs.retired, "0");
  assert.equal(r.outputs.unlisted, "2");
});

test("repo with no ids: says so, still prints the per-verdict table, exits 0", () => {
  const r = run("repo-none");
  assert.equal(r.status, 0);
  assert.match(r.summary, /No pinned model ids found in 1 scanned files/);
  assert.match(r.summary, /### Cheapest model that passed/);
  assert.equal(r.outputs.pinned, "0");
});

test("task input narrows the table; an unknown task falls back to all verdicts with a warning", () => {
  const one = run("repo-none", { GUARD_TASK: "extraction" });
  assert.match(one.summary, /\| extraction \|/);
  assert.ok(!one.summary.includes("| classification |"));
  const bad = run("repo-none", { GUARD_TASK: "poetry" });
  assert.match(bad.stdout, /::warning::task 'poetry' has no published verdict/);
  assert.match(bad.summary, /\| classification \|/);
});

test("paths input scans only what is named", () => {
  const r = run("repo-sample", { GUARD_PATHS: "config" });
  assert.equal(r.outputs.pinned, "2");
});

test("an unreadable data URL is a warning, never a failed build", () => {
  const r = run("repo-sample", { GUARD_DATA_URL: "file:///nonexistent/guard.json", GUARD_FAIL_RETIRED: "true", GUARD_FAIL_UNLISTED: "true" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning::model-price-guard could not read/);
  assert.equal(r.outputs.pinned, "0");
});
