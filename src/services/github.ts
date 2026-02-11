import { Octokit } from '@octokit/rest';

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2] };
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
      ...(config.branch ? { ref: config.branch } : {}),
    });
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({ name: item.name, type: item.type }));
  },

  async readFile(
    config: GitHubConfig,
    path: string,
  ): Promise<{ content: string; sha: string }> {
    const octokit = new Octokit({ auth: config.token });

    const { data: meta } = await octokit.repos.getContent({
      owner: config.owner,
      repo: config.repo,
      path,
      ...(config.branch ? { ref: config.branch } : {}),
    });

    if (Array.isArray(meta) || meta.type !== 'file') {
      throw new Error(`Not a file: ${path}`);
    }

    // Decode base64 content from the standard getContent response
    const text = atob(meta.content!.replace(/\n/g, ''));
    return { content: text, sha: meta.sha };
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
      ...(config.branch ? { branch: config.branch } : {}),
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
      ...(config.branch ? { sha: config.branch } : {}),
    });
    return data.map((c) => ({
      message: c.commit.message,
      sha: c.sha.slice(0, 7),
      date: c.commit.committer?.date ?? '',
    }));
  },

  async createBranch(
    config: GitHubConfig,
    branchName: string,
    fromBranch: string = 'main',
  ): Promise<void> {
    const octokit = new Octokit({ auth: config.token });
    const { data: refData } = await octokit.git.getRef({
      owner: config.owner,
      repo: config.repo,
      ref: `heads/${fromBranch}`,
    });
    await octokit.git.createRef({
      owner: config.owner,
      repo: config.repo,
      ref: `refs/heads/${branchName}`,
      sha: refData.object.sha,
    });
  },

  async listUserRepos(
    token: string,
  ): Promise<Array<{ full_name: string; html_url: string }>> {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
    });
    return data.map((r) => ({ full_name: r.full_name, html_url: r.html_url }));
  },

  async deleteBranch(config: GitHubConfig, branchName: string): Promise<void> {
    const octokit = new Octokit({ auth: config.token });
    try {
      await octokit.git.deleteRef({
        owner: config.owner,
        repo: config.repo,
        ref: `heads/${branchName}`,
      });
    } catch {
      // Ignore errors (branch might not exist)
    }
  },
};
