# Flash Card Completion Plan

## Status and scope

The server-authoritative backend is complete and closed. The repository already contains:

- the authoritative Postgres/Drizzle schema and migrations;
- deterministic `Cadence` and `StudyQueue` domain policies;
- authenticated, tenant-scoped vertical tRPC routers for auth, decks, cards, revisions, queues, reviews, history, and undo;
- request-consistent application time;
- unit, schema-integration, and real-JWT/real-HTTP acceptance coverage.

The remaining product work is:

1. a shared authenticated tRPC client;
2. the Expo Router/React Native Web frontend;
3. the agent-facing TypeScript CLI;
4. assembled-product verification and production rollout.

Backend architecture, schema design, cadence behavior, queue behavior, and authorization are not active design work. Change them only when client integration exposes a concrete contract defect, and cover that defect at the existing backend boundary before continuing.

This document is the authoritative product and architecture plan. [`task.md`](./task.md) is the remaining execution checklist. [`plan-backend-acceptance-tests.md`](./plan-backend-acceptance-tests.md) is a completed historical implementation plan, not active scope.

## Goals

- Keep Postgres as the only durable application-data source of truth.
- Give the frontend and CLI one typed, authenticated API.
- Keep both clients thin: presentation and transport only.
- Restore a complete study and card-management experience without restoring RxDB, replication, FSRS, or client-side scheduling.
- Preserve independent Markdown cards, semantic Chinese ruby/Pinyin rendering, and TTS metadata.
- Ship a repeatable, locally verified production deployment for the initial two users.

## Non-goals

- Offline study, local-first storage, or background replication.
- Client-side cadence, queue construction, authorization, or mutation reconciliation.
- OAuth, magic links, public signup, self-service password recovery, or email-confirmation UI.
- Automatic linkage between reciprocal cards.
- Daily limits or persisted study sessions.
- Supabase Realtime or live multi-client propagation.
- Restoring the deleted AI translator, sync screen, approval workflow, reverse-card workflow, or “super easy” rating.
- Replacing the accepted backend with repositories, services, a second API, or a client-specific endpoint layer.

## Locked product behavior

- Cards are independent records with a name, Markdown front and back, tags, optional speech metadata, suspension state, scheduling state, optimistic version, and timestamps.
- Reciprocal prompts are ordinary independent cards. The system stores no relationship between them.
- `nextReviewAt` is the sole authority for queue eligibility; a null value means the card is new.
- Studied cards due within the inclusive rolling 12-hour window precede all new cards.
- Studied cards use `nextReviewAt, id` ordering. New cards use `createdAt, id` ordering.
- The 12-hour horizon is fixed by the server rather than caller-configurable.
- The queue limit is a transport working-set limit, not a daily limit.
- Queue items contain the complete canonical card plus server-derived `new`, `due`, or `future` status.
- A short Again or initial Hard retry remains ahead of new cards because it falls inside the rolling window.
- Rating supports exactly `again`, `hard`, `good`, and `easy`.
- Undo applies only to the latest active review for a card and restores its recorded `beforeState` exactly.
- Review history includes visibly undone events. Revision history remains append-only, including rollback revisions.
- The client never computes a rating preview because cadence belongs to the server.

## Cadence

Cadence has no learning/review phase. Once a new card is rated, every later rating uses the same studied-card transition. `intervalDays` is the accumulated summary of earlier ratings; the scheduler does not replay review history.

| Card state | Rating | Next presentation | Stored interval |
|---|---|---|---|
| New | Again | 1 minute | 1 day |
| New | Hard | 10 minutes | 1 day |
| New | Good | 1 day | 1 day |
| New | Easy | 7 days | 7 days |
| Studied | Again | 1 minute | `max(1, old × 0.5)` days |
| Studied | Hard | `max(1, old × 1.2)` days | same |
| Studied | Good | `max(1, old × 2)` days | same |
| Studied | Easy | `max(7, old × 4)` days | same |

All intervals are capped at 365 days. Easy is intentionally aggressive so confidently known cards leave the active study workload quickly. Every accepted rating increments `reviewCount`; Again on a studied card also increments `lapseCount`.

Review events record exact before/after scheduling state for history and undo. They are evidence, not an input replay log. Undo restores the recorded state instead of mathematically reversing a multiplier.

## Existing server boundary

The public application boundary is the authenticated Edge Function rooted at `supabase/functions/api/router.ts`.

### Authentication

| Procedure | Result |
|---|---|
| `auth.session` | Verified caller identity and token timestamps. |

Supabase Auth owns email/password sign-in, refresh, and sign-out. Every Edge Function request requires a bearer access token; passwords never pass through tRPC.

### Decks

| Procedure | Result |
|---|---|
| `deck.list` | Deterministically ordered decks. Counts are not part of the current contract. |
| `deck.create` | Created deck. |
| `deck.rename` | Updated deck after version validation. |
| `deck.remove` | `{ removed: true }` after version validation and explicit confirmation. |
| `deck.queue` | Complete authoritative queue snapshot for one deck. |

The first frontend release lists decks without per-deck due/new counts. It must not issue one queue request per deck merely to synthesize counts. Add a server summary contract later only if counts prove necessary.

### Cards and revisions

| Procedure | Result |
|---|---|
| `card.get` | Canonical owned card. |
| `card.search` | Paginated deterministic card results. |
| `card.create` | Created card and initial revision. |
| `card.update` | Updated card and appended revision. |
| `card.suspend` | Replacement study queue. |
| `card.restore` | Restored card and replacement study queue. |
| `card.remove` | Replacement study queue after confirmation. |
| `card.revisions` | Paginated newest-first content revisions. |
| `card.rollbackRevision` | Restored card with rollback recorded as a new revision. |

### Reviews

| Procedure | Result |
|---|---|
| `review.rate` | Review ID and replacement study queue. |
| `review.history` | Paginated newest-first review events, including undone events. |
| `review.undo` | Replacement study queue. |

### Client consistency contract

The current API deliberately has two mutation categories:

1. **Active-study mutations:** `review.rate`, `review.undo`, `card.suspend`, `card.restore`, and `card.remove` return a replacement queue. The frontend installs `response.queue` verbatim. It never patches, reorders, or recalculates the queue locally.
2. **Management mutations:** card create/update/rollback and deck create/rename/remove return their affected resource or confirmation. Management screens update/refetch their resource data; the study screen fetches a fresh queue when entered or focused.

Additional invariants:

- The frontend keeps the current queue only in React memory.
- A queue fetch occurs on study-screen entry, foreground/focus, reconnect, and return from a management screen that may have changed the deck.
- Duplicate mutation controls are disabled while a request is pending.
- Review requests generate one UUID per logical rating attempt. An ambiguous retry reuses that UUID.
- Entity mutations send the last server-issued `version` as `expectedVersion`.
- A conflict causes a visible stale-data message and a refetch; clients do not merge or overwrite newer state.
- Queries may be retried. Mutations are not automatically retried except an idempotent `review.rate` retry using the same request ID.
- A mutation failure retains the last confirmed local view and shows the server error.

## Target client structure

```text
app/
  _layout.tsx                       Auth/session gate and application shell
  index.tsx                         Initial redirect
  auth.tsx                          Email/password sign-in
  (app)/
    decks/index.tsx                 Deck list and management
    review/[deckId].tsx             Queue, reveal, rate, undo, suspend
    cards/[deckId].tsx              Search and card management
    cards/edit/[cardId].tsx         Create/edit form
    cards/history/[cardId].tsx      Review and revision history

src/
  api/
    client.ts                       Shared authenticated tRPC client factory
    environment.ts                  Validated public client configuration
  auth/
    supabase.ts                     Frontend Supabase Auth client
  components/
    CardContent.tsx                 Safe Markdown and ruby renderer
    ErrorNotice.tsx                 Consistent request errors
  hooks/
    useAuth.ts                      Frontend session lifecycle
    useStudyQueue.ts                Queue snapshot and request state only
  presentation/                     Small display-only helpers when genuinely shared

cli/
  index.ts                          Executable entry point
  auth.ts                           CLI login/session credential adapter
  output.ts                         Stable stdout/stderr envelopes
  commands/                         Thin procedure invocations grouped by resource

tests/e2e/                          Cross-cutting Playwright journeys only
```

Exact file boundaries may stay smaller than this sketch. Do not create layers or wrapper modules without at least two real callers.

## Phase 1 — Shared authenticated API client

Implement one transport factory around `@trpc/client` and the exported `AppRouter` type.

The factory accepts:

- the Edge Function API URL;
- an asynchronous access-token provider;
- an unauthorized callback or refresh policy appropriate to the runtime.

It supplies the bearer token dynamically for every request. Frontend and CLI reuse the transport factory but own different session persistence:

- the frontend uses the Supabase browser/native session adapter;
- the CLI uses its credential adapter;
- neither client duplicates request or response DTOs;
- neither imports server runtime values or database code;
- only `import type` may cross from the router definition.

Use explicit environment names:

- frontend: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_API_URL`;
- CLI: `FLASHCARD_SUPABASE_URL`, `FLASHCARD_SUPABASE_PUBLISHABLE_KEY`, and `FLASHCARD_API_URL`.

Only URL and publishable-key values may enter client bundles. Database URLs, JWT secrets, service-role keys, test-clock secrets, and deployment tokens are server-only.

On an unauthorized API response, a client may refresh the Supabase session once and retry the request once. A second unauthorized response clears the local session and requires login. Do not add general mutation retries.

Acceptance:

- a real access token calls `auth.session` through the shared tRPC client;
- an expired access token follows the one-refresh rule;
- a missing session never sends an undefined or stale bearer token;
- frontend and CLI do not define handwritten copies of router payloads.

## Phase 2 — Frontend reconstruction

The old presentation at commit `787940b` is reference material for layout and interaction only. Reuse useful route/component code selectively, but rewrite every data and authentication binding. Never restore RxDB, replication, FSRS, reverse-card fields, daily limits, GitHub login, sync state, approval state, or client scheduling.

### Application shell and authentication

- Restore the Expo Router shell for web and native.
- Implement email/password sign-in with `signInWithPassword()`.
- Restore an existing Supabase session on startup and listen for session changes.
- Refresh access tokens through Supabase Auth.
- Confirm the accepted token with `auth.session` before entering authenticated routes.
- Sign-out clears auth credentials and ephemeral React state only; there is no application database to destroy.
- Do not expose signup, OAuth, magic links, recovery, or confirmation flows.

### Deck workflow

- List decks by ID and name.
- Create and rename decks with optional default speech locale.
- Remove a deck only after deliberate confirmation.
- Navigate using deck IDs, not names.
- Present loading, empty, conflict, and error states.
- Do not synthesize due/new counts with N queue requests.

### Study workflow

- Fetch one `deck.queue` snapshot using the fixed 12-hour horizon and an explicit or default 50-card working-set limit.
- Render each queue item directly; studying performs no per-card `card.get` request.
- Preserve front, reveal, and back interaction.
- Label new and future cards; future treatment must be visually unambiguous.
- Offer exactly four ratings after reveal, without client-calculated interval previews.
- Generate and retain a request ID for each pending logical rating.
- On rate, undo, suspend, restore, or remove success, replace the complete queue from the response.
- Reset reveal/pending state when the active card changes.
- Prevent duplicate submissions.
- Refetch on screen focus, application foreground, reconnect, and return from card management.
- Show session-empty state without implying a daily limit.

### Card management and histories

- Search cards through `card.search`; do not filter a downloaded database.
- Create one independent card at a time.
- Edit name, front/back Markdown, tags, and speech metadata.
- Suspend, restore, and permanently remove with appropriate confirmation.
- Carry server-issued versions through optimistic mutations.
- Display review history newest first with rating, timestamp, interval change, resulting due date, and undone status.
- Display revision history newest first and permit rollback with confirmation.
- After create/update/rollback, refetch affected management data and invalidate the study queue for its next focus.

### Safe Markdown, ruby, and speech

- Use one Markdown parsing path for web and native.
- Sanitize rendered output with an explicit allowlist.
- Permit the Markdown output needed by the product and raw `ruby`, `rt`, and optional `rp` tags only.
- Remove scripts, iframes, event handlers, arbitrary styles, unsafe URL schemes, and unapproved raw HTML.
- Render semantic `<ruby>/<rt>` on web.
- Render Pinyin above Hanzi on native.
- Speak `speechText` when present; otherwise speak sanitized visible text.
- Select locale from card metadata, then deck default, then an optional device-local user choice.
- Device-local presentation/TTS preferences are allowed; card, queue, cadence, and study-session data are not.

Choose the smallest renderer/sanitizer stack that passes an Expo web and native spike. Do not maintain separate Markdown semantics per platform.

### Frontend verification

Use the actual app against local Supabase and the served Edge Function. Verify:

- login, restored session, refresh, and sign-out;
- deck create/rename/remove;
- card search/create/edit/suspend/restore/remove;
- queue loading with no N+1 card fetch;
- reveal and all four ratings;
- exact replacement-snapshot behavior;
- future-card styling;
- undo and visibly undone review history;
- revision display and rollback;
- web ruby rendering and the native ruby layout;
- hostile HTML does not execute or render;
- reload reconstructs application state from Postgres.

## Phase 3 — Agent-facing CLI

Implement a TypeScript `flashcard` executable using the shared tRPC transport.

### Authentication and credentials

- `flashcard auth login` accepts email plus a protected prompt, stdin, or a dedicated password environment variable.
- Passwords are never accepted in command arguments and never enter logs or output.
- Persist Supabase access/refresh credentials in the operating-system credential store when available.
- If a credential store is unavailable, use an explicitly selected user-only fallback with restrictive permissions; never silently write plaintext credentials to a project file.
- Refresh sessions through Supabase Auth and update stored credentials atomically.
- `flashcard auth logout` removes stored credentials.

### Commands

Provide JSON-first commands for:

- auth session/login/logout;
- deck list/create/rename/remove;
- queue fetch;
- card get/search/create/update/suspend/restore/remove;
- revision list/rollback;
- review rate/history/undo.

Destructive commands require an explicit confirmation flag suitable for non-interactive agents. Review rating generates a request ID unless the caller provides one for deliberate replay.

### Output contract

- Successful stdout is one stable JSON document.
- Diagnostics and machine-readable error details go to stderr.
- Failures return nonzero status.
- Output never contains passwords, refresh tokens, access tokens, service keys, or database URLs.
- Preserve server application codes and enough field context for an agent to recover from validation or version conflicts.
- The CLI prints server results; it does not calculate cadence, reorder queues, infer reciprocal cards, or authorize resources.

### CLI verification

Against the real local Edge Function:

- log in without exposing the password;
- restore and refresh a stored session;
- create independent reciprocal cards;
- search for duplicates;
- list decks and fetch a queue;
- rate, inspect history, and undo;
- edit, suspend, restore, revise, rollback, and remove a card;
- validate stdout as JSON and failures as stderr plus nonzero status;
- log out and prove the credential is removed.

## Phase 4 — Browser journeys and repository verification

Reintroduce Playwright for assembled-product journeys, not backend duplication. Cover:

1. email/password login and restored session;
2. deck and card management;
3. studied-first 12-hour queue and Markdown reveal;
4. all four ratings and replacement snapshots;
5. future-card styling;
6. undo and review history;
7. suspension and queue removal;
8. revision history and rollback;
9. ruby/Pinyin rendering and hostile HTML rejection;
10. sign-out and protected-route redirect.

Retain the closed backend unit, schema-integration, and acceptance suites. Add focused frontend unit tests only for behavior not adequately proven through the actual surface, especially sanitization/ruby rendering and small state transitions. Do not recreate shallow client tests that restate tRPC types.

The final local verification sequence must cover:

- domain unit tests;
- schema/integration tests;
- backend HTTP acceptance tests;
- type checking and dead-code checking;
- Expo web export;
- CLI smoke scenario;
- Playwright browser journeys.

## Phase 5 — Production readiness and rollout

### Deployment configuration

- Split validation from deployment. No production migration or deployment runs before required checks pass.
- Add Edge Function deployment for `api`; the current workflow deploys only migrations and Pages.
- Build Expo with only public Supabase/API values.
- Set `API_ALLOWED_ORIGINS` to the exact GitHub Pages origin rather than `*`.
- Keep `DATABASE_URL` available only to migration jobs and the Edge Function.
- Keep the acceptance test-clock secret absent from production.
- Configure GitHub environments/approval so the initial destructive cutover remains operator-gated.
- Publish or package the CLI from the same reviewed revision as the frontend and API.

### Authentication configuration

Before production use:

- disable public signup;
- disable GitHub and other OAuth providers;
- provision and confirm the two initial email/password users administratively;
- verify the production site URL and allowed redirects;
- accept that password recovery remains an administrator operation until SMTP is configured.

The current local Supabase configuration still permits signup and enables GitHub OAuth; production readiness must explicitly remove that mismatch.

### Operator-gated cutover

Do not perform these actions without explicit operator authorization:

1. Accept Supabase Free inactivity-pause and backup limitations.
2. Take and verify a production database export.
3. Start a short maintenance window and prevent old-client writes.
4. Apply the already-tested production migrations.
5. Validate migrated deck, card, cadence, review, and revision counts.
6. Deploy the `api` Edge Function and its server-only secrets.
7. Deploy the matching static frontend and CLI release.
8. Smoke test both provisioned accounts and representative decks.
9. End maintenance only after proving no old write path remains.

## Definition of done

The rewrite is complete when:

- the frontend and CLI authenticate through Supabase and use the same typed tRPC API;
- Postgres remains the only durable application-data source;
- no client contains cadence, queue ordering, ownership, or undo business rules;
- the frontend supports the complete deck, study, card, history, revision, TTS, and safe Markdown surface;
- the CLI exposes the same product capabilities with stable secure JSON behavior;
- local unit, integration, acceptance, build, CLI, and browser verification pass;
- production configuration exposes no server secret to either client;
- the production migration/deployment runbook is ready, with unexecuted operator-gated actions clearly marked;
- no RxDB, replication, FSRS, reverse-card, daily-limit, persistent-study-session, compatibility, or dual-write path is restored.
