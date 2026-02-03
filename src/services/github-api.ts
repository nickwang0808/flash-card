export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  // Handle https://github.com/owner/repo or https://github.com/owner/repo.git
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2] };
}

async function apiRequest(config: GitHubConfig, path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res;
}

export const githubApi = {
  async validateRepo(config: GitHubConfig): Promise<boolean> {
    try {
      await apiRequest(config, '');
      return true;
    } catch {
      return false;
    }
  },

  async readFile(config: GitHubConfig, path: string): Promise<{ content: string; sha: string }> {
    const res = await apiRequest(config, `/contents/${path}`);
    const data = await res.json();
    const content = atob(data.content.replace(/\n/g, ''));
    // Handle UTF-8 properly
    const bytes = Uint8Array.from(content, c => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    return { content: decoded, sha: data.sha };
  },

  async writeFile(
    config: GitHubConfig,
    path: string,
    content: string,
    sha: string,
    message: string,
  ): Promise<string> {
    // Encode content to base64 properly for UTF-8
    const bytes = new TextEncoder().encode(content);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    const encoded = btoa(binary);

    const res = await apiRequest(config, `/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: encoded, sha }),
    });
    const data = await res.json();
    return data.content.sha;
  },

  async listDirectory(config: GitHubConfig, path: string = ''): Promise<Array<{ name: string; type: string }>> {
    const res = await apiRequest(config, `/contents/${path}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((item: any) => ({ name: item.name, type: item.type }));
  },

  async getCommits(config: GitHubConfig, limit: number = 10): Promise<Array<{ message: string; sha: string; date: string }>> {
    const res = await apiRequest(config, `/commits?per_page=${limit}`);
    const data = await res.json();
    return data.map((c: any) => ({
      message: c.commit.message,
      sha: c.sha.slice(0, 7),
      date: c.commit.committer.date,
    }));
  },
};
