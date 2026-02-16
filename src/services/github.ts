import { Octokit } from '@octokit/rest';
import type { CardData, GitStorageService } from './git-storage';

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
  baseUrl?: string;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2] };
}

export async function listUserRepos(
  token: string,
): Promise<Array<{ full_name: string; html_url: string }>> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: 100,
    sort: 'updated',
  });
  return data.map((r) => ({ full_name: r.full_name, html_url: r.html_url }));
}

// Card JSON format as stored in GitHub (FSRS dates serialized to ISO strings)
// The card's term/key is the JSON map key, not stored inside the object.
interface CardJSON {
  front?: string;             // markdown (optional, defaults to term/key)
  back: string;               // markdown
  tags?: string[];
  created: string;
  reversible?: boolean;
  state: Record<string, unknown> | null;
  reverseState: Record<string, unknown> | null;
  suspended?: boolean;
}

export class GitHubStorageService implements GitStorageService {
  private octokit: Octokit;

  constructor(private config: GitHubConfig) {
    this.octokit = new Octokit({
      auth: config.token,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }

  async pullAllCards(): Promise<CardData[]> {
    const allCards: CardData[] = [];

    const entries = await this.listDirectory('');
    for (const entry of entries) {
      if (entry.type !== 'dir') continue;
      try {
        const { content } = await this.readFile(`${entry.name}/cards.json`);
        const cardsMap: Record<string, CardJSON> = JSON.parse(content);

        let order = 0;
        for (const [term, card] of Object.entries(cardsMap)) {
          if (term.startsWith('$')) continue; // skip $schema and other meta keys
          allCards.push({
            deckName: entry.name,
            term,
            front: card.front,
            back: card.back,
            tags: card.tags,
            created: card.created,
            reversible: card.reversible ?? false,
            order,
            state: card.state ?? null,
            reverseState: card.reverseState ?? null,
            suspended: card.suspended,
          });
          order++;
        }
      } catch {
        // Not a deck directory or no cards.json — skip
      }
    }

    return allCards;
  }

  async pushCards(cards: CardData[]): Promise<void> {
    // Group by deckName
    const byDeck = new Map<string, CardData[]>();
    for (const card of cards) {
      if (!byDeck.has(card.deckName)) byDeck.set(card.deckName, []);
      byDeck.get(card.deckName)!.push(card);
    }

    for (const [deckName, deckCards] of byDeck) {
      let existing: Record<string, CardJSON> = {};
      let sha: string | undefined;

      try {
        const result = await this.readFile(`${deckName}/cards.json`);
        existing = JSON.parse(result.content);
        sha = result.sha;
      } catch {
        // New deck, file doesn't exist yet
      }

      for (const card of deckCards) {
        const json: CardJSON = {
          back: card.back,
          tags: card.tags,
          created: card.created,
          reversible: card.reversible,
          state: card.state,
          reverseState: card.reverseState,
          suspended: card.suspended,
        };
        if (card.front) json.front = card.front;
        existing[card.term] = json;
      }

      await this.writeFile(
        `${deckName}/cards.json`,
        JSON.stringify(existing, null, 2),
        sha,
        `sync: ${deckName} - ${deckCards.map((c) => c.term).join(', ')}`,
      );
    }
  }

  async getCommits(
    limit: number = 10,
  ): Promise<Array<{ message: string; sha: string; date: string }>> {
    const { data } = await this.octokit.repos.listCommits({
      owner: this.config.owner,
      repo: this.config.repo,
      per_page: limit,
      ...(this.config.branch ? { sha: this.config.branch } : {}),
    });
    return data.map((c) => ({
      message: c.commit.message,
      sha: c.sha.slice(0, 7),
      date: c.commit.committer?.date ?? '',
    }));
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.octokit.repos.get({
        owner: this.config.owner,
        repo: this.config.repo,
      });
      return true;
    } catch {
      return false;
    }
  }

  async listDecks(): Promise<string[]> {
    const entries = await this.listDirectory('');
    return entries
      .filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
      .map((e) => e.name);
  }

  // --- Internal helpers (GitHub-specific file I/O) ---

  async listDirectory(path: string): Promise<Array<{ name: string; type: string }>> {
    const { data } = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
      ...(this.config.branch ? { ref: this.config.branch } : {}),
    });
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({ name: item.name, type: item.type }));
  }

  async readFile(path: string): Promise<{ content: string; sha: string }> {
    const { data: meta } = await this.octokit.repos.getContent({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
      ...(this.config.branch ? { ref: this.config.branch } : {}),
    });

    if (Array.isArray(meta) || meta.type !== 'file') {
      throw new Error(`Not a file: ${path}`);
    }

    // Decode base64 content with proper UTF-8 handling
    const binary = atob(meta.content!.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return { content: text, sha: meta.sha };
  }

  private async writeFile(
    path: string,
    content: string,
    sha: string | undefined,
    message: string,
  ): Promise<string> {
    const bytes = new TextEncoder().encode(content);
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    const encoded = btoa(binary);

    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.config.owner,
      repo: this.config.repo,
      path,
      message,
      content: encoded,
      ...(sha ? { sha } : {}),
      ...(this.config.branch ? { branch: this.config.branch } : {}),
    });

    return data.content?.sha ?? '';
  }
}
