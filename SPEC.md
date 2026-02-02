# Flashcards App Specification

## Overview

A local-first, git-powered spaced repetition flashcard app for vocabulary learning. Cards are created via Claude MCP and stored in a GitHub repository. Review sessions happen in a web app that clones the repo locally using IndexedDB, works offline, and syncs when ready.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Card Creation                             │
│                                                                  │
│   User → Claude (with GitHub MCP) → commits to cards.json       │
│   Or manually add/edit cards.json                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Data Repository (per user)                     │
│                                                                  │
│   flash-card-data/                                               │
│   ├── spanish-vocab/                                             │
│   │   ├── cards.json                                             │
│   │   └── state.json                                             │
│   └── spanish-verbs/                                             │
│       ├── cards.json                                             │
│       └── state.json                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                App Repository (shared, GitHub Pages)             │
│                                                                  │
│   flash-card/                                                    │
│   ├── src/                # webapp source                        │
│   ├── index.html          # webapp entry                         │
│   └── dist/               # built assets                         │
│                                                                  │
│   - Clones data repo to IndexedDB via isomorphic-git             │
│   - Reviews cards offline                                        │
│   - Commits locally after each card                              │
│   - Pushes on session end or manual sync                         │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### cards.json

```json
{
  "chabacano": {
    "id": "chabacano",
    "source": "chabacano",
    "translation": "apricot",
    "example": "Los chabacanos están en temporada en primavera.",
    "notes": "Common in Mexico, 'albaricoque' used in Spain",
    "tags": ["fruit", "mexico"],
    "created": "2025-02-01T10:00:00Z"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier, matches key |
| source | string | yes | Word/phrase in source language |
| translation | string | yes | Translation |
| example | string | no | Example sentence |
| notes | string | no | Additional context |
| tags | string[] | no | Tags for filtering |
| created | ISO8601 | yes | Creation timestamp |
| reversible | boolean | no | If true, also review back→front as a separate card (default false) |

### state.json

```json
{
  "chabacano": {
    "due": "2025-02-05T00:00:00Z",
    "stability": 4.2,
    "difficulty": 0.31,
    "elapsed_days": 3,
    "scheduled_days": 4,
    "reps": 3,
    "lapses": 0,
    "state": "Review",
    "last_review": "2025-02-01T10:30:00Z",
    "suspended": false
  }
}
```

This matches ts-fsrs Card type. Cards in cards.json without a state.json entry are new and should be initialized with `createEmptyCard()`.

State keys use the convention:
- `chabacano` — forward card (front→back)
- `chabacano:reverse` — reverse card (back→front), only exists if `reversible: true`

Reverse cards are virtual — generated at load time by CardStore, not stored in cards.json.

## Tech Stack

| Concern | Solution |
|---------|----------|
| Framework | React |
| UI Components | shadcn/ui (Radix + Tailwind) |
| Bundler | Vite (with vite-plugin-pwa) |
| Git operations | isomorphic-git |
| Local filesystem | @isomorphic-git/lightning-fs (IndexedDB) |
| Scheduling | ts-fsrs |
| Testing | Vitest + @testing-library |
| CSS | Tailwind CSS (via shadcn) |

## Card Creation Flow

Cards are created by Claude (via GitHub MCP), not by the web app.

### Process
1. Claude reads existing `cards.json` to check for duplicate keys
2. Creates a branch (e.g. `cards/fruit-vocab`)
3. Adds new entries to `cards.json` (does NOT touch `state.json`)
4. Opens a PR for user review
5. User merges PR on GitHub
6. Web app picks up new cards on next sync, initializes state via `createEmptyCard()`

### Deduplication
- Card ID = spanish word, so JSON key uniqueness prevents exact duplicates
- Claude must read existing `cards.json` before adding cards and skip existing keys
- Topics may overlap (e.g. "food" and "cooking" both have "cuchara") — Claude checks across all existing cards, not just the current batch

### Instructions
A `CLAUDE_INSTRUCTIONS.md` file in the repo defines:
- Card schema and required/optional fields
- Branch naming convention (`cards/<topic>`)
- PR format (list of added cards in description)
- Dedup rules (check existing keys, skip duplicates)
- Batch size guidelines
- Commit message format: one commit per card, e.g. `add card: chabacano (apricot)`

### Future: Custom MCP
If the instructions-based approach proves error-prone, build a lightweight MCP server that:
- Validates card schema before committing
- Automates dedup checks
- Enforces PR conventions
- Works with Claude Code (no desktop required)

## Core Modules

### 1. GitService

Handles all git operations via isomorphic-git.

```typescript
interface GitService {
  // Setup
  init(repoUrl: string, token: string): Promise<void>;
  isInitialized(): boolean;

  // Sync
  clone(): Promise<void>;
  pull(): Promise<void>;
  push(): Promise<void>;

  // File operations
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;

  // Commits
  commit(message: string): Promise<void>;
  hasUnpushedCommits(): Promise<boolean>;

  // Status
  getStatus(): Promise<'synced' | 'ahead' | 'behind' | 'diverged'>;
}
```

**Implementation notes:**
- Store repo URL and token in localStorage
- Clone to `/repo` in LightningFS
- Handle auth via `onAuth` callback
- Detect conflicts on pull, surface to user

### 2. CardStore

Manages card data and state.

```typescript
interface Card {
  id: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
}

interface CardState {
  // ts-fsrs Card fields
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: Date;
  suspended: boolean;  // default false, excluded from review queue when true
}

interface CardStore {
  // Load from git repo
  load(): Promise<void>;

  // Getters
  getAllCards(): Card[];
  getCard(id: string): Card | undefined;
  getState(id: string): CardState;
  getDueCards(): Card[];
  getNewCards(): Card[];

  // Review
  reviewCard(id: string, rating: Rating): CardState;
  suspendCard(id: string): void;
  unsuspendCard(id: string): void;

  // Persistence
  save(): Promise<void>;  // writes state.json, commits
}
```

**Implementation notes:**
- Initialize missing state entries with `createEmptyCard()`
- For cards with `reversible: true`, generate a virtual reverse card (swap source/translation) keyed as `id:reverse`
- Reverse cards have independent SRS state in state.json
- After each review, update in-memory state AND write to localStorage (write-ahead)
- `save()` writes state.json to git fs, commits
- Commit messages are explicit: `review: chabacano (Good) — next due 2025-02-05`
- For reverse cards: `review: chabacano:reverse (Again) — next due 2025-02-02`

### 3. ReviewSession

Manages active review session.

```typescript
interface ReviewSession {
  // Lifecycle
  start(): void;
  end(): Promise<void>;  // commits + pushes

  // Cards
  getCurrentCard(): Card | null;
  getProgress(): { done: number; remaining: number; total: number };

  // Actions
  showAnswer(): void;
  rate(rating: Rating): void;  // commits with message: "review: {id} ({rating}) — next due {date}"
  skip(): void;

  // State
  isActive(): boolean;
}
```

**Daily limits:**
- New cards capped per day (default 10), tracked in localStorage with today's date
- If the date changes, counter resets
- Reviews are uncapped — skipping due cards hurts FSRS scheduling
- Multiple sessions in one day share the same new card budget
- Tracked in localStorage, so switching devices resets the count (acceptable for personal use)
- "More new cards" button in UI to add another batch if you want to keep going

**Card order strategy:**
1. Shuffle due cards
2. Interleave new cards (1 new per 5 reviews, configurable)
3. New cards initialized and immediately reviewable

### 4. SyncManager

Handles sync status and recovery.

```typescript
interface SyncManager {
  // Status
  getStatus(): 'synced' | 'pending' | 'offline' | 'conflict';
  getPendingCommits(): number;

  // Actions
  sync(): Promise<SyncResult>;

  // Recovery
  recoverFromLocalStorage(): Promise<void>;
}

type SyncResult =
  | { status: 'ok' }
  | { status: 'conflict'; branch: string };  // e.g. "sync/2025-02-01T10-30-00Z"
```

**Implementation notes:**
- On app start, check localStorage for uncommitted reviews
- If found, apply them to state.json before doing anything else
- Track online/offline status via `navigator.onLine`

**Conflict strategy:**
- On push failure (non-fast-forward), do NOT force push or try to merge
- Instead, push local commits to a timestamped branch: `sync/<ISO-timestamp>`
- Show the user a message: "Conflict detected. Your reviews were pushed to branch `sync/...`. Merge it on GitHub when ready."
- After pushing to the conflict branch, reset local to track remote main again (re-pull)
- This keeps main always clean and lets you resolve via GitHub PR/merge

### 5. SettingsStore

Manages user settings.

```typescript
interface Settings {
  repoUrl: string;  // e.g. github.com/user/flashcards
  token: string;  // fine-grained PAT with contents: read/write on the repo
  newCardsPerDay: number;  // default 10
  reviewOrder: 'random' | 'oldest-first' | 'deck-grouped';
  theme: 'light' | 'dark' | 'system';
}

interface SettingsStore {
  get(): Settings;
  set(settings: Partial<Settings>): void;
  clear(): void;  // logout
  isConfigured(): boolean;
}
```

Storage: localStorage (never committed to repo)

## UI Components

### Screens

1. **Auth Screen** (first run)
   - Repo URL input (e.g. `github.com/user/flashcards`)
   - PAT input (with help text: needs `contents: read/write` on that repo)
   - App validates token has access to the repo
   - Clone progress indicator

2. **Deck List Screen** (home)
   - List of decks (directories in data repo)
   - Each deck shows: due count, new count
   - Click a deck to start review session
   - Sync status indicator
   - "Sync" button
   - Settings gear

3. **Review Screen**
   - Prompt side (centered, large) — source or translation depending on direction
   - "Show Answer" button
   - Answer side + example + notes (after reveal)
   - Rating buttons: Again / Hard / Good / Easy
   - Progress bar
   - "End Session" button

4. **Settings Screen**
   - Repo URL (read-only after setup)
   - New cards per day slider
   - Review order dropdown
   - Theme toggle
   - "Logout" button (clears everything)
   - Debug info (commit count, last sync, etc)

### Components

```
App
├── AuthScreen
├── DeckListScreen
│   ├── SyncStatus
│   ├── DeckCard (per deck: name, due count, new count)
│   └── ActionButtons
├── ReviewScreen
│   ├── CardDisplay
│   ├── AnswerReveal
│   ├── RatingButtons
│   └── ProgressBar
└── SettingsScreen
```

## Offline Behavior

| Scenario | Behavior |
|----------|----------|
| Open app offline | Works, reads from IndexedDB |
| Review offline | Works, commits locally |
| Try to sync offline | Show "offline" status, queue for later |
| Come back online | Auto-sync or prompt user |
| New cards added while offline | Won't see until next pull |

## Error Handling

| Error | Handling |
|-------|----------|
| Clone fails | Show error, let user retry, check token |
| Push fails (auth) | Prompt to re-enter token |
| Push fails (conflict) | Push to `sync/<timestamp>` branch, notify user to merge on GitHub |
| Corrupt localStorage | Clear and re-clone |
| Corrupt IndexedDB | Clear and re-clone |
| Network timeout | Retry with backoff, show status |

## Testing Strategy

### Test Environment

- Before each test run: create a temporary branch from `main`, layer fixture data on top
- Tests clone that branch — always testing against the current schema from `main`
- After tests: delete the temporary branch
- No separate test repo needed

### Unit Tests (Vitest)

```
tests/
├── unit/
│   ├── card-store.test.ts      # card loading, state management
│   ├── review-session.test.ts  # session logic, card ordering
│   ├── fsrs-integration.test.ts # scheduling calculations
│   └── sync-manager.test.ts    # recovery, conflict detection
```

**Mocking strategy:**
- Mock isomorphic-git for unit tests
- Mock LightningFS with in-memory implementation
- Use real ts-fsrs (it's pure functions)

### Integration Tests

```
tests/
├── integration/
│   ├── git-operations.test.ts  # real git ops against test repo
│   ├── full-review-flow.test.ts # complete session simulation
│   └── offline-sync.test.ts    # offline/online transitions
```

**Test branch setup:**
- Create temp branch from `main`, apply fixtures, run tests, delete branch

### E2E Tests (Playwright)

```
tests/
├── e2e/
│   ├── setup-flow.spec.ts      # first-run experience
│   ├── review-session.spec.ts  # full review cycle
│   └── sync-conflicts.spec.ts  # conflict resolution UI
```

### Test Data Fixtures

```typescript
// tests/fixtures/cards.ts
export const testCards = {
  "test-card-1": {
    id: "test-card-1",
    source: "hola",
    translation: "hello",
    deck: "test",
    created: "2025-01-01T00:00:00Z"
  },
  // ... more fixture cards
};

// tests/fixtures/state.ts
export const testState = {
  "test-card-1": {
    due: "2025-02-01T00:00:00Z",
    stability: 2.5,
    difficulty: 0.3,
    // ... full FSRS state
  }
};
```

### Debug Mode

Environment variable `VITE_DEBUG=true` enables:

1. **Test repo toggle** - Switch between prod and test repo
2. **Time travel** - Override "now" for testing scheduling
3. **State inspector** - View raw state.json in UI
4. **Git log** - View recent commits in UI
5. **Reset button** - Clear IndexedDB and localStorage
6. **Network simulation** - Force offline mode

```typescript
// src/config.ts
export const config = {
  debug: import.meta.env.VITE_DEBUG === 'true',
  testBranch: 'test-fixtures',
};
```

### CI Pipeline (GitHub Actions)

```yaml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run validate:schema  # validate cards.json + state.json
      - run: npm run test:unit
      - run: npm run test:integration
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npm run test:e2e
```

### Schema Validation

Run on every push and PR to catch malformed data early — especially useful since Claude is writing `cards.json` via PRs.

Validates:
- `cards.json` — all required fields present, correct types, IDs match keys
- `state.json` — valid FSRS fields, keys reference existing cards (or `card:reverse` for reversible cards)
- No orphaned state entries (state exists but card was deleted)

Implemented as a Vitest test or standalone script (`npm run validate:schema`) that can run in CI and locally.

## File Structure

### App repo (flash-card)
```
flash-card/
├── .github/
│   └── workflows/
│       └── test.yml
├── src/
│   ├── main.tsx                # entry point
│   ├── config.ts               # environment config
│   ├── services/
│   │   ├── git-service.ts
│   │   ├── card-store.ts
│   │   ├── review-session.ts
│   │   ├── sync-manager.ts
│   │   └── settings-store.ts
│   ├── components/
│   │   ├── ui/              # shadcn components
│   │   ├── App.tsx
│   │   ├── AuthScreen.tsx
│   │   ├── DeckListScreen.tsx
│   │   ├── ReviewScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── utils/
│   │   ├── fsrs.ts             # ts-fsrs wrapper
│   │   └── date.ts
│   └── styles/
│       └── main.css
├── tests/
│   ├── fixtures/
│   │   ├── cards.ts
│   │   └── state.ts
│   ├── mocks/
│   │   ├── git-service.mock.ts
│   │   └── lightning-fs.mock.ts
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Data repo (per user, e.g. flash-card-data)
```
flash-card-data/
├── spanish-vocab/
│   ├── cards.json
│   └── state.json
└── spanish-verbs/
    ├── cards.json
    └── state.json
```

## Implementation Order

### Phase 1: Core (MVP)
1. Project setup (Vite, TypeScript, deps)
2. GitService with isomorphic-git
3. CardStore with ts-fsrs
4. Basic ReviewSession
5. Minimal UI (setup + review only)
6. PWA setup (vite-plugin-pwa, manifest, service worker)
7. Unit tests for core logic

### Phase 2: Polish
1. SyncManager with conflict handling
2. SettingsStore
3. Full UI with all screens
4. Offline indicators
5. Integration tests

### Phase 3: DX & Testing
1. Debug mode features
2. E2E tests
3. CI pipeline
4. Error boundaries and recovery

## Open Questions

1. **Card order in review** - Random? Oldest due first? Configurable?
2. **Multiple decks** - Filter by deck in UI, or always review all?
3. **Stats/history** - Track review history for charts? (adds complexity)
4. ~~**PWA** - Add service worker for true installability?~~ — Yes, included in Phase 1

## Security Considerations

- Fine-grained PAT scoped to single repo, `contents: read/write` only
- PAT stored in localStorage (acceptable for personal use)
- Never commit PAT to repo
- HTTPS only (GitHub Pages enforces this)
- CSP headers to prevent XSS

## Dependencies

```json
{
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "isomorphic-git": "^1.25.0",
    "@isomorphic-git/lightning-fs": "^4.6.0",
    "ts-fsrs": "^4.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "@playwright/test": "^1.40.0",
    "@testing-library/react": "^14.0.0",
    "vite-plugin-pwa": "^0.17.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0"
  }
}
```

Keep dependencies minimal beyond React + shadcn/ui.
