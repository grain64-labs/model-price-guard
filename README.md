# model-price-guard

A GitHub Action that finds the LLM model ids pinned in your repo and tells you, in the job summary, which ones are retired or about to expire and what the cheapest model is that actually passed a public verdict for the same kind of task.

No API key. No model call. No sign-up. It reads one public JSON file and nothing from your repo leaves the runner.

## Add it to a workflow

```yaml
# .github/workflows/model-price-guard.yml
on: [pull_request, workflow_dispatch]
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grain64-labs/model-price-guard@v1
```

Options:

| Input | Default | What it does |
|---|---|---|
| `paths` | `.` | Space-separated files or folders to scan |
| `task` | empty | Compare against one task family only: `classification`, `extraction` or `tool-call` |
| `fail-on-retired` | `false` | `true` fails the job when a pinned id is retired or has an announced expiry date |
| `fail-on-unlisted` | `false` | `true` fails the job when a pinned id is not on the price list (renamed, misspelt, private or brand new) |
| `data-url` | the public JSON below | Point it at a saved copy (a `file://` URL works) to run offline |

Outputs: `pinned`, `retired`, `unlisted`, `beaten` (counts).

## What it prints

Real output of the Action on `action/fixtures/repo-sample` (six pinned ids, price list of 2026-11-22):

> 6 pinned model ids in 4 scanned files · price list of 2026-11-22 · 0 retired or expiring · 0 not on the price list · 2 beaten on cost by a model that passed a public verdict
>
> | Model | Found at | Status | List price | Against the public verdicts |
> |---|---|---|---|---|
> | `anthropic/claude-sonnet-4.5` | `src/summarise.ts:1` | listed | $3 / $15 per Mtok in/out | not in a published verdict |
> | `google/gemini-2.5-flash` | `config/app.yaml:3` | listed | $0.3 / $2.5 per Mtok in/out | not in a published verdict |
> | `openai/gpt-4o` | `config/app.yaml:5` | listed | $2.5 / $10 per Mtok in/out | not in a published verdict |
> | `openai/gpt-4o-mini` | `src/summarise.ts:2` | listed | $0.15 / $0.6 per Mtok in/out | not in a published verdict |
> | `openai/gpt-6.1-sol` | `src/classify.py:5` | listed | $2 / $10 per Mtok in/out | passed Product-review sentiment at $0.000319 per success; **mistralai/mistral-small-2603** passed at $0.000019 (94% less) |
> | `openai/gpt-6.1-terra` | `.env.example:2` | listed | $1 / $5 per Mtok in/out | passed Product-review sentiment at $0.000165 per success; **mistralai/mistral-small-2603** passed at $0.000019 (88% less) |

(Each verdict mention links to its page in the real summary; the "not in a published verdict" cell points to the table below it.)

Reproduce it with no network: `node --test action/test/guard.test.mjs` (Node 20 or later) writes the `.env.example` fixture and runs the Action's script against the fixture repos in `action/fixtures` and a saved copy of the public JSON.

Under it, a table of the cheapest passing model per public verdict (sentiment, intent classification, spam, tool-call arguments, JSON extraction), each linked to its verdict page with the failure examples and the run you can repeat.

## What it scans

`.py .ts .tsx .js .jsx .mjs .cjs .json .yaml .yml .toml` and `.env.example`. It matches OpenRouter slugs (`vendor/model`) and common provider ids. `node_modules`, `.git` and build folders are skipped.

## What it reads

One GET of `https://clearbar.grain64.com/guard/v1.json`: the dated OpenRouter price list and the stored verdicts, cost per successful task with retries and failed attempts counted. The request is a plain GET with a fixed `User-Agent: model-price-guard/1`: no query string, no body, no token, nothing taken from your repo. The Action makes no other network call and has no telemetry; the scan runs inside the runner, and `action.yml` is the whole implementation, so you can read it. Verdict pages: <https://clearbar.grain64.com/verdicts/?utm_source=action>

Want the same answer on your own examples? Upload 50-300 input/expected pairs and get the cheapest model that clears your threshold: <https://clearbar.grain64.com/?utm_source=action>

## License

Apache-2.0
