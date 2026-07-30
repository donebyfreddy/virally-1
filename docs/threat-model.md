# Virally — threat model

Scope: the authenticated product in `web/`. Covers what is implemented today and states
plainly where a control is designed but not yet built. Nothing here claims a mitigation
that has not been written.

Status key — **Mitigated**: implemented and tested. **Partial**: implemented, gaps
named. **Open**: not implemented.

> **2026-07-30 — migrated off Supabase to Neon Postgres + Drizzle ORM + Better Auth.**
> This is a real change in security posture, not a relabelling, and every section below
> was re-read against it:
>
> - **Row-level security is gone.** Neon has no RLS policies on these tables. Every
>   guarantee this document previously attributed to `FORCE ROW LEVEL SECURITY` and the
>   `SECURITY DEFINER` helpers in `0002`/`0003` now depends entirely on
>   `src/lib/db/authorization.ts` being called correctly at every query site — a
>   code-review obligation, not a database-enforced one. Treat any section below still
>   describing an RLS policy as **historical**: it documents the property Neon must
>   still uphold, not a mechanism currently enforcing it.
> - **The pgTAP isolation/control test suite (`supabase/tests/*.sql`) no longer runs
>   against anything.** It asserted RLS policies that no longer exist. No equivalent
>   automated cross-tenant test exists yet against Neon — this is a new, real gap, not
>   carried over from before.
> - **Supabase Auth (GoTrue) is replaced by Better Auth.** Credentials, sessions and
>   OAuth are Better Auth's tables (`user`, `session`, `account`, `verification`) and
>   API, not Supabase's.
> - The `supabase/` directory (migrations, config, tests) is retained only as historical
>   reference for what the schema/policies used to be — it is not applied to anything.

---

## 1. Cross-tenant data access

**Threat.** A user reads or writes another organisation's campaigns, media, accounts,
analytics or tokens — by guessing a UUID, by tampering with a cookie, or by calling
PostgREST directly with their own valid JWT.

**Status: Partial — re-architected, not yet re-verified.**

- RLS is gone. Isolation is now enforced by `src/lib/db/authorization.ts`
  (`assertWorkspaceMember`, `assertOrgMember`, `assertWorkspacePermission`,
  `assertOrgPermission`, `isWorkspaceMember`, `isOrgMember`) plus explicit
  `where(eq(table.workspaceId, context.workspaceId))` filters on every query — there is
  no database-level fallback if a call site omits either.
- Workspace and brand selection arrive in cookies and are re-validated against
  membership on every read (`lib/tenant/context.ts`) and every write
  (`lib/tenant/actions.ts`).
- **Open, and new:** `supabase/tests/10_tenant_isolation_test.sql` and
  `20_rls_control_test.sql` asserted this property automatically against real RLS
  policies. Neither has an equivalent against Neon yet — cross-tenant isolation is
  currently verified by code review only, not by an automated test that would catch a
  regression. This is the single most important gap this migration introduced and it
  should be closed before the next tenant-touching change ships.

**Residual.** There is no service-role/RLS-bypass distinction anymore — the application
itself is the only writer, using one Postgres role. Every call site must authorise
first; that is a code-review obligation, not something the database can catch.

---

## 2. OAuth token theft / unauthorised publishing

**Threat.** An attacker with a compromised browser session, or an XSS foothold, reads a
platform access token and posts as the user's brand.

**Status: Partial; encryption is Open.**

- `oauthConnections` (src/lib/db/schema.fragment.ts) has no query call sites anywhere in
  the app yet (no platform adapter is implemented), and every future call site must go
  through `src/lib/db/authorization.ts` explicitly — there is no RLS backstop anymore if
  one doesn't.
- The UI would read `connectedAccountTokenStatus`, a view exposing expiry state only —
  no ciphertext, no scopes-as-secrets, no key id — but its own header now says plainly
  that the view carries no authorisation predicate of its own; the caller must filter to
  its own workspace.
- Session cookies are httpOnly; sign-out is a server action because only the server can
  clear them.
- **Open:** `access_token_encrypted` is a column with a key-version discriminator, but
  the application-layer encryption using `TOKEN_ENCRYPTION_KEY` is **not implemented**.
  Until it is, tokens would be stored as plaintext in a column named `_encrypted`. No
  tokens exist yet because no adapter is implemented, so nothing is currently at risk —
  but the encryption must land before the first real connection.

---

## 3. Account takeover

**Threat.** An attacker gains control of a Virally account and thereby of every
connected social account.

**Status: Partial.**

- Better Auth owns credentials (`account.password`, hashed); no password is ever stored
  in an application table.
- `auth.api.getSession()` (which validates the session against the database) is used
  everywhere access is gated, via `src/lib/auth/session.ts`.
- Google OAuth uses Better Auth's own PKCE/state-cookie flow, so an intercepted
  authorisation code is useless.
- Email verification is configured (`emailVerification.sendOnSignUp` in
  `src/lib/auth/better-auth.ts`), so an account's email is confirmed before being
  treated as verified. Delivery itself is feature-detected: with no `RESEND_API_KEY`,
  the link is logged to the server console rather than silently failing to send (see
  `src/lib/auth/email.ts`) — treat any deployment without `RESEND_API_KEY` set as **not
  actually enforcing this** in practice, since nobody receives the email.
- **Open:** no MFA. No re-authentication prompt before high-impact actions
  (disconnecting accounts, changing a role, publishing a large batch).

---

## 4. Open redirect / phishing via our own domain

**Threat.** `?next=https://evil.example` turns our sign-in page into a credible
launchpad for credential phishing.

**Status: Mitigated.** `safeNextPath` in `lib/auth/routes.ts` accepts only same-origin
absolute paths. `routes.test.ts` covers absolute URLs, `javascript:`, `data:`,
protocol-relative `//host`, backslash-smuggled `/\host`, control-character scheme
smuggling (`/\tapp`), unrooted paths, and auth-route loopbacks — 12 hostile inputs.

---

## 5. Account enumeration

**Threat.** An attacker learns which email addresses have accounts.

**Status: Mitigated on all three vectors.**

- Sign-up returns Better Auth's own neutral response for sign-up requests rather than
  reintroducing the leak.
- Password reset always reports success, conditionally worded ("if an account exists").
- Sign-in returns one combined credential error, never "no such user".
- Rate limiting is the one condition surfaced, because silence would leave the user
  pressing a dead button.

---

## 6. Prompt injection from imported content

**Threat.** A user imports a website or document; that content contains instructions
which the language model follows — exfiltrating the system prompt, or poisoning
generated output.

**Status: Partial.**

- `sanitiseExternalText` strips zero-width and bidirectional control characters (used to
  hide instructions from a human reviewer while leaving them readable to the model),
  neutralises instruction-override phrasings across a wide determiner set, redacts
  system/developer-prompt references, and strips the fence delimiter so imported text
  cannot escape into instruction context.
- `fenceExternalText` wraps content in an explicit data fence with an instruction to
  treat it as data.
- `campaign_briefs.external_text_sanitised` records that the filter ran, so a later
  stage can refuse unsanitised text rather than assuming.
- 11 tests in `lib/ai/ai.test.ts`.

**Residual — stated plainly.** Input filtering cannot make untrusted text safe. A
determined injection will get through. The real mitigations are architectural and
**Open**: generated output is not yet treated as untrusted when rendered, and the model
is not yet given least-privilege tool access. Nothing generated should ever be executed
or trusted as an instruction.

---

## 7. Duplicate publishing

**Threat.** A retry, a double-click or a crash between "posted" and "recorded that we
posted" results in the same content published twice.

**Status: Mitigated, in three layers.**

1. `scheduled_posts` unique on `(content_variant_id, connected_account_id, scheduled_for)`.
2. `publishing_jobs.idempotency_key` unique; the key is a pure function of variant,
   account and minute (`publishIdempotencyKey`) — it contains no timestamp and no nonce,
   because either would make every retry a fresh row.
3. Partial unique index on `(connected_account_id, external_post_id)`, so the database
   itself refuses to record the same remote post twice. A `published` row without an
   `external_post_id` is rejected by a check constraint, so a half-written success cannot
   masquerade as pending and be retried.

`isRetrySafe` fails closed on an ambiguous mid-upload failure: the UI must ask the user
to check the account rather than offering a retry button.

---

## 8. Generation cost abuse

**Threat.** A user — or a bug — triggers work costing far more than intended.

**Status: Partial.**

- `PLAN_LIMITS` caps concepts, hooks, languages, accounts and total variants (5,000) per
  request.
- Counts and cost are computed by one pure module used by both client and server, and
  **re-validated server-side**; the client's numbers are never trusted.
- The confirmation gate for an expensive batch is re-decided on the server, so omitting
  the checkbox client-side cannot bypass it.
- Default stage is `plan`, never `render`.
- `generation_runs` records provider, model, prompt version, cost and whether a failed
  attempt was billed.
- **Open:** no per-organisation spend ceiling, and no rate limit on campaign creation.
  A user can currently create unlimited campaigns each under the per-request cap.

---

## 9. Malicious uploads

**Threat.** A user uploads a file that exploits the transcoder, or serves as a vector to
other users.

**Status: Partial.**

- Per-bucket MIME allow-lists and size limits (`0012`).
- `media_assets.scan_state` exists and defaults to `pending`.
- All buckets private; access via short-lived signed URLs only.
- **Open:** no scanner is wired, so `scan_state` never leaves `pending`. No server-side
  content-type verification — the declared MIME type is currently trusted.

---

## 10. Media URL leakage

**Threat.** A user's unpublished campaign video becomes publicly accessible.

**Status: Open — scaffolding only, nothing uses it yet.** No app code uploads or reads
media (confirmed before and after this migration — no adapter is implemented). The
storage layer that exists (`src/lib/storage/`) is an adapter interface plus a
local-disk mock for development, gated behind a signed, time-limited HMAC token
(`src/lib/storage/local.ts`) so no object is ever served from an unguarded public path —
but neither the adapter interface nor its dev implementation currently checks that the
caller belongs to the workspace whose object it is requesting; that authorisation still
needs to be added at the call site (mirroring the same `assertWorkspaceMember` pattern
used everywhere else) before any real upload/download path is built on top of it.

---

## 11. Webhook forgery and replay

**Threat.** An attacker posts a forged provider callback to mark a job complete, or
replays a real one.

**Status: Partial.**

- `webhook_events` is unique on `(source, external_event_id)`, so a replay collides.
- `signature_verified` is recorded per event.
- RLS enabled with no policies — service-role only, since payloads can contain other
  tenants' material.
- **Open:** no webhook endpoints exist yet, so no signature verification is implemented.
  The schema is ready; the handlers are not.

---

## 12. Privilege escalation within a tenant

**Threat.** An editor grants themselves admin, or approves their own content.

**Status: Partial.**

- Eight roles mapped to thirteen discrete permissions in `src/lib/permissions/index.ts`
  (`ROLE_PERMISSIONS`), asserted against `supabase/migrations/0001_foundation.sql`'s
  original seed by `permissions.test.ts` so the two cannot silently drift — that
  migration file is kept specifically as the golden reference this test still checks
  against.
- **Open, and new:** the "only an owner may create or alter another owner" rule
  previously lived in an RLS policy (`0002`) enforced on every write regardless of
  application code. No team-management server actions exist yet (role changes,
  invitations) to even carry this rule forward — when they're built, they must
  explicitly re-check `isOrgOwner` before permitting a role change to/from `owner`,
  since there is no database-level backstop anymore.
- Approval, creation and publishing are separate permissions in the role matrix, but
  there is no automated isolation test proving an editor is blocked from approving —
  see §1's note on the retired pgTAP suite.

---

## 13. Billing / ledger tampering

**Threat.** A user grants themselves credits or erases usage.

**Status: Open — no write path exists yet, so nothing to tamper with.** `usageEvents`
and `creditLedger` (src/lib/db/schema.fragment.ts) have no query call sites anywhere in
the app. Balances are designed as a `SUM` over the ledger, never a stored counter, which
remains the right design — but when a write path is built, it must gate on
`billing.manage`/`billing.view` via `src/lib/db/authorization.ts` itself, since there is
no RLS write-policy to fall back on if that check is missed.

---

## 14. Queue poisoning

**Threat.** A crafted job payload causes a worker to do something unintended, or a job
loops forever.

**Status: Partial.**

- `jobs` (src/lib/db/schema.fragment.ts) has no query call sites anywhere in the app yet
  — no worker or enqueue path is implemented. When one is built it must enqueue only
  through server actions with their own workspace/permission checks, since there is no
  RLS write-policy to fall back on.
- `max_attempts`, an attempts check constraint, a `dead_letter` status and a
  `locked_until` lease (so a crashed worker's job is reclaimable rather than stuck).
- **Open:** no worker is implemented, so payload validation at the consumer boundary
  does not exist yet.

---

## 15. Availability / denial of wallet

**Status: Open.** Better Auth ships configurable rate limiting but it is not currently
turned on in `src/lib/auth/better-auth.ts`. Sign-up, campaign creation and password
reset are all unthrottled at our layer. This is the largest open gap and should precede
any public launch.

---

## Summary of open items, in priority order

1. **Rate limiting** across auth, creation and reset endpoints (§15).
2. **Token encryption** before the first real social connection (§2).
3. **Upload scanning and server-side content-type verification** (§9).
4. **Webhook signature verification** when handlers are written (§11).
5. **Per-organisation spend ceiling** (§8).
6. **MFA and re-authentication** for high-impact actions (§3).
7. **Treat generated output as untrusted** at render time (§6).

## What this document deliberately does not claim

- No penetration test has been performed.
- No security review by a third party.
- Nothing has run against a production load; all verification so far is the migration
  build/typecheck/lint/test pass plus manual review, against a real (but low-traffic)
  Neon project.
- The compliance boundary (no account creation, no CAPTCHA bypass, no proxy rotation, no
  fake engagement, no credential collection) is enforced by the absence of those
  capabilities from the adapter interface. The credential-shaped-column assertion that
  used to fail the Supabase migration build (`0014` assertion 2) has no Neon/Drizzle
  equivalent yet — this boundary is currently enforced by code review only, not by an
  automated check, for any new column added to the schema.
