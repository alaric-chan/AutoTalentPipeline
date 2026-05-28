import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, paths } from './config.js';
import {
  getOauthState,
  getOutlookState,
  getOutlookToken,
  getDeviceFlow,
  newId,
  patchCandidate,
  setDeviceFlow,
  getPublicOauth,
  setOauthState,
  setOutlookProfile,
  setOutlookToken,
  setPublicOauth,
  upsertCandidate
} from './store.js';
import { extractResumeText, inferNameFromFile, parseEmailAddress } from './resumeParser.js';
import { screenResume } from './screening.js';
import { sampleMessage, sampleResumeText } from './sampleData.js';

const graphBase = 'https://graph.microsoft.com/v1.0';

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formEncode(data) {
  return new URLSearchParams(Object.entries(data).filter(([, value]) => value !== undefined && value !== '')).toString();
}

function tokenEndpoint() {
  return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/token`;
}

export async function getOutlookStatus() {
  const state = await getOutlookState();
  const expiresAt = state.token?.expires_at || null;
  return {
    connected: Boolean(state.token?.access_token || state.token?.refresh_token),
    profile: state.profile,
    expiresAt,
    tokenExpired: expiresAt ? Date.now() > expiresAt - 60_000 : true,
    configured: Boolean(config.microsoft.clientId || config.microsoft.publicClientId),
    authMode: state.token?.auth_mode || (config.microsoft.clientId ? 'authorization_code' : 'device_code'),
    pendingDeviceFlow: state.deviceFlow
      ? {
          userCode: state.deviceFlow.user_code,
          verificationUri: state.deviceFlow.verification_uri,
          expiresAt: state.deviceFlow.expires_at,
          message: state.deviceFlow.message
        }
      : null
  };
}

export async function buildAuthUrl() {
  if (!config.microsoft.clientId) {
    throw new Error('缺少 MS_CLIENT_ID，请先配置 Microsoft Entra 应用。');
  }
  const state = crypto.randomBytes(16).toString('hex');
  await setOauthState(state);
  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: 'code',
    redirect_uri: config.microsoft.redirectUri,
    response_mode: 'query',
    scope: config.microsoft.scopes,
    state
  });
  return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function buildPublicAuthUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const redirectUri = `${config.appBaseUrl}/api/outlook/public-callback`;
  await setPublicOauth({
    state,
    verifier,
    redirectUri,
    createdAt: new Date().toISOString()
  });
  const params = new URLSearchParams({
    client_id: config.microsoft.publicClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: config.microsoft.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function handlePublicOAuthCallback({ code, state, error, error_description }) {
  if (error) {
    throw new Error(error_description || error);
  }
  const flow = await getPublicOauth();
  if (!flow?.verifier || state !== flow.state) {
    throw new Error('Public OAuth state 校验失败。');
  }
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: config.microsoft.publicClientId,
      code,
      redirect_uri: flow.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
      scope: config.microsoft.scopes
    })
  });
  const token = await response.json();
  if (!response.ok) {
    throw new Error(token.error_description || token.error || `Public token exchange failed: ${response.status}`);
  }
  await setOutlookToken({
    ...token,
    auth_mode: 'public_pkce',
    client_id: config.microsoft.publicClientId,
    redirect_uri: flow.redirectUri,
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000
  });
  await setPublicOauth(null);
  const profile = await graphRequest('/me');
  await setOutlookProfile({
    displayName: profile.displayName,
    userPrincipalName: profile.userPrincipalName,
    mail: profile.mail
  });
  return profile;
}

export async function handleOAuthCallback({ code, state }) {
  const expectedState = await getOauthState();
  if (!code) {
    throw new Error('OAuth callback 缺少 code。');
  }
  if (!state || state !== expectedState) {
    throw new Error('OAuth state 校验失败。');
  }

  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: config.microsoft.clientId,
      client_secret: config.microsoft.clientSecret,
      code,
      redirect_uri: config.microsoft.redirectUri,
      grant_type: 'authorization_code',
      scope: config.microsoft.scopes
    })
  });

  const token = await response.json();
  if (!response.ok) {
    throw new Error(token.error_description || token.error || `Token exchange failed: ${response.status}`);
  }

  await setOutlookToken({
    ...token,
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000
  });
  const profile = await graphRequest('/me');
  await setOutlookProfile({
    displayName: profile.displayName,
    userPrincipalName: profile.userPrincipalName,
    mail: profile.mail
  });
  return profile;
}

async function refreshToken(token) {
  if (!token?.refresh_token) {
    throw new Error('Outlook 尚未连接或 refresh_token 不存在。');
  }
  const clientId = token.client_id || config.microsoft.clientId || config.microsoft.publicClientId;
  const body = {
    client_id: clientId,
    refresh_token: token.refresh_token,
    redirect_uri:
      token.auth_mode === 'authorization_code'
        ? config.microsoft.redirectUri
        : token.auth_mode === 'public_pkce'
          ? token.redirect_uri
          : undefined,
    grant_type: 'refresh_token',
    scope: config.microsoft.scopes
  };
  if (token.auth_mode !== 'device_code' && config.microsoft.clientSecret) {
    body.client_secret = config.microsoft.clientSecret;
  }
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode(body)
  });
  const refreshed = await response.json();
  if (!response.ok) {
    throw new Error(refreshed.error_description || refreshed.error || `Token refresh failed: ${response.status}`);
  }
  const nextToken = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000
  };
  await setOutlookToken(nextToken);
  return nextToken;
}

async function getAccessToken() {
  let token = await getOutlookToken();
  if (!token?.access_token || Date.now() > token.expires_at - 60_000) {
    token = await refreshToken(token);
  }
  return token.access_token;
}

export async function graphRequest(pathname, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${graphBase}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (response.status === 204 || response.status === 202) {
    return { ok: true, status: response.status };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Graph request failed: ${response.status}`);
  }
  return data;
}

export async function startDeviceCodeFlow() {
  const response = await fetch(
    `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/devicecode`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        client_id: config.microsoft.publicClientId,
        scope: config.microsoft.scopes
      })
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || `Device code failed: ${response.status}`);
  }
  const flow = {
    ...data,
    client_id: config.microsoft.publicClientId,
    expires_at: Date.now() + Number(data.expires_in || 900) * 1000
  };
  await setDeviceFlow(flow);
  return {
    userCode: flow.user_code,
    verificationUri: flow.verification_uri,
    expiresAt: flow.expires_at,
    interval: flow.interval,
    message: flow.message
  };
}

export async function pollDeviceCodeFlow() {
  const flow = await getDeviceFlow();
  if (!flow?.device_code) {
    return { status: 'missing', message: '没有待处理的 device code 授权。' };
  }
  if (Date.now() > flow.expires_at) {
    await setDeviceFlow(null);
    return { status: 'expired', message: 'device code 已过期，请重新发起连接。' };
  }
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: flow.client_id,
      device_code: flow.device_code
    })
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.error === 'authorization_pending') {
      return { status: 'pending', message: '等待用户完成 Microsoft 授权。' };
    }
    if (data.error === 'slow_down') {
      return { status: 'pending', message: '轮询过快，稍后再试。' };
    }
    if (['authorization_declined', 'expired_token', 'bad_verification_code'].includes(data.error)) {
      await setDeviceFlow(null);
    }
    return {
      status: 'error',
      message: data.error_description || data.error || `Token polling failed: ${response.status}`
    };
  }

  await setOutlookToken({
    ...data,
    auth_mode: 'device_code',
    client_id: flow.client_id,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000
  });
  await setDeviceFlow(null);
  const profile = await graphRequest('/me');
  await setOutlookProfile({
    displayName: profile.displayName,
    userPrincipalName: profile.userPrincipalName,
    mail: profile.mail
  });
  return { status: 'connected', profile };
}

async function graphBinaryRequest(pathname) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${graphBase}${pathname}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Graph binary request failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isResumeAttachment(attachment) {
  const name = attachment.name || '';
  if (attachment.isInline) return false;
  return /\.(pdf|doc|docx|txt|md)$/i.test(name);
}

async function importCandidateFromResume({ message, attachment, buffer, resumeText }) {
  const ext = path.extname(attachment.name || '.txt') || '.txt';
  const id = newId('cand');
  const safeName = `${id}${ext}`;
  const filePath = path.join(paths.uploads, safeName);
  await fs.writeFile(filePath, buffer);

  const sender = message.from?.emailAddress || {};
  const inferredName =
    inferNameFromFile(attachment.name) ||
    sender.name ||
    inferNameFromFile(message.subject) ||
    '';
  const email = sender.address || parseEmailAddress(message.bodyPreview) || '';
  const candidate = await upsertCandidate({
    id,
    name: inferredName,
    email,
    source: 'outlook',
    status: '待筛选',
    messageId: message.id,
    messageSubject: message.subject,
    receivedAt: message.receivedDateTime,
    resumeFile: {
      path: filePath,
      originalName: attachment.name,
      size: buffer.length,
      mimeType: attachment.contentType || ''
    },
    resumeText,
    screening: null,
    timeline: [
      {
        at: new Date().toISOString(),
        action: '从 Outlook 邮件附件导入简历',
        detail: message.subject
      }
    ]
  });
  return candidate;
}

export async function syncOutlookResumes({ query = '超级智能体 实习申请', limit = 20, mock = false } = {}) {
  if (mock) {
    const candidate = await upsertCandidate({
      id: newId('cand'),
      name: '张婧仪',
      email: 'jingyi@example.com',
      source: 'mock',
      status: '待筛选',
      messageId: sampleMessage().id,
      messageSubject: sampleMessage().subject,
      receivedAt: new Date().toISOString(),
      resumeFile: {
        path: null,
        originalName: '张婧仪-简历.txt',
        size: sampleResumeText.length,
        mimeType: 'text/plain'
      },
      resumeText: sampleResumeText,
      screening: null,
      timeline: [
        {
          at: new Date().toISOString(),
          action: '导入内置样例简历',
          detail: '用于验证筛选、面邀和日程预定链路'
        }
      ]
    });
    return { mode: 'mock', imported: [candidate], scannedMessages: 1 };
  }

  const messagesResponse = await graphRequest(
    `/me/messages?$top=${Math.min(Number(limit) || 20, 100)}&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview&$orderby=receivedDateTime desc`,
    {
      headers: {
        Prefer: 'outlook.body-content-type="text"'
      }
    }
  );
  const keywords = String(query || '')
    .split(/\s+/)
    .filter(Boolean);
  const messages = (messagesResponse.value || []).filter((message) => {
    const haystack = `${message.subject || ''} ${message.bodyPreview || ''}`;
    return message.hasAttachments && keywords.every((keyword) => haystack.includes(keyword));
  });

  const imported = [];
  for (const message of messages) {
    const attachmentResponse = await graphRequest(`/me/messages/${encodeURIComponent(message.id)}/attachments`);
    for (const attachment of attachmentResponse.value || []) {
      if (!isResumeAttachment(attachment)) continue;
      const buffer = attachment.contentBytes
        ? Buffer.from(attachment.contentBytes, 'base64')
        : await graphBinaryRequest(
            `/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}/$value`
          );
      const tempPath = path.join(paths.uploads, `${newId('tmp')}${path.extname(attachment.name || '.txt')}`);
      await fs.writeFile(tempPath, buffer);
      const resumeText = await extractResumeText(tempPath, attachment.contentType);
      await fs.rm(tempPath, { force: true });
      imported.push(await importCandidateFromResume({ message, attachment, buffer, resumeText }));
    }
  }

  return { mode: 'live', imported, scannedMessages: messagesResponse.value?.length || 0 };
}

export async function screenCandidate(candidate) {
  const screening = await screenResume({ resumeText: candidate.resumeText || '', candidate });
  const status = candidate.manualReview
    ? candidate.status
    : '待人工确认';
  return patchCandidate(candidate.id, {
    screening,
    status,
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: `完成岗位匹配评估：${screening.recommendation}`,
        detail: `分数 ${screening.score}，来源 ${screening.source}`
      }
    ]
  });
}

export async function sendInterviewMail({ candidate, email }) {
  return graphRequest('/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: email.subject,
        body: {
          contentType: 'HTML',
          content: email.bodyHtml
        },
        toRecipients: [
          {
            emailAddress: {
              address: candidate.email,
              name: candidate.name || candidate.screening?.candidate_name || ''
            }
          }
        ]
      },
      saveToSentItems: true
    })
  });
}

export async function createInterviewEvent({ event }) {
  return graphRequest('/me/calendar/events', {
    method: 'POST',
    body: JSON.stringify(event)
  });
}
