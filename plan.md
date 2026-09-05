# Flash Card Rewrite Plan

## Status

The server-authoritative API collapse milestone is implemented. The working tree now
contains vertical-slice tRPC routers, tenant-scoped Drizzle access, shared domain
schemas, and a minimal Expo export stub. Frontend reconstruction, CLI work, browser
journeys, and production cutover remain future phases.

This is a clean cutover, not an incremental extension of the RxDB architecture.

## Goals

- Keep the product small enough to understand end to end.
- Make Postgres the single durable source of truth.
- Keep all queue and cadence behavior in testable TypeScript on the server.
- Serve the existing frontend and an agent-friendly CLI through one typed API.
- Support multiple isolated users.
- Remove daily limits and persistent study-session state.
- Represent every prompt/answer pair as an independent card.
- Support flexible Markdown content, including Chinese characters and Pinyin.
- Keep deployment at or near $0 for the initial two-user deployment.

## Non-goals

- Offline study or local-first synchronization.
- RxDB or a second client-side database.
- Automatic linkage between forward and reverse cards.
- Reimplementing FSRS or optimizing for a target retention rate.
- Real-time propagation between multiple simultaneously open clients in the first release.
- Deck templates or language-specific card schemas.

## Locked decisions

### Product behavior

- New cards are always presented before cards with review history.
- New cards have no cadence state and therefore have `next_review_at = null`.
- Reviewed cards are ordered by `next_review_at`, then card ID for deterministic ties.
- Reviewed cards are fetched through a rolling 48-hour horizon.
- The queue working-set limit is a transport limit, not a daily study limit.
- A default working set contains 50 cards and is replenished after mutations.
- `next_review_at` is the only authoritative scheduling timestamp.
- Future cards may be shown for study-ahead and are visually distinguished from due cards.
- Every forward or reverse prompt is an independent card with its own ID and cadence state.
- The application does not store or infer a relationship between reciprocal cards.
- Card fronts and backs are Markdown.

### Architecture

- The frontend does not query or mutate Postgres directly.
- The frontend and CLI call a tRPC API.
- The tRPC API runs in one Supabase Edge Function.
- Server-side TypeScript owns cadence calculation, queue construction, authorization, transactions, and rollback.
- Postgres owns durable data, constraints, indexes, and transaction isolation; it does not contain cadence business logic.
- The frontend keeps only the latest server-issued queue snapshot in memory.
- Every queue-affecting mutation returns a replacement queue snapshot.
- RxDB, Supabase replication, generated RxDB schemas, and local mutation reconciliation are removed.

### Authentication

- Use Supabase email-and-password authentication, not OAuth or passwordless email.
- New public signups are disabled. The two initial accounts are provisioned and email-confirmed administratively.
- Clients sign in with `signInWithPassword()` and retain the resulting Supabase session.
- Routine sign-in requires no email delivery provider, redirect callback, or OAuth-provider configuration.
- Password recovery and self-service email confirmation require working SMTP and are deferred. Until then, account recovery is an explicit administrator operation.
- Passwords are handled only by Supabase Auth and are never sent to the tRPC application procedures.
- Sessions should be long-lived enough that ordinary use does not require frequent reauthentication.

## Important ordering consequence

Strict new-first ordering means a card rated `Again` becomes a reviewed card and moves behind every untouched new card. Its `next_review_at = now + 1 minute` orders it relative to other reviewed cards; it is not a guarantee that the card will be presented exactly one minute later if new cards remain.

This consequence is accepted by the current new-first decision. If it proves undesirable, the only policy change should be to add a leading `due learning/retry` bucket before new cards. Do not add hidden client-side exceptions.

## Technology stack

| Layer | Technology | Decision rationale |
|---|---|---|
| Frontend | Expo Router, React, React Native Web | The current milestone keeps a minimal static-export stub; the rebuilt frontend remains a later phase. |
| Static hosting | GitHub Pages | Already configured and free. |
| Typed API | tRPC v11 with Zod | Shared TypeScript procedure types and runtime input validation for web and CLI clients. |
| Serverless runtime | One Supabase Edge Function named `api` | Reuses the existing platform and should remain inside the free allowance. |
| Authentication | Supabase Auth email and password | No OAuth-provider or routine email-delivery dependency; JWT sessions integrate with Edge Functions. |
| Database | Supabase Postgres | Existing source of truth and migration workflow. |
| Database client | Postgres.js through the Supabase transaction pooler | Allows transactions and row locks from TypeScript without putting business logic in SQL functions. |
| Schema management | Supabase SQL migrations plus typed Drizzle schema | Postgres remains canonical while server queries use compile-time schema types. |
| Markdown | Existing Markdown stack with a sanitized ruby-HTML subset | Preserves standard `<ruby>/<rt>` Pinyin annotations without allowing arbitrary HTML. |
| Unit/API tests | Vitest | Already used and suitable for pure domain and tRPC caller tests. |
| Browser tests | Playwright | Already used and verifies the deployed interaction surface. |
| Agent interface | TypeScript CLI backed by the tRPC client | Stable JSON commands without duplicating domain behavior. |

## Target system

```text
Expo web/native client ----\
                            +--> tRPC Edge Function --> Postgres
Agent-friendly CLI --------/
             |
             +--> Supabase Auth email/password + JWT
```

The Edge Function contains no persistent in-memory state. Every request authenticates the user, reads current Postgres state, applies pure domain behavior, and returns a fresh result.

## Current and proposed repository layout

The implemented server-collapse milestone uses this layout:

```text
app/
  index.tsx                         Minimal Expo static-export stub
src/
  db/
    client.ts                       Typed Postgres.js/Drizzle client
    schema.ts                       Typed view of the SQL schema
    tenant.ts                       User-scoped query bases and cursors
  domain/
    Card.ts                         Canonical card schemas and content rules
    CardRevision.ts                 Revision schemas
    Cadence.ts                      Pure cadence policy
    CadenceState.ts                 Cadence state schema
    Deck.ts                         Deck schema
    ReviewEvent.ts                  Review schemas
    StudyQueue.ts                   Pure queue policy
    errors.ts                       Stable application errors
    primitives.ts                   Shared primitives and timestamps

supabase/
  functions/
    api/
      index.ts                      Edge Fetch entry point
      router.ts                     Root tRPC router
      trpc.ts                       Context, auth, and error formatting
      routers/
        auth.ts                     Session procedure
        deck.ts                     Deck procedures and queue construction
        card.ts                     Card procedures and revisions
        review.ts                   Rating, history, and undo
        *.integration.test.ts       Caller-level integration suites
  migrations/

cli/                                Future agent-facing client
tests/e2e/                          Future browser journeys
```

Procedure-specific input/output schemas and database operations stay in their
vertical router files. Shared domain vocabulary remains independent of edge
function code. The frontend is intentionally a stub until the frontend-cutover
phase; the CLI and browser journeys are also future work.

## Data model

Use SQL snake_case names and map them once at the repository boundary.

### `decks`

```text
id                  uuid primary key
user_id             uuid not null references auth.users
name                text not null
default_speech_locale text null
created_at          timestamptz not null
updated_at          timestamptz not null
unique(user_id, name)
```

A deck belongs to exactly one user in this release. Shared household decks are out of scope; add explicit membership later only if actually needed.

### `cards`

```text
id                  uuid primary key
deck_id             uuid not null references decks on delete cascade
front_markdown      text not null
back_markdown       text not null
speech_text         text null
speech_locale       text null
tags                text[] not null default '{}'
suspended           boolean not null default false
created_at          timestamptz not null
updated_at          timestamptz not null

-- Null cadence fields mean the card is new.
cadence_phase       text null check ('learning', 'review')
next_review_at      timestamptz null
interval_days       double precision null
review_count        integer not null default 0
lapse_count         integer not null default 0
scheduler_version   integer null

-- Optimistic concurrency.
version             integer not null default 0
```

Do not retain `term`, `direction`, `reversible`, `forward_state`, or `reverse_state` concepts. UUID is the only card identity. Similar or reciprocal content is valid and must not be blocked by a content uniqueness constraint.

Consider a check constraint requiring the cadence fields to be either all null for a new card or all populated for a studied card.

### `review_events`

```text
id                  uuid primary key
card_id             uuid not null references cards on delete cascade
rating              text not null check ('again', 'hard', 'good', 'easy')
reviewed_at         timestamptz not null
before_state        jsonb null
after_state         jsonb not null
request_id          uuid not null
undone_at           timestamptz null
created_at          timestamptz not null
unique(card_id, request_id)
```

`before_state` and `after_state` hold the small cadence state. Review undo restores the exact stored prior state; it never reverses the cadence algorithm mathematically.

`review.history({ cardId })` returns these events newest first, including undone reviews marked as such. History exposes rating, review time, the before/after interval, and the resulting `next_review_at`; it never mutates cadence state.

### `card_revisions`

```text
id                  uuid primary key
card_id             uuid not null references cards on delete cascade
event_type          text not null
before_content      jsonb null
after_content       jsonb not null
created_at          timestamptz not null
```

Use this for agent-created, edited, and restored content. Keep a bounded history by an explicit retention policy. Content revision behavior stays separate from review undo.

## Card content

A card is an independent Markdown prompt and answer:

```ts
type CardContent = {
  frontMarkdown: string;
  backMarkdown: string;
  speechText?: string;
  speechLocale?: string;
};
```

Pinyin is ordinary Unicode Markdown rather than a schema field:

```markdown
# 苹果

*píngguǒ*
```

A reciprocal English-to-Chinese card is a separately created card. It may use different examples, hints, or formatting and does not automatically change when the first card changes.

Core Markdown has no syntax for ruby annotations. Permit the narrow HTML subset `<ruby>`, `<rt>`, and optional `<rp>` so Pinyin can remain directly associated with each Hanzi:

```markdown
<ruby>上<rt>shàng</rt></ruby><ruby>午<rt>wǔ</rt></ruby>
```

Reject other raw HTML during card validation and sanitize the rendered output with an explicit tag-and-attribute allowlist. Do not permit `script`, `iframe`, arbitrary `style`, event-handler attributes, or unsafe URL schemes. The existing custom ruby renderer remains responsible for native layout, while browsers use semantic HTML ruby rendering.

`speech_text` and `speech_locale` are optional metadata because arbitrary Markdown cannot always be converted into the intended spoken phrase. When absent, the client may speak sanitized visible text using the deck's default locale.

## Queue contract

### Query

```ts
deck.queue({
  deckId,
  horizonHours: 48,
  limit: 50,
});
```

### Server behavior

1. Verify that the authenticated user owns the deck.
2. Select active new cards with `next_review_at is null` in `created_at, id` order.
3. Select active reviewed cards with `next_review_at <= now + 48 hours` in `next_review_at, id` order.
4. Concatenate new cards followed by reviewed cards.
5. Return at most the requested working-set limit.
6. Include server time so clients classify due versus future cards without relying solely on a skewed local clock.

### Response

```ts
type Card = {
  id: string;
  deckId: string;
  frontMarkdown: string;
  backMarkdown: string;
  tags: string[];
  speechText: string | null;
  speechLocale: string | null;
  suspended: boolean;
  cadencePhase: 'learning' | 'review' | null;
  nextReviewAt: string | null;
  intervalDays: number | null;
  reviewCount: number;
  lapseCount: number;
  schedulerVersion: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type QueueCard = Card & {
  status: 'new' | 'due' | 'future';
};

type QueueSnapshot = {
  asOf: string;
  horizon: string;
  items: QueueCard[];
};
```

`deck.queue` returns the same complete canonical `Card` representation as `card.get`, augmented only with the derived queue `status`. This gives the study UI everything needed to render, speak, rate, suspend, or navigate to editing without another card request. Review history and content-revision history are intentionally excluded and remain available through their dedicated paginated procedures.

Each reviewed item includes `nextReviewAt`. Each new item has `nextReviewAt: null`. Queue status is derived using server time and is not persisted.

## Local consistency model

The frontend queue is a disposable snapshot, not a synchronized database.

- On review-screen entry, fetch a queue snapshot.
- Keep the snapshot only in React memory.
- Disable duplicate rating actions while a mutation is pending.
- On successful queue-affecting mutation, replace the entire local queue with the snapshot returned by the server.
- On mutation failure before commit, retain the previous snapshot and show the error.
- Give every mutation a client-generated `request_id` so retry after an ambiguous network failure is idempotent.
- Send `expected_version` with card mutations. On conflict, return a fresh queue and require the client to replace its snapshot.
- Refetch on reconnect and window/app focus.
- Refetch when an idle timer crosses the earliest future `next_review_at` if the screen is waiting.
- Do not add polling or Supabase Realtime initially.

This guarantees immediate consistency for mutations made by the current client. Changes made by another simultaneously open client become visible on focus/refetch or produce a version conflict. True instantaneous cross-client propagation is intentionally deferred.

## Mutation contract

### Rate

```ts
review.rate({
  cardId,
  deckId,
  rating,
  expectedVersion,
  requestId,
  queue: { horizonHours: 48, limit: 50 },
});
```

Inside one server-side database transaction:

1. Authenticate the user.
2. Lock the card through its user-owned deck.
3. Reject a stale `expected_version`.
4. Return the previous successful result if `request_id` already exists.
5. Calculate the next cadence state using the transaction timestamp.
6. Insert the immutable review event with before/after states.
7. Update the card cadence fields and increment `version`.
8. Commit.
9. Build and return a fresh queue snapshot.

### Undo review

```ts
review.undo({ reviewId, deckId, queue });
```

Inside one transaction:

1. Verify ownership through the event's card and deck.
2. Lock the card and review event.
3. Reject an already-undone event.
4. Reject undo if a newer active review exists for the same card.
5. Restore `before_state` exactly.
6. Mark the event undone and increment card `version`.
7. Commit and return a replacement queue snapshot.

### Card mutations

Create, update, suspend, restore, and delete procedures all verify deck ownership. Any mutation affecting the visible study deck returns or invalidates its queue snapshot through the same explicit contract.

## Cadence v1

This is a custom transparent cadence, not FSRS. FSRS models difficulty, stability, and retrievability; Cadence v1 is intentionally a small state machine with multiplicative review intervals.

All calculations are pure and accept an explicit `now`. Use UTC timestamps. Do not add random fuzz, desired-retention optimization, or timezone-dependent day boundaries.

### Configuration

```ts
const CADENCE_V1 = {
  againMinutes: 1,
  hardLearningMinutes: 10,
  firstGoodDays: 1,
  firstEasyDays: 4,
  lapseMultiplier: 0.5,
  hardMultiplier: 1.2,
  goodMultiplier: 2,
  easyMultiplier: 3,
  maximumIntervalDays: 365,
} as const;
```

### New card

| Rating | State |
|---|---|
| Again | Learning; due in 1 minute; retained interval 1 day |
| Hard | Learning; due in 10 minutes; retained interval 1 day |
| Good | Review; due in 1 day; interval 1 day |
| Easy | Review; due in 4 days; interval 4 days |

### Learning card

| Rating | State |
|---|---|
| Again | Remain learning; due in 1 minute |
| Hard | Remain learning; due in 10 minutes |
| Good | Graduate to review at the retained interval |
| Easy | Graduate to review at at least 4 days |

### Review card

| Rating | State |
|---|---|
| Again | Enter learning; due in 1 minute; retained interval becomes `max(1, old × 0.5)`; increment lapse count |
| Hard | Remain review; interval becomes `max(1, old × 1.2)` |
| Good | Remain review; interval becomes `max(1, old × 2)` |
| Easy | Remain review; interval becomes `max(4, old × 3)` |

Clamp every review interval to `maximumIntervalDays`. Increment review count on every accepted rating. Persist `scheduler_version = 1`. A future behavior change creates a new explicit scheduler version and migration rather than silently reinterpreting existing state.

## tRPC API

All procedures except Supabase's sign-in/session-refresh calls are protected by the authenticated JWT. Authentication credentials are handled by Supabase Auth directly; tRPC never receives a password.

### Authentication

| Procedure | Kind | Description |
|---|---|---|
| `auth.session` | Query | Confirms that the tRPC server accepts the current JWT and returns the caller's non-sensitive identity and session metadata. Used by the frontend and CLI as an authenticated API health check; it does not create or refresh the Supabase session. |

### Decks

| Procedure | Kind | Description |
|---|---|---|
| `deck.list` | Query | Returns every deck owned by the caller in deterministic name/ID order, with lightweight counts suitable for the deck picker. |
| `deck.create` | Mutation | Creates an owned deck with its name and optional default speech locale. Rejects duplicate names for the same user. |
| `deck.rename` | Mutation | Renames an owned deck after an optimistic-version check and returns the updated deck. |
| `deck.remove` | Mutation | Permanently removes an owned deck and its dependent cards and histories after explicit version/ownership checks. The UI and CLI must require deliberate confirmation before calling it. |
| `deck.queue` | Query | Builds a server-authoritative queue snapshot for one owned deck. New cards come first; reviewed cards follow in `next_review_at, id` order within the requested horizon and working-set limit. Every item contains the same complete `Card` DTO returned by `card.get`, plus server-derived new/due/future status. |

### Cards

| Procedure | Kind | Description |
|---|---|---|
| `card.get` | Query | Returns one owned card using the canonical `Card` DTO also embedded in `deck.queue`: Markdown content, tags, speech metadata, timestamps, current cadence state, suspension state, and optimistic version. Review and content-revision histories remain separate paginated queries. |
| `card.search` | Query | Searches the caller's card Markdown and tags, optionally within one deck. Supports agent duplicate checks and card discovery; results are paginated and deterministically ordered. |
| `card.create` | Mutation | Creates one independent Markdown card. It does not create, link, or infer a reverse card. Records the initial content revision and returns the created card. |
| `card.update` | Mutation | Replaces editable Markdown/metadata after an optimistic-version check, records before/after content in `card_revisions`, and returns the updated card. It does not modify cadence state. |
| `card.suspend` | Mutation | Excludes a card from future queue snapshots without deleting content, cadence state, or history. Returns a replacement snapshot when called from an active study deck. |
| `card.restore` | Mutation | Re-enables a suspended card with its existing cadence state intact and returns the updated card or replacement queue snapshot. |
| `card.remove` | Mutation | Permanently deletes one owned card and its dependent review/content history after explicit version/ownership checks. The UI and CLI must require deliberate confirmation before calling it. |
| `card.revisions` | Query | Returns a paginated newest-first history of content creation, edits, and restorations for one owned card. |
| `card.rollbackRevision` | Mutation | Restores a selected historical content snapshot as a new revision. Existing history is preserved, and cadence state is unchanged. |

### Reviews

| Procedure | Kind | Description |
|---|---|---|
| `review.rate` | Mutation | Locks an owned card, verifies its version and idempotency key, applies Cadence v1 for `again`, `hard`, `good`, or `easy`, records the before/after states, updates the card atomically, and returns the review ID plus a replacement queue snapshot. |
| `review.history` | Query | Returns paginated review events for one owned card in newest-first order, including rating, review time, before/after intervals, resulting due time, and whether each event was undone. |
| `review.undo` | Mutation | Undoes the selected review only when it is the latest active review for that card. Restores the exact stored `before_state`, marks the event undone, increments the card version, and returns a replacement queue snapshot. Redo is not supported. |

Use Zod validation for every input. Domain and repository errors map to stable tRPC error codes. Do not expose internal SQL errors or accept `userId` from callers.

## Agent-facing CLI

The CLI imports the tRPC client and emits stable JSON on stdout. Human-readable diagnostics go to stderr, and failures use nonzero exit codes.

Initial commands:

```text
flashcard auth login --email <email> --password-stdin
flashcard auth logout

flashcard decks list --json
flashcard queue --deck <id> --json
flashcard card search --deck <id> --query <text> --json
flashcard card create --deck <id> --front <markdown> --back <markdown> --json
flashcard card update <id> ... --json
flashcard card suspend <id> --json
flashcard review <id> --rating again|hard|good|easy --json
flashcard review history <card-id> --json
flashcard review undo <review-id> --json
```

Store the access and refresh tokens using the operating system credential store when available. Accept passwords through a protected prompt, stdin, or a dedicated environment variable for controlled automation; never place them in command arguments, logs, or JSON output. Never distribute the Supabase secret/service-role key to the CLI.

## Multi-tenant authorization

- The Supabase JWT subject is the only caller identity.
- Every server repository method requires an authenticated user ID.
- Every deck query filters by `decks.user_id`.
- Every card and review mutation verifies ownership through the parent deck.
- Never query or mutate a card solely by card ID.
- Keep RLS policies as defense in depth where practical, but do not rely on them to repair an unscoped privileged server query.
- Add integration tests proving that user A cannot list, read, rate, edit, undo, or delete user B's data.

## Test plan

### Colocation convention

- A test that primarily exercises one source file lives next to that file.
- Unit tests use `Name.test.ts` or `Name.test.tsx`.
- Tests requiring real Postgres, Supabase, or another external boundary use `Name.integration.test.ts`.
- Do not mirror the source tree under centralized `tests/unit` or `tests/integration` directories.
- Shared test helpers live beside the narrow slice that uses them; promote a helper to a small shared test-support module only when multiple independent slices genuinely share it.
- `tests/e2e` is the intentional exception because Playwright journeys exercise the assembled product rather than one source file.
- Configure Vitest projects/globs so ordinary unit runs exclude `*.integration.test.*`, while the integration command selects only those neighboring integration files.

### Pure cadence tests

Create table-driven tests for every phase/rating combination:

- exact `next_review_at` from a fixed clock;
- initial intervals;
- learning graduation;
- lapse interval reduction;
- Hard/Good/Easy multipliers;
- minimum and maximum interval clamps;
- review and lapse counts;
- scheduler version;
- input state remains immutable.

### Pure queue tests

- new cards always precede reviewed cards;
- new cards use deterministic `created_at, id` ordering;
- reviewed cards use deterministic `next_review_at, id` ordering;
- the 48-hour horizon is inclusive at the boundary;
- cards beyond the horizon are absent;
- suspended cards are absent;
- the limit truncates the working set without changing cadence state;
- future status uses server time;
- strict new-first ordering places an `Again` card behind remaining new cards.

### tRPC tests

Use `appRouter.createCaller()` with test contexts:

- unauthenticated procedures reject;
- Zod rejects malformed Markdown limits, UUIDs, ratings, versions, and horizons;
- procedures derive user identity from context;
- mutation responses contain a replacement queue;
- domain errors map to stable API codes.

### Repository integration tests

Run against local Supabase/Postgres:

- review event and card state commit together;
- transaction failure rolls both back;
- row lock/version check prevents stale writes;
- duplicate request ID is idempotent;
- undo restores exact prior state;
- undo rejects a non-latest active review;
- queue query applies ownership, suspension, ordering, horizon, and limit;
- all cross-tenant operations fail.

### Browser tests

- sign in with a provisioned email-and-password account;
- load a new-first queue;
- reveal Markdown front/back content;
- render Chinese and Pinyin correctly;
- rate all four outcomes and receive the new snapshot;
- distinguish future cards visually;
- undo the latest review;
- inspect review history, including an undone review;
- suspend a card;
- sign out and clear only ephemeral client state.

### CLI smoke tests

- password login stores a usable session without exposing the password;
- JSON output is valid and stable;
- queue, create, review, and undo call the same tRPC procedures as the frontend;
- failures use stderr and nonzero exit codes.

## Migration and implementation phases

### Phase 1: Freeze contracts

1. Convert this plan's domain types into Zod schemas.
2. Freeze Cadence v1 constants and behavior with table-driven tests.
3. Freeze new-first queue behavior with pure tests.
4. Define the tRPC input/output contracts and stable error codes.
5. Establish request ID, optimistic version, and queue snapshot conventions.

Acceptance:

- Domain tests describe every rating and queue boundary.
- No database or frontend code is needed to execute the domain tests.

### Phase 2: Create the new schema

1. Create a Supabase migration for decks, independent Markdown cards, review events, and card revisions.
2. Add ownership, cadence consistency, idempotency, and query indexes.
3. Regenerate TypeScript database types using the existing `npm run gen` workflow.
4. Add migration fixtures covering forward-only, reversible, new, reviewed, suspended, and logged cards.

Acceptance:

- Local migration succeeds from the current schema.
- Generated types match the migrated Postgres schema.
- Migration fixture assertions prove that no current cards or review states are lost.

### Phase 3: Implement the server

1. Add the single Supabase `api` Edge Function.
2. Add authenticated tRPC context using Supabase user JWTs.
3. Connect Postgres.js through the transaction pooler.
4. Implement tenant-scoped repositories.
5. Implement queue, rating, undo, content revision, and card CRUD services.
6. Add unit, tRPC caller, and local-Postgres integration tests.

Acceptance:

- All business decisions execute in TypeScript.
- Rating and undo are atomic and idempotent.
- Cross-tenant tests fail closed.
- Every queue-affecting mutation returns a replacement snapshot.

### Phase 4: Replace frontend data flow

1. Add Supabase email-and-password sign-in and session restoration.
2. Add the authenticated tRPC client.
3. Replace `useDeck` with a queue-snapshot hook.
4. Render both card sides as sanitized Markdown.
5. Add future-card visual treatment using server-provided time/status.
6. Move rating, undo, suspension, editing, creation, and deck operations to tRPC.
7. Add a per-card review-history view that shows ratings, timestamps, interval changes, resulting due dates, and undone entries.
8. Remove local sync status from the UI.

Acceptance:

- The actual app can authenticate, fetch, study, mutate, and undo entirely through tRPC.
- Mutation success replaces the local snapshot.
- Reload reconstructs the same state from the server.
- Review history remains readable after undo and clearly marks undone events.
- Browser verification covers the complete changed surface.

### Phase 5: Add the agent CLI

1. Implement password login, session refresh, secure credential storage, and logout.
2. Implement JSON-first deck, queue, card, review, and undo commands.
3. Reuse the tRPC client and Zod contracts.
4. Add CLI smoke coverage.

Acceptance:

- An agent can create independent reciprocal cards, search for duplicates, study, rate, and undo without browser-only functionality.
- The CLI contains no cadence or queue logic.

### Phase 6: Migrate production data and cut over

Use a short maintenance window because there are only two initial users. Avoid operating old and new write paths concurrently.

1. Take a verified export before destructive migration.
2. Create one deck row per existing `(user, deckName)`.
3. Convert every existing card into an independent Markdown forward card.
4. Materialize every existing reversible direction as a second independent card with a new UUID and swapped presentation.
5. Map forward state to the original card and reverse state to the materialized card.
6. Rewrite review-log card references so former reverse reviews target the new independent card.
7. Adapt retained card snapshots into content revisions.
8. Validate counts and representative schedules inside the migration.
9. Deploy migration, Edge Function, and frontend as one controlled cutover.
10. Smoke test both user accounts and representative decks.

Acceptance:

- Every old forward and reverse schedule has exactly one independent destination card.
- Existing review history remains attributable to the correct destination card.
- No old client writes occur after the migration begins.

### Phase 7: Remove obsolete architecture

Only after the new app smoke test succeeds:

1. Remove RxDB and Dexie dependencies.
2. Remove RxDB schemas and schema generator.
3. Remove Supabase replication and sync lifecycle.
4. Remove `useRxQuery` and client-side database hooks.
5. Remove `ts-fsrs` and every FSRS serialization adapter.
6. Remove direction, reverse-state, reversible-card, daily-limit, and review-order code.
7. Remove obsolete sync/settings screens and tests.
8. Move every surviving file-focused test beside its source file and remove the old centralized unit/integration test directories.
9. Remove old database tables, columns, triggers, policies, and publication entries.
10. Update deployment to push migrations, deploy the `api` function, and publish the static frontend.
11. Run focused unit, integration, CLI, and browser verification, followed by the repository's full pre-push suite.

Acceptance:

- No compatibility aliases, dual writes, deprecated endpoints, or legacy local data paths remain.
- Dependency and dead-code checks find no obsolete architecture.
- No file-focused test remains in a mirrored centralized test tree; only cross-cutting Playwright journeys remain under `tests/e2e`.

## Deployment

GitHub Actions should perform:

1. Install dependencies.
2. Run type checking and unit tests.
3. Start local Supabase and run migrations/integration tests where CI permits.
4. Run browser tests.
5. Push production database migrations.
6. Deploy the Supabase `api` Edge Function.
7. Export the Expo web app.
8. Deploy the static output to GitHub Pages.

Production secrets:

```text
SUPABASE_PROJECT_REF
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_URL            transaction-pooler connection for Edge Function
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY        server only
```

Never expose `SUPABASE_DB_URL` or the secret key to Expo build-time environment variables.

## Cost and operational constraints

The intended two-user workload should fit Supabase Free and GitHub Pages at $0/month. Relevant current Supabase Free allowances include 500,000 Edge Function invocations per month, 500 MB of database data, and 50,000 monthly active Auth users.

Known compromises:

- Free Supabase projects pause after one week of inactivity.
- Free projects do not include automatic database backups.
- Routine email-and-password sign-in does not require an email sender.
- Password recovery and self-service confirmation remain unavailable until custom SMTP is configured; the initial accounts are provisioned, confirmed, and recovered administratively.

Before cutover, decide whether the inactivity pause and lack of automatic backups are acceptable. Neither should change the application architecture.

## Completion criteria

The rewrite is complete when:

- both provisioned users authenticate with email and password;
- all requests are tenant-scoped;
- the frontend and CLI use the same tRPC API;
- new cards are always first and reviewed cards are time-ordered;
- every mutation returns and installs a fresh queue snapshot;
- reciprocal cards are ordinary independent Markdown cards;
- Chinese/Pinyin content and TTS metadata render correctly;
- Cadence v1 and undo are deterministic and fully tested;
- current data is migrated without loss;
- RxDB, replication, FSRS, virtual reverses, daily limits, and legacy code are deleted;
- focused verification and the full pre-push suite pass.
