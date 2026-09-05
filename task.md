# Flash Card Completion Checklist

## Objective

Complete the application described in [`plan.md`](./plan.md). The backend is closed: its schema, domain policies, vertical tRPC routers, authorization, transactions, and HTTP acceptance coverage are the accepted foundation.

Active work is limited to the shared API client, frontend, CLI, assembled-product verification, and production readiness. Do not redesign backend layers or restore deleted legacy architecture. If client integration exposes a concrete backend contract defect, add a focused backend regression test and make only the smallest contract correction.

## Working rules

- Read `plan.md` before implementation.
- Follow `agent.md` for schema and verification commands.
- Use the exported `AppRouter` type and canonical domain schemas; do not duplicate DTOs.
- Keep cadence, queue construction, authorization, optimistic-concurrency policy, and undo behavior out of clients.
- Keep the frontend queue only in React memory.
- Never restore RxDB, replication, FSRS, reverse-card state, daily limits, persistent study sessions, GitHub authentication, or client-side mutation reconciliation.
- Treat `nextReviewAt` as the sole queue-eligibility timestamp; do not introduce a cadence phase.
- Preserve the fixed 12-hour studied-card horizon and studied-before-new ordering.
- Never expose a database URL, JWT secret, service-role key, deployment token, or acceptance clock secret to frontend or CLI output.
- Do not modify production data or deploy production without explicit operator authorization.
- Check an item only after its observable behavior is implemented and verified.

## Phase 1 — Shared authenticated API client

- [ ] Add the tRPC client dependency required by frontend and CLI.
- [ ] Implement one typed client factory using `AppRouter` and a dynamic access-token provider.
- [ ] Validate frontend public configuration for Supabase URL, publishable key, and API URL.
- [ ] Validate equivalent CLI configuration without using Expo environment access.
- [ ] Attach the current bearer token to every tRPC request.
- [ ] Refresh an unauthorized Supabase session once and retry once.
- [ ] Clear the session after a second unauthorized response.
- [ ] Do not add automatic mutation retries; preserve one request ID for deliberate review replay.
- [ ] Confirm browser and Node callers share transport/type code without sharing credential persistence.
- [ ] Confirm client bundles cannot import server runtime values or database code.

### Phase 1 verification

- [ ] Call `auth.session` through the shared client with a real local user token.
- [ ] Exercise the one-refresh unauthorized path.
- [ ] Prove a missing session does not send a stale bearer token.
- [ ] Run type checking and dead-code checking for the client foundation.

## Phase 2 — Frontend reconstruction

### Application shell and authentication

- [ ] Restore the Expo Router application shell for web and native.
- [ ] Add the frontend Supabase Auth client using public environment values only.
- [ ] Implement email/password sign-in with `signInWithPassword()`.
- [ ] Restore and refresh the Supabase session on startup.
- [ ] Confirm authenticated entry with `auth.session`.
- [ ] Protect application routes and redirect unauthenticated users to sign-in.
- [ ] Implement sign-out that clears auth and ephemeral React state only.
- [ ] Exclude signup, OAuth, magic-link, recovery, and confirmation UI.
- [ ] Add consistent loading and server-error presentation.

### Deck workflow

- [ ] List decks without issuing per-deck queue requests for counts.
- [ ] Create decks with optional default speech locale.
- [ ] Rename decks using the last server-issued version.
- [ ] Remove decks only after explicit confirmation.
- [ ] Navigate using deck IDs rather than deck names.
- [ ] Handle loading, empty, stale-version, and error states.

### Study workflow

- [ ] Implement `useStudyQueue` with only the current snapshot and request state.
- [ ] Fetch `deck.queue` on screen entry.
- [ ] Refetch on screen focus, application foreground, reconnect, and return from management.
- [ ] Render complete queue card content without an N+1 `card.get` call.
- [ ] Implement front, reveal, and back interaction.
- [ ] Visually distinguish `new`, `due`, and `future` status.
- [ ] Offer exactly Again, Hard, Good, and Easy after reveal.
- [ ] Do not calculate schedule previews in the client.
- [ ] Generate and retain one request ID for each pending logical rating.
- [ ] Disable duplicate rating and queue mutation actions while pending.
- [ ] Replace local queue state with every successful rate response.
- [ ] Replace local queue state with every successful undo response.
- [ ] Replace local queue state with every successful suspend, restore, or remove response.
- [ ] Retain the previous confirmed snapshot and show errors on failed mutations.
- [ ] Reset reveal and pending state when the active card changes.
- [ ] Show an empty working-set state without describing a daily limit.

### Card management and histories

- [ ] Search through `card.search` with server pagination.
- [ ] Create one independent card at a time.
- [ ] Edit card name, Markdown, tags, and speech metadata.
- [ ] Send the latest server-issued version for card mutations.
- [ ] Show conflicts and refetch instead of overwriting newer data.
- [ ] Suspend and restore cards.
- [ ] Permanently remove cards only after confirmation.
- [ ] Display review history newest first, including visibly undone events.
- [ ] Display rating time, interval transition, and resulting due time.
- [ ] Display content revisions newest first.
- [ ] Roll back a selected revision with confirmation.
- [ ] Refetch management data after create, update, and rollback.
- [ ] Invalidate the affected study queue for its next focus.

### Markdown, ruby, and TTS

- [ ] Select the smallest Markdown/sanitizer stack that works in an Expo web and native spike.
- [ ] Use one Markdown semantics path across web and native.
- [ ] Sanitize output with an explicit allowlist.
- [ ] Permit raw `ruby`, `rt`, and optional `rp` only.
- [ ] Remove scripts, iframes, event handlers, arbitrary styles, unsafe URLs, and unapproved raw HTML.
- [ ] Render semantic ruby markup on web.
- [ ] Render Pinyin above Hanzi on native.
- [ ] Use card speech text with sanitized visible-text fallback.
- [ ] Resolve locale from card metadata, deck default, then optional device-local preference.
- [ ] Add focused renderer coverage for valid Markdown, ruby, and hostile HTML.

### Phase 2 verification

- [ ] Run the actual app against local Supabase and the served Edge Function.
- [ ] Verify login, restored session, refresh, protected routes, and sign-out.
- [ ] Verify deck create, rename, and confirmed removal.
- [ ] Verify card search, create, edit, suspend, restore, rollback, and removal.
- [ ] Verify studied-first 12-hour queue behavior, reveal, all four ratings, and replacement snapshots.
- [ ] Verify future cards inside the 12-hour horizon are visually distinct.
- [ ] Verify undo restores the queue and history marks the event undone.
- [ ] Verify revision history and rollback through the UI.
- [ ] Verify ruby visually on web and native.
- [ ] Verify hostile HTML does not execute or render.
- [ ] Reload and confirm application state reconstructs from Postgres.
- [ ] Run Expo web export, type checking, and dead-code checking.

## Phase 3 — Agent-facing CLI

### Executable and authentication

- [ ] Add a packaged TypeScript `flashcard` executable.
- [ ] Reuse the shared tRPC transport and canonical API types.
- [ ] Implement email/password login using a protected prompt, stdin, or dedicated environment variable.
- [ ] Reject passwords supplied through command arguments.
- [ ] Store access and refresh credentials in the operating-system credential store when available.
- [ ] Add only an explicit user-private fallback with restrictive permissions when credential storage is unavailable.
- [ ] Refresh sessions and update stored credentials atomically.
- [ ] Implement logout that removes stored credentials.

### Commands and output

- [ ] Implement auth session/login/logout commands.
- [ ] Implement deck list/create/rename/remove commands.
- [ ] Implement queue fetch.
- [ ] Implement card get/search/create/update/suspend/restore/remove commands.
- [ ] Implement revision list/rollback commands.
- [ ] Implement review rate/history/undo commands.
- [ ] Require an explicit confirmation flag for destructive commands.
- [ ] Generate a review request ID unless one is supplied for deliberate replay.
- [ ] Emit one stable JSON document on successful stdout.
- [ ] Emit diagnostics and structured application errors on stderr.
- [ ] Return nonzero status on failure.
- [ ] Preserve server error/application codes and conflict context.
- [ ] Never output credentials, tokens, service keys, or database URLs.
- [ ] Confirm no cadence, queue ordering, authorization, or undo business rule exists in CLI code.

### Phase 3 verification

- [ ] Log in through the actual CLI without exposing the password.
- [ ] Restore and refresh the stored session.
- [ ] Create independent reciprocal cards and search for duplicates.
- [ ] List decks, fetch a queue, rate, inspect history, and undo.
- [ ] Edit, suspend, restore, revise, rollback, and remove a card.
- [ ] Validate successful stdout as JSON.
- [ ] Validate failure stderr and nonzero status.
- [ ] Log out and prove stored credentials are removed.
- [ ] Run type checking and dead-code checking for the CLI.

## Phase 4 — Browser journeys and complete local verification

- [ ] Restore Playwright configuration for the actual Expo web application.
- [ ] Add an email/password login and restored-session journey.
- [ ] Add deck and card management journeys.
- [ ] Add the studied-first 12-hour queue and Markdown reveal journey.
- [ ] Cover all four ratings and replacement queue behavior.
- [ ] Cover future-card styling inside the fixed horizon.
- [ ] Cover undo and visibly undone review history.
- [ ] Cover suspension and queue removal.
- [ ] Cover revision history and rollback.
- [ ] Cover ruby/Pinyin rendering and hostile HTML rejection.
- [ ] Cover sign-out and protected-route redirect.
- [ ] Keep Playwright journeys cross-cutting; do not duplicate backend acceptance assertions.

### Phase 4 verification

- [ ] Run domain unit tests.
- [ ] Run schema/integration tests.
- [ ] Run the real-HTTP backend acceptance suite.
- [ ] Run the CLI smoke scenario.
- [ ] Run all Playwright journeys against the actual app.
- [ ] Run the Expo web export.
- [ ] Run TypeScript and Knip.
- [ ] Confirm no legacy client architecture or unused dependency was restored.

## Phase 5 — Production readiness

### CI and deployment preparation

- [ ] Make validation complete before any production migration or deployment job.
- [ ] Add deployment of the Supabase `api` Edge Function.
- [ ] Supply only public Supabase/API values to the Expo build.
- [ ] Set exact production CORS origins.
- [ ] Keep database URLs and server secrets out of frontend artifacts and CLI output.
- [ ] Ensure the acceptance test-clock secret is absent from production.
- [ ] Add GitHub environment approval for the initial production cutover.
- [ ] Package the CLI from the same reviewed revision as the API and frontend.
- [ ] Document the exact local and CI verification commands in repository guidance.

### Auth and operational preparation

- [ ] Disable production public signup.
- [ ] Disable GitHub and all unused OAuth providers.
- [ ] Provision and confirm the two initial email/password users administratively.
- [ ] Verify production site URL and redirect allowlist.
- [ ] Verify production Edge Function database and CORS secrets.
- [ ] Confirm administrator-operated recovery is acceptable without SMTP.
- [ ] Confirm Supabase Free inactivity-pause and backup limitations are accepted.

## Production cutover — operator-gated

Do not mark or execute these without explicit operator authorization.

- [ ] Take and verify a production database export.
- [ ] Start a maintenance window and prevent old-client writes.
- [ ] Apply the tested production migrations.
- [ ] Validate deck, card, cadence, review, and revision counts.
- [ ] Deploy the `api` Edge Function and server-only secrets.
- [ ] Deploy the matching static frontend.
- [ ] Publish the matching CLI release.
- [ ] Smoke test both provisioned accounts and representative decks.
- [ ] Confirm no old write path remains.
- [ ] End the maintenance window.

## Definition of done

- [ ] Frontend and CLI authenticate through Supabase and use the same typed tRPC API.
- [ ] Postgres is the only durable application-data source.
- [ ] No client contains cadence, queue ordering, ownership, or undo business rules.
- [ ] Frontend deck, study, card, history, revision, TTS, and safe Markdown workflows pass on the actual surface.
- [ ] CLI commands pass against the actual Edge Function with secure stable JSON behavior.
- [ ] Unit, integration, backend acceptance, CLI, build, type/dead-code, and browser verification pass.
- [ ] Production client artifacts contain no server secrets.
- [ ] Remaining production-only actions are explicitly operator-gated.
- [ ] No RxDB, replication, FSRS, reverse-card, daily-limit, persistent-study-session, compatibility, or dual-write path exists.
