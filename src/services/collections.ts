import { type Card } from 'ts-fsrs';
import { github, parseRepoUrl } from './github';
import { getDatabaseSync } from './rxdb';
import { defaultSettings } from '../hooks/useSettings';

// Stored version of ReviewLog with serialized dates
export interface StoredReviewLog {
  id: string;                  // cardSource:direction:timestamp
  cardSource: string;
  isReverse: boolean;
  rating: number;              // Rating enum value
  state: number;               // State enum value
  due: string;                 // ISO date
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;              // ISO date
}

// FlashCard: content + FSRS state in one structure
// id and deckName are added by the RxDB layer
export interface FlashCard {
  id: string;                  // composite key: "deckName|source"
  deckName: string;
  source: string;
  translation: string;
  example?: string;
  notes?: string;
  tags?: string[];
  created: string;
  reversible: boolean;
  state: Card | null;
  reverseState: Card | null;
  suspended?: boolean;
}

// Get commits from GitHub
export async function getCommits(limit: number = 10) {
  const db = getDatabaseSync();
  const doc = await db.settings.findOne('settings').exec();
  const settings = doc ? doc.toJSON() : defaultSettings;
  const { owner, repo } = parseRepoUrl(settings.repoUrl);
  const config = { owner, repo, token: settings.token, branch: settings.branch };
  return github.getCommits(config, limit);
}
