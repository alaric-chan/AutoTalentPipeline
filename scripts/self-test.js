import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractResumeProfile } from '../server/resumeParser.js';
import { mergeCandidateForUpsert } from '../server/store.js';
import { buildOutlookWebCalendarUrl, buildOutlookWebMailUrl } from '../server/templates.js';
import { buildCandidateConfirmationNotification, feishuBotSign } from '../server/notificationService.js';

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

function assertManualProfileOverrideMerge() {
  const existing = {
    id: 'lark_rec_manual_override_test',
    name: '人工姓名',
    email: 'manual@example.com',
    phone: '13900000000',
    school: '人工学校 · 人工专业',
    degree: '硕士',
    receivedAt: '2026-05-26T00:31:00.000Z',
    source: 'lark-base',
    identityKey: 'email:manual@example.com',
    lark: { recordId: 'rec_manual_override_test' },
    profileOverrides: {
      fields: ['name', 'email', 'phone', 'schoolBackground', 'arrival'],
      updatedAt: '2026-05-28T00:00:00.000Z',
      updatedBy: 'self-test'
    },
    application: {
      fields: {
        姓名: '人工姓名',
        联系邮箱: 'manual@example.com',
        联系电话: '13900000000',
        院校背景: '人工学校 · 人工专业',
        学历: '硕士',
        最快到岗时间: '2026-06-01',
        可实习时长: '3个月'
      },
      picked: {
        name: '姓名',
        email: '联系邮箱',
        phone: '联系电话',
        school: '院校背景',
        degree: '学历',
        arrival: '最快到岗时间',
        duration: '可实习时长'
      }
    },
    timeline: []
  };
  const incoming = {
    id: 'lark_rec_manual_override_test',
    name: '飞书姓名',
    email: 'lark@example.com',
    phone: '123213',
    school: '飞书学校',
    degree: '本科',
    receivedAt: '2026-05-27T00:31:00.000Z',
    source: 'lark-base',
    identityKey: 'email:lark@example.com',
    lark: { recordId: 'rec_manual_override_test' },
    application: {
      fields: {
        姓名: '飞书姓名',
        联系邮箱: 'lark@example.com',
        联系电话: '123213',
        院校背景: '飞书学校',
        学历: '本科',
        最快到岗时间: '2026-07-01',
        可实习时长: '6个月'
      },
      picked: {
        name: '姓名',
        email: '联系邮箱',
        phone: '联系电话',
        school: '院校背景',
        degree: '学历',
        arrival: '最快到岗时间',
        duration: '可实习时长'
      }
    },
    timeline: []
  };
  const merged = mergeCandidateForUpsert(existing, incoming);
  if (merged.name !== '人工姓名' || merged.email !== 'manual@example.com' || merged.phone !== '13900000000') {
    throw new Error('manual profile override merge failed to preserve corrected identity fields');
  }
  if (merged.school !== '人工学校 · 人工专业' || merged.application.fields.院校背景 !== '人工学校 · 人工专业') {
    throw new Error('manual profile override merge failed to preserve corrected school background');
  }
  if (merged.application.fields.最快到岗时间 !== '2026-06-01') {
    throw new Error('manual profile override merge failed to preserve corrected arrival date');
  }
  if (merged.degree !== '本科' || merged.application.fields.可实习时长 !== '6个月') {
    throw new Error('manual profile override merge blocked unedited Lark fields');
  }
  if (merged.identityKey !== 'email:manual@example.com') {
    throw new Error(`manual profile override merge reset identity key: ${merged.identityKey}`);
  }
}

function assertOutlookDeepLinkEncoding() {
  const email = {
    subject: '请确认联想AI产品经理实习生面试时间-王萌',
    bodyText: [
      'Hi 王萌，',
      '',
      '面试方式：Teams 线上会议',
      'Best wishes'
    ].join('\n'),
    bodyHtml: '<p>Hi 王萌，</p>\n<p>面试方式：Teams 线上会议<br/>Best wishes</p>'
  };
  const candidate = { email: 'wm@example.com' };
  const mailUrl = buildOutlookWebMailUrl({ email, candidate });
  const calendarUrl = buildOutlookWebCalendarUrl({
    event: { subject: '面试：王萌', location: { displayName: 'Teams 线上会议' } },
    interview: { start: '2026-06-03T14:30', end: '2026-06-03T15:00', locationOrLink: 'Teams 线上会议' },
    email,
    candidate
  });
  for (const url of [mailUrl, calendarUrl]) {
    if (url.includes('+')) {
      throw new Error(`Outlook deeplink should encode spaces as %20 instead of +: ${url}`);
    }
    const body = new URL(url).searchParams.get('body') || '';
    if (!body.includes('Hi 王萌') || !body.includes('Teams 线上会议') || body.includes('Hi+')) {
      throw new Error(`Outlook deeplink body decoding failed: ${body}`);
    }
  }
  const mailBody = new URL(mailUrl).searchParams.get('body') || '';
  const calendarBody = new URL(calendarUrl).searchParams.get('body') || '';
  if (mailBody.includes('<p>') || !mailBody.includes('\n')) {
    throw new Error('Outlook mail deeplink should keep plain text line breaks');
  }
  if (!calendarBody.includes('<p>Hi 王萌') || !calendarBody.includes('<br/>Best wishes')) {
    throw new Error(`Outlook calendar deeplink should use HTML to preserve rich-text line breaks: ${calendarBody}`);
  }
}

function assertLarkConfirmationNotification() {
  const candidate = {
    id: 'cand_notify_test',
    name: '王萌',
    email: 'wm@example.com',
    phone: '13800138000',
    interview: {
      start: '2026-06-03T14:30',
      end: '2026-06-03T15:00',
      locationOrLink: 'Teams 线上会议',
      confirmation: {
        token: 'token_notify_test',
        status: 'reschedule_requested',
        response: 'reschedule',
        note: '周五 16:30 可以',
        respondedAt: '2026-05-28T14:24:00.000Z',
        url: 'https://new.leaibot.cn/recruiting/#/confirm/token_notify_test'
      }
    }
  };
  const text = buildCandidateConfirmationNotification(candidate);
  for (const expected of ['候选人申请改期', '王萌', '6月3日', '周五 16:30 可以', '#/confirm/token_notify_test']) {
    if (!text.includes(expected)) {
      throw new Error(`Lark confirmation notification missing ${expected}: ${text}`);
    }
  }
  if (feishuBotSign('1234567890', 'secret') !== 'ZfKVuj6L5hFYWbpNk/R//8s1lu9nDXiIbG0Fc4NaCEk=') {
    throw new Error('Feishu bot signature generation changed unexpectedly');
  }
}

function confirmationTokenFromUrl(url = '') {
  const match = String(url).match(/#\/confirm\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `${pathname} failed: ${response.status}`);
  }
  return data;
}

async function assertInterviewStatusFlow(candidateId) {
  const draftOne = await fetchJson(`/api/candidates/${candidateId}/interview/confirmation-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '2026-06-04T10:30',
      end: '2026-06-04T11:00',
      durationMinutes: 30,
      locationOrLink: 'Teams 线上会议'
    })
  });
  const oldToken = confirmationTokenFromUrl(draftOne.confirmationUrl);
  if (!oldToken) throw new Error('first confirmation mail did not return a token');

  const draftTwo = await fetchJson(`/api/candidates/${candidateId}/interview/confirmation-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '2026-06-05T15:30',
      end: '2026-06-05T16:00',
      durationMinutes: 30,
      locationOrLink: 'Teams 线上会议'
    })
  });
  const currentToken = confirmationTokenFromUrl(draftTwo.confirmationUrl);
  if (!currentToken || currentToken === oldToken) throw new Error('replacement confirmation mail did not rotate token');

  const historical = await fetchJson(`/api/interview-confirmations/${encodeURIComponent(oldToken)}`);
  if (historical.isCurrent !== false) {
    throw new Error('old confirmation token should remain readable as history');
  }

  const sent = await fetchJson(`/api/candidates/${candidateId}/interview/confirmation-mail-sent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'self-test sent' })
  });
  if (sent.status !== '等待候选人确认') {
    throw new Error(`confirmation sent status should wait for candidate: ${sent.status}`);
  }

  await fetchJson(`/api/interview-confirmations/${encodeURIComponent(currentToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'reschedule', note: '周五全天都可以' })
  });
  const rescheduled = await fetchJson(`/api/candidates/${candidateId}`);
  if (rescheduled.status !== '待重新安排' || rescheduled.interview?.confirmation?.note !== '周五全天都可以') {
    throw new Error('candidate reschedule response was not persisted for admin review');
  }

  const offlineConfirmed = await fetchJson(`/api/candidates/${candidateId}/interview/offline-confirmation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '2026-06-08T16:30',
      end: '2026-06-08T17:00',
      durationMinutes: 30,
      locationOrLink: 'Teams 线上会议',
      note: '电话确认 16:30 可以面试'
    })
  });
  if (
    offlineConfirmed.candidate?.status !== '候选人已确认' ||
    offlineConfirmed.candidate?.interview?.confirmation?.status !== 'offline_confirmed' ||
    offlineConfirmed.candidate?.interview?.start !== '2026-06-08T16:30'
  ) {
    throw new Error('offline reschedule confirmation did not unlock the formal calendar step');
  }

  const currentConfirmation = await fetchJson(`/api/interview-confirmations/${encodeURIComponent(currentToken)}`);
  if (currentConfirmation.status !== 'offline_confirmed') {
    throw new Error('offline confirmation should be visible on the candidate confirmation page');
  }

  const calendar = await fetchJson(`/api/candidates/${candidateId}/interview/outlook-web-calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: '2026-06-08T16:30',
      end: '2026-06-08T17:00',
      durationMinutes: 30,
      locationOrLink: 'Teams 线上会议'
    })
  });
  if (calendar.candidate?.status !== 'Outlook日程待发送') {
    throw new Error(`calendar draft should move to Outlook send stage: ${calendar.candidate?.status}`);
  }
  const confirmedInvite = await fetchJson(`/api/candidates/${candidateId}/interview/confirm-sent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamsConfirmation: 'self-test' })
  });
  if (confirmedInvite.status !== '已预约面试') {
    throw new Error(`calendar sent should be terminal schedule status: ${confirmedInvite.status}`);
  }
  const lateMailSent = await fetchJson(`/api/candidates/${candidateId}/interview/confirmation-mail-sent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'late click should not regress' })
  });
  if (lateMailSent.status !== '已预约面试' || lateMailSent.interview?.confirmation?.status !== 'offline_confirmed') {
    throw new Error('late confirmation-mail sent click regressed the scheduled candidate status');
  }

  const questionRun = await fetchJson(`/api/candidates/${candidateId}/interview/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mock: true })
  });
  const groups = questionRun.candidate?.interview?.questionGroups || [];
  if (!groups.length || !groups.every((group) => group.title && group.questions?.length)) {
    throw new Error('AI interview question generation did not persist usable question groups');
  }
  if (questionRun.candidate?.status !== '已预约面试') {
    throw new Error('AI interview question generation should not change candidate scheduling status');
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
    assertManualProfileOverrideMerge();
    assertOutlookDeepLinkEncoding();
    assertLarkConfirmationNotification();
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
      const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
      const storedCandidate = db.candidates?.find((candidate) => candidate.id === candidateId);
      if (!storedCandidate?.profileOverrides?.fields?.includes('phone')) {
        throw new Error('candidate profile edit did not mark the corrected phone field as manual');
      }
      await assertInterviewStatusFlow(candidateId);
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
