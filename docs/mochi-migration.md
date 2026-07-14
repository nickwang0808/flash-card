# Migrating Cards to Mochi

Notes from reverse-engineering Mochi's `.mochi` import format, so existing cards (with real SRS
history) can be moved out of this project's Supabase `cards`/`srs_state` tables into Mochi
without losing scheduling state and without forcing a full re-study.

Verified by trial and error against a real Mochi account, cross-checked against a real export
(Settings → Export) of a manually-created and manually-reviewed card.

## File format

A `.mochi` file is a **zip archive** containing one `data.json` (or `data.edn`) at the root, plus
any attachments. Both EDN and Transit-JSON are accepted on **import** — Mochi's own **export**
always produces Transit-JSON (`data.json`). EDN is easier to hand-write (no keyword-encoding
gotchas); Transit-JSON is what you get back if you ever want to inspect real data.

Build one with Python's stdlib (no extra deps needed):

```python
import zipfile
with zipfile.ZipFile('out.mochi', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write('data.json', arcname='data.json')  # or data.edn
```

## Transit-JSON conventions (what a real export looks like)

- Every EDN keyword becomes a string prefixed `~:` — e.g. `:version` → `"~:version"`,
  and IDs like `:cd000003` → `"~:cd000003"`.
- EDN sets become `{"~#set": [...]}` — used for `tags`, `references`, `cloze/indexes`.
- Ordered lists (a deck's cards, template list) become `{"~#list": [...]}`, **not** a bare
  JSON array — this tripped us up initially.
- Two different date encodings coexist in the same file:
  - `created-at` / `updated-at` → `{"~#dt": <epoch-millis>}`
  - Review `date` / `due` → plain string `"~t<epoch-millis>"`

EDN avoids all of this — keywords and `#inst` timestamps are native — which is why EDN import
worked on the first structurally-correct attempt while a naive hand-rolled JSON attempt would
have needed the `~:` / `~#` prefixing to be right.

## Deck / card structure (the part that actually matters)

**Cards must be nested inside the deck's own `:cards` field.** A top-level `:cards` vector with
a `:deck-id` back-reference (which the official format docs describe as a valid alternative) did
**not** work in practice — decks were created but held zero cards. Always nest:

```edn
{:version 2
 :decks [{:id :dk000003
          :name "Some Deck"
          :cards [{:id :cd000003
                   :content "<pinyin>你好</pinyin>\n---\nhello"}]}]}
```

- `:id` on decks/cards: must be 8+ alphanumeric characters (`0-9A-Za-z`). We used simple
  sequential ids like `dk000003` / `cd000003` for testing; anything unique of sufficient length
  works.
- `:content`: `front\n---\nback` when no template is used (`---` is the side separator).
- Chinese/Japanese ruby-text components render automatically:
  - `<pinyin>你好</pinyin>` → renders with tone-marked pinyin above the hanzi.
  - `<furigana>例えば</furigana>` → same idea for kanji/hiragana.

## Preserving SRS state (no re-study on import)

This is the part we cared about most: importing a card with a `:reviews` entry keeps it out of
today's "New"/"Due" queue, seeded at whatever interval you specify.

```edn
:reviews [{:date #inst "2026-06-13T00:00:00.000Z"
           :due #inst "2026-08-12T00:00:00.000Z"
           :interval 60
           :remembered? true}]
```

Confirmed working: **a single synthetic review record is sufficient.** A real export of one
manual "Remembered" tap actually produces *two* review records (an initial `due == date` marker
with no `interval`, followed by the real scored review with `interval` + `duration`), but our
import only needed the second shape — one record with `interval` + `remembered?: true` — to
correctly seed the due date and keep the card out of today's queue.

- `interval` is in **days**.
- `due` should be `date + interval` days later, expressed as its own timestamp (Mochi doesn't
  compute it for you from `interval` alone — we verified by setting them independently).
- `duration` (seconds spent on the review) appears in real exports but is optional; omitting it
  did not cause any problem.

### What does NOT work for controlling scheduling

Confirmed by reading Mochi's own docs, not just by testing:

- **CSV import** does not preserve review history — everything comes in as a new card.
- **`POST /api/cards/`** (create) and **`POST /api/cards/:id`** (update) do not accept any
  scheduling fields (`due`, `interval`, `reviews`) — only `content`, `deck-id`, `template-id`,
  `archived?`, `trashed?`, `review-reverse?`, `pos`, `manual-tags`, `fields`.
- The app itself has no manual "postpone" or "set due date" UI — only **Reset** (back to new)
  and **Archive** (remove from review queues entirely). Anki has a native "Set Due Date" feature
  for this; Mochi does not.

So the `.mochi` import format is the *only* lever for controlling a card's schedule, and only at
creation time — once a card exists in Mochi there is no way to edit its schedule short of
exporting, patching the JSON, and re-importing as a new card.

## Mapping from this project's schema

| This project (`cards` / `srs_state`) | Mochi field |
|---|---|
| `deckName`                | one deck per distinct value, `:decks[].name` |
| `term` (+ wrap in `<pinyin>`/`<furigana>` as needed) | front side of `:content` |
| `back`                    | back side of `:content` (after `---`) |
| `srs_state.lastReview`    | `Review.:date` |
| `srs_state.due`           | `Review.:due` |
| `srs_state.scheduledDays` | `Review.:interval` (round to int) |
| n/a                       | `Review.:remembered?` → `true` for anything not being reset |

Practical split for migration:
- **Cards with no meaningful `srs_state`** (never studied, or barely) → import with no
  `:reviews` block at all, let them enter as new.
- **Well-studied cards** → attach one synthetic `:reviews` entry per the mapping above.

Note this is a lossy migration: this project's `srs_state` stores real FSRS parameters
(`stability`, `difficulty`) which have no equivalent field in Mochi's format — Mochi's own
scheduler (multiplier-based, or FSRS in beta) will recompute its own state going forward from
the single seeded review, not from the original FSRS parameters.
