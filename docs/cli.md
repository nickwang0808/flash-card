# Flashcard CLI reference

`flashcard` is a one-shot Node 22.12+ client. It reads `FLASHCARD_SUPABASE_URL`, `FLASHCARD_SUPABASE_PUBLISHABLE_KEY`, and `FLASHCARD_API_URL`; no other endpoint, database, service-role, JWT, deployment, or dotenv configuration is accepted.

## Results and failures

Operational success is exactly one line on stdout: `{"ok":true,"data":<server result>}`. Operational failure leaves stdout empty, writes `{"ok":false,"error":{"code":"...","message":"..."}}` to stderr, and exits 1. Safe `details` may appear only for local-removal state. `--help`, `help`, and `--version` are text and exit 0.

Local error codes are `USAGE_ERROR`, `VALIDATION_FAILED`, `CONFIRMATION_REQUIRED`, `CANCELLED`, `CONFIGURATION_ERROR`, `UNAUTHENTICATED`, `AUTHENTICATION_FAILED`, `CREDENTIAL_STORE_UNAVAILABLE`, `CREDENTIAL_STORE_ERROR`, `TRANSPORT_ERROR`, and `INTERNAL`. Server application codes such as `CONFLICT`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_STATE`, and `IDEMPOTENCY_CONFLICT` are preserved. No error includes a token, password, request header, or raw server response.

## Authentication and credential storage

- `auth login --email <email> [--password-stdin] [--credential-store keyring|file]`
- `auth session`
- `auth logout`

Without `--password-stdin`, login requires an interactive terminal. `--password-stdin` reads one non-empty line through EOF; never pass a password as an argument or environment variable. The default store is a per-Supabase-origin OS keyring entry. Headless Linux needs an available Secret Service; use `--credential-store file` only as an explicit fallback. File sessions live under `%APPDATA%/flashcard`, `~/Library/Application Support/flashcard`, or `${XDG_CONFIG_HOME:-~/.config}/flashcard`, in `sessions/<sha256-origin>.json`; POSIX files/directories are owner-only. The remembered store selection contains no secrets. Logout is local-scope and idempotent; it removes local credentials even if remote revocation fails.

A stored access token is refreshed once after a 401, using its refresh token under a per-origin lock. Concurrent processes re-read the store after acquiring that lock. Keyring failure never silently falls back to files.

## Input rules

Commands with input accept documented kebab-case flags **or** `--input <path|->`, not both. JSON input is one UTF-8 object (maximum 1 MiB), uses exact camelCase API fields, rejects BOMs, arrays/scalars, and unknown fields, and `-` reads stdin. `--yes` is a local confirmation flag and may accompany JSON input. UUIDs, ratings, versions, and limits are validated before dispatch. Pagination cursors are opaque and must be passed through unchanged.

Repeated `--tag <tag>` forms `tags`. Search, revisions, and history flags use `--cursor`/`--limit` as `pagination`; queue and queue-changing mutations use `--limit` as `queue`. Limits are 1–100 and default to 50.

## Commands and JSON shapes

```text
flashcard deck list
flashcard deck create --name <name> [--default-speech-locale <locale>]
flashcard deck rename --deck-id <uuid> --name <name> --expected-version <integer>
flashcard deck remove --deck-id <uuid> --expected-version <integer> --yes
flashcard deck queue --deck-id <uuid> [--limit <1..100>]
```

Deck JSON: create `{name,defaultSpeechLocale?}`; rename `{deckId,name,expectedVersion}`; remove `{deckId,expectedVersion}`; queue `{deckId,limit?}`.

```text
flashcard card get --card-id <uuid> --deck-id <uuid>
flashcard card search --query <query> [--deck-id <uuid>] [--cursor <cursor>] [--limit <1..100>]
flashcard card create --deck-id <uuid> --name <name> --front-markdown <markdown> --back-markdown <markdown> [--tag <tag>] [--speech-text <text>] [--speech-locale <locale>] [--speech-side <front|back>] [--reversible]
flashcard card update --card-id <uuid> --deck-id <uuid> --name <name> --front-markdown <markdown> --back-markdown <markdown> --expected-version <integer> [--tag <tag>] [--speech-text <text>] [--speech-locale <locale>] [--speech-side <front|back>] [--reversible]
flashcard card suspend|restore --card-id <uuid> --deck-id <uuid> --expected-version <integer> [--limit <1..100>]
flashcard card remove --card-id <uuid> --deck-id <uuid> --expected-version <integer> --yes [--limit <1..100>]
flashcard card revisions --card-id <uuid> --deck-id <uuid> [--cursor <cursor>] [--limit <1..100>]
flashcard card rollback --card-id <uuid> --deck-id <uuid> --revision-id <uuid> --expected-version <integer>
```

Card JSON: get `{cardId,deckId}`; search `{deckId?,query,pagination}`; create `{deckId,name,frontMarkdown,backMarkdown,tags?,speechText?,speechLocale?,speechSide?,reversible?}`; update adds `{cardId,expectedVersion}`; suspend/restore `{cardId,deckId,expectedVersion,queue}`; remove uses the same input without confirmation; revisions `{cardId,deckId,pagination}`; rollback `{cardId,deckId,revisionId,expectedVersion}`. Flag-mode create/update is a full replacement: omitted tags become `[]`, omitted speech fields become `null`, and omitted `reversible` becomes `false`. A card's direction cannot change after creation. To preserve a field, `card get` then submit it again. Rollback restores revision content only, not tags, suspension, or cadence.

```text
flashcard review rate --card-id <uuid> --deck-id <uuid> --rating <again|hard|good|easy> --expected-version <integer> [--request-id <uuid>] [--limit <1..100>]
flashcard review history --card-id <uuid> --deck-id <uuid> [--cursor <cursor>] [--limit <1..100>]
flashcard review undo --review-id <uuid> --deck-id <uuid> [--limit <1..100>]
```

Review JSON: rate `{cardId,deckId,rating,expectedVersion,requestId?,queue}`; history `{cardId,deckId,pagination}`; undo `{reviewId,deckId,queue}`. If rate has no request ID, the CLI generates one once; reuse a caller-supplied ID when recovering from an uncertain request. The server replacement queue is authoritative. Do not reorder it, persist it, or reconstruct scheduling. Undo can reverse only the latest active review.

## Destructive operations and examples

Only deck/card removal prompts. Interactive terminals require an exact `y` or `yes`; noninteractive processes must supply `--yes`. The prompt is not part of stdout. A refusal never reaches the API.

```sh
flashcard deck list | jq '.data.decks[] | {id,name,version}'
printf '%s' '{"deckId":"...","name":"漢字","frontMarkdown":"<ruby>漢<rt>かん</rt></ruby>","backMarkdown":"Chinese","tags":["language"],"speechText":null,"speechLocale":null,"speechSide":null,"reversible":false}' \
  | flashcard card create --input -
```

Always carry the latest returned `version` into versioned mutations. A `CONFLICT` means re-read the server entity; the CLI never fetches and retries for you. Deletion submits backend `confirmation:true` only after local confirmation.
