# Flash Card Client Completion Plan

## Current state

The backend and shared authenticated tRPC client are complete. The accepted
foundation includes the Postgres schema and migrations, domain policies,
authenticated Edge Function routers, authorization, transactions, and backend
test coverage.

Backend development is closed. Change it only when client implementation
exposes a concrete contract defect. Reproduce any such defect with a focused
backend regression test and make the smallest necessary correction.

The remaining implementation has two independent workstreams:

1. the Expo Router/React Native Web application;
2. the agent-facing TypeScript CLI.

Each workstream runs in its own worktree. Its agent owns detailed design,
implementation sequencing, dependency selection, and local verification within
the constraints below.

## Shared constraints

- Reuse the existing authenticated tRPC client and exported `AppRouter` type.
- Supabase Auth owns email/password sign-in, refresh, and sign-out.
- Postgres remains the only durable application-data source.
- Keep cadence, queue construction and ordering, authorization, optimistic
  concurrency policy, and undo behavior out of both clients.
- Install server-returned replacement queues verbatim rather than patching or
  recalculating them.
- Send the latest server-issued version for optimistic mutations.
- Preserve one request ID for each logical review-rating attempt.
- Do not add automatic mutation retries.
- Never expose credentials, tokens, database URLs, service-role keys, JWT
  secrets, deployment tokens, or acceptance-test secrets.
- Do not restore RxDB, replication, FSRS, reverse-card state, daily limits,
  persistent study sessions, OAuth, public signup, or legacy client workflows.
- Do not perform production migrations or deployments without explicit
  operator authorization.

## App frontend worktree

Build the complete user-facing Expo application against the existing API.

Product scope:

- session restoration, email/password login, protected navigation, and
  sign-out;
- deck listing and management;
- authoritative study queues, reveal, the four supported ratings, undo, and
  clear new/due/future presentation;
- card search, creation, editing, suspension, restoration, and confirmed
  removal;
- review history, revision history, and confirmed revision rollback;
- safe Markdown, semantic ruby/Pinyin presentation, and TTS;
- loading, empty, conflict, and server-error states.

The queue lives only in React memory. The app must refetch when its current
server view may be stale and must not issue per-card requests to render a queue.

Completion requires exercising the actual application against local Supabase
and the served Edge Function, including authentication, deck and card
management, studying, history, rollback, hostile Markdown handling, reload, and
sign-out. The Expo web export and repository checks must pass.

## CLI worktree

Build the packaged `flashcard` executable against the same authenticated API.

Product scope:

- secure login, restored and refreshed sessions, session inspection, and
  logout;
- deck listing and management;
- queue fetching;
- card search and management;
- revision listing and rollback;
- review rating, history, and undo;
- explicit confirmation for destructive commands;
- stable machine-readable success and failure behavior.

Passwords must not be accepted through command arguments. Credentials should
use the operating-system credential store when available, with an explicitly
selected user-private fallback when necessary. Successful stdout is one JSON
document; diagnostics and structured errors go to stderr; failures return a
nonzero status.

Completion requires exercising the actual CLI against local Supabase and the
served Edge Function, including secure login, session refresh, representative
deck/card/review workflows, JSON output, failure behavior, and credential
removal on logout. Repository checks must pass.

## Coordination and completion

The two workstreams may proceed in parallel from the commit containing the
shared tRPC client. Neither should create a second transport, duplicate API
types, or redesign the backend.

Shared-client changes require a concrete need discovered by one of the clients
and must remain runtime-neutral so both consumers retain the same transport and
type contract.

After both worktrees are complete, merge them and perform one assembled-product
verification pass covering the app, CLI, existing backend suites, Expo export,
type checking, and dead-code checking. Cross-cutting browser journeys may be
added during this integration pass where they protect real user workflows.

There is no third active implementation workstream. Production preparation and
operator-gated rollout remain later work.
