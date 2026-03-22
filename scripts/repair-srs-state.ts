/**
 * One-off script: replay orphaned review_logs through FSRS to reconstruct
 * missing srs_state rows, then output SQL INSERT statements.
 *
 * Usage: npx tsx scripts/repair-srs-state.ts
 */
import { fsrs, createEmptyCard, type Grade, type Card } from 'ts-fsrs';

// Review logs for orphaned cards, grouped by cardId+isReverse, ordered chronologically
const reviewLogs = [
  // 1c289e9c reverse
  { cardId: '1c289e9c-44e4-4dcd-bfd9-1eacfc496aa5', isReverse: true, rating: 1, review: '2026-03-21T22:24:48.320Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '1c289e9c-44e4-4dcd-bfd9-1eacfc496aa5', isReverse: true, rating: 3, review: '2026-03-21T22:47:17.538Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 2d021010 forward
  { cardId: '2d021010-0d93-4a7d-8c1b-2ddf20039e60', isReverse: false, rating: 1, review: '2026-03-21T21:45:19.360Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '2d021010-0d93-4a7d-8c1b-2ddf20039e60', isReverse: false, rating: 3, review: '2026-03-21T22:45:48.962Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 2d021010 reverse
  { cardId: '2d021010-0d93-4a7d-8c1b-2ddf20039e60', isReverse: true, rating: 3, review: '2026-03-21T22:25:31.931Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '2d021010-0d93-4a7d-8c1b-2ddf20039e60', isReverse: true, rating: 3, review: '2026-03-21T22:49:19.843Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 3704c98b reverse
  { cardId: '3704c98b-dec0-43a7-b5ed-15a314189730', isReverse: true, rating: 1, review: '2026-03-21T21:57:28.768Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '3704c98b-dec0-43a7-b5ed-15a314189730', isReverse: true, rating: 3, review: '2026-03-21T22:46:32.184Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 3ed49959 reverse
  { cardId: '3ed49959-f2b8-49e4-9eb5-1e5000c26d8d', isReverse: true, rating: 3, review: '2026-03-21T21:57:07.807Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '3ed49959-f2b8-49e4-9eb5-1e5000c26d8d', isReverse: true, rating: 3, review: '2026-03-21T22:46:54.011Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 41685276 reverse
  { cardId: '41685276-fdc1-461f-bffa-88df077a1cfb', isReverse: true, rating: 1, review: '2026-03-21T21:57:16.298Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '41685276-fdc1-461f-bffa-88df077a1cfb', isReverse: true, rating: 3, review: '2026-03-21T22:46:22.147Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 48745225 forward (es que...)
  { cardId: '48745225-cbbe-4cc1-9d9f-354f0b6eb9be', isReverse: false, rating: 1, review: '2026-03-21T21:45:11.221Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '48745225-cbbe-4cc1-9d9f-354f0b6eb9be', isReverse: false, rating: 1, review: '2026-03-21T22:45:35.309Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '48745225-cbbe-4cc1-9d9f-354f0b6eb9be', isReverse: false, rating: 1, review: '2026-03-21T22:52:29.830Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '48745225-cbbe-4cc1-9d9f-354f0b6eb9be', isReverse: false, rating: 1, review: '2026-03-21T22:55:03.611Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '48745225-cbbe-4cc1-9d9f-354f0b6eb9be', isReverse: false, rating: 1, review: '2026-03-21T22:56:27.780Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '48745225-cbbe-4cc1-9d9f-354f0b6eb9be', isReverse: false, rating: 3, review: '2026-03-21T22:57:05.435Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 4bca62a6 forward
  { cardId: '4bca62a6-8938-406f-b89f-6efb6ad9d0d2', isReverse: false, rating: 1, review: '2026-03-21T19:57:45.290Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '4bca62a6-8938-406f-b89f-6efb6ad9d0d2', isReverse: false, rating: 3, review: '2026-03-21T22:44:14.749Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '4bca62a6-8938-406f-b89f-6efb6ad9d0d2', isReverse: false, rating: 4, review: '2026-03-22T21:07:12.893Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 4bca62a6 reverse
  { cardId: '4bca62a6-8938-406f-b89f-6efb6ad9d0d2', isReverse: true, rating: 1, review: '2026-03-21T22:24:59.199Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '4bca62a6-8938-406f-b89f-6efb6ad9d0d2', isReverse: true, rating: 3, review: '2026-03-21T22:47:27.875Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 8c63692a forward
  { cardId: '8c63692a-f418-4ef8-9102-ad5ed663a980', isReverse: false, rating: 1, review: '2026-03-21T21:45:13.543Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '8c63692a-f418-4ef8-9102-ad5ed663a980', isReverse: false, rating: 1, review: '2026-03-21T22:45:42.426Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '8c63692a-f418-4ef8-9102-ad5ed663a980', isReverse: false, rating: 3, review: '2026-03-21T22:52:31.767Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 8c63692a reverse
  { cardId: '8c63692a-f418-4ef8-9102-ad5ed663a980', isReverse: true, rating: 3, review: '2026-03-21T22:25:22.209Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '8c63692a-f418-4ef8-9102-ad5ed663a980', isReverse: true, rating: 3, review: '2026-03-21T22:49:16.856Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // 93ddb1fa reverse
  { cardId: '93ddb1fa-fc2a-4d5a-9df1-5f33bb89821b', isReverse: true, rating: 3, review: '2026-03-21T21:45:32.596Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: '93ddb1fa-fc2a-4d5a-9df1-5f33bb89821b', isReverse: true, rating: 3, review: '2026-03-21T22:45:56.201Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // a518a7a8 reverse
  { cardId: 'a518a7a8-9c78-480a-9c8f-325b7f8d8d80', isReverse: true, rating: 1, review: '2026-03-21T21:57:48.341Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'a518a7a8-9c78-480a-9c8f-325b7f8d8d80', isReverse: true, rating: 2, review: '2026-03-21T22:46:51.930Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'a518a7a8-9c78-480a-9c8f-325b7f8d8d80', isReverse: true, rating: 3, review: '2026-03-21T22:54:55.737Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // b2ac2f61 reverse
  { cardId: 'b2ac2f61-d592-4366-a786-adfa747dc75b', isReverse: true, rating: 4, review: '2026-03-21T22:24:52.123Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // b5108fc2 forward
  { cardId: 'b5108fc2-3293-4c7a-bf61-c54993d932cd', isReverse: false, rating: 1, review: '2026-03-21T20:22:24.690Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'b5108fc2-3293-4c7a-bf61-c54993d932cd', isReverse: false, rating: 1, review: '2026-03-21T22:44:37.326Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'b5108fc2-3293-4c7a-bf61-c54993d932cd', isReverse: false, rating: 3, review: '2026-03-21T22:52:08.310Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'b5108fc2-3293-4c7a-bf61-c54993d932cd', isReverse: false, rating: 3, review: '2026-03-22T21:07:24.744Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // b5974283 reverse
  { cardId: 'b5974283-1cb9-4996-afae-b78dfb1bb8bb', isReverse: true, rating: 4, review: '2026-03-21T21:45:40.865Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // c3e0efa0 forward
  { cardId: 'c3e0efa0-58ce-47a8-b3cc-4a147ac14b59', isReverse: false, rating: 1, review: '2026-03-21T19:57:41.601Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'c3e0efa0-58ce-47a8-b3cc-4a147ac14b59', isReverse: false, rating: 3, review: '2026-03-21T22:44:11.110Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'c3e0efa0-58ce-47a8-b3cc-4a147ac14b59', isReverse: false, rating: 4, review: '2026-03-22T21:07:10.038Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // c3e0efa0 reverse
  { cardId: 'c3e0efa0-58ce-47a8-b3cc-4a147ac14b59', isReverse: true, rating: 1, review: '2026-03-21T22:24:55.361Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'c3e0efa0-58ce-47a8-b3cc-4a147ac14b59', isReverse: true, rating: 3, review: '2026-03-21T22:47:21.724Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // cde0fc11 reverse
  { cardId: 'cde0fc11-3c8f-467e-8d4a-1dea1efa7a44', isReverse: true, rating: 1, review: '2026-03-21T21:57:04.303Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'cde0fc11-3c8f-467e-8d4a-1dea1efa7a44', isReverse: true, rating: 1, review: '2026-03-21T22:46:09.300Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'cde0fc11-3c8f-467e-8d4a-1dea1efa7a44', isReverse: true, rating: 1, review: '2026-03-21T22:52:43.818Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'cde0fc11-3c8f-467e-8d4a-1dea1efa7a44', isReverse: true, rating: 3, review: '2026-03-21T22:55:15.472Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // d0c0b14c forward
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: false, rating: 1, review: '2026-03-21T19:57:51.025Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: false, rating: 1, review: '2026-03-21T22:44:17.217Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: false, rating: 3, review: '2026-03-21T22:52:05.123Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: false, rating: 4, review: '2026-03-22T21:07:18.672Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // d0c0b14c reverse
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: true, rating: 1, review: '2026-03-21T22:25:10.400Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: true, rating: 1, review: '2026-03-21T22:47:31.751Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: true, rating: 1, review: '2026-03-21T22:53:03.115Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: true, rating: 1, review: '2026-03-21T22:55:20.147Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd0c0b14c-2c00-48e8-a1c4-d22353474428', isReverse: true, rating: 3, review: '2026-03-21T22:56:39.193Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // d2618c9a reverse
  { cardId: 'd2618c9a-36cc-4b9c-9a3c-796ac7b3812a', isReverse: true, rating: 1, review: '2026-03-21T21:56:53.474Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd2618c9a-36cc-4b9c-9a3c-796ac7b3812a', isReverse: true, rating: 3, review: '2026-03-21T22:46:00.505Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // d80bc2fa forward
  { cardId: 'd80bc2fa-f8c1-428c-9d1a-fe1761444b97', isReverse: false, rating: 1, review: '2026-03-21T21:45:24.490Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'd80bc2fa-f8c1-428c-9d1a-fe1761444b97', isReverse: false, rating: 3, review: '2026-03-21T22:45:53.591Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // e2831545 forward
  { cardId: 'e2831545-bad9-4cb1-b018-22689c2cd304', isReverse: false, rating: 1, review: '2026-03-21T21:45:05.685Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'e2831545-bad9-4cb1-b018-22689c2cd304', isReverse: false, rating: 1, review: '2026-03-21T22:45:30.872Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'e2831545-bad9-4cb1-b018-22689c2cd304', isReverse: false, rating: 3, review: '2026-03-21T22:52:21.085Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'e2831545-bad9-4cb1-b018-22689c2cd304', isReverse: false, rating: 3, review: '2026-03-22T21:07:33.348Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // ea7aa5b7 forward
  { cardId: 'ea7aa5b7-2980-45b7-be4f-067dcd675777', isReverse: false, rating: 1, review: '2026-03-21T21:45:00.211Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'ea7aa5b7-2980-45b7-be4f-067dcd675777', isReverse: false, rating: 3, review: '2026-03-21T22:45:25.096Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'ea7aa5b7-2980-45b7-be4f-067dcd675777', isReverse: false, rating: 3, review: '2026-03-22T21:07:29.784Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // ea7aa5b7 reverse
  { cardId: 'ea7aa5b7-2980-45b7-be4f-067dcd675777', isReverse: true, rating: 1, review: '2026-03-21T22:25:18.810Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'ea7aa5b7-2980-45b7-be4f-067dcd675777', isReverse: true, rating: 1, review: '2026-03-21T22:47:38.761Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'ea7aa5b7-2980-45b7-be4f-067dcd675777', isReverse: true, rating: 3, review: '2026-03-21T22:53:07.639Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // f4367f2c forward
  { cardId: 'f4367f2c-e2d7-45e7-8db1-8308180bfaea', isReverse: false, rating: 1, review: '2026-03-21T21:45:16.494Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'f4367f2c-e2d7-45e7-8db1-8308180bfaea', isReverse: false, rating: 1, review: '2026-03-21T22:45:46.459Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'f4367f2c-e2d7-45e7-8db1-8308180bfaea', isReverse: false, rating: 3, review: '2026-03-21T22:52:35.088Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // f4367f2c reverse
  { cardId: 'f4367f2c-e2d7-45e7-8db1-8308180bfaea', isReverse: true, rating: 1, review: '2026-03-21T22:25:28.293Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'f4367f2c-e2d7-45e7-8db1-8308180bfaea', isReverse: true, rating: 3, review: '2026-03-21T22:47:45.813Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // f907a0fa reverse (super easy — 60 day)
  { cardId: 'f907a0fa-5e78-4275-9cfd-613166e92f4f', isReverse: true, rating: 4, review: '2026-03-21T21:57:21.419Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // fe5db6ed reverse
  { cardId: 'fe5db6ed-0cb4-4558-a2ca-8ded250cc02e', isReverse: true, rating: 3, review: '2026-03-21T21:57:38.828Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  { cardId: 'fe5db6ed-0cb4-4558-a2ca-8ded250cc02e', isReverse: true, rating: 3, review: '2026-03-21T22:46:56.002Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
  // ff20ba82 reverse
  { cardId: 'ff20ba82-78b4-4dae-8d1e-253453af345b', isReverse: true, rating: 4, review: '2026-03-21T21:45:36.121Z', userId: '0a0891bf-e645-415d-b83c-a343480eb36f' },
];

// Group by cardId + direction
type Key = string;
const groups = new Map<Key, typeof reviewLogs>();
for (const log of reviewLogs) {
  const key = `${log.cardId}:${log.isReverse ? 'reverse' : 'forward'}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(log);
}

// Check for the "super easy" pattern: rating 4, state 0, scheduledDays 60
// These were handled by rateCardSuperEasy, not the normal FSRS flow
const SUPER_EASY_CARDS = new Set([
  'f907a0fa-5e78-4275-9cfd-613166e92f4f:reverse',
]);

const f = fsrs();
const sqlValues: string[] = [];

for (const [key, logs] of groups) {
  const [cardId, direction] = key.split(':') as [string, string];
  const userId = logs[0].userId;

  if (SUPER_EASY_CARDS.has(key)) {
    // Reconstruct the super easy state: 60 days out from review time
    const reviewTime = new Date(logs[0].review);
    const due = new Date(reviewTime.getTime() + 60 * 24 * 60 * 60 * 1000);
    sqlValues.push(
      `(gen_random_uuid(), '${userId}', '${cardId}', '${direction}', ` +
      `'${due.toISOString()}', 60, 4, 0, 60, 1, 0, 2, '${reviewTime.toISOString()}')`
    );
    console.log(`${key}: super easy → due ${due.toISOString()}, state=Review`);
    continue;
  }

  // Replay through FSRS
  let state: Card = createEmptyCard();
  for (const log of logs) {
    const now = new Date(log.review);
    const result = f.repeat(state, now)[log.rating as Grade];
    state = result.card;
  }

  sqlValues.push(
    `(gen_random_uuid(), '${userId}', '${cardId}', '${direction}', ` +
    `'${state.due.toISOString()}', ${state.stability}, ${state.difficulty}, ` +
    `${state.elapsed_days}, ${state.scheduled_days}, ${state.reps}, ${state.lapses}, ` +
    `${state.state}, ${state.last_review ? `'${state.last_review.toISOString()}'` : 'NULL'})`
  );

  console.log(`${key}: ${logs.length} reviews → state=${state.state}, due=${state.due.toISOString()}, reps=${state.reps}`);
}

console.log('\n-- SQL to insert missing srs_state rows:');
console.log(`INSERT INTO srs_state (id, "userId", "cardId", direction, due, stability, difficulty, "elapsedDays", "scheduledDays", reps, lapses, state, "lastReview")`);
console.log(`VALUES`);
console.log(sqlValues.join(',\n') + ';');
