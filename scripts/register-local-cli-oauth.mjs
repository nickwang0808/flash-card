import { execFileSync } from 'node:child_process';

const clientName = 'Flash Cards CLI (local)';
const callbackUrl = 'http://127.0.0.1:43821/oauth/callback';

let rawStatus;
try {
  rawStatus = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (caught) {
  const stderr = caught instanceof Error && 'stderr' in caught && typeof caught.stderr === 'string' ? ` ${caught.stderr.trim()}` : '';
  throw new Error(`The local Supabase stack must be running.${stderr}`);
}

let status;
try {
  status = JSON.parse(rawStatus);
} catch {
  throw new Error('Supabase status returned invalid JSON');
}

if (typeof status.API_URL !== 'string' || typeof status.SECRET_KEY !== 'string') {
  throw new Error('Supabase status did not provide API_URL and SECRET_KEY');
}

const adminHeaders = { Authorization: `Bearer ${status.SECRET_KEY}`, apikey: status.SECRET_KEY };
const listResponse = await fetch(new URL('/auth/v1/admin/oauth/clients', status.API_URL), {
  headers: adminHeaders,
});
if (!listResponse.ok) throw new Error(`Could not list local OAuth clients (HTTP ${listResponse.status}); restart Supabase after enabling auth.oauth_server`);
const listed = await listResponse.json();
const clients = Array.isArray(listed) ? listed : typeof listed === 'object' && listed !== null && Array.isArray(listed.clients) ? listed.clients : [];
let client = clients.find((candidate) => candidate?.client_name === clientName && Array.isArray(candidate.redirect_uris) && candidate.redirect_uris.includes(callbackUrl));
if (!client) {
  const createResponse = await fetch(new URL('/auth/v1/admin/oauth/clients', status.API_URL), {
    method: 'POST',
    headers: {
      ...adminHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [callbackUrl],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!createResponse.ok) throw new Error('Could not create the local public OAuth client');
  client = await createResponse.json();
}

if (typeof client.client_id !== 'string' || client.client_id.length === 0) throw new Error('Local OAuth client has no client ID');
process.stdout.write(`export FLASHCARD_OAUTH_CLIENT_ID=${client.client_id}\n`);
