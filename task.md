# Server-Authoritative Rewrite Implementation Task

## Objective

Implement the rewrite specified in [`plan.md`](./plan.md) end to end. `plan.md` is the authoritative product and architecture specification; this file is the execution checklist. Do not replace its decisions with a different architecture or preserve legacy paths for convenience.

The finished application must use the existing Expo Router/React Native Web frontend and GitHub Pages deployment while moving authentication, queue construction, cadence, mutations, undo, histories, and tenant authorization behind one authenticated tRPC Supabase Edge Function. Postgres is authoritative. The frontend retains only a disposable in-memory queue snapshot.

## Current milestone

The server-collapse milestone is complete and committed alongside this
checklist's follow-up documentation:

- Tenant-scoped Drizzle query bases live in `src/db/tenant.ts`.
- `auth`, `deck`, `card`, and `review` are vertical tRPC router slices.
- Shared domain schemas and pure cadence/queue policies remain in `src/domain/`.
- The old repository/service/API-contract/RxDB client stack is deleted.
- The Expo app is currently a minimal static-export stub.
- Caller integration suites and live HTTP smoke coverage pass.

The frontend rebuild, CLI, Playwright journeys, and production cutover remain
unchecked future work. Local `drizzle-kit migrate` still requires migration
state compatible with the Supabase-managed local database.


- Read all of `plan.md` before editing.
- Follow `CLAUDE.md`, especially the required Supabase migration workflow.
- Work phase by phase. Check an item only after its behavior is implemented and verified.
- Prefer a clean cutover. Do not introduce compatibility wrappers, dual writes, deprecated aliases, or a second business-logic path.
- Keep business rules in server-side TypeScript. Pure policies stay in `src/domain/`; procedure-specific orchestration, authorization, queries, and transactions stay in the owning vertical tRPC router.
- Use cohesive domain policy objects (`Cadence`, `StudyQueue`), not one class per database entity, static utility classes, service singletons, inheritance hierarchies, or entities that hide database I/O.
- Keep `Card`, `Deck`, `ReviewEvent`, API payloads, and database row mappings as plain immutable records.
- Scope every server operation with the user ID derived from the verified Supabase JWT. Never accept a caller-supplied user ID.
- Treat mutation idempotency, optimistic concurrency, atomic rating/undo, and replacement queue snapshots as required contracts rather than follow-up hardening.
- Colocate file-focused tests with their source. Use `Name.test.ts[x]` for unit/API tests and `Name.integration.test.ts` for real infrastructure. Keep only assembled-product Playwright journeys under `tests/e2e`.
- Do not deploy to production or run a destructive production migration without explicit operator authorization. Implement and prove the complete migration locally, then leave the production cutover ready to execute.

## Locked behavior

- Cards are independent records with Markdown front and back. There is no direction, reversible flag, reverse state, or reciprocal linkage.
- New cards always precede reviewed cards.
- New cards use `created_at, id` ordering. Reviewed cards use `next_review_at, id` ordering.
- Reviewed cards are fetched through a rolling 48-hour horizon. This is a working set, not a daily limit.
- Queue responses contain the complete canonical `Card` DTO returned by `card.get`, plus derived `new`, `due`, or `future` status.
- Queue-affecting mutations return a complete replacement `QueueSnapshot`; clients replace local state rather than reconciling it.
- Cadence v1 and all rating outcomes must match `plan.md` exactly.
- Undo restores the exact recorded `before_state`. It applies only to the latest active review for a card. Redo is not supported.
- Review history includes undone events. Content revisions remain append-only, including rollbacks.
- Authentication uses Supabase email/password. Passwords never pass through tRPC.
- Markdown permits only the narrowly sanitized raw HTML subset required for semantic `<ruby>`, `<rt>`, and optional `<rp>` annotations.
- No RxDB, replication, client scheduling, daily limits, persistent sessions, or FSRS code remains after cutover.

## Cleanup strategy

Cleanup is incremental and replacement-gated, not a destructive first pass. The current RxDB, FSRS, replication, hooks, scripts, and tests are evidence for migration behavior until their replacements have been proven. Remove each legacy slice immediately after its replacement passes the relevant smoke test; do not retain all deletion work for the end, and do not delete working reference code before extracting its required behavior.

For every cleanup:

1. Identify the callers with language-server references and dependency/dead-code tooling.
2. Name the replacement or prove the artifact is already unreachable.
3. Move or replace its behavioral coverage.
4. Delete source, tests, exports, scripts, configuration, and dependencies for that slice together.
5. Run the narrow verification for the affected surface.

Do not delete historical Supabase migration files. They are required to reconstruct the database. Remove legacy tables, columns, triggers, and policies through a new forward migration only.

### Deletion gates

| Legacy slice | Earliest safe deletion |
|---|---|
| Centralized `tests/unit` and empty `tests/integration` layout | Phase 0, after moving surviving tests and updating Vitest/Knip scripts |
| Old migration/repair/import scripts and their documentation | Phase 2, after required mapping behavior is captured by the new migration fixtures |
| Old tRPC/schema experiments or temporary contract duplicates | Phase 1 or 3, as soon as the canonical contract/server equivalent passes focused tests |
| `useDeck`, `useRxQuery`, and their tests | Phase 4, after the corresponding screen works through `useStudyQueue` against the real local API |
| `rxdb.ts`, generated RxDB schemas, `schema/cards.schema.json`, and RxDB generation scripts | Phase 4, after no frontend route imports or initializes RxDB |
| `supabase-replication.ts`, sync lifecycle, and sync screens/tests | Phase 4, after reload reconstructs authoritative state through tRPC |
| `ts-fsrs`, FSRS adapters/state, and FSRS-specific tests | Phase 4, after rating and undo work through Cadence v1 end to end |
| Direction/reversible/daily-limit/persistent-session code | Phase 4, after every affected frontend workflow uses the new independent-card contract |
| Old E2E helpers, seed paths, and obsolete journeys | Phase 6, after replacement Playwright journeys pass |
| Legacy database objects | New forward migration in Phase 2; production removal occurs only during the operator-gated cutover |

## Phase 0 — Baseline and low-risk repository cleanup

- [ ] Inventory source files, routes, scripts, tests, generated artifacts, dependencies, and package scripts; classify each as retained, replacement-gated, or already unreachable.
- [ ] Record which current tests protect migration-critical behavior: forward/reverse schedules, review logs, ruby rendering, authentication, synchronization, and card management.
- [ ] Run the current type/dead-code check and focused tests to establish a behavioral baseline. Record genuine pre-existing failures rather than weakening tests to obtain green output.
- [ ] Move every currently retained file-focused unit test from `tests/unit` beside the source file it primarily exercises, preserving test behavior during the move.
- [ ] Replace the separate centralized integration-test config with root Vitest project/glob configuration that discovers colocated `*.integration.test.*` files.
- [ ] Update `package.json`, `vitest.config.ts`, `knip.json`, and test setup paths for colocated tests.
- [ ] Remove the empty centralized unit/integration directories once no test or configuration references them.
- [ ] Remove only artifacts proven already unreachable and not needed as migration reference; delete their tests, exports, scripts, and direct dependencies in the same change.
- [ ] Do not remove RxDB, replication, FSRS, old data scripts, old E2E journeys, or active routes during Phase 0 merely because the target architecture will later replace them.

### Phase 0 verification

- [ ] Run every moved test from its new neighboring path.
- [ ] Run the updated unit command and prove it excludes integration tests.
- [ ] Run the integration command and prove it discovers neighboring `*.integration.test.*` files.
- [ ] Run type checking and Knip after the low-risk deletions/configuration changes.

## Phase 1 — Contracts and pure domain

- [ ] Define canonical immutable domain/API records and Zod schemas for decks, cards, cadence state, queue snapshots, reviews, revisions, pagination, procedure inputs, and procedure outputs.
- [ ] Make the canonical `Card` DTO include Markdown, tags, speech metadata, suspension state, cadence fields, optimistic version, and timestamps.
- [ ] Define stable application errors and their tRPC code mapping without exposing SQL details.
- [ ] Define `requestId`, `expectedVersion`, pagination, server-time, horizon, and replacement-snapshot conventions once and reuse them everywhere.
- [ ] Implement `Cadence` as a deterministic policy object with explicit `now` input and no I/O or hidden mutable state.
- [ ] Implement every Cadence v1 new-card and reviewed-card rating transition from `plan.md`, including counters, clamps, phases, due times, and scheduler version.
- [ ] Add neighboring table-driven `Cadence.test.ts` coverage for every rating/phase combination, exact time calculation, immutability, minimum/maximum clamps, and counters.
- [ ] Implement `StudyQueue` as a pure policy object for new-first selection, reviewed ordering, the inclusive 48-hour horizon, deterministic tie-breaking, limit behavior, and derived status.
- [ ] Add neighboring `StudyQueue.test.ts` coverage for every ordering and horizon boundary, suspension, truncation, due/future classification, and the accepted Again-behind-new behavior.
- [ ] Configure test scripts/projects so ordinary unit tests exclude `*.integration.test.*` and the integration command selects those tests wherever they are colocated.

### Phase 1 verification

- [ ] Run the focused Cadence tests.
- [ ] Run the focused StudyQueue tests.
- [ ] Run type checking for the new contracts/domain code.

### Phase 1 cleanup checkpoint

- [ ] Remove superseded type/schema experiments and duplicate domain constants once all callers use the canonical contracts.
- [ ] Remove unused dependencies or configuration introduced/discovered during contract work.
- [ ] Run references and focused tests before deleting each superseded contract symbol.

## Phase 2 — Authoritative Postgres schema and migration

Use the required workflow: create a migration with `npx supabase migration new`, edit the generated SQL, apply it locally with `npx supabase migration up`, then run `npm run gen` before coding against generated types.

- [ ] Add the `decks`, independent Markdown `cards`, `review_events`, and `card_revisions` schema specified in `plan.md`.
- [ ] Add ownership constraints and all cadence consistency constraints.
- [ ] Add per-user/deck uniqueness rules where specified.
- [ ] Enforce the review-event `request_id` idempotency contract at the database level.
- [ ] Add indexes supporting tenant-scoped deck/card lookup, new-card order, reviewed-card horizon/order, history pagination, and revision pagination.
- [ ] Add RLS policies as defense in depth without relying on them to compensate for unscoped server SQL.
- [ ] Implement migration of current forward cards, materialization of reversible directions as independent cards, cadence-state mapping, review-log remapping, and retained content snapshots.
- [ ] Make the migration preserve stable source IDs where possible and generate deterministic/traceable destination IDs where a reverse card must be materialized.
- [ ] Add local migration fixtures for forward-only, reversible, new, reviewed, suspended, and reviewed/logged cards.
- [ ] Add assertions proving source/destination counts, schedule mapping, history attribution, and snapshot preservation.
- [ ] Regenerate database types and commit code only against generated schema types.

### Phase 2 verification

- [ ] Apply the complete migration from the current local schema successfully.
- [ ] Run migration fixture assertions against local Supabase.
- [ ] Confirm every old forward and reverse schedule has exactly one independent destination card.
- [ ] Confirm review history targets the correct destination card after migration.

### Phase 2 cleanup checkpoint

- [ ] Compare `migrate-v2.ts`, `migrate-from-github.ts`, `repair-srs-state.ts`, existing schema validation, and migration documentation with the new migration fixtures.
- [ ] Extract any still-required data mapping or repair invariant into the forward migration and automated fixture assertions.
- [ ] Delete obsolete one-off migration/repair/import scripts, their package commands, and documentation only when their behavior is represented by the tested migration or explicitly remains operationally required.
- [ ] Keep every historical file under `supabase/migrations`; schema cleanup happens through the new forward migration.
- [ ] Do not remove the RxDB schema generator yet if the still-running frontend requires its generated schema.

## Phase 3 — Authenticated tRPC Edge Function

- [x] Add the single Supabase Edge Function `api` with CORS suitable for the static GitHub Pages client.
- [x] Add tRPC v11 router wiring and authenticated request context.
- [x] Verify Supabase bearer JWTs and derive the user ID only from the verified token.
- [x] Add Postgres.js using the Supabase transaction-pooler connection. Do not expose its URL or server secrets to Expo.
- [x] Supply `identity` and `db` through the request context; procedure files own validation, authorization, queries, transactions, and serialization.

### Vertical router slices

- [x] Implement tenant-scoped deck lifecycle and queue procedures in `routers/deck.ts`.
- [x] Implement tenant-scoped card CRUD, search, suspension, revisions, and rollback in `routers/card.ts`.
- [x] Implement queue, rating, history, idempotency, and undo behavior in `routers/review.ts`.
- [x] Implement `auth.session` in `routers/auth.ts`.
- [x] Ensure `deck.queue` embeds the complete canonical `Card` DTO with derived queue status.
- [x] Validate every input with Zod and map expected errors to stable tRPC codes.

The repository and service subsections from the original plan are superseded by
the vertical-slice decision. Their behavior is implemented directly in the
owning router files, with shared tenant bases in `src/db/tenant.ts` and pure
policies in `src/domain/`.

### Phase 3 tests and verification

- [x] Add caller-level router integration suites using `appRouter.createCaller()`.
- [x] Prove cross-tenant denial for deck/card operations in the live integration suite.
- [x] Prove request idempotency, exact undo restoration, history pagination, and queue behavior.
- [x] Invoke the actual local Edge Function with a real local Supabase user token and exercise session, queue, rate, history, and undo.

### Phase 3 cleanup checkpoint

- [x] Remove temporary routers, duplicate DTOs, repository/service layers, unused legacy dependencies, and abandoned client paths.
- [x] Confirm there is one implementation for each business rule and one public tRPC router surface.
- [x] Replace the old app with a minimal Expo export stub; the real frontend cutover remains Phase 4 work.

## Phase 4 — Frontend cutover

- [ ] Add Supabase email/password sign-in with `signInWithPassword()` and session restoration.
- [ ] Do not add public signup, OAuth, magic links, password recovery UI, or email confirmation flows.
- [ ] Add the authenticated tRPC client with token refresh behavior.
- [ ] Replace `useDeck` with `useStudyQueue`, storing only the current server snapshot and request state in React memory.
- [ ] Remove local sorting, cadence calculation, reverse-card generation, limits, persistent session state, mutation reconciliation, and database observation from frontend hooks.
- [ ] On every queue-affecting mutation success, call `setQueue(response.queue)` with no local patching.
- [ ] Update deck selection and review routes to use tRPC exclusively.
- [ ] Render the full card content already returned by `deck.queue`; do not issue an N+1 `card.get` request while studying.
- [ ] Preserve front/reveal/back interactions and TTS behavior using card/deck speech metadata.
- [ ] Visually distinguish future study-ahead cards using server-provided time/status.
- [ ] Move rating, undo, suspension, editing, creation, deck rename/removal, card removal, and rollback to tRPC.
- [ ] Add per-card newest-first review history, including ratings, timestamps, interval changes, resulting due dates, and visibly undone entries.
- [ ] Add content revision history and rollback UI where specified by the existing product surface.
- [ ] Remove sync status and offline/replication settings from the UI.

### Safe Markdown and ruby rendering

- [ ] Add explicit input limits for front/back Markdown and metadata.
- [ ] Sanitize rendered HTML with an allowlist that permits Markdown output and only the required raw ruby tags: `ruby`, `rt`, and optional `rp`.
- [ ] Reject/remove scripts, iframes, event handlers, arbitrary styles, unsafe URL schemes, and all unapproved raw HTML.
- [ ] Preserve semantic `<ruby>/<rt>` output on web.
- [ ] Preserve the native renderer that displays Pinyin above Hanzi.
- [ ] Add neighboring renderer tests for allowed ruby markup and malicious/disallowed HTML.

### Phase 4 verification

- [ ] Run the actual app against local Supabase and sign in with a provisioned email/password account.
- [ ] Fetch and study a new-first queue through tRPC.
- [ ] Exercise all four ratings and observe replacement snapshots.
- [ ] Verify future cards are visually distinct.
- [ ] Undo a review and confirm both cadence restoration and the visible undone history entry.
- [ ] Create, edit, suspend, restore, and delete cards through the real UI.
- [ ] Verify Chinese ruby content visually on the actual web surface and verify unsafe HTML does not execute/render.
- [ ] Reload and confirm authoritative state reconstructs from Postgres rather than local persistence.

### Phase 4 cleanup checkpoint

Delete legacy frontend slices one workflow at a time, immediately after that workflow passes its actual-app smoke test:

- [ ] After queue/review/undo pass through tRPC, delete `useDeck`, its old centralized tests, client cadence/reverse/limit/session logic, FSRS adapters, and `ts-fsrs`.
- [ ] After every route uses `useStudyQueue`/tRPC, delete `useRxQuery`, `rxdb.ts`, generated RxDB schemas, `schema/cards.schema.json`, the RxDB generator, and RxDB/Dexie dependencies; change `npm run gen` and `gen:prod` to generate only authoritative Postgres/API types.
- [ ] After reload/session restoration passes through the server, delete `supabase-replication.ts`, replication lifecycle wiring, sync route/UI, sync tests, and replication-only configuration.
- [ ] After independent-card create/edit flows pass, delete every direction, reversible, reverse-state, review-order, and daily-limit field/component/setting left in the frontend.
- [ ] Replace old local-data E2E seed helpers as each dependent journey moves to server-authoritative fixtures; retain a helper only while a still-active journey requires it.
- [ ] Remove obsolete settings screens and dependencies only after separating settings still required for authentication, TTS, or retained UI behavior.
- [ ] Run language-server references, focused tests, type checking, and Knip after each slice deletion rather than batching all legacy removal into one unverified change.

## Phase 5 — Agent-facing CLI

- [ ] Implement the TypeScript `flashcard` CLI using the same tRPC client and Zod contracts as the frontend.
- [ ] Implement secure password login, session refresh, operating-system credential storage where available, and logout.
- [ ] Accept passwords through a protected prompt, stdin, or dedicated environment variable; never accept/log them in command arguments or JSON output.
- [ ] Emit stable machine-readable JSON on stdout, diagnostics on stderr, and nonzero exit codes on failure.
- [ ] Implement deck list and queue commands.
- [ ] Implement card search/create/update/suspend/restore/remove and revision/rollback commands.
- [ ] Implement review rate/history/undo commands.
- [ ] Keep cadence, queue ordering, and authorization logic out of the CLI.
- [ ] Add neighboring CLI contract/smoke tests.

### Phase 5 verification

- [ ] Log in through the actual CLI without exposing the password.
- [ ] Create independent reciprocal cards, detect/search duplicates, fetch a queue, rate a card, inspect history, and undo through the local Edge Function.
- [ ] Validate stdout as JSON and confirm failures use stderr and nonzero status.

### Phase 5 cleanup checkpoint

- [ ] Remove any CLI-only duplicate DTO, authentication, or HTTP implementation; the CLI must import the canonical schemas and tRPC client.
- [ ] Remove abandoned CLI experiments and unused credential/network dependencies after the real commands pass.
- [ ] Confirm no cadence, queue, ownership, or mutation business rule exists in CLI code.

## Phase 6 — Browser journeys and residual cleanup

This is a residual pass, not the first deletion pass. All large architecture slices should already have been removed at their Phase 2–5 gates.

- [ ] Update/add Playwright journeys for email/password login, new-first queue, Markdown reveal, ruby/Pinyin rendering, all ratings, future styling, undo, review history, suspension, and sign-out.
- [ ] Delete superseded E2E journeys, fixtures, seed helpers, global setup, and server harness code only after replacement journeys cover the retained behavior.
- [ ] Search for residual RxDB, Dexie, replication, FSRS, direction/reverse, daily-limit, old session, old schema-generation, and compatibility-path references and remove each complete slice.
- [ ] Remove unused dependencies, exports, generated artifacts, scripts, configuration entries, and dead code reported by TypeScript/Knip.
- [ ] Confirm every surviving file-focused test is beside its source and only cross-cutting Playwright journeys remain under `tests/e2e`.
- [ ] Confirm historical Supabase migration files remain intact and all legacy schema removal is expressed as a tested forward migration.
- [ ] Update GitHub Actions for type checking, colocated unit tests, local migration/integration tests, Playwright, production migration push, Edge Function deployment, Expo export, and GitHub Pages deployment.
- [ ] Ensure no server secrets or database connection strings enter Expo build-time variables or frontend bundles.

### Phase 6 verification

- [ ] Run focused tests for every residual deletion.
- [ ] Run the complete unit suite.
- [ ] Start local Supabase, apply migrations from the current schema, and run all integration tests.
- [ ] Invoke the local Edge Function smoke scenario.
- [ ] Run the complete Playwright suite against the actual application.
- [ ] Run the repository type checker/build/export and Knip.
- [ ] Run the repository's required pre-push command: `npm run test:unit && npm run test:e2e`.
- [ ] Confirm no obsolete architecture or dependency remains and no deleted behavior lacks a proven replacement.

## Production cutover runbook — operator-gated

Prepare these steps and their exact commands, but stop before modifying production unless explicitly authorized:

- [ ] Confirm Supabase Free inactivity-pause and backup limitations are accepted.
- [ ] Confirm the two initial email/password users are provisioned and email-confirmed administratively.
- [ ] Take and verify a production database export.
- [ ] Announce/start a short maintenance window and prevent old client writes.
- [ ] Apply the tested production migration.
- [ ] Validate migrated deck/card/history counts and representative schedules before deploying clients.
- [ ] Deploy the `api` Edge Function and its server-only secrets.
- [ ] Deploy the matching static frontend and CLI release.
- [ ] Smoke test both production user accounts and representative decks.
- [ ] End maintenance only after proving no old client write path remains.

## Definition of done

- [ ] Frontend and CLI authenticate through Supabase and perform all application behavior through the same tRPC API.
- [ ] Postgres is the only durable source of truth.
- [ ] Queue, cadence, tenant authorization, revisions, review history, mutations, idempotency, concurrency control, and undo are server-authoritative and tested.
- [ ] Every queue item carries the complete canonical card content; studying performs no per-card fetch.
- [ ] Independent Markdown cards fully replace forward/reverse modeling.
- [ ] Safe Pinyin-above-Hanzi rendering works on web and native without arbitrary HTML execution.
- [ ] File-focused tests are colocated; only cross-cutting browser journeys remain centralized.
- [ ] No old local database, replication, FSRS, reverse-direction, limits, persistent-session, compatibility, or dual-write code remains.
- [ ] Local migration, Edge Function, frontend, CLI, integration, and browser verification all pass.
- [ ] Any remaining production-only action is explicitly identified as operator-gated, not represented as completed.
