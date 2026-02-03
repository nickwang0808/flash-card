import { Octokit } from '@octokit/rest';
import { settingsStore } from './settings-store';

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2] };
}

export function getConfig(): GitHubConfig {
  const s = settingsStore.get();
  const { owner, repo } = parseRepoUrl(s.repoUrl);
  return { owner, repo, token: s.token };
}

export function createOctokit(token?: string): Octokit {
  return new Octokit({ auth: token ?? settingsStore.get().token });
}

export const github = {
  async validateRepo(config: GitHubConfig): Promise<boolean> {
    try {
      const octokit = new Octokit({ auth: config.token });
      await octokit.repos.get({ owner: config.owner, repo: config.repo });
      return true;
    } catch {
      return false;
    }
  },

  async listDirectory(
    config: GitHubConfig,
    path: string = '',
  ): Promise<Array<{ name: string; type: string }>> {
    const octokit = new Octokit({ auth: config.token });
    const { data } = await octokit.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path,
    });
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({ name: item.name, type: item.type }));
  },

  async readFile(
    config: GitHubConfig,
    path: string,
  ): Promise<{ content: string; sha: string }> {
    const octokit = new Octokit({ auth: config.token });
    const { data } = await octokit.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path,
    });

    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
      throw new Error(`Not a file: ${path}`);
    }

    const content = atob(data.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(content, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    return { content: decoded, sha: data.sha };
  },

  async writeFile(
    config: GitHubConfig,
    path: string,
    content: string,
    sha: string | undefined,
    message: string,
  ): Promise<string> {
    const octokit = new Octokit({ auth: config.token });
    const bytes = new TextEncoder().encode(content);
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    const encoded = btoa(binary);

    const { data } = await octokit.repos.createOrUpdateFileContents({
      owner: config.owner,
      repo: config.repo,
      path,
      message,
      content: encoded,
      ...(sha ? { sha } : {}),
    });

    return data.content?.sha ?? '';
  },

  async getCommits(
    config: GitHubConfig,
    limit: number = 10,
  ): Promise<Array<{ message: string; sha: string; date: string }>> {
    const octokit = new Octokit({ auth: config.token });
    const { data } = await octokit.repos.listCommits({
      owner: config.owner,
      repo: config.repo,
      per_page: limit,
    });
    return data.map((c) => ({
      message: c.commit.message,
      sha: c.sha.slice(0, 7),
      date: c.commit.committer?.date ?? '',
    }));
  },
};
