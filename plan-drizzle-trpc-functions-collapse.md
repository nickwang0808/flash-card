# Drizzle + tRPC Functions Collapse

Vertical-slice rebuild: every tRPC procedure owns its full vertical slice (Zod schemas, Drizzle queries, transactions, cadence/queue logic) in one file. Delete the repository/service/contracts/fakes layers and the entire legacy RxDB client stack.

## Context

The current server has grown a horizontal stack — `src/api/contracts/`, `repositories/` (3 files), `services/` (3 files), `fakes.test-support.ts`, `mappers.ts`, a drizzle-zod base + domain schemas + wire contracts, plus the old client-side RxDB/supabase-replication/useDeck legacy. Reviewing any behavior requires jumping across 4-6 files and 3 test suites, and two legitimately different card-shaped types are drifting.

User decisions locked in:
- **One vertical slice per tRPC procedure.** Input output schemas + all logic (queries, transactions, locks, Cadence, StudyQueue) live in the same file as the procedure.
- **Collocation is for procedure code only.** Shared domain vocabulary (schemas, `Card`/`Deck` types, `Cadence`, `StudyQueue`, errors, `TimestampSchema`) stays in `src/domain/` — the CLI (Phase 5) and pure domain tests import it without pulling in edge-function code.
- **Cut the whole horizontal stack**, and **delete the entire legacy client** (RxDB, supabase-replication, useDeck, old app routes, ts-fsrs) now, not at Phase 4.
- **EVERYTHING in the DB is user-scoped, not just cards.** Every table carries/derives `user_id`; every query is tenant-scoped; every procedure enforces ownership. This is a global invariant, not a card-specific rule.

## Approach

### 1. Tenant scoping — the global invariant

Every query in every procedure starts from a pre-scoped base. One shared module, the only place raw tables are read:

**New file `src/db/tenant.ts`** (~70 lines). Required `userId` argument on every export — you cannot call any base without the tenant key:

```ts
cardsOwnedBy(db: AppDb, userId: string)        // cards ⋈ decks, decks.user_id = userId
reviewEventsOf(db: AppDb, userId: string)      // events ⋈ cards ⋈ decks, scoped
deckRevisionsOf(db: AppDb, userId: string)     // revisions ⋈ cards ⋈ decks, scoped
deckOwned(db: AppDb, userId: string, deckId: string)          // boolean gate
requireDeck(db: AppDb, userId: string, deckId: string)        // throws NOT_FOUND
requireDeckForCard(db, userId, cardId, deckId) // verify ownership of a card through its deck
```

Contracts:
- `cardsOwnedBy` returns the joined base; procedures append `.where(eq(cards.id, cardId))`, `.orderBy(desc(cards.createdAt))`, `.limit(n)`, `.for('update', { of: cards })` etc.
- `reviewEventsOf`/`deckRevisionsOf` likewise return joined bases.
- `requireDeck*` throw `new ApplicationError('NOT_FOUND', ...)` when the scoped query returns nothing.

Every table is reachable only through one of these bases. The sole exceptions are inserts into `decks`/`cards`/`review_events`/`card_revisions` (which carry `user_id`/`deck_id` FKs) and ownership-gated writes that target rows already selected through a base.

### 2. Vertical-slice router files

**New files** (delete `src/api/contracts/` afterwards):

- `supabase/functions/api/routers/auth.ts` — `auth.session` (public), identity passthrough.
- `supabase/functions/api/routers/deck.ts` — `deck.list`, `deck.create`, `deck.rename`, `deck.remove`, `deck.queue`. Queue logic inline: `cardsOwnedBy` → two bucket queries (new: `next_review_at is null` order `created_at,id`; reviewed: `next_review_at <= now+horizon` order `next_review_at,id`) → `StudyQueue.build(...)`.
- `supabase/functions/api/routers/card.ts` — `card.get`, `card.search`, `card.create`, `card.update`, `card.suspend`, `card.restore`, `card.remove`, `card.revisions`, `card.rollbackRevision`. All via bases + `requireDeckForCard`. `create`/`update`/`rollbackRevision` open a transaction and insert into `card_revisions` (values from `CardContentSchema`).
- `supabase/functions/api/routers/review.ts` — `review.rate` (transaction: `for update` lock through base → version CAS → `requestId` idempotency → `Cadence.rate` → insert event → update card, `version: expectedVersion+1` because a double-increment in one statement loses the CAS) and `review.undo` (lock event through base, latest-active check, restore exact `before_state`, mark `undone_at`), then rebuild queue snapshot post-commit. `review.history` paginated newest-first.
- `supabase/functions/api/router.ts` — import + merge the four, export `AppRouter`.

**Procedure pattern** (tRPC v11):

```ts
const t = initTRPC.context<ApiContext>().create({ errorFormatter });
const protectedProcedure = t.procedure.use(requireAuth);

export const deckRouter = t.router({
  list: protectedProcedure
    .input(DeckListInputSchema)
    .output(DeckListOutputSchema)
    .query(async ({ ctx, input }) => { ... }),
  ...
});
```

· Error mapping: keep `trpc.ts` (`requireAuth`, `ApplicationError → TRPCError`, `appCode` in `errorFormatter.data`). Do NOT use the `guard()` wrapper — `errorFormatter` handles ApplicationError already; throw ApplicationError directly in procedures. Delete `guard()` if unused after the cut.

### 3. Zod schemas — collocate inputs; keep shared domain schemas

- **Input schemas** move into each router file, next to their procedure. Delete `src/api/contracts/*` entirely.
- **Domain schemas stay in `src/domain/`** (only these were shared): `DeckSchema`, `CardSchema`, `CardContentSchema`, `MarkdownSchema`, `CardNameSchema`, `CadenceStateSchema`, `ReviewEventSchema`, `ReviewHistoryEntrySchema`, `CardRevisionSchema`, `QueueSnapshotSchema`, `QueueOptionsSchema`, primitives, `Cadence`, `StudyQueue`, `ApplicationError`.
- **Applying refinements inside the domain schema is required.** drizzle-zod bases are raw row shapes: `frontMarkdown` must be `MarkdownSchema` (ruby-only tag allowlist), `name` non-empty trimmed, counters `.int().nonnegative()`, cadence all-or-none `superRefine`. This is what prevents `<script>` from being accepted; do not weaken it in the collapse.
- **Delete `src/db/zod.ts`** (the drizzle-zod bases). The domain schemas are the single source for validation; no base re-export needed. This removes the row/DTO distinction entirely and means the mapper-complexity arguments disappear.
- Procedure output schemas are the domain schemas directly (`output(CardSchema)` etc.) — one shape everywhere.
- Rationale: input schemas are per-procedure (belong with the procedure); domain schemas are cross-cutting vocabulary (must stay shared for Cadence/StudyQueue/CLI).

**Review the schemas you delete so no rule is lost.** `src/api/contracts/cards.ts` currently defines `CardSuspendInputSchema`, `CardRemoveInputSchema`, etc. — carry each field into the matching router file exactly.

### 4. Timestamps — delete the mappers

Change the Drizzle column mode so no `Date→ISO` mapping exists:

- In `src/db/schema.ts`, every `timestamp('...', { withTimezone: true })` becomes `timestamp('...', { mode: 'string', withTimezone: true })`. Columns affected: `createdAt`/`updatedAt`/`nextReviewAt` on `cards`; `createdAt`/`updatedAt` on `decks`; `reviewedAt`/`undoneAt`/`createdAt` on `review_events`; `createdAt` on `card_revisions`.
- Drizzle then returns ISO strings from Postgres. `jsonb` columns stay `.$type<CadenceState|CardContent>(...)`.
- **Inserts must pass ISO strings**, not `Date`: `.values({ updatedAt: new Date().toISOString(), ... })`.
- Procedure code writes `reviewedAt: now.toISOString()`, cursor timestamps as strings.
- Delete `src/db/zod.ts`, delete `supabase/functions/api/repositories/mappers.ts`; stops existing on the first successful tsc — there is no mapper after this step.

Do NOT run `drizzle-kit generate` for this (it's a pure mode change, no DDL). Do re-run `npm run test:integration` to prove rows round-trip as ISO strings.

### 5. Delete the whole horizontal stack

In one commit, after tests pass:

- `supabase/functions/api/repositories/` — `CardRepository.ts`, `DeckRepository.ts`, `StudyRepository.ts`, `cursor.ts`, `fakes.test-support.ts`, `mappers.ts` (yes: cursor helpers move into `src/db/tenant.ts`; they're shared by paginated procedures).
- `supabase/functions/api/services/` — `CardService.ts`, `DeckService.ts`, `StudyService.ts` (their bodies move into the routers; anything still called from a router after the move is a leftover — delete it).
- `supabase/functions/api/contracts/` → move input schemas into routers. Delete the folder. Do NOT delete `src/domain/` and do NOT delete `src/db/` (they're the new substrate).
- `src/types/supabase.ts` + `scripts/gen-rxdb-schemas.ts` + the `gen`/`gen:prod` package scripts: delete. The Supabase-CLI gen workflow is gone; generated database types were for the old client stack and PostgREST which nothing uses anymore.

### 6. Legacy client + old routes — full deletion

Delete everything from the pre-server client that no longer has a producer:

- `src/services/`: `rxdb.ts`, `rxdb-schemas.generated.ts`, `supabase-replication.ts`, `supabase.ts`, `translate.ts` (translate/ai features move to tRPC procedures in the rebuild — delete the client-side file here).
- `src/services/card-creator.ts` and its old tests IF nothing else imports it — mark as delete unless it's pure and dependency-free and the new UI wants it; if it's pure and dependency-free and intended for the rebuilt UI, move it beside the new UI components (it is NOT to be re-created — check imports first with `grep`).
- `src/hooks/useDeck.ts`, `useRxQuery.ts`, `replication` hooks, their tests (`tests/unit/useDeck.test.ts`, `tests/unit/card-creator.test.ts`, etc.), and the `tests/unit/` folder (Phase 0 colocation convention moved surviving tests next to source; the remaining old-client tests are deleted with their sources).
- `src/services/` moves → the new UI's components import `/api/client` from the client library (Phase 4); any imports that would go through `useDeck` are deleted, not migrated.
- `app/` (the expo-router app): after `src/services` and old hooks are gone the routes that imported them no longer compile. Replace the whole `app/` directory with a minimal stub that renders one screen (a static `<Text>Flashcards</Text>` cutoff indicator) so `npx expo export --platform web` (CI build step) still passes. **Do NOT build the new UI in this task.**
- Delete `tests/e2e/` old Playwright journeys (they drive the old client and reference the deleted `test-server.ts` helpers).
- Delete `scripts/seed-test-repo.ts` + `seed`, `seed:reset`, `seed:status` scripts (tied to RxDB import/replication).
- Delete the now-unused `validate:schema` script (its target file doesn't exist).
- Remove deps: `rxdb`, `ts-fsrs`, `@react-native-async-storage/async-storage` (AsyncStorage might still be wanted by the new sign-in session storage — check `src/api/client` need first; if the new client stores the session there keep the dep), `rxjs` if only used by old hooks, plus `@ai-sdk/openai`/`ai` and any AI-dep if the translate feature is fully deleted (grep for imports first, delete only confirmed-unused). Run `npm uninstall <pkg>`.
- Remove `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` from the dev script env and from the CI build env — the client no longer uses them (tRPC session is JWT-based; the anon/publishable key is not needed).
- `supabase/migrations/{local-stack.test-support.ts, schema.integration.test.ts}` stay — used by the integration suites. The archived `.sql` migrations stay under `supabase/migrations/archive/`.
- `supabase/functions/.env` and `supabase/functions/api/.env` are gitignored local secrets, unused by the new test flow — leave them out of the commit (only touch if smoke needs them).
- `tests/setup.ts` — check whether it imports jsdom setup referencing the old client; update if it does, keep in-place. `vitest.config.ts` includes `src/**/*.test.ts`? if so, remove old `tests/unit` references, verify `*.integration.test.*` excludes remain; `vitest.integration.config.ts` stays as-is (it selects `**/*.integration.test.{ts,tsx}`).

Before deleting each file, `grep` for importers; if a dependency-free pure util is used by the new UI plans, move it next to the new components instead of deleting.

### 7. Context plumbing after collapse

- `supabase/functions/api/index.ts` (entry): build `ApiContext` with `{ identity, db: getDb(env.databaseUrl) }` — no more services. `createContext` closure passes `ctx.db` + `ctx.identity`. CORS + JWT verification unchanged.
- `supabase/functions/api/trpc.ts`: keep `initTRPC` + `errorFormatter` + `requireAuth`; context interface becomes `{ identity: VerifiedIdentity; db: DbTransaction }` (or `AppDb` + transaction type).
- `DbTransaction` = `AppDb` — PgTransaction extends PgDatabase so `.transaction(cb)` accepts the same shape; keep the existing alias definition in `src/db/client.ts`.

### 8. Test restructuring — one caller suite + live smoke

- Delete `supabase/functions/api/repositories/repositories.integration.test.ts` (was repo-level; superseded by caller-level suites).
- New colocated suites per slice:
  - `supabase/functions/api/routers/card.integration.test.ts` — `createCaller` with real DB: deck create→card create; search by name/markdown/tag; suspension/restore; revision history + rollback; CAS conflicts (`expectedVersion` wrong → CONFLICT); **cross-tenant: user B cannot get/search/update/suspend/remove user A's card**.
  - `supabase/functions/api/routers/review.integration.test.ts` — rate applies Cadence (interval/nextReviewAt/counters/version), idempotency (`requestId` reuse returns same reviewId, cadence applied once), unique-key race branch, undo restores exact `before_state` and only latest-active, history newest-first incl. undone.
  - `supabase/functions/api/routers/deck.integration.test.ts` — list/create/rename/remove with version CAS + per-user name uniqueness.
  - `supabase/functions/api/routers/auth.integration.test.ts` — session returns verified identity; unauthenticated throws UNAUTHORIZED.
  - Keep `supabase/functions/api/http-smoke.integration.test.ts` (live function, real sign-in): provision user, sign in, deck→card→queue→rate→history→undo.
- `router.test.ts` (unit) — delete; replaced by the caller suites. Domain unit tests (`src/domain/*.test.ts`) unchanged and still green.
- Keep `supabase/migrations/schema.integration.test.ts` (RLS/constraints proof; admin client touches tables with superuser → policies evaluated as owner, anon client proves RLS deny).

## Critical files & anchors

- `src/db/tenant.ts` — NEW; the only place table queries are scoped. All procedures must use it; grep for stray `.from(cards)` / `.from(decks)` outside it at the end and eliminate them.
- `src/db/schema.ts` — change timestamp mode to `'string'`; keep `.$type` on jsonb. Verify against the migration: it must still match `supabase/drizzle/0001_baseline.sql` after the change (mode is compile-time only).
- `src/domain/Card.ts:27-49` — keep `CardSchema` with all refinements + `superRefine`; this is the single Card validation, do not replace with a raw base.
- `supabase/functions/api/router.ts` — becomes a merge of the four router files; export `AppRouter`.
- `supabase/functions/api/index.ts` — context builds `db` only; no services.
- `supabase/functions/api/trpc.ts` — keep auth middleware + error formatter; context type updated; delete `guard()` if unused.

## Verification

Prereqs: local Supabase running (`supabase start`), PATH with node, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

1. `npx tsc --noEmit` — 0 errors in `supabase/functions/**`, `src/db/**`, `src/domain/**`; the only allowed errors are the pre-existing app ones IF the old routes still compile — after step 6 the stub `app/` must yield 0 errors total.
2. `npm run test:unit` — still passes (126 domain/unit tests; no old-client suites).
3. `DATABASE_URL=... npm run test:integration` — new caller suites + smoke all green. At minimum prove: cross-tenant denial (user B cannot read/modify A's data), idempotent rate, undo restores exact state, queue ordering new-first + horizon.
4. `npx expo export --platform web` — the stub app builds (CI parity).
5. Repeat `drizzle-kit migrate` — still "up to date"; no DDL drift from the mode change.
6. `npx knip` — no unused deps/exports after deletions (some pre-existing unused exports allowed only if they were also allowed before).

## Assumptions & contingencies

- Keep `src/domain/` and `src/db/`; they are the substrate for both the new stack and the Phase-5 CLI. Do not delete them.
- The old `app/` is replaced by a stub; the real rebuilt UI is another session (Phase 4). Do not attempt it here.
- `@react-native-async-storage/async-storage`: keep only if the new tRPC client uses it for session persistence; otherwise delete (check during step 6).
- Contingency: if `drizzle-kit migrate` shows drift after the timestamp-mode change (unexpected), re-generate with `npx drizzle-kit generate --name timestamps_string_mode` and verify the diff is empty DDL; do not commit a non-empty migration for a compile-time-only change.
- Contingency: if a legacy file is imported by code that survives (unlikely, but e.g. a UI constant in `translate.ts`), move that pure constant next to the new stub/UI instead of deleting it; never keep the whole legacy file.