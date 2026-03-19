# Flash Card App

## Pre-push Checklist

Before every push, run the full test suite:

```bash
npm run test:unit && npm run test:e2e
```

Both unit tests and e2e tests must pass before pushing.

## Testing

- **Unit tests**: `npm run test:unit` — Vitest, tests in `tests/unit/`
- **E2E tests**: `npm run test:e2e` — Playwright, tests in `tests/e2e/`
  - Requires local Supabase running (`npx supabase start`)
  - Seeds test data directly into local Supabase; resets between tests
  - Test data: 30 spanish-vocab cards (all reversible), default limit 10 = 5 fwd + 5 rev = 10 study items
