# CI and the local CI script

GitHub Actions minutes are limited on the free plan, so most verification runs on your machine and a real GitHub run is spent only where it counts. No check on pull requests was weakened.

## What runs when

| Event | `checks` (lint, typecheck, unit, integration, build, openapi, i18n) | `e2e (1/2)` and `e2e (2/2)` |
| --- | --- | --- |
| `pull_request` | runs | runs |
| `push` to `main` | runs | skipped (already ran on the pull request) |
| `workflow_dispatch` (manual) | runs | runs |

- A pull request or push that changes only `.claude/**`, `docs/**` or `*.md` files starts no CI run at all.
- `design/**` is deliberately NOT ignored: `tests/unit/ui/logo.test.ts` reads `design/logo/*.svg`.
- Nothing else depends on the e2e job running on push: no `workflow_run` trigger or `needs` exists in `.github/workflows/`.
- `concurrency` still cancels a superseded run on the same ref.

## Full pipeline by hand

Actions tab, CI, Run workflow, branch `main`. This runs `checks` and both e2e shards. It is the one real GitHub run still required: the final green run on `main` as review evidence.

## `pnpm ci:local`

Runs the `checks` job on your machine, in the same order as `ci.yml`, plus the contrast script:
lint, typecheck, unit, integration (local Docker Postgres, scratch schema `itest_cilocal`, dropped at the end), build, `openapi:check`, i18n keys, contrast.

```
pnpm ci:local                              # all of it, stops at the first failure
pnpm ci:local -- --keep-going              # run every step
pnpm ci:local -- --e2e                     # also the Playwright projects CI uses (mobile, dashboard-mobile, desktop shell spec)
pnpm ci:local -- --only lint,typecheck     # selected steps
pnpm ci:local -- --dry-run                 # print the plan only
pnpm ci:local -- --help
```

- Needs Docker running for the integration step (`docker compose up -d --wait db`).
- Uses the same throwaway env values as CI, never reads `.env` secrets, and refuses to run if `DATABASE_URL`, `DIRECT_URL` or `DATABASE_URL_TEST` in your shell point anywhere but localhost / 127.0.0.1.
- It does not run `prisma migrate deploy`: the integration helpers apply the migrations inside the scratch schema, so no other schema is touched.
- Writes `.ci-local/summary.md` (date, commit, each step with result and duration), git-ignored. Exit code is non-zero on failure.
- Pure parts (steps, arguments, localhost guard) are covered by `tests/unit/scripts/ciLocal.test.ts`.
