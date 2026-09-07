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

## TTS design

### Accepted product behavior

- Use `expo-speech` as the single Android, iOS, and web speech adapter.
- Store one speech configuration per logical card, not one per cadence
  direction.
- Associate that configuration with the card's canonical `front` or `back`
  side. A reverse queue item swaps the association together with its rendered
  content.
- Render a pronunciation button only while its associated side is visible.
  This prevents a reverse prompt from exposing its hidden answer through
  audio.
- Start speech only from an explicit button press. Do not add autoplay.
- Resolve the language as
  `card.speechLocale ?? deck.defaultSpeechLocale`; the card value is an override.
- If neither locale resolves, do not offer playback. Never silently use the
  device language for foreign-language content.

### Shared data contract

Define shared `SpeechLocaleSchema` and `SpeechSideSchema` values and reuse them
in card, deck, API, and revision schemas. A speech locale is a validated,
canonicalized BCP 47 language tag rather than a closed list of known locales.
`SpeechSide` is `'front' | 'back'`.

Cards retain the existing nullable `speechText` and `speechLocale` fields and
gain nullable `speechSide`:

```ts
interface CardSpeechFields {
  speechText: string | null;
  speechLocale: SpeechLocale | null;
  speechSide: 'front' | 'back' | null;
}
```

The invariants are:

- absent speech: text, locale override, and side are all `null`;
- configured speech: non-empty text and a non-null side are required;
- configured speech may leave `speechLocale` null to inherit the deck locale;
- `speechLocale` without `speechText` is invalid.

In a canonical `Card`, `speechSide` refers to `frontMarkdown` or
`backMarkdown`. In a `QueueItem`, it refers to the already direction-adjusted
`frontMarkdown` or `backMarkdown`. Queue construction therefore swaps
`speechSide` when it swaps content for a reverse cadence:

```ts
const renderedSpeechSide =
  direction === 'forward' ? card.speechSide
  : card.speechSide === 'front' ? 'back'
  : card.speechSide === 'back' ? 'front'
  : null;
```

This keeps presentation components independent of cadence-direction logic.

### Persistence and API

- Add nullable `cards.speech_side` using the existing text-plus-check
  convention.
- Add a database constraint enforcing the card speech-field invariants.
- Backfill existing speech-enabled cards to `speech_side = 'front'`, matching
  the legacy TTS behavior; leave speech-disabled cards null.
- Backfill stored card revision JSON with the same rule before making the
  revised `CardContentSchema` authoritative.
- Include `speechSide` in card creation, editing, revision recording,
  revision retrieval, rollback, aggregation, search, and queue responses.
- Keep `decks.default_speech_locale`. Extend deck editing so users can change
  it after deck creation.
- Apply the same BCP 47 validation to deck defaults and card overrides.
- Keep locale resolution in the client composition layer; do not persist the
  resolved locale onto cards or rewrite cards when a deck default changes.

### Deck and card forms

These are fields in the application's normal deck and card create/edit forms,
not a separate UI. Those management screens are already part of the frontend
product scope but have not been implemented yet.

- Deck create/edit forms expose an optional **Default speech locale** field.
- Card create/edit forms expose an optional speech section containing:
  **Text to speak**, **Side** (`Front` or `Back`), and **Locale override**.
- The locale override control clearly displays when it will use the current
  deck default.
- Clearing speech text clears its side and locale override.
- Speech text is plain text, independent of Markdown or ruby presentation, so
  authors can provide the exact pronunciation input.

### Playback and study UI

- Install the Expo-SDK-compatible `expo-speech` package.
- Add one application speech controller around `Speech.speak` and
  `Speech.stop`; do not call browser or native speech APIs directly.
- Before starting an utterance, stop the active utterance so repeated taps
  restart rather than queue audio.
- Pass only the resolved BCP 47 locale as Expo's `language` option. Do not
  persist or synchronize platform-specific voice identifiers.
- Stop speech on card changes, study-screen unmount, session exit, and app
  backgrounding.
- Track start, completion, stop, and error callbacks so the button can expose
  speaking state and synthesis failures can use existing feedback UI.
- Render an accessible **Play pronunciation** control beside the visible side
  selected by `QueueItem.speechSide`. A back-side control does not exist in
  the tree until the answer is revealed.
- Do not restore the legacy study-time locale picker or per-device
  `AsyncStorage` locale setting.

### Implementation sequence

1. Add shared locale and side schemas plus card invariants and focused domain
   tests.
2. Generate a forward Drizzle migration, then add and inspect the card and
   revision backfills and database checks before applying it.
3. Migrate card and deck API inputs, outputs, revisions, rollback, fixtures,
   and callers as a clean cutover.
4. Make `StudyQueue` swap `speechSide` with reverse content and cover all
   front/back and forward/reverse combinations.
5. Add deck-default and card-speech authoring controls.
6. Install `expo-speech` and implement the lifecycle-safe speech controller.
7. Add the study-card pronunciation control and error feedback.
8. Update local seed cards with explicit speech text and canonical side so the
   real study flow exercises both queue directions.

### Verification

- Domain tests reject malformed locales and incomplete speech
  configurations.
- Queue tests prove the side association moves with content in both cadence
  directions.
- Backend acceptance tests prove create, update, search, revision retrieval,
  rollback, deck-default preservation, and optimistic concurrency retain the
  complete speech configuration.
- Component behavior proves hidden answer-side audio cannot be invoked before
  reveal and proves playback receives the card override before the deck
  default.
- Exercise the served web application with real browser speech synthesis,
  including repeated playback, reveal, rating, card transition, and session
  exit.
- Smoke-test the same flow on Android and iOS through Expo, accepting
  platform-dependent voices and the documented iOS silent-mode behavior.

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
