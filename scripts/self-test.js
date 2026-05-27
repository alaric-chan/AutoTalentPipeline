import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractResumeProfile } from '../server/resumeParser.js';

const port = process.env.PORT || 4317;
const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
let authHeaders = process.env.APP_AUTH_TOKEN ? { 'X-App-Token': process.env.APP_AUTH_TOKEN } : {};
const dbPath = path.resolve('data/recruiting.json');

async function isServerAlive() {
  try {
    const response = await fetch(`${baseUrl}/api/security/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureAuthHeaders() {
  if (Object.keys(authHeaders).length) return;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.SELF_TEST_USERNAME || process.env.INITIAL_ADMIN_USERNAME || 'chenbk1',
      password: process.env.SELF_TEST_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '123456'
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `login failed: ${response.status}`);
  }
  authHeaders = { Authorization: `Bearer ${data.token}` };
}

function startServer() {
  const child = spawn('node', ['server/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      APP_BASE_URL: baseUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

function assertResumeProfileParsing() {
  const profile = extractResumeProfile({
    filename: '北京邮电大学-电子科学与技术-王萌-简历.pdf',
    text: [
      '姓名：王萌',
      '联系邮箱：wm.resume@example.com',
      '联系电话：138 0013 8000',
      '具备 Agent Workflow 与 Prompt 工程实践经验'
    ].join('\n')
  });
  if (profile.name !== '王萌') {
    throw new Error(`resume profile name parse failed: ${profile.name}`);
  }
  if (profile.email !== 'wm.resume@example.com') {
    throw new Error(`resume profile email parse failed: ${profile.email}`);
  }
  if (!profile.phone.includes('138')) {
    throw new Error(`resume profile phone parse failed: ${profile.phone}`);
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (await isServerAlive()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server did not become ready in time');
}

async function main() {
  let child = null;
  let dbBackup = null;
  try {
    assertResumeProfileParsing();
    if (process.env.SELF_TEST_RESTORE !== 'false') {
      dbBackup = await fs.readFile(dbPath, 'utf8').catch(() => null);
    }
    if (!(await isServerAlive())) {
      child = startServer();
      await waitForServer();
    }
    await ensureAuthHeaders();
    const response = await fetch(`${baseUrl}/api/self-test`, { method: 'POST', headers: authHeaders });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `self-test failed: ${response.status}`);
    }
    const candidateId = data.steps?.find((step) => step.candidateId)?.candidateId;
    if (candidateId) {
      const detailResponse = await fetch(`${baseUrl}/api/candidates/${candidateId}`, { headers: authHeaders });
      const detail = await detailResponse.json();
      if (!detailResponse.ok) {
        throw new Error(detail.error || `candidate detail check failed: ${detailResponse.status}`);
      }
      const patchResponse = await fetch(`${baseUrl}/api/candidates/${candidateId}/profile`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '13900000000' })
      });
      const patched = await patchResponse.json();
      if (!patchResponse.ok) {
        throw new Error(patched.error || `candidate partial profile patch failed: ${patchResponse.status}`);
      }
      if (detail.email && patched.email !== detail.email) {
        throw new Error('candidate partial profile patch cleared an omitted email field');
      }
    }
    const candidatesResponse = await fetch(`${baseUrl}/api/candidates`, { headers: authHeaders });
    const candidates = await candidatesResponse.json();
    if (!candidatesResponse.ok) {
      throw new Error(candidates.error || `candidate privacy check failed: ${candidatesResponse.status}`);
    }
    const leaked = candidates.find((candidate) => candidate.email || candidate.phone || candidate.identityKey);
    if (leaked) {
      throw new Error(`candidate list privacy check failed: ${leaked.id || leaked.name || 'unknown candidate'}`);
    }
    console.log(JSON.stringify(data, null, 2));
  } finally {
    if (dbBackup != null) {
      await fs.writeFile(dbPath, dbBackup, 'utf8');
    }
    if (child) {
      child.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
