# Flash Card Data Repository Setup

This guide explains how to create, populate, and connect a flash card data repository for use with the [flash-card app](https://github.com/nickwang0808/flash-card).

## Data Repo Structure

A data repo is a GitHub repository containing one directory per deck, each with a `cards.json` file:

```
my-flashcards/
  README.md
  spanish-vocab/
    README.md
    cards.json
  javascript-fundamentals/
    README.md
    cards.json
```

- Each top-level directory is a deck (the directory name becomes the deck name).
- Each deck contains exactly one `cards.json` file.
- Each deck should have a `README.md` with deck-specific instructions (see below).
- Directories starting with `.` are ignored.

## `cards.json` Format (v2)

Each `cards.json` is a JSON object where **keys are the raw terms** (used for TTS and as the default front side). Values are card objects.

### Schema Reference

Add a `$schema` key at the top of each `cards.json` for editor validation:

```json
{
  "$schema": "https://raw.githubusercontent.com/nickwang0808/flash-card/master/schema/cards.schema.json"
}
```

### Card Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `back` | string | Yes | Markdown content for the back (answer) side |
| `created` | string | Yes | ISO 8601 datetime (e.g. `"2025-01-15T00:00:00.000Z"`) |
| `front` | string | No | Markdown for the front side; defaults to the JSON key if omitted |
| `tags` | string[] | No | Tags for filtering/organizing |
| `reversible` | boolean | No | If `true`, the card can also be studied back-to-front |
| `state` | object/null | No | FSRS scheduling state (managed by the app, do not set manually) |
| `reverseState` | object/null | No | FSRS state for reverse direction (managed by the app) |
| `suspended` | boolean | No | If `true`, the card is excluded from review |

### Examples

#### Simple vocab card (key = front side)

The JSON key `"hola"` is displayed on the front. No `front` field needed.

```json
{
  "hola": {
    "back": "hello",
    "created": "2025-01-15T00:00:00.000Z"
  }
}
```

#### Card with custom `front` markdown

Use `front` when you want richer content than the plain key:

```json
{
  "hacer": {
    "front": "**hacer** (irregular verb)",
    "back": "to do / to make\n\n*Yo hago mi tarea todos los días.*",
    "created": "2025-01-15T00:00:00.000Z"
  }
}
```

#### Reversible card

Set `reversible: true` to also study in the back-to-front direction. This creates two study items from one card.

```json
{
  "gato": {
    "back": "cat",
    "created": "2025-01-15T00:00:00.000Z",
    "reversible": true
  }
}
```

#### Full example `cards.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/nickwang0808/flash-card/master/schema/cards.schema.json",
  "hola": {
    "back": "hello",
    "created": "2025-01-15T00:00:00.000Z"
  },
  "gato": {
    "back": "cat",
    "created": "2025-01-15T00:00:00.000Z",
    "reversible": true
  },
  "hacer": {
    "front": "**hacer** (irregular verb)",
    "back": "to do / to make\n\n*Yo hago mi tarea todos los días.*",
    "tags": ["verbs", "irregular"],
    "created": "2025-01-15T00:00:00.000Z"
  }
}
```

## Per-Deck README

Each deck directory should contain a `README.md` with deck-specific rules and conventions. Agents **must** read this file before adding or modifying cards in that deck.

Use the deck README for things like:
- Subject-specific conventions (e.g. how to handle verb conjugations, code examples, formulas)
- Which tags to use for that deck
- Card creation guidelines unique to the topic
- Any special formatting rules for `front` or `back` content

Example `spanish-vocab/README.md`:

```markdown
# Spanish Vocab

## Rules
- Set `reversible: true` for all single-word translations
- Include example sentences in `back` when possible
- Use tags: `["greetings"]`, `["verbs"]`, `["food"]`, etc.

## Irregular Verbs
- Only create conjugation cards for actually irregular forms
- Skip conjugations that follow regular -ar/-er/-ir patterns
```

## Workflow for Adding Cards

1. **Read the deck's `README.md`** — check for deck-specific rules before doing anything
2. **Read existing cards** — check `<deck>/cards.json` for duplicates before adding
2. **Create a branch** — `cards/<topic>` (e.g. `cards/kitchen-vocab`)
3. **Add cards** — append new entries to `cards.json`
4. **Commit** — `add <topic> cards`
5. **Open a PR** — list added cards in the description

### Rules

- Skip existing keys (check all decks first); you may update existing cards if adding new information
- Include examples in `back` when possible
- Set `reversible: true` for terms worth studying in both directions
- One topic per PR to keep diffs reviewable
- Always set `state: null` and `reverseState: null` for new cards (or omit them — the app initializes them)

## New Repo Setup

Follow these steps to create a fresh data repo:

1. **Create a GitHub repository** (public or private).

2. **Clone it locally:**
   ```bash
   git clone https://github.com/<user>/<repo>.git
   cd <repo>
   ```

3. **Create a deck directory with `cards.json` and `README.md`:**
   ```bash
   mkdir spanish-vocab
   ```
   Create `spanish-vocab/cards.json` with your cards following the format above. Include the `$schema` key for validation.

   Create `spanish-vocab/README.md` with deck-specific rules and conventions (see [Per-Deck README](#per-deck-readme) above).

4. **Create a `README.md`** in the repo root:
   ```markdown
   # My Flash Cards

   Data repository for the [flash-card app](https://github.com/nickwang0808/flash-card).

   **IMPORTANT:** Before adding or modifying cards, always fetch the latest setup guide for
   the current card format, workflow rules, and migration instructions:
   https://raw.githubusercontent.com/nickwang0808/flash-card/master/docs/data-setup.md
   ```

5. **Commit and push:**
   ```bash
   git add .
   git commit -m "Initial deck setup"
   git push
   ```

6. **Connect to the app** (see below).

## Migration from v1

If your data repo uses the old format (`source`, `translation`, `example`, `notes` fields), run the migration script:

1. **Clone the app repo** (if you don't have it):
   ```bash
   git clone https://github.com/nickwang0808/flash-card.git
   ```

2. **Run the migration** from your data repo directory:
   ```bash
   npx tsx flash-card/scripts/migrate-v2.ts .
   ```
   This converts all `cards.json` files in place. The script:
   - Combines `translation`, `example`, and `notes` into a `back` markdown field
   - Removes the `source` field (redundant with the JSON key)
   - Preserves `tags`, `created`, `reversible`, `state`, `reverseState`, and `suspended`
   - Skips cards already in v2 format

3. **Review and commit the changes:**
   ```bash
   git diff
   git add .
   git commit -m "Migrate cards to v2 format"
   git push
   ```

## Connecting to the App

1. Open the flash-card app.
2. Sign in with GitHub.
3. Enter your data repo URL (e.g. `https://github.com/<user>/<repo>`) and click **Connect**.
4. The app validates the repo has at least one deck with a `cards.json` file, then begins syncing.
