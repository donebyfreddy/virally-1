# Third-party notices

Virally is proprietary. This file records third-party source that Virally has
**studied or adapted** at the source level — not packages installed from a
registry, which carry their own licences in `node_modules` and
`package-lock.json`.

An entry here means one of two things, and the distinction matters:

- **Adapted** — Virally source contains code, data or structure derived from the
  upstream work. The upstream licence applies to that derivation and the notice
  below is a licence obligation.
- **Studied** — the upstream work was read to understand a third-party protocol
  or to inform a design, but no upstream code was copied. Recorded for honesty
  and provenance, not because a licence compels it.

---

## Open Generative AI

| | |
|---|---|
| **Repository** | https://github.com/anil-matcha/open-generative-ai |
| **Upstream name** | Open Generative AI (`open-generative-ai`), v2.0.0 |
| **Licence** | MIT |
| **Copyright** | Copyright (c) 2026 Open Generative AI Contributors |
| **Commit audited** | see `docs/integration/open-generative-ai-audit.md` |
| **Relationship** | Adapted (model metadata) + Studied (MuAPI wire protocol) |

### Licence text

```
MIT License

Copyright (c) 2026 Open Generative AI Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### What Virally uses

**Adapted — model metadata.**

The upstream `packages/studio/src/models.js` (and its generator input
`models_dump.json`) is a machine-generated description of the MuAPI model
surface: per-model endpoint slugs, input field names, enumerated aspect ratios,
durations and resolutions, and the per-model quirks that decide which payload
key receives a reference image (`imageField`, `lastImageField`, `images_list`).

Virally derives its MuAPI catalogue from that data. The derivation is a
transformation, not a copy: upstream ships 422 models across eight loosely
related arrays with no capability taxonomy and no pricing; Virally emits a
curated, typed, priced subset in its own `GenerationModel` shape. The upstream
data is nonetheless the factual source for every endpoint slug and field name,
so the MIT notice above applies to it.

| Virally file | Derived from |
|---|---|
| `src/lib/creative/muapi/catalog.ts` | `packages/studio/src/models.js` — endpoint slugs, input field names, ratio/duration/resolution enums, `imageField` / `lastImageField` / `hasPrompt` / `maxImages` per-model quirks |

**Studied — MuAPI wire protocol.**

The upstream `src/lib/muapi.js` and `packages/studio/src/muapi.js` were read to
determine how MuAPI is called, because MuAPI's own public documentation does not
publish endpoint-level request and response schemas. What was learned is
protocol fact — the submit path shape, the `x-api-key` header, the
`{ request_id }` submit response, the `GET /api/v1/predictions/{id}/result`
polling path, the status vocabulary, and the `outputs[]` result array — and
protocol fact is not copyrightable expression.

No upstream code was copied. `src/lib/creative/muapi/client.ts` is written
against Virally's existing `MagnificClient` as its model, and differs from
upstream in every respect that matters: the credential is read server-side only,
requests carry an abort budget, polling is driven by a durable job rather than
an in-process loop, and failures are mapped to Virally's `GenerationFailure`
rather than thrown as strings.

### What Virally deliberately does not use

Recorded because rejecting these was a decision, not an oversight:

| Upstream area | Reason |
|---|---|
| `electron/`, `build/local-ai/`, `src/lib/localModels.js`, `src/lib/localInferenceClient.js` | Desktop and local-inference runtime. Out of scope for a web deployment; must never enter the browser bundle. |
| `src/components/*Studio.js`, `packages/studio/src/components/*.jsx` | Dark single-tenant desktop UI. Virally has its own authenticated light design system. |
| `middleware.js` MuAPI rewrite | Blind unauthenticated proxy of `/api/v1/*` to `api.muapi.ai`. An open relay against a billed API. |
| `MuapiClient.getKey()` (`localStorage` / `window.__MUAPI_KEY__`) | Browser-held provider credential. |
| `pollForResult` in-browser loops | Up to 900 unbounded attempts with no abort budget and no durable record. |
| `app/api/**` proxy routes | Header-forwarding passthroughs with no tenant check, no rate limit and no idempotency. |
| `packages/Vibe-Workflow`, `packages/Open-Poe-AI`, `packages/Open-AI-Design-Agent` | Git submodules for a generic node editor and agent runtime. Concepts informed Virally's typed workflow templates; no code taken. |

---

## Provider APIs

Virally speaks to third-party HTTP APIs. Their terms bind usage, not this
repository's licensing, and no vendor code is vendored here.

| Service | Terms |
|---|---|
| Magnific | https://www.magnific.com/terms |
| MuAPI | https://muapi.ai/terms |

---

## Maintaining this file

Add an entry whenever Virally source is derived from a third-party work, before
the code that derives from it merges. An adaptation that ships without its
notice is a licence breach, and one discovered later is far more expensive to
unwind than to record now.
