import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';

const DIR = '/repo';
const BRANCH = 'main';

let fs: LightningFS | null = null;

function getFS(): LightningFS {
  if (!fs) {
    fs = new LightningFS('flash-card-fs');
  }
  return fs;
}

function corsProxy(url: string): string {
  return url;
}

export interface GitServiceConfig {
  repoUrl: string;
  token: string;
}

function onAuth(config: GitServiceConfig) {
  return () => ({
    username: config.token,
    password: 'x-oauth-basic',
  });
}

export const gitService = {
  getFS,

  async clone(config: GitServiceConfig, onProgress?: (msg: string) => void): Promise<void> {
    const lfs = getFS();
    // Clean slate
    try {
      await lfs.promises.rmdir(DIR, { recursive: true } as any);
    } catch {
      // dir may not exist
    }
    await lfs.promises.mkdir(DIR, { recursive: true } as any);

    await git.clone({
      fs: lfs,
      http,
      dir: DIR,
      url: corsProxy(config.repoUrl),
      ref: BRANCH,
      singleBranch: true,
      depth: 10,
      onAuth: onAuth(config),
      onProgress: onProgress
        ? (e) => onProgress(e.phase + (e.loaded ? ` ${e.loaded}/${e.total}` : ''))
        : undefined,
    });
  },

  async pull(config: GitServiceConfig): Promise<void> {
    const lfs = getFS();
    await git.pull({
      fs: lfs,
      http,
      dir: DIR,
      ref: BRANCH,
      singleBranch: true,
      onAuth: onAuth(config),
      author: { name: 'Flash Card App', email: 'flashcard@local' },
    });
  },

  async push(config: GitServiceConfig): Promise<void> {
    const lfs = getFS();
    await git.push({
      fs: lfs,
      http,
      dir: DIR,
      ref: BRANCH,
      onAuth: onAuth(config),
    });
  },

  async pushAsBranch(config: GitServiceConfig): Promise<string> {
    const lfs = getFS();
    const branchName = `sync/${new Date().toISOString().replace(/[:.]/g, '-')}`;

    await git.branch({ fs: lfs, dir: DIR, ref: branchName });
    await git.checkout({ fs: lfs, dir: DIR, ref: branchName });

    await git.push({
      fs: lfs,
      http,
      dir: DIR,
      ref: branchName,
      onAuth: onAuth(config),
    });

    // Switch back to main and reset
    await git.checkout({ fs: lfs, dir: DIR, ref: BRANCH });

    return branchName;
  },

  async readFile(path: string): Promise<string> {
    const lfs = getFS();
    const data = await lfs.promises.readFile(`${DIR}/${path}`, {
      encoding: 'utf8',
    });
    return data as string;
  },

  async writeFile(path: string, content: string): Promise<void> {
    const lfs = getFS();
    // Ensure parent dir exists
    const parts = path.split('/');
    if (parts.length > 1) {
      let dir = DIR;
      for (const part of parts.slice(0, -1)) {
        dir += '/' + part;
        try {
          await lfs.promises.mkdir(dir);
        } catch {
          // exists
        }
      }
    }
    await lfs.promises.writeFile(`${DIR}/${path}`, content, 'utf8');
  },

  async commit(message: string): Promise<void> {
    const lfs = getFS();
    await git.add({ fs: lfs, dir: DIR, filepath: '.' });
    await git.commit({
      fs: lfs,
      dir: DIR,
      message,
      author: { name: 'Flash Card App', email: 'flashcard@local' },
    });
  },

  async hasUnpushedCommits(_config: GitServiceConfig): Promise<boolean> {
    const lfs = getFS();
    try {
      const localOid = await git.resolveRef({ fs: lfs, dir: DIR, ref: BRANCH });
      // Try to resolve remote ref
      let remoteOid: string;
      try {
        remoteOid = await git.resolveRef({
          fs: lfs,
          dir: DIR,
          ref: `refs/remotes/origin/${BRANCH}`,
        });
      } catch {
        return true; // no remote tracking = unpushed
      }
      return localOid !== remoteOid;
    } catch {
      return false;
    }
  },

  async getStatus(): Promise<'synced' | 'ahead' | 'behind' | 'diverged'> {
    const lfs = getFS();
    try {
      const localOid = await git.resolveRef({ fs: lfs, dir: DIR, ref: BRANCH });
      let remoteOid: string;
      try {
        remoteOid = await git.resolveRef({
          fs: lfs,
          dir: DIR,
          ref: `refs/remotes/origin/${BRANCH}`,
        });
      } catch {
        return 'ahead';
      }
      if (localOid === remoteOid) return 'synced';

      // Check if local is ancestor of remote
      const isAncestor = await git.isDescendent({
        fs: lfs,
        dir: DIR,
        oid: localOid,
        ancestor: remoteOid,
      });
      if (isAncestor) return 'ahead';

      const isDescendent = await git.isDescendent({
        fs: lfs,
        dir: DIR,
        oid: remoteOid,
        ancestor: localOid,
      });
      if (isDescendent) return 'behind';

      return 'diverged';
    } catch {
      return 'synced';
    }
  },

  async listDirectories(): Promise<string[]> {
    const lfs = getFS();
    const entries = await lfs.promises.readdir(DIR);
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      try {
        const stat = await lfs.promises.stat(`${DIR}/${entry}`);
        if (stat.isDirectory()) dirs.push(entry);
      } catch {
        // skip
      }
    }
    return dirs;
  },

  async getLog(depth: number = 10): Promise<Array<{ message: string; oid: string; timestamp: number }>> {
    const lfs = getFS();
    try {
      const commits = await git.log({ fs: lfs, dir: DIR, depth });
      return commits.map((c) => ({
        message: c.commit.message,
        oid: c.oid.slice(0, 7),
        timestamp: c.commit.committer.timestamp * 1000,
      }));
    } catch {
      return [];
    }
  },

  async isInitialized(): Promise<boolean> {
    const lfs = getFS();
    try {
      await lfs.promises.stat(`${DIR}/.git`);
      return true;
    } catch {
      return false;
    }
  },

  /** Completely wipe the filesystem (for logout) */
  async wipe(): Promise<void> {
    if (fs) {
      fs = null;
    }
    const lfs = new LightningFS('flash-card-fs');
    try {
      await lfs.promises.rmdir(DIR, { recursive: true } as any);
    } catch {
      // ok
    }
    // Also destroy the whole DB
    indexedDB.deleteDatabase('flash-card-fs');
    fs = null;
  },
};
