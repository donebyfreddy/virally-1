# Open Generative AI — audit, reuse matrix and integration plan

**Phase 0–1 deliverable.** Audited 2026-08-01.

| | |
|---|---|
| Upstream | https://github.com/anil-matcha/open-generative-ai |
| Version | 2.0.0, MIT |
| Cloned to | `/tmp/open-generative-ai` (outside the Virally tree, never vendored) |
| Licence notice | [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) |

---

## 1. What the upstream repository actually is

It is a **single-user Electron desktop app** with a Next.js shell, not a
multi-tenant web product. Every architectural decision in it follows from that,
and most of them invert Virally's requirements.

```
electron/          Desktop main process
build/local-ai/    Bundled local inference binaries (Wan2GP, stable-diffusion.cpp)
src/components/    12 dark "Studio" screens (Image, Video, Cinema, LipSync, …)
src/lib/muapi.js   MuAPI HTTP client — reads the key from localStorage
packages/studio/   The same studios again, as a workspace package (the newer copy)
  src/models.js    22,296 lines: 422 models across 8 arrays. Generated.
  src/muapi.js     857 lines: the fuller client (adds audio, workflows, agents)
packages/Vibe-Workflow/       git submodule — generic node editor
packages/Open-Poe-AI/         git submodule — agent runtime
packages/Open-AI-Design-Agent/ git submodule — design agent
app/api/**         Header-forwarding proxies to api.muapi.ai
middleware.js      Rewrites /api/v1/* straight to api.muapi.ai
tests/             4 tests, all about local-inference file paths
```

There is **no database, no auth, no tenancy, no billing, no job queue, no
storage layer, and no cost model.** Those are the parts Virally already has and
the reason the repository cannot be adopted as an application.

Its genuine value is narrow and real: it is the only place where the **MuAPI
model surface and wire protocol are written down**. MuAPI's public documentation
covers authentication and webhooks but does not publish endpoint-level request
schemas. Upstream's `models.js` does — for 422 models.

### Dependency compatibility

| | Virally | Upstream | Verdict |
|---|---|---|---|
| Next.js | 16.2.12 | ^15.0.0 | Major gap — upstream App Router code not portable |
| React | 19.2.4 | ^19.0.0 | Compatible |
| Tailwind | v4 (`@tailwindcss/postcss`) | v3.4 + `tailwind.config.js` | Incompatible config model |
| Language | TypeScript (strict) | Plain JS, `jsconfig.json` | No types to import |
| Runtime | Next server | Electron + Vite | Rejected wholesale |

New dependencies required: **none.** Upstream's only runtime deps beyond
Next/React are `axios` and `react-hot-toast`; Virally uses `fetch` and has its
own notification surface. Nothing is installed.

---

## 2. Security audit of the external code

Every item was checked against the brief's list. Findings are ordered by
severity, and each records what Virally does instead.

| # | Finding | Where | Severity | Virally's counter-design |
|---|---|---|---|---|
| 1 | **Provider API key held in the browser** — `window.__MUAPI_KEY__ \|\| localStorage.getItem('muapi_key')`, then sent as `x-api-key` on `fetch` from the renderer | `src/lib/muapi.js:9-13` | Critical | Key is read only by `src/lib/creative/env.ts`, which throws if imported in a browser context. Never `NEXT_PUBLIC_*`, never in a server-action return value. |
| 2 | **Open proxy to a billed API** — middleware blind-rewrites any `/api/v1/*` to `api.muapi.ai`, no auth, no allowlist, no rate limit | `middleware.js:37-41` | Critical | No proxy exists. Virally calls MuAPI server-side from a typed adapter with a fixed endpoint allowlist derived from the catalogue. |
| 3 | **Unbounded polling** — up to 900 attempts × 2 s ≈ 30 min per task, in a browser loop, with `continue` on every 5xx and no abort budget | `packages/studio/src/muapi.js:17-40` | High | Polling is a durable `jobs` row with attempt limits, exponential backoff, a per-call `AbortController`, a wall-clock deadline, and a `dead_letter` terminal state. Terminal tasks are never polled again. |
| 4 | **No request timeouts** — every `fetch` is unbounded | throughout | High | Every call carries an abort budget (30 s submit, 15 s poll), modelled on `MagnificClient`. |
| 5 | **No idempotency** — a double-click submits twice and bills twice | throughout | High | `idempotency_key` is a required field on the request type and a `UNIQUE (workspace_id, idempotency_key)` constraint on `provider_runs`. Already enforced. |
| 6 | **No tenant isolation** — no concept of a tenant | n/a | Critical for us | Every new table carries `organization_id` + `workspace_id`; all reads go through `TenantScope`. |
| 7 | **Weak upload validation** — `upload-binary` accepts any multipart body, no auth, no size cap, no MIME or signature check | `app/api/upload-binary/route.js` | High | Reference uploads reuse Virally's `media_assets` path: size cap, MIME + magic-byte check, checksum, scan state. |
| 8 | **Insecure URL fetching** — result URLs from the provider are rendered directly, never revalidated | throughout | Medium | `ingest.ts` downloads server-side with a byte cap and content-type verification; the provider URL is recorded as temporary and never served. |
| 9 | **Credentials echoed into logs** — `console.log('[Muapi] Payload:', finalPayload)` on every call | `src/lib/muapi.js:68-69` and ~14 others | Medium | No provider value is ever interpolated into a log line or an `Error`; `credentialEnvVar` names the variable only. |
| 10 | **Webhooks unused, and unsigned upstream** — MuAPI supports a `webhook` param but publishes no signature scheme | MuAPI docs | Medium | See §5. Treated as an untrusted *hint*, not a write path. |
| 11 | **"No safeguards" product stance** — no moderation, no consent gate, no rate limits | product-wide | Policy | Virally keeps moderation, consent confirmation for likeness/voice, workspace rate limits and audit logs. Non-negotiable. |
| 12 | **Local inference in the app bundle** — Wan2GP / stable-diffusion.cpp staged into the build | `build/local-ai/`, `scripts/stage-local-ai-binary.js` | N/A | Excluded. The provider interface is shaped so a future out-of-band `LocalInferenceProvider` worker can implement it (§7). |

---

## 3. MuAPI protocol — what the audit established

Derived from upstream's client and confirmed against muapi.ai/docs.

| Aspect | Value |
|---|---|
| Base URL | `https://api.muapi.ai` |
| Auth header | `x-api-key: <key>` |
| Submit | `POST /api/v1/{endpoint}` — endpoint slug is per-model, **not** derivable from the model id |
| Submit response | `{ request_id }` (sometimes `{ id }`; some endpoints return the result inline) |
| Poll | `GET /api/v1/predictions/{request_id}/result` |
| Status values | `completed` / `succeeded` / `success`, `failed` / `error`, otherwise still running |
| Progress | **Not reported.** No percentage field exists. |
| Results | `outputs: string[]` (also seen as `url`, `output.url`) |
| Upload | `POST /api/v1/upload_file`, multipart |
| Balance | `GET /api/v1/account/balance` |
| Webhooks | Supported via a `webhook` request param. **No signature scheme published.** |
| Pricing | **Not exposed anywhere** — not in the catalogue, not in the submit or poll response |
| Env var | Upstream uses `MUAPI_KEY`. Virally uses `MUAPI_API_KEY` to match `MAGNIFIC_API_KEY`. |

Two facts drive the design:

**MuAPI reports no progress.** Virally's `GenerationTaskStatus.progress` is
already nullable and the UI already renders an indeterminate indicator for null.
The adapter reports `null` rather than synthesising a percentage.

**MuAPI quotes no price.** Every MuAPI estimate is therefore
`basis: "configured_table"` — a Virally-configured figure, never presentable as
a vendor quote. The existing `CostEstimate` type already carries that
distinction, and the estimator UI already honours it.

---

## 4. Reuse matrix

| Upstream artefact | Lines | Disposition | Rationale |
|---|---|---|---|
| `packages/studio/src/models.js` — model metadata | 22,296 | **Adapt (data)** | The only written record of MuAPI's endpoint slugs and per-model field quirks. Transformed into a curated typed subset, not copied. Licence notice recorded. |
| `packages/studio/src/muapi.js` — wire protocol | 857 | **Study only** | Protocol facts (paths, header, envelope) are not copyrightable expression. Client rewritten against `MagnificClient`. |
| `src/lib/muapi.js` | 557 | **Study only** | Older duplicate of the above. |
| `src/lib/promptUtils.js` | 92 | **Study only** | Prompt-shaping helpers; Virally's `src/lib/ai/` already covers this. |
| `packages/studio/src/models.js` — `imageField` / `lastImageField` / `images_list` handling | — | **Adapt (logic shape)** | The per-model reference-image field mapping is genuine domain knowledge. Reimplemented as typed catalogue data. |
| Workflow node/step concepts (`Vibe-Workflow`) | submodule | **Concept only** | Informs Phase 6 typed templates. No node editor, no code. |
| `src/components/*Studio.js`, `packages/studio/src/components/*.jsx` | ~15k | **Reject** | Dark single-tenant desktop UI. Virally has its own light authenticated design system. |
| `middleware.js` MuAPI rewrite | 54 | **Reject** | Open proxy (finding #2). |
| `app/api/**` | ~660 | **Reject** | Unauthenticated passthroughs. |
| `electron/`, `build/local-ai/`, `afterPack.js`, `scripts/` | — | **Reject** | Desktop packaging and local inference. |
| `src/lib/localModels.js`, `localInferenceClient.js` | 283 | **Reject (shape only)** | Confirms the provider interface can accommodate a future local worker. |
| `src/lib/uploadHistory.js`, `pendingJobs.js` (localStorage) | 85 | **Reject** | Client-side job state. Virally's `jobs` table is durable and authoritative. |
| `tests/` | 4 files | **Reject** | All about local-inference file paths. |
| `packages/Open-Poe-AI`, `Open-AI-Design-Agent` | submodules | **Reject** | Agent runtimes out of scope. |

**Net:** one data file adapted, two studied. Zero upstream source files copied.
Zero new npm dependencies.

---

## 5. What Virally already has (and must not be duplicated)

This is the most important finding of the audit. Virally's `src/lib/creative/`
is **already** the normalized generation layer the brief describes, and the
Neon schema already models most of the required tables. The correct integration
is to *extend* it. Building a parallel `MediaGenerationProvider` stack alongside
`CreativeGenerationProvider` would create two sources of truth for cost,
idempotency and tenancy — the exact failure the brief is trying to avoid.

| Brief requirement | Already exists |
|---|---|
| Normalized provider interface | `CreativeGenerationProvider` — `src/lib/creative/types.ts:199` |
| `isConfigured()`, `estimate*`, `submit`, `getStatus`, `cancel?` | all present, plus `supports()` |
| `MockProvider` | `MockCreativeProvider` — `mock.ts` |
| `MagnificProvider` | `magnific/provider.ts` (+ client, catalog, webhook) |
| `ProviderRouter` with explainable fallback | `router.ts` |
| Cost estimate separate from generation | `CostEstimate`, `estimator.ts` |
| Production Credits reserve / settle / release / expire | `credits.ts`, `credit_reservations`, `credit_ledger` |
| Production modes as data | `production_modes` table + `modes.ts` |
| Idempotent submission | `provider_runs.idempotency_key`, `UNIQUE(workspace_id, key)` |
| Server-side download, checksum, MIME, size cap, storage | `ingest.ts` (`MAX_ASSET_BYTES` 512 MB) |
| Provider URL marked temporary | `provider_run_outputs.source_url` + null `media_asset_id` until ingested |
| Tenant isolation | `TenantScope`, org+workspace on every table |
| Tables | `generation_providers`, `generation_models`, `provider_runs`, `provider_run_outputs`, `production_modes`, `cost_configuration`, `media_assets`, `media_asset_versions`, `jobs`, `job_events`, `usage_events`, `credit_ledger`, `credit_reservations`, `activity_events`, `audit_logs` |
| Webhook verification | `magnific/webhook.ts` (HMAC-SHA256) |

### Genuine gaps this integration must close

| Gap | Phase |
|---|---|
| `generation_models` has no capability taxonomy — only `kind: image\|video\|audio`. No `text-to-image` vs `image-to-image`, no lip-sync, no reference-image limits, no seed/negative-prompt flags. | 2 |
| Catalogue is a hardcoded TS array (`MAGNIFIC_MODELS`), not read from Neon. Models cannot be added, retired, repriced or disabled without a deploy. | 2 |
| No `generation_model_versions` — no history when a model is renamed or repriced. | 2 |
| `provider_runs.state` lacks `waiting_external`, `validating`, `dead_letter`. | 2 |
| Per-provider rate limit is a single integer; needs to be per capability. | 2 |
| **No job runner exists.** The `jobs` table and `pollRun()` exist, but nothing claims or drains the queue. | 2 |
| No lip-sync capability, no consent gate. | 5 |
| No workflow tables or engine. | 6 |
| Generation studios (`/app/generate/*`). | 3–5 |

---

## 6. Design decisions taken

**Extend `CreativeGenerationProvider`, do not add `MediaGenerationProvider`.**
The brief's proposed interface and the existing one describe the same contract
with different names. The existing one is better in two respects worth keeping:
`supports()` lets the router distinguish "not configured" from "cannot do 4:3
video", and `credentialEnvVar` lets an unconfigured state tell an operator which
variable to set. The brief's additions — `listModels(capability)`, an explicit
`GenerationCapability` union, and richer `GenerationModel` metadata — are real
gaps and are being added to the existing interface.

**The catalogue moves to Neon; the TS array becomes the seed.** `generation_models`
becomes authoritative and is read through a short-lived cached loader. The
in-code catalogue survives only as seed data and as the fallback when the table
is unseeded — the same pattern `modes.ts` already uses for `production_modes`.
This is what makes models addable, retirable, renamable and repriceable without
a deploy, and it is why no model id may be hardcoded in JSX.

**MuAPI webhooks are a hint, never a write path.** MuAPI publishes no signature
scheme, so an inbound webhook cannot be authenticated the way Magnific's can.
Accepting one as a state transition would be an unauthenticated write into the
job table. Instead the registered URL carries a per-run unguessable token, and a
valid hit only *schedules an immediate poll*. The poll — an authenticated
outbound call — remains the sole source of truth. This keeps the latency benefit
with none of the trust.

**MuAPI does not displace Magnific.** Magnific keeps its webhook path, its
catalogue and its position in the router. MuAPI is a second candidate, selected
on capability, price and availability. Where both can serve, the router
explains which it chose and why.

**Curated model subset, not 422 models.** Upstream exposes every model MuAPI
sells. Virally seeds a curated subset per capability. Exposing all of them would
make the production-mode abstraction meaningless and give the estimator a
surface it cannot price honestly — MuAPI publishes no prices at all. The
catalogue table can be extended operationally when a model is priced.

---

## 7. Local inference — deliberately deferred

Upstream ships Wan2GP and stable-diffusion.cpp binaries and an Electron host.
None of it enters the web deployment: no Electron, no model weights, no native
binaries in the bundle.

The provider interface is nonetheless shaped to accept a future
`LocalInferenceProvider`: it is submit-then-poll, it declares its own
capabilities and configuration state, and it quotes its own cost. A local worker
would be a **separate out-of-band deployment** that implements the same
interface and registers with the router — not a change to the web app. Documented
here so the option stays open; not built.

---

## 8. Phase plan

| Phase | Scope | State |
|---|---|---|
| 0 | Clone, audit both repos, security review | Done |
| 1 | Reuse matrix, licence notices, architecture decisions | Done — this document + `THIRD_PARTY_NOTICES.md` |
| 2 | Capability taxonomy · DB-backed catalogue · `MuApiProvider` · router extension · durable job runner · migration `0003` | Done |
| 3–5 | Generation service layer, studios, campaign + Remotion attachment | Service layer done; studios in progress |
| 6 | Typed workflow templates · migration `0004` | Done |
| 7 | Hardening: moderation, rate limits, consent, a11y, tests | Safety and limits done; e2e pending |

### Defects found and fixed along the way

Recorded because each was latent in the existing code and none was part of the
brief — they were surfaced by adding a second provider and by testing the paths
that had never had a caller.

| Defect | Consequence had it shipped |
|---|---|
| `pipeline.ts` `resolveProvider()` re-routed a synthetic request and accepted the result only on id match | Correct with one provider. With two, every MuAPI run resolved to `null` and stuck in `submitted` with no error. |
| `pollRun` enumerated three terminal states inline | A `dead_letter` run would be polled forever, since nothing would move it on. |
| `reservationForRun()` returned `null` unconditionally | Credits were held and never charged. Every generation effectively free; holds cleared only by an expiry sweeper that nothing scheduled. |
| `submitGeneration` re-routed after the service layer had already quoted | The user could be charged against a quote for a model that never ran. |
| `mock` had no `generation_providers` row | `provider_runs.provider_id` has a FK to that table, so **no mock generation could be persisted at all** — the credential-free path the brief requires died at the first submit. |

### Architecture notes added in this pass

**Reserve-then-submit, settle-on-last.** Credits are withheld before any
provider is called, and the run is linked to its reservation only once the run
row exists — which is after submission. A reservation covering a batch settles
exactly once, when the last of its runs reaches a terminal state, for the sum of
their actual costs. Settling on the first would charge the batch for one clip
and release the rest of the hold.

**MuAPI webhooks are a hint, not a write path.** Implemented as designed in §6:
the callback URL carries a per-run HMAC capability token, and a valid hit only
brings the next poll forward (floored at 2s so a callback storm cannot pin a job
to the front of the queue). The endpoint never reads the request body. The
authenticated outbound poll remains the sole source of truth.
