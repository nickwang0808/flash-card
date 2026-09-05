# Backend Acceptance Test Plan

## Purpose

Build an aggressive backend acceptance suite before resuming the frontend or CLI work. The suite treats the authenticated HTTP API as the product boundary and exercises the real local stack end to end:

```text
Vitest test
  -> real Supabase email/password sign-in
  -> real bearer JWT
  -> local Supabase Edge Function
  -> tRPC router
  -> Drizzle/Postgres.js
  -> local Supabase Postgres
```

The suite must simulate complete user study behavior, not retest router implementation details. It must use dynamically created, test-owned data rather than a shared master seed.

This is a separate detour from `plan.md` and `task.md`. Do not start the frontend cutover or CLI while executing this plan. Work phase by phase and stop for review at every phase gate.

## Current repository baseline

The server collapse is complete:

- `supabase/functions/api/router.ts` merges the `auth`, `deck`, `card`, and `review` vertical slices.
- `supabase/functions/api/index.ts` authenticates a real bearer token and builds `ApiContext` for the Edge Function request.
- `ApiContext` currently contains only `identity` and `db`.
- Server procedures currently call `new Date()` directly in `routers/deck.ts`, `routers/card.ts`, and `routers/review.ts`.
- `Cadence` and `StudyQueue` already accept an explicit `Date`, so the pure policies need no clock redesign.
- Existing router integration tests use `appRouter.createCaller()` and share one user and mutable state per file.
- `http-smoke.integration.test.ts` is the only current real-HTTP test and requires a separately served function.
- Vitest already runs test files in parallel, but tests inside a file are sequential unless marked concurrent.
- `getDb()` currently creates a Postgres.js pool with `max: 5` on every call; it must not be called once per test in a highly parallel suite.

### Ownership checkpoint

The current schema stores `user_id` directly on `decks`; cards, review events, and revisions derive ownership through required foreign-key chains. The application queries are explicitly tenant-scoped through those chains.

A prior product requirement stated that every database concern is user-scoped, and discussion also considered a literal `user_id` column on every tenant-owned table. Before changing fixture contracts, inspect the latest accepted schema decision:

- If derived ownership through `card -> deck -> user` is accepted, document that and test the complete chain behaviorally.
- If every tenant table must literally carry `user_id`, stop and make that a reviewed schema/migration phase before building factories. Do not silently encode either interpretation only in test utilities.

This checkpoint does not block the clock spike or HTTP harness work.

## Locked testing decisions

1. The primary suite calls the actual local Edge Function over HTTP. `createCaller()` is not the primary acceptance boundary.
2. Authentication uses real local Supabase users and real signed JWTs.
3. Every test owns a unique user. Every row created for that story belongs to that user.
4. All acceptance tests share one local Supabase stack, one Edge Function service, and one Postgres database.
5. Tests run concurrently across different users. They do not intentionally race mutations against the same user's rows.
6. There is no shared master dataset and no suite-wide mutable deck or card.
7. Behavior-defining state is explicit and deterministic. Randomness may generate unique identities and irrelevant display data, never expected cadence or queue state.
8. User actions use HTTP. Direct Drizzle access is permitted only to arrange otherwise expensive historical preconditions and inspect hidden transactional postconditions.
9. Production tRPC inputs never accept `userId` or `now`.
10. Keep sequential request replay coverage for idempotency, but do not build broad multi-client race testing.
11. Migrations, stale-test cleanup, and Edge Function startup happen once before parallel tests. Test stories do not truncate tables or reset the database.
12. Pure `Cadence` and `StudyQueue` unit tests remain. Schema constraint/RLS integration tests remain separate from user journey tests.

## Clock investigation and target contract

### Why Vitest fake timers alone are insufficient

`vi.useFakeTimers()` and `vi.setSystemTime()` affect the JavaScript environment running the Vitest test. The local Supabase Edge Function runs in a separate Edge Runtime process, so a Vitest worker's fake clock does not automatically change `new Date()` inside the function.

Do not change the laptop clock. Do not use one mutable process-global test clock: parallel tests would interfere with each other.

### Required spike

Before broad test implementation, investigate and prove the smallest approach that satisfies all of these conditions:

- The request still traverses real HTTP, JWT verification, the Edge Function, tRPC, Drizzle, and Postgres.
- Each concurrent test chooses its own time independently.
- One test can advance its own time without changing another test.
- Production clients cannot control server time.
- Time is absent from public tRPC inputs.
- Rating, undo, queue `asOf`, queue horizon, and persisted mutation timestamps use one request-consistent instant.
- The mechanism works under the actual local `supabase functions serve api` runtime, not only under `createCaller()`.

Investigate these options in order:

1. **Request-scoped clock in `ApiContext` guarded by a test-only Edge environment secret** — recommended candidate.
2. Importing and running the fetch handler in-process under Vitest fake timers, only if it still proves the real Edge/JWT/runtime boundary.
3. One independently served Edge Function per worker with a worker-specific fixed clock, only if request-scoped context cannot work.

Reject a global mutable clock shared by the served function. Reject a public `now` procedure input.

### Recommended candidate design

Prefer one immutable effective time per HTTP request:

```ts
export interface ApiContext {
  identity: VerifiedIdentity;
  db: AppDb;
  now: Date;
}
```

Production context:

```ts
now: new Date()
```

Local acceptance context, only when a dedicated test secret exists in the Edge Function environment:

```text
X-Flashcard-Test-Clock: 2026-01-01T12:00:00.000Z
X-Flashcard-Test-Secret: <local ephemeral secret>
```

The test client owns a small logical clock:

```ts
actor.clock.set('2026-01-01T12:00:00.000Z');
actor.clock.advance({ minutes: 1 });
```

Its HTTP header callback sends the current actor time on each request. Other actors have independent clock instances, so tests remain parallel.

Security requirements:

- The override is disabled when the test-secret environment variable is absent.
- Production deployment must never set that variable.
- A clock header with a missing or incorrect secret must not affect `ctx.now`.
- The header is test transport infrastructure, not part of any tRPC input schema or application client contract.
- Add focused tests proving unauthorized clock headers cannot override time.
- JWT issuance/expiry verification continues using the runtime's real security clock. The request clock controls application scheduling only.

Implementation requirements if this design wins the spike:

- Resolve and validate the test timestamp while building request context.
- Read the effective clock once per request; procedures use `ctx.now` instead of calling `new Date()`.
- Use `ctx.now` for queue construction, cadence rating, review timestamps, undo timestamps, and `updated_at`.
- Explicitly write `created_at`/`updated_at` from `ctx.now` for HTTP-created decks, cards, review events, and card revisions where deterministic consistency matters. Database defaults remain defensive defaults for non-application inserts.
- Pass the same `Date` through a mutation transaction and its post-commit replacement queue.
- Do not introduce a service layer or global clock singleton.

### Clock spike acceptance

A real HTTP test must prove concurrently:

- Actor A asks at `2026-01-01T12:00:00Z` and receives exactly that queue `asOf`.
- Actor B asks at `2030-06-15T08:30:00Z` and receives exactly that queue `asOf`.
- Actor A advances one minute without changing Actor B.
- A rating's `reviewedAt`, cadence `nextReviewAt`, persisted event, updated card, and replacement queue all derive from Actor A's request time.
- The same header without the local test secret cannot override application time.

Stop for review after this spike. Do not build the full suite on an unproven clock mechanism.

## Target test layout

```text
vitest.acceptance.config.ts
supabase/functions/api/acceptance/
  auth.acceptance.test.ts
  one-new-card-session.acceptance.test.ts
  mixed-study-session.acceptance.test.ts
  rating-transitions.acceptance.test.ts
  undo-history.acceptance.test.ts
  queue-boundaries.acceptance.test.ts
  cards-and-revisions.acceptance.test.ts
  search-pagination.acceptance.test.ts
  tenancy.acceptance.test.ts
  validation-errors.acceptance.test.ts
  test-support/
    actor.ts
    api-client.ts
    clock.ts
    database.ts
    environment.ts
    scenarios.ts
    assertions.ts
```

Keep cross-router user journeys together under `acceptance/`; do not scatter a single study story across router files. Keep test support small and behavior-free.

## Test runner and local service lifecycle

`npm run test:acceptance` must be a complete repeatable command for a running local Supabase stack. It must not require the developer to manually start the Edge Function in a second terminal.

The acceptance runner must:

1. Refuse destructive setup unless Supabase and database URLs are verified local addresses.
2. Apply current Drizzle migrations once before Vitest workers start; Supabase CLI must not own schema migration state.
3. Remove stale users matching the dedicated acceptance-test email prefix.
4. Generate one ephemeral test-clock secret for this run.
5. Start `supabase functions serve api` with the existing function env plus the ephemeral clock secret.
6. Wait until the function endpoint is demonstrably ready.
7. Start Vitest only after readiness.
8. Stop only the function process owned by the runner during teardown.
9. Close fixture pools and remove remaining run-owned users after success or failure.

Use `/home/nick/.nvm/versions/node/v24.18.0/bin/npx` when invoking the Supabase CLI on this workstation. Do not use the `~/bin/docker` shim.

If the function is already being served, the runner must not silently use an instance with unknown environment. Either prove it has the current run's test-clock secret or fail with a clear instruction.

## Per-test actor isolation

Create a fresh actor fixture for every acceptance story:

```ts
type TestActor = {
  userId: string;
  email: string;
  accessToken: string;
  api: AcceptanceApiClient;
  clock: TestClock;
  scenarios: ScenarioFactory;
};
```

Lifecycle:

```text
create confirmed local Auth user
  -> sign in with password
  -> capture real JWT
  -> create actor-specific API client and logical clock
  -> run the story
  -> delete auth user in fixture teardown
  -> rely on ownership cascades for all tenant data
```

Requirements:

- Email format includes a run ID and UUID, for example `acceptance-<run>-<uuid>@example.com`.
- Never search for or reuse a fixed email inside ordinary tests.
- Cleanup runs in `finally`/fixture teardown even when assertions fail.
- Startup stale cleanup matches only the dedicated prefix and only on verified local infrastructure.
- A test never asserts that global tables are empty.
- A test queries only its own API-visible records or directly inspects rows reachable from its own user ID.

## HTTP client

Prefer the official tRPC client with `httpLink` if a short spike confirms it works cleanly with the Edge Function path and current transformer-free JSON contract. Import `AppRouter` only for types; requests must still go over HTTP.

The client must supply dynamically:

- `Authorization: Bearer <real access token>`
- Test-clock timestamp and secret headers in the acceptance environment
- A unique request ID for each logical rating, except deliberate replay stories

Keep a small raw `fetch` helper for malformed authorization, malformed JSON, CORS, and serialized error-envelope assertions.

Do not duplicate handwritten request/response interfaces already inferable from `AppRouter` or Zod output schemas.

## Fixture database access and connection budget

Do not call the production `getDb()` once per test. Its current pool size is five, which would multiply connections across concurrent tests.

Create one small fixture pool per Vitest worker or active test file, with a maximum of one or two connections, and reuse it for scenario arrangement and hidden-state assertions. Close it once when its worker/file finishes.

The Edge Function keeps its existing production-style pool. Set bounded initial concurrency and tune from measurements rather than maximizing workers blindly.

Initial safe target:

```text
maxWorkers: 4
maxConcurrency: 8
fixture pool: at most 2 connections per active worker/file
```

Measure 4, 8, and 16 concurrent stories. Select the fastest stable setting that stays below Postgres connection limits and does not overload local Auth or the Edge Runtime.

## Dynamic scenario factories

Do not add a master seed or make tests depend on a persistent dataset. Build explicit, composable factories:

```ts
createDeck(actor, overrides?)
createNewCard(actor, deck, overrides?)
createStudiedCard(actor, deck, {
  cadencePhase,
  nextReviewAt,
  intervalDays,
  reviewCount,
  lapseCount,
  schedulerVersion,
  suspended,
  history,
})
createMixedStudyScenario(actor, overrides?)
```

Rules:

- Ordinary deck/card creation goes through HTTP when setup itself is part of the journey.
- Direct Drizzle inserts may arrange mature cadence, old histories, identical sort timestamps, or outside-horizon states that would otherwise require many preliminary requests.
- Factories validate their produced records with existing domain schemas before returning.
- Ownership fields and parent-child relationships are always derived from the actor, never accepted as arbitrary factory input.
- Every behavior-defining timestamp and cadence field is explicit relative to `actor.clock.now()`.
- Defaults are small and readable; an individual story overrides only what it cares about.
- Use `crypto.randomUUID()` for unique email/name suffixes and request IDs.

Do not add Faker initially. If a later measured bulk/search story benefits from realistic content, Faker may generate presentation-only fields under a recorded deterministic seed. It must never choose cadence phase, due time, version, suspension, ownership, or expected outcomes.

## Core study-session stories

### Story A — one new card

Arrange through HTTP:

```text
one actor
  -> one deck
  -> one new card
```

Exercise through HTTP:

1. Sign in with the actor's real JWT.
2. Load the deck queue at fixed time T.
3. Assert exactly one card, with `status: new`, complete canonical card content, and `asOf: T`.
4. Rate the card `good` with expected version zero.
5. Assert one review event, version one, exact Cadence v1 state, and a replacement queue built at T.
6. Because reviewed cards inside the 48-hour horizon are intentionally included for study-ahead, do not assume the queue becomes empty; assert the card's correct `future`/`due` status according to its exact next-review time.
7. Advance only this actor's clock to the exact due boundary.
8. Reload and assert the card changes from `future` to `due` at the documented inclusive boundary.
9. Read history and assert the exact before/after state and timestamps.
10. Undo and assert exact restoration to a new card plus a replacement queue built at the advanced request time.
11. Inspect Postgres to prove exactly one active/undone event as expected and no partial rows.

### Story B — mixed study state

Arrange one actor and one deck containing explicit states:

- Two untouched new cards with deterministic creation ordering.
- One due learning card.
- One due review card.
- One future review card inside the 48-hour horizon.
- One review card just outside the horizon.
- One suspended card that would otherwise be due.

Exercise:

1. Load the queue at T.
2. Assert new cards come first by `created_at, id`.
3. Assert eligible studied cards follow by `next_review_at, id`.
4. Assert inside-horizon future cards are included and labeled `future`.
5. Assert outside-horizon and suspended cards are absent.
6. Rate the first new card `again`.
7. Assert the untouched new card remains ahead of the newly reviewed/retry card, preserving the accepted strict new-first behavior.
8. Continue a bounded sequence using `again`, `hard`, `good`, and `easy`; after each mutation assert the complete replacement queue rather than locally patching expectations.
9. Reload mid-session and prove the queue reconstructs from Postgres.
10. Inspect review history newest-first.
11. Undo the latest active review and prove exact state and queue restoration.
12. Advance only this actor beyond selected due/horizon boundaries and verify eligibility changes without affecting another actor.

A “complete session” here means the complete user workflow and persistence cycle, not necessarily an empty queue. The product intentionally exposes future reviewed cards inside the rolling horizon and has no persistent daily-session state.

## Extended acceptance story matrix

Implement separate, focused stories after the two core sessions pass.

### Ratings and cadence

- Each rating from a new card produces the exact Cadence v1 state at an exact actor-controlled time.
- Each rating from learning and review states produces exact interval, due time, counters, scheduler version, and card version.
- Interval minimum and maximum behavior survives the full HTTP/database round trip.
- A sequential replay of the same request ID returns the original review ID and changes cadence once.
- Reusing a request ID with a different rating preserves the already-committed result according to the current contract.
- A stale expected version fails without creating a review event or changing card state.

Do not add simultaneous same-card race stress unless the product's one-client assumption changes.

### Undo and history

- Undo restores the exact recorded `before_state`.
- Only the latest active review can be undone.
- Repeating an undo is rejected without further mutation.
- Undone reviews remain in newest-first history with `undoneAt`.
- Pagination returns every event exactly once across pages, including equal timestamps resolved by ID.
- Undo response contains the post-commit replacement queue at the actor's request time.

### Queue boundaries

- Exact due instant is `due`; one millisecond later remains due.
- Exact horizon boundary is included; one millisecond outside is excluded.
- New-first ordering is stable across reloads.
- Reviewed tie-breaking is deterministic by card ID.
- Suspension and restoration immediately replace the queue.
- Limits apply after new/review ordering according to the locked queue contract.
- Empty eligible working sets return a valid empty snapshot.

### Card and deck lifecycle

- Create, list, rename, and remove a deck through HTTP.
- Create, get, update, suspend, restore, remove, and search cards through HTTP.
- Card creation and its initial revision commit together.
- Card update and revision commit together; stale update creates no revision.
- Rollback restores content, creates a new revision, and does not alter cadence.
- Search covers name, front Markdown, back Markdown, and tags.
- Search and revision cursors have no gaps or duplicates at tied timestamps.
- Removing a deck removes all owned child data through the accepted database cascades.

### Authentication and tenant isolation

- Missing, malformed, and expired tokens fail before procedure execution.
- `auth.session` returns the identity verified from the JWT.
- A caller-supplied extra `userId` field cannot influence ownership.
- Actor B cannot get, search, mutate, queue, rate, inspect history, undo, or remove Actor A's records.
- Cross-tenant guessed IDs fail closed without disclosing whether the row exists.
- Running Actor A and Actor B at different logical times does not cross-contaminate data or queue time.

### Validation and error transport

- Invalid UUIDs, Markdown, names, ratings, pagination, queue limits, and confirmations return stable tRPC errors.
- Expected application errors preserve the agreed tRPC code and `applicationCode` over HTTP.
- SQL details, connection strings, and stack traces never enter client responses.
- A rejected mutation leaves no partial card, revision, review, or queue-affecting state.

## Concurrency model

Yes: once request-scoped time is proven, user journey tests can run concurrently because every test owns a unique user and rows.

Parallelize:

- Acceptance test files across Vitest workers.
- Independent tests within a file using `test.concurrent` or `describe.concurrent`.
- User creation, sign-in, scenario setup, HTTP behavior, and cleanup, bounded by `maxConcurrency`.

Keep serial or one-time:

- Drizzle migration application.
- Local-only stale-user cleanup.
- Edge Function process startup/readiness and teardown.
- Any schema test that intentionally changes global schema state.
- Performance-tuning measurements themselves.

Do not use top-level mutable fixtures, shared `beforeAll` users, fixed emails, global deck IDs, sequence-dependent test ordering, or database truncation.

Parallel tests must not rely on Vitest's global `vi.setSystemTime()`. The actor's request-scoped logical clock is the isolation boundary.

## Implementation phases

### Phase 0 — Baseline and ownership checkpoint

- Read `plan.md`, `task.md`, `agent.md`, current routers, current tests, schema, migrations, and local-stack helpers.
- Record current unit, caller-integration, schema-integration, and HTTP-smoke results without changing expectations.
- Resolve the direct-versus-derived child `user_id` checkpoint with the latest accepted project decision.
- Inventory every direct `new Date()`/`Date.now()` that affects application behavior or persisted timestamps.

Acceptance:

- Current behavior and clock callsites are documented.
- Fixture ownership requirements are unambiguous.

Stop for review.

### Phase 1 — Per-request clock spike

- Evaluate the three clock approaches against the required real-HTTP and parallel-isolation contract.
- Implement only the minimum spike needed to exercise two concurrent users at different times.
- Prefer immutable `ctx.now` and secret-guarded local test headers if the runtime carries them correctly.
- Prove unauthorized headers cannot alter production/default time behavior.
- Prove exact rating and queue timestamps over real HTTP.
- Record the chosen design and rejected alternatives in the implementation report; do not add a second clock path.

Acceptance:

- Two concurrent HTTP tests independently control time through one served Edge Function.
- No laptop/system clock changes.
- No public tRPC `now` input.
- Exact persisted and returned timestamps agree.

Stop for review.

### Phase 2 — Self-contained acceptance runner

- Add a dedicated acceptance Vitest config and package command.
- Add local-environment destructive-operation guards.
- Make the command apply Drizzle migrations once, own Edge Function startup/readiness, and tear it down.
- Generate and inject the ephemeral test-clock secret.
- Add bounded parallel worker/concurrency settings.
- Add one small fixture database pool per worker/file, not per test.

Acceptance:

- One command runs a trivial real-JWT HTTP test from a clean local stack.
- Failure still tears down owned processes, users, and pools.
- The command refuses non-local destructive setup.

Stop for review.

### Phase 3 — Actor and scenario factories

- Add per-test actor fixtures with unique users, real sign-in, JWTs, independent clocks, and teardown.
- Add explicit new-card and studied-card scenario factories.
- Add stale-test-user cleanup limited to the dedicated prefix.
- Validate produced records and ownership relationships.
- Keep all behavior-defining state explicit; do not add a master seed.

Acceptance:

- At least eight concurrent fixture lifecycle tests create, use, and remove isolated actors without leaked or crossed data.
- Post-run checks find no run-owned users or tenant rows.

Stop for review.

### Phase 4 — Core study sessions

- Implement Story A: one new card.
- Implement Story B: mixed new/studied/suspended/horizon state.
- Assert every HTTP response, exact clock-derived cadence transition, replacement queue, history record, version, and selected database postcondition.
- Include mid-session reload and exact undo restoration.

Acceptance:

- Both stories pass concurrently at distinct logical times.
- They fail if queue order, cadence, persistence, replacement snapshots, or tenant scoping regresses.

Stop for review.

### Phase 5 — Aggressive backend coverage

- Implement the extended rating, undo/history, queue, lifecycle, tenancy, and validation stories.
- Prefer one cohesive user story with several meaningful assertions over many microscopic tests that repeat authentication setup.
- Keep sequential idempotency replay; omit broad same-user race stress.
- Use direct DB assertions only for hidden atomicity and ownership postconditions.

Acceptance:

- Every public procedure appears in at least one real-HTTP success journey and its important failure/tenant boundary.
- Every queue-affecting mutation proves the returned replacement snapshot.
- Every transaction has a failure story proving no partial write.

Stop for review.

### Phase 6 — Parallel performance tuning

- Run the acceptance suite with measured worker/concurrency settings.
- Compare stable wall-clock time and failure rate at 4, 8, and 16 concurrent stories.
- Inspect local Postgres connection counts and Edge/Auth saturation.
- Choose a bounded default; do not optimize only for this workstation if it destabilizes CI.
- Run the chosen configuration repeatedly to detect order dependence and leaked state.

Acceptance:

- Three consecutive runs pass with the chosen concurrency.
- Parallel execution is materially faster than serial execution.
- No connection exhaustion, auth throttling, clock contamination, or orphaned actors occurs.

Stop for review.

### Phase 7 — Test cleanup and final verification

- Retain pure domain unit tests and schema/RLS integration tests.
- Delete shallow caller tests and the old HTTP smoke only after the new HTTP acceptance stories cover their observable contracts.
- Remove superseded fixed-email/shared-fixture helpers and unused config.
- Keep one test implementation for each contract; do not retain caller and HTTP duplicates for comfort.
- Update Knip inputs and package scripts.

Final verification:

```text
npm run test:unit
npm run test:integration
npm run test:acceptance
npm run check
npm run build
```

Also prove:

- Acceptance tests pass from a clean local database after Drizzle migration.
- Acceptance tests pass with unrelated local users/data already present.
- No acceptance test uses a master seed or requires global emptiness.
- No acceptance test changes the laptop clock.
- Production startup without the test-clock secret uses real request time.
- The production API cannot accept caller-controlled time.
- All significant acceptance stories run concurrently except explicitly documented global setup/schema work.

## Non-goals

- Frontend implementation or browser rendering tests.
- CLI implementation.
- Production migration or deployment.
- Load testing, soak testing, or same-user mutation race campaigns.
- A permanent development seed consumed by tests.
- Random/property-based cadence expectations.
- A new repository/service layer for testability.
- Changing JWT validation time to the actor's application clock.

## Completion definition

This detour is complete when a single command can launch the real local API boundary and aggressively simulate isolated users studying in parallel; each test controls its own application time, creates only its own dynamic data, and proves the resulting queue, cadence, history, undo, validation, transaction, and tenant behavior through HTTP and Postgres without shared seed state or global clock mutation.
