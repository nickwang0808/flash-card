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
  - Requires `E2E_REPO_URL` and `E2E_TOKEN` in `.env`
  - Uses a real GitHub test repo; each suite creates/deletes branches for isolation
  - Test data: 5 spanish-vocab cards + 1 reversible (gato) = 6 total study items
