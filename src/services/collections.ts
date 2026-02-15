import { GitHubStorageService, parseRepoUrl } from './github';
import { getDatabaseSync } from './rxdb';
import { defaultSettings } from '../hooks/useSettings';

// Get commits from GitHub
export async function getCommits(limit: number = 10) {
  const db = getDatabaseSync();
  const doc = await db.settings.findOne('settings').exec();
  const settings = doc ? doc.toJSON() : defaultSettings;
  const { owner, repo } = parseRepoUrl(settings.repoUrl);
  const service = new GitHubStorageService({
    owner,
    repo,
    token: settings.token,
    branch: settings.branch,
    baseUrl: settings.apiBaseUrl || undefined,
  });
  return service.getCommits(limit);
}
