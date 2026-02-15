/**
 * Local HTTP server that mocks GitHub's Contents API, backed by a real git repo on disk.
 * Used for E2E tests so they don't need a real GitHub connection.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// --- Repo creation / cleanup ---

interface SeedDeck {
  [cardSource: string]: {
    source: string;
    translation: string;
    example?: string;
    notes?: string;
    tags?: string[];
    created: string;
    reversible?: boolean;
  };
}

export function createTestRepo(seedDecks?: Record<string, SeedDeck>): {
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-card-test-'));

  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  if (seedDecks) {
    for (const [deckName, cards] of Object.entries(seedDecks)) {
      const deckDir = path.join(dir, deckName);
      fs.mkdirSync(deckDir, { recursive: true });
      fs.writeFileSync(path.join(deckDir, 'cards.json'), JSON.stringify(cards, null, 2));
    }
  } else {
    // Create a dummy file so git has something to commit
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  }

  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "seed test data"', { cwd: dir, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: dir, stdio: 'pipe' });

  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    },
  };
}

// --- Helpers ---

function blobSha(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  const store = Buffer.concat([Buffer.from(header), content]);
  return crypto.createHash('sha1').update(store).digest('hex');
}

function toBase64(content: Buffer): string {
  return content.toString('base64');
}

function fromBase64(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64');
}

function parseRoute(
  url: string,
): { owner: string; repo: string; rest: string } | null {
  // /repos/:owner/:repo/...
  const match = url.match(/^\/repos\/([^/]+)\/([^/]+)\/?(.*)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], rest: match[3] || '' };
}

function parseQueryParams(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  const qs = url.slice(idx + 1);
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return params;
}

// --- Server ---

export async function startGitTestServer(repoDir: string): Promise<{
  url: string;
  port: number;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    handleRequest(repoDir, req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: err.message }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

async function handleRequest(
  repoDir: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const method = req.method || 'GET';
  const url = (req.url || '/').split('?')[0];
  const fullUrl = req.url || '/';

  // CORS headers for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const route = parseRoute(url);
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  const { rest } = route;

  // GET /repos/:o/:r — validateConnection
  if (method === 'GET' && rest === '') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 1, name: route.repo, full_name: `${route.owner}/${route.repo}` }));
    return;
  }

  // GET /repos/:o/:r/contents/:path — listDirectory or readFile
  if (method === 'GET' && rest.startsWith('contents')) {
    const contentPath = decodeURIComponent(rest.replace(/^contents\/?/, ''));
    const ref = parseQueryParams(fullUrl).ref;
    await handleGetContents(repoDir, contentPath, ref, res);
    return;
  }

  // PUT /repos/:o/:r/contents/:path — writeFile
  if (method === 'PUT' && rest.startsWith('contents')) {
    const contentPath = decodeURIComponent(rest.replace(/^contents\/?/, ''));
    const body = await readBody(req);
    await handlePutContents(repoDir, contentPath, body, res);
    return;
  }

  // GET /repos/:o/:r/commits — getCommits
  if (method === 'GET' && rest === 'commits') {
    const params = parseQueryParams(fullUrl);
    const limit = parseInt(params.per_page || '10', 10);
    await handleGetCommits(repoDir, limit, res);
    return;
  }

  // GET /repos/:o/:r/git/ref/heads/:branch — for createBranch/deleteBranch
  if (method === 'GET' && rest.startsWith('git/ref/heads/')) {
    const branch = rest.replace('git/ref/heads/', '');
    await handleGetRef(repoDir, branch, res);
    return;
  }

  // POST /repos/:o/:r/git/refs — createRef
  if (method === 'POST' && rest === 'git/refs') {
    const body = await readBody(req);
    await handleCreateRef(repoDir, body, res);
    return;
  }

  // DELETE /repos/:o/:r/git/refs/heads/:branch — deleteRef
  if (method === 'DELETE' && rest.startsWith('git/refs/heads/')) {
    const branch = rest.replace('git/refs/heads/', '');
    await handleDeleteRef(repoDir, branch, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: `Not found: ${method} ${url}` }));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// --- Handlers ---

async function handleGetContents(
  repoDir: string,
  contentPath: string,
  ref: string | undefined,
  res: http.ServerResponse,
): Promise<void> {
  // If a branch ref is given, check it out (for branch-based isolation)
  if (ref) {
    try {
      execSync(`git checkout "${ref}" --quiet`, { cwd: repoDir, stdio: 'pipe' });
    } catch {
      // Branch might not exist; stay on current
    }
  }

  const fullPath = path.join(repoDir, contentPath);

  if (!fs.existsSync(fullPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not Found' }));
    return;
  }

  const stat = fs.statSync(fullPath);

  if (stat.isDirectory()) {
    // List directory
    const entries = fs.readdirSync(fullPath);
    const result = entries
      .filter((name) => !name.startsWith('.'))
      .map((name) => {
        const entryPath = path.join(fullPath, name);
        const entryStat = fs.statSync(entryPath);
        return {
          name,
          path: contentPath ? `${contentPath}/${name}` : name,
          type: entryStat.isDirectory() ? 'dir' : 'file',
          sha: entryStat.isFile()
            ? blobSha(fs.readFileSync(entryPath))
            : '',
        };
      });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } else {
    // Read file
    const content = fs.readFileSync(fullPath);
    const sha = blobSha(content);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        name: path.basename(fullPath),
        path: contentPath,
        sha,
        type: 'file',
        content: toBase64(content),
        encoding: 'base64',
      }),
    );
  }
}

async function handlePutContents(
  repoDir: string,
  contentPath: string,
  body: any,
  res: http.ServerResponse,
): Promise<void> {
  const fullPath = path.join(repoDir, contentPath);
  const dir = path.dirname(fullPath);

  // Checkout target branch if specified
  if (body.branch) {
    try {
      execSync(`git checkout "${body.branch}" --quiet`, { cwd: repoDir, stdio: 'pipe' });
    } catch {
      // Branch might not exist, create it
      try {
        execSync(`git checkout -b "${body.branch}" --quiet`, { cwd: repoDir, stdio: 'pipe' });
      } catch {
        // Already exists, just switch
      }
    }
  }

  fs.mkdirSync(dir, { recursive: true });

  const decoded = fromBase64(body.content);
  fs.writeFileSync(fullPath, decoded);

  execSync(`git add "${contentPath}"`, { cwd: repoDir, stdio: 'pipe' });
  const message = body.message || 'update';
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    cwd: repoDir,
    stdio: 'pipe',
  });

  const newContent = fs.readFileSync(fullPath);
  const sha = blobSha(newContent);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      content: {
        name: path.basename(fullPath),
        path: contentPath,
        sha,
        type: 'file',
      },
      commit: {
        sha: execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim(),
        message,
      },
    }),
  );
}

async function handleGetCommits(
  repoDir: string,
  limit: number,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const output = execSync(
      `git log -${limit} --format="%H%n%s%n%aI%n---"`,
      { cwd: repoDir, encoding: 'utf-8' },
    );
    const commits = output
      .split('---\n')
      .filter((block) => block.trim())
      .map((block) => {
        const lines = block.trim().split('\n');
        return {
          sha: lines[0],
          commit: {
            message: lines[1],
            committer: { date: lines[2] },
          },
        };
      });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(commits));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  }
}

async function handleGetRef(
  repoDir: string,
  branch: string,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const sha = execSync(`git rev-parse "refs/heads/${branch}"`, {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ref: `refs/heads/${branch}`,
        object: { sha, type: 'commit' },
      }),
    );
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Reference not found' }));
  }
}

async function handleCreateRef(
  repoDir: string,
  body: any,
  res: http.ServerResponse,
): Promise<void> {
  const ref = body.ref || ''; // refs/heads/branch-name
  const sha = body.sha || '';
  const branch = ref.replace('refs/heads/', '');

  try {
    execSync(`git branch "${branch}" "${sha}"`, { cwd: repoDir, stdio: 'pipe' });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ref,
        object: { sha, type: 'commit' },
      }),
    );
  } catch (err: any) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: err.message }));
  }
}

async function handleDeleteRef(
  repoDir: string,
  branch: string,
  res: http.ServerResponse,
): Promise<void> {
  try {
    // Make sure we're not on the branch we're deleting
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoDir,
      encoding: 'utf-8',
    }).trim();
    if (currentBranch === branch) {
      execSync('git checkout main --quiet', { cwd: repoDir, stdio: 'pipe' });
    }
    execSync(`git branch -D "${branch}"`, { cwd: repoDir, stdio: 'pipe' });
    res.writeHead(204);
    res.end();
  } catch {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Reference not found' }));
  }
}
