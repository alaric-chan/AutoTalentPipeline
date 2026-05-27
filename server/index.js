import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config, paths, publicConfigStatus } from './config.js';
import {
  addVerificationRun,
  candidateIdentityKey,
  createSession,
  deleteSessionByTokenHash,
  deleteUser,
  getCandidate,
  getSettings,
  getSessionByTokenHash,
  getUser,
  getUserByUsername,
  listCandidates,
  listUsers,
  listVerificationRuns,
  newId,
  patchCandidate,
  patchSettings,
  patchUser,
  upsertUser,
  upsertCandidate
} from './store.js';
import { extractResumeProfile, extractResumeText, parseEmailAddress, parsePhoneNumber } from './resumeParser.js';
import {
  buildAuthUrl,
  buildPublicAuthUrl,
  createInterviewEvent,
  getOutlookStatus,
  handleOAuthCallback,
  handlePublicOAuthCallback,
  pollDeviceCodeFlow,
  screenCandidate,
  startDeviceCodeFlow,
  syncOutlookResumes
} from './graphService.js';
import {
  buildCalendarEvent,
  buildInterviewEmail,
  buildOfferEmail,
  buildOutlookWebCalendarUrl,
  buildOutlookWebMailUrl,
  defaultInterviewTemplate,
  normalizeInterviewTemplate
} from './templates.js';
import { exportInterviewArtifacts } from './interviewArtifacts.js';
import { createOutlookDraftAndCalendar } from './outlookDesktopService.js';
import {
  getLarkStatus,
  listLarkFields,
  listLarkTables,
  pullLarkCandidates
} from './larkBaseService.js';
import { pullInterviewSheetCandidates } from './interviewSheetService.js';

await fs.mkdir(paths.uploads, { recursive: true });
await fs.mkdir(paths.larkDownloads, { recursive: true });

const app = express();
const upload = multer({ dest: paths.uploads });
const allowedResumeExtensions = new Set(['.pdf', '.doc', '.docx', '.txt', '.md']);
let larkSyncState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastStatus: 'idle',
  lastError: '',
  lastImported: 0,
  lastScanned: 0,
  trigger: ''
};
const hasBuiltFrontend = await fs
  .access(path.join(paths.dist, 'index.html'))
  .then(() => true)
  .catch(() => false);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (hasBuiltFrontend) {
  app.use(express.static(paths.dist));
}

function getRequestToken(req) {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return req.get('x-app-token') || bearer || req.query?.token || '';
}

function tokenMatches(value) {
  const expected = config.security.authToken;
  if (!expected) return false;
  const input = String(value || '');
  const expectedBuffer = Buffer.from(expected);
  const inputBuffer = Buffer.from(input);
  return (
    expectedBuffer.length === inputBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, inputBuffer)
  );
}

function normalizeUsername(value = '') {
  return String(value).trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const iterations = 120000;
  const key = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${iterations}$${salt}$${key}`;
}

function verifyPassword(password, storedHash = '') {
  const [scheme, iterations, salt, expectedKey] = String(storedHash).split('$');
  if (scheme !== 'pbkdf2_sha256' || !iterations || !salt || !expectedKey) return false;
  const key = crypto
    .pbkdf2Sync(String(password), salt, Number(iterations), 32, 'sha256')
    .toString('hex');
  const expected = Buffer.from(expectedKey);
  const actual = Buffer.from(key);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || 'member',
    status: user.status || 'active',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function validateUsername(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    const error = new Error('账号名需为 3-32 位，可使用字母、数字、点、下划线和短横线。');
    error.status = 400;
    throw error;
  }
  return normalized;
}

async function ensureDefaultAdmin() {
  const users = await listUsers();
  const hasActiveAdmin = users.some((user) => user.role === 'admin' && user.status !== 'disabled');
  const username = validateUsername(config.security.initialAdminUsername);
  if (hasActiveAdmin) return;
  const existing = await getUserByUsername(username);
  const adminPatch = {
    username,
    displayName: existing?.displayName || '陈百科',
    role: 'admin',
    status: 'active',
    passwordHash: existing?.passwordHash || hashPassword(config.security.initialAdminPassword)
  };
  await upsertUser(existing ? { ...existing, ...adminPatch } : adminPatch);
}

async function resolveAuth(req) {
  const token = getRequestToken(req);
  if (token) {
    const tokenHash = hashSessionToken(token);
    const session = await getSessionByTokenHash(tokenHash);
    if (session) {
      const user = await getUser(session.userId);
      if (user?.status === 'active') {
        return { authenticated: true, mode: 'session', user };
      }
    }
    if (tokenMatches(token)) {
      return {
        authenticated: true,
        mode: 'legacy-token',
        user: {
          id: 'legacy-token',
          username: 'legacy-token',
          displayName: 'Legacy Token',
          role: 'admin',
          status: 'active'
        }
      };
    }
  }
  return { authenticated: false, mode: 'none', user: null };
}

function requireAdmin(req) {
  if (req.currentUser?.role === 'admin') return;
  const error = new Error('需要管理员权限。');
  error.status = 403;
  throw error;
}

async function wouldRemoveLastActiveAdmin(targetUser, patch = {}) {
  const targetStatus = targetUser?.status || 'active';
  if (!targetUser || targetUser.role !== 'admin' || targetStatus === 'disabled') return false;
  const nextRole = patch.role ?? targetUser.role;
  const nextStatus = patch.status ?? targetStatus;
  if (nextRole === 'admin' && nextStatus === 'active') return false;
  const users = await listUsers();
  return !users.some(
    (user) => user.id !== targetUser.id && user.role === 'admin' && user.status === 'active'
  );
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireCandidate(candidate) {
  if (!candidate) {
    const error = new Error('候选人不存在。');
    error.status = 404;
    throw error;
  }
  return candidate;
}

async function autoScreenNewCandidate(candidate) {
  const screened = await screenCandidate({
    ...candidate,
    status: '待人工确认',
    manualReview: candidate.manualReview || null
  });
  await addVerificationRun({
    type: 'resume-auto-screen',
    status: 'passed',
    detail: `${screened.name || screened.email || screened.id}：自动初筛 ${screened.screening.recommendation} / ${screened.screening.score}`,
    mode: screened.screening.source
  });
  return screened;
}

async function findExistingCandidate(candidate) {
  const existingById = await getCandidate(candidate.id);
  if (existingById) return existingById;
  const identityKey = candidateIdentityKey(candidate);
  if (!identityKey) return null;
  const candidates = await listCandidates();
  return candidates.find((item) => (item.identityKey || candidateIdentityKey(item)) === identityKey) || null;
}

function getLarkSyncState() {
  return { ...larkSyncState };
}

async function syncLarkBaseCandidates(options = {}, { trigger = 'manual', mode = '' } = {}) {
  if (larkSyncState.running) {
    const error = new Error('飞书同步正在进行中，请稍后刷新。');
    error.status = 409;
    throw error;
  }

  const startedAt = new Date().toISOString();
  larkSyncState = {
    ...larkSyncState,
    running: true,
    lastStartedAt: startedAt,
    lastStatus: 'running',
    lastError: '',
    trigger
  };

  try {
    const existingCandidates = await listCandidates();
    const existingByRecordId = new Map(
      existingCandidates
        .filter((candidate) => candidate.lark?.recordId)
        .map((candidate) => [String(candidate.lark.recordId), candidate])
    );
    const skipResumeDownloadRecordIds = existingCandidates
      .filter((candidate) => candidate.lark?.recordId && (candidate.resumeFile?.path || candidate.resumeText))
      .map((candidate) => String(candidate.lark.recordId));
    const result = await pullLarkCandidates({
      ...options,
      skipResumeDownloadRecordIds
    });
    const imported = [];

    for (const candidate of result.candidates) {
      const recordId = candidate.lark?.recordId ? String(candidate.lark.recordId) : '';
      const existing = existingByRecordId.get(recordId) || await findExistingCandidate(candidate);
      const isNewCandidate = !existing;
      let saved = await upsertCandidate({
        ...candidate,
        status: existing?.status || candidate.status,
        receivedAt: candidate.receivedAt || existing?.receivedAt || candidate.createdAt || '',
        isNew: existing ? Boolean(existing.isNew) : true,
        newAt: existing?.newAt || (isNewCandidate ? new Date().toISOString() : null),
        viewedAt: existing?.viewedAt || null,
        manualReview: existing?.manualReview || null,
        screening: existing?.screening || candidate.screening || null,
        resumeFile: candidate.resumeFile || existing?.resumeFile || null,
        resumeText: candidate.resumeFile || !existing?.resumeText ? candidate.resumeText : existing.resumeText,
        timeline: [
          ...(existing?.timeline || []),
          {
            at: new Date().toISOString(),
            action: trigger === 'auto' ? '服务器自动同步飞书投递记录' : '从飞书多维表格同步投递记录',
            detail: candidate.lark?.recordId || candidate.email || candidate.name
          }
        ]
      });
      if (isNewCandidate && !saved.screening) {
        saved = await autoScreenNewCandidate(saved);
      }
      imported.push(stripPrivateCandidate(saved));
    }

    await addVerificationRun({
      type: trigger === 'auto' ? 'lark-base-auto-sync' : 'lark-base-sync',
      status: 'passed',
      detail: `飞书 Base 拉取 ${result.candidates.length} 条投递，导入/更新 ${imported.length} 位候选人`,
      mode: mode || `${result.profile}/${result.as}/${trigger}`
    });
    larkSyncState = {
      ...larkSyncState,
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastStatus: 'passed',
      lastError: '',
      lastImported: imported.length,
      lastScanned: result.candidates.length
    };
    return { ...result, candidates: undefined, imported };
  } catch (error) {
    larkSyncState = {
      ...larkSyncState,
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastStatus: 'failed',
      lastError: error.message || '飞书同步失败'
    };
    throw error;
  }
}

function reviewStatus(decision, fallback = '待人工确认') {
  if (decision === 'pass') return '待邀约';
  if (decision === 'reject') return '不通过';
  return fallback;
}

function maskEmail(value = '') {
  const email = String(value || '').trim();
  const [name, domain] = email.split('@');
  if (!name || !domain) return '';
  const visible = name.length <= 2 ? name.slice(0, 1) : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${visible}@${domain}`;
}

function maskPhone(value = '') {
  const phone = String(value || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone ? '已填写' : '';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function cleanProfileText(value = '', maxLength = 120) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanProfileEmail(value = '') {
  const text = cleanProfileText(value, 160);
  if (!text) return '';
  const email = parseEmailAddress(text);
  if (!email || email !== text) {
    const error = new Error('联系邮箱格式不正确。');
    error.status = 400;
    throw error;
  }
  return email;
}

function cleanProfilePhone(value = '') {
  return cleanProfileText(value, 40);
}

function firstExistingField(fields, aliases, fallback) {
  return aliases.find((alias) => Object.prototype.hasOwnProperty.call(fields, alias)) || fallback;
}

function updateField(fields, aliases, fallback, value) {
  const key = firstExistingField(fields, aliases, fallback);
  if (value) {
    fields[key] = value;
  } else {
    delete fields[key];
  }
  return key;
}

function buildProfilePatch(candidate, body = {}) {
  const fields = { ...(candidate.application?.fields || {}) };
  const picked = { ...(candidate.application?.picked || {}) };
  const name = cleanProfileText(body.name, 48);
  const email = cleanProfileEmail(body.email);
  const phone = cleanProfilePhone(body.phone);
  const arrival = cleanProfileText(body.arrival, 80);
  const duration = cleanProfileText(body.duration, 80);
  const receivedAt = cleanProfileText(body.receivedAt, 80);
  const degree = cleanProfileText(body.degree, 80);
  const schoolBackground = cleanProfileText(body.schoolBackground, 160);
  picked.name = updateField(fields, ['姓名', '名字', '候选人', '应聘者', 'Name'], picked.name || '姓名', name);
  picked.email = updateField(fields, ['联系邮箱', '邮箱', '电子邮箱', 'Email', 'email'], picked.email || '联系邮箱', email);
  picked.phone = updateField(fields, ['联系电话', '手机', '电话', '手机号', '联系方式'], picked.phone || '联系电话', phone);
  updateField(fields, ['学历', '学位', '最高学历', 'Degree'], '学历', degree);
  updateField(fields, ['院校背景', '教育背景', '学校背景'], '院校背景', schoolBackground);
  updateField(fields, ['最快到岗时间', '预计入职时间', '到岗时间', '最快到岗'], '最快到岗时间', arrival);
  updateField(fields, ['可实习时长', '实习时长', '可实习月份'], '可实习时长', duration);
  updateField(fields, ['投递时间', '提交时间', '提交日期', '创建时间', '导入时间'], '投递时间', receivedAt);

  const nextCandidate = {
    ...candidate,
    name,
    email,
    phone,
    degree,
    school: schoolBackground || candidate.school || '',
    receivedAt,
    application: {
      ...(candidate.application || {}),
      fields,
      picked
    }
  };
  return {
    name,
    email,
    phone,
    degree,
    school: schoolBackground || candidate.school || '',
    receivedAt,
    application: nextCandidate.application,
    identityKey: candidateIdentityKey(nextCandidate),
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: '编辑候选人投递档案',
        detail: [name, email, phone].filter(Boolean).join(' · ')
      }
    ]
  };
}

function resumeContentType(file = {}) {
  const name = file.originalName || file.path || '';
  if (file.mimeType) return file.mimeType;
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.docx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.doc$/i.test(name)) return 'application/msword';
  if (/\.md$/i.test(name)) return 'text/markdown; charset=utf-8';
  if (/\.txt$/i.test(name)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function assertAllowedResumePath(filePath = '') {
  const resolved = path.resolve(filePath);
  const allowedRoots = [paths.uploads, paths.larkDownloads].map((item) => path.resolve(item));
  const isAllowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!isAllowed) {
    const error = new Error('简历文件路径不在允许的存储目录内。');
    error.status = 403;
    throw error;
  }
  return resolved;
}

async function assertAllowedResumeUpload(file) {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (allowedResumeExtensions.has(ext)) return ext;
  await fs.unlink(file.path).catch(() => {});
  const error = new Error('只支持上传 PDF、Word、TXT 或 Markdown 简历文件。');
  error.status = 400;
  throw error;
}

function pickApplicationFields(fields = {}) {
  const allowed = [
    '面试时间',
    '预计入职时间',
    '实习时长',
    '面试官',
    'offer情况'
  ];
  return Object.fromEntries(allowed.filter((key) => key in fields).map((key) => [key, fields[key]]));
}

function stripPrivateCandidate(candidate, { detail = false } = {}) {
  if (!candidate) return candidate;
  const safe = JSON.parse(JSON.stringify(candidate));
  if (safe.lark?.baseToken) delete safe.lark.baseToken;
  if (safe.resumeFile?.path) delete safe.resumeFile.path;
  if (safe.interview?.artifacts) {
    safe.interview.artifacts = {
      ...safe.interview.artifacts,
      emlPath: safe.interview.artifacts.emlPath ? path.basename(safe.interview.artifacts.emlPath) : '',
      icsPath: safe.interview.artifacts.icsPath ? path.basename(safe.interview.artifacts.icsPath) : ''
    };
  }
  if (detail) {
    safe.emailMasked = maskEmail(safe.email);
    safe.phoneMasked = maskPhone(safe.phone);
    safe.hasEmail = Boolean(safe.email);
    safe.hasPhone = Boolean(safe.phone);
    return safe;
  }

  return {
    id: safe.id,
    identityKey: safe.identityKey,
    name: safe.name,
    phone: safe.phone,
    emailMasked: maskEmail(safe.email),
    phoneMasked: maskPhone(safe.phone),
    hasEmail: Boolean(safe.email),
    hasPhone: Boolean(safe.phone),
    school: safe.school,
    degree: safe.degree,
    major: safe.major,
    source: safe.source,
    status: safe.status,
    messageSubject: safe.messageSubject,
    receivedAt: safe.receivedAt,
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt,
    isNew: safe.isNew,
    newAt: safe.newAt,
    viewedAt: safe.viewedAt,
    screening: safe.screening,
    manualReview: safe.manualReview,
    offer: safe.offer,
    offerRecords: safe.offerRecords,
    interview: safe.interview,
    interviewRecord: safe.interviewRecord
      ? {
          rowNumber: safe.interviewRecord.rowNumber,
          interviewTime: safe.interviewRecord.interviewTime,
          expectedOnboard: safe.interviewRecord.expectedOnboard,
          duration: safe.interviewRecord.duration,
          interviewer: safe.interviewRecord.interviewer,
          offerStatus: safe.interviewRecord.offerStatus
        }
      : null,
    interviewRecords: safe.interviewRecords,
    application: safe.application
      ? {
          fields: pickApplicationFields(safe.application.fields || {}),
          picked: safe.application.picked || {}
        }
      : null,
    resumeFile: safe.resumeFile
      ? {
          originalName: safe.resumeFile.originalName,
          size: safe.resumeFile.size,
          mimeType: safe.resumeFile.mimeType
        }
      : null
  };
}

await ensureDefaultAdmin();

app.get('/api/security/status', asyncRoute(async (req, res) => {
  const auth = await resolveAuth(req);
  res.json({
    authRequired: true,
    authenticated: auth.authenticated,
    authMode: auth.mode,
    user: sanitizeUser(auth.user),
    localOnly: config.host === '127.0.0.1' || config.host === 'localhost',
    legacyTokenEnabled: Boolean(config.security.authToken)
  });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const user = username ? await getUserByUsername(username) : null;
  if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: '账号或密码不正确。' });
    return;
  }
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.security.sessionDays * 24 * 60 * 60 * 1000).toISOString();
  await createSession({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
    userAgent: req.get('user-agent') || '',
    ip: req.ip
  });
  const updated = await patchUser(user.id, { lastLoginAt: new Date().toISOString() });
  res.json({ ok: true, token, user: sanitizeUser(updated || user), expiresAt });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = getRequestToken(req);
  if (token) await deleteSessionByTokenHash(hashSessionToken(token));
  res.json({ ok: true });
}));

app.post('/api/security/login', (req, res) => {
  if (!config.security.authToken || !tokenMatches(req.body?.token)) {
    res.status(401).json({ error: '平台访问令牌不正确。' });
    return;
  }
  res.json({
    ok: true,
    legacy: true,
    user: sanitizeUser({
      id: 'legacy-token',
      username: 'legacy-token',
      displayName: 'Legacy Token',
      role: 'admin',
      status: 'active'
    })
  });
});

app.use('/api', asyncRoute(async (req, res, next) => {
  if (
    (req.method === 'GET' && req.path === '/outlook/callback') ||
    (req.method === 'GET' && req.path === '/outlook/public-callback')
  ) {
    next();
    return;
  }
  const auth = await resolveAuth(req);
  if (auth.authenticated) {
    req.currentUser = auth.user;
    req.authMode = auth.mode;
    next();
    return;
  }
  res.status(401).json({ error: '请先登录工作台。' });
}));

app.get('/api/users', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const users = await listUsers();
  res.json({ users: users.map(sanitizeUser) });
}));

app.post('/api/users', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const username = validateUsername(req.body?.username);
  const password = String(req.body?.password || '');
  if (password.length < 6) {
    const error = new Error('初始密码至少 6 位。');
    error.status = 400;
    throw error;
  }
  if (await getUserByUsername(username)) {
    const error = new Error('账号名已存在。');
    error.status = 409;
    throw error;
  }
  const user = await upsertUser({
    username,
    displayName: String(req.body?.displayName || username).trim(),
    role: req.body?.role === 'admin' ? 'admin' : 'member',
    status: req.body?.status === 'disabled' ? 'disabled' : 'active',
    passwordHash: hashPassword(password)
  });
  await addVerificationRun({
    type: 'account-create',
    status: 'passed',
    detail: `管理员创建账号 ${user.username}`,
    mode: req.currentUser?.username || req.authMode
  });
  res.status(201).json({ user: sanitizeUser(user) });
}));

app.patch('/api/users/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  const target = await getUser(req.params.id);
  if (!target) {
    const error = new Error('账号不存在。');
    error.status = 404;
    throw error;
  }
  const patch = {};
  if (req.body?.displayName != null) patch.displayName = String(req.body.displayName).trim();
  if (req.body?.role != null) patch.role = req.body.role === 'admin' ? 'admin' : 'member';
  if (req.body?.status != null) patch.status = req.body.status === 'disabled' ? 'disabled' : 'active';
  if (req.body?.password) {
    const password = String(req.body.password);
    if (password.length < 6) {
      const error = new Error('新密码至少 6 位。');
      error.status = 400;
      throw error;
    }
    patch.passwordHash = hashPassword(password);
  }
  if (await wouldRemoveLastActiveAdmin(target, patch)) {
    const error = new Error('至少需要保留一个可用管理员账号。');
    error.status = 400;
    throw error;
  }
  const updated = await patchUser(target.id, patch);
  await addVerificationRun({
    type: 'account-update',
    status: 'passed',
    detail: `管理员更新账号 ${updated.username}`,
    mode: req.currentUser?.username || req.authMode
  });
  res.json({ user: sanitizeUser(updated) });
}));

app.delete('/api/users/:id', asyncRoute(async (req, res) => {
  requireAdmin(req);
  if (req.currentUser?.id === req.params.id) {
    const error = new Error('不能删除当前登录账号。');
    error.status = 400;
    throw error;
  }
  const target = await getUser(req.params.id);
  if (!target) {
    const error = new Error('账号不存在。');
    error.status = 404;
    throw error;
  }
  if (await wouldRemoveLastActiveAdmin(target, { status: 'disabled' })) {
    const error = new Error('至少需要保留一个可用管理员账号。');
    error.status = 400;
    throw error;
  }
  await deleteUser(target.id);
  await addVerificationRun({
    type: 'account-delete',
    status: 'passed',
    detail: `管理员删除账号 ${target.username}`,
    mode: req.currentUser?.username || req.authMode
  });
  res.json({ ok: true });
}));

app.get('/api/health', asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    config: publicConfigStatus(),
    outlook: await getOutlookStatus(),
    larkSync: getLarkSyncState()
  });
}));

app.get('/api/outlook/status', asyncRoute(async (req, res) => {
  res.json(await getOutlookStatus());
}));

app.get('/api/settings/interview-template', asyncRoute(async (req, res) => {
  const settings = await getSettings();
  res.json({
    template: normalizeInterviewTemplate(settings.interviewTemplate || defaultInterviewTemplate),
    variables: [
      'name',
      'position',
      'timeText',
      'location',
      'contactName',
      'contactPhone',
      'contactEmail',
      'candidateEmail'
    ]
  });
}));

app.put('/api/settings/interview-template', asyncRoute(async (req, res) => {
  const template = normalizeInterviewTemplate(req.body?.template || req.body || {});
  if (!template.subject.trim() || !template.body.trim()) {
    const error = new Error('面邀模板的主题和正文不能为空。');
    error.status = 400;
    throw error;
  }
  const settings = await patchSettings({ interviewTemplate: template });
  await addVerificationRun({
    type: 'interview-template',
    status: 'passed',
    detail: '面邀模板已更新',
    mode: 'settings'
  });
  res.json({ template: normalizeInterviewTemplate(settings.interviewTemplate) });
}));

app.post('/api/settings/interview-template/reset', asyncRoute(async (req, res) => {
  const settings = await patchSettings({ interviewTemplate: defaultInterviewTemplate });
  await addVerificationRun({
    type: 'interview-template',
    status: 'passed',
    detail: '面邀模板已恢复默认',
    mode: 'settings'
  });
  res.json({ template: normalizeInterviewTemplate(settings.interviewTemplate) });
}));

app.get('/api/outlook/auth-url', asyncRoute(async (req, res) => {
  res.json({ authUrl: await buildAuthUrl() });
}));

app.get('/api/outlook/public-auth-url', asyncRoute(async (req, res) => {
  res.json({ authUrl: await buildPublicAuthUrl() });
}));

app.post('/api/outlook/device-code/start', asyncRoute(async (req, res) => {
  res.json(await startDeviceCodeFlow());
}));

app.post('/api/outlook/device-code/poll', asyncRoute(async (req, res) => {
  res.json(await pollDeviceCodeFlow());
}));

app.get('/api/outlook/callback', asyncRoute(async (req, res) => {
  await handleOAuthCallback({ code: req.query.code, state: req.query.state });
  res.redirect('/?outlook=connected');
}));

app.get('/api/outlook/public-callback', asyncRoute(async (req, res) => {
  await handlePublicOAuthCallback({
    code: req.query.code,
    state: req.query.state,
    error: req.query.error,
    error_description: req.query.error_description
  });
  res.redirect('/?outlook=connected');
}));

app.post('/api/outlook/sync', asyncRoute(async (req, res) => {
  const result = await syncOutlookResumes({
    query: req.body.query,
    limit: req.body.limit,
    mock: Boolean(req.body.mock)
  });
  await addVerificationRun({
    type: 'outlook-sync',
    status: 'passed',
    detail: `扫描 ${result.scannedMessages} 封邮件，导入 ${result.imported.length} 份简历`,
    mode: result.mode
  });
  const imported = [];
  for (const candidate of result.imported) {
    const existing = await findExistingCandidate(candidate);
    let saved = await patchCandidate(candidate.id, {
      isNew: existing?.isNew ?? true,
      newAt: existing?.newAt || new Date().toISOString()
    });
    if (!saved.screening) {
      saved = await autoScreenNewCandidate(saved);
    }
    imported.push(stripPrivateCandidate(saved));
  }
  res.json({ ...result, imported });
}));

app.get('/api/lark/status', asyncRoute(async (req, res) => {
  res.json(await getLarkStatus());
}));

app.post('/api/lark/tables', asyncRoute(async (req, res) => {
  res.json(await listLarkTables(req.body || {}));
}));

app.post('/api/lark/fields', asyncRoute(async (req, res) => {
  res.json(await listLarkFields(req.body || {}));
}));

app.post('/api/lark/sync', asyncRoute(async (req, res) => {
  const result = await syncLarkBaseCandidates(req.body || {}, {
    trigger: 'manual',
    mode: req.currentUser?.username || req.authMode
  });
  res.json({ ...result, syncState: getLarkSyncState() });
}));

app.post('/api/interview-sheet/sync', asyncRoute(async (req, res) => {
  if (!config.interviewSheet.enabled) {
    const error = new Error('历史面试表回填已隐藏。需要使用时请在 .env 设置 INTERVIEW_SHEET_ENABLED=true。');
    error.status = 400;
    throw error;
  }
  const result = await pullInterviewSheetCandidates(req.body || {});
  const imported = [];
  for (const candidate of result.candidates) {
    const existing = await getCandidate(candidate.id);
    const saved = await upsertCandidate({
      ...candidate,
      screening: existing?.screening || null,
      timeline: [
        ...(existing?.timeline || []),
        {
          at: new Date().toISOString(),
          action: '从真实面试表同步记录',
          detail: `${candidate.interviewRecord?.rowNumber || ''} ${candidate.name || candidate.phone || ''}`.trim()
        }
      ]
    });
    imported.push(stripPrivateCandidate(saved));
  }
  await addVerificationRun({
    type: 'interview-sheet-sync',
    status: 'passed',
    detail: `面试表读取 ${result.totalRows} 行，导入/更新 ${imported.length} 位候选人`,
    mode: `${result.profile}/${result.as}`
  });
  res.json({ ...result, candidates: undefined, imported });
}));

app.get('/api/candidates', asyncRoute(async (req, res) => {
  const candidates = await listCandidates();
  res.json(candidates.map((candidate) => stripPrivateCandidate(candidate)));
}));

app.get('/api/candidates/:id', asyncRoute(async (req, res) => {
  res.json(stripPrivateCandidate(requireCandidate(await getCandidate(req.params.id)), { detail: true }));
}));

app.patch('/api/candidates/:id/profile', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const patch = buildProfilePatch(candidate, req.body || {});
  const updated = await patchCandidate(candidate.id, patch);
  await addVerificationRun({
    type: 'candidate-profile-edit',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：投递档案已更新`,
    mode: req.currentUser?.username || req.authMode || 'manual'
  });
  res.json(stripPrivateCandidate(updated, { detail: true }));
}));

app.get('/api/candidates/:id/resume-file', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  if (!candidate.resumeFile?.path) {
    const error = new Error('候选人没有可预览的简历原文件。');
    error.status = 404;
    throw error;
  }
  const resumePath = assertAllowedResumePath(candidate.resumeFile.path);
  await fs.access(resumePath);
  const filename = candidate.resumeFile.originalName || path.basename(resumePath);
  res.setHeader('Content-Type', resumeContentType(candidate.resumeFile));
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.sendFile(resumePath);
}));

app.post('/api/candidates/upload', upload.single('resume'), asyncRoute(async (req, res) => {
  if (!req.file) {
    const error = new Error('请上传简历文件。');
    error.status = 400;
    throw error;
  }
  const ext = await assertAllowedResumeUpload(req.file);
  const stablePath = path.join(paths.uploads, `${newId('resume')}${ext}`);
  await fs.rename(req.file.path, stablePath);
  const resumeText = await extractResumeText(stablePath, req.file.mimetype);
  const parsedProfile = extractResumeProfile({
    text: resumeText,
    filename: req.file.originalname
  });
  const name = String(req.body.name || '').trim() || parsedProfile.name;
  const email = parseEmailAddress(req.body.email) || parsedProfile.email;
  const phone = parsePhoneNumber(req.body.phone) || parsedProfile.phone;
  let candidate = await upsertCandidate({
    id: newId('cand'),
    name,
    email,
    phone,
    source: 'manual',
    status: '待人工确认',
    receivedAt: new Date().toISOString(),
    isNew: true,
    newAt: new Date().toISOString(),
    viewedAt: null,
    resumeFile: {
      path: stablePath,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    },
    resumeText,
    application: {
      fields: {
        姓名: name,
        联系邮箱: email,
        联系电话: phone,
        简历文件: req.file.originalname
      },
      picked: {
        name: name ? 'resume-auto-parse' : '',
        email: email ? 'resume-auto-parse' : '',
        phone: phone ? 'resume-auto-parse' : ''
      }
    },
    screening: null,
    timeline: [
      {
        at: new Date().toISOString(),
        action: '人工上传简历',
        detail: [req.file.originalname, name, email, phone].filter(Boolean).join(' · ')
      }
    ]
  });
  candidate = await autoScreenNewCandidate(candidate);
  res.json(stripPrivateCandidate(candidate, { detail: true }));
}));

app.post('/api/candidates/:id/screen', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const screened = await screenCandidate(candidate);
  await addVerificationRun({
    type: 'resume-screen',
    status: 'passed',
    detail: `${screened.name || screened.email || screened.id}：${screened.screening.recommendation} / ${screened.screening.score}`,
    mode: screened.screening.source
  });
  res.json(stripPrivateCandidate(screened, { detail: true }));
}));

app.post('/api/candidates/:id/viewed', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const updated = await patchCandidate(candidate.id, {
    isNew: false,
    viewedAt: new Date().toISOString()
  });
  res.json(stripPrivateCandidate(updated, { detail: true }));
}));

app.post('/api/candidates/:id/review', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const decision = req.body?.decision;
  if (!['pass', 'reject', 'undo'].includes(decision)) {
    const error = new Error('人工判断只支持 pass、reject 或 undo。');
    error.status = 400;
    throw error;
  }
  const nextManualReview =
    decision === 'undo'
      ? null
      : {
          decision,
          decidedAt: new Date().toISOString(),
          decidedBy: req.body.decidedBy || config.recruiting.contactName,
          previousStatus: candidate.status || ''
        };
  const nextStatus =
    decision === 'undo'
      ? candidate.screening
        ? '待人工确认'
        : '待筛选'
      : reviewStatus(decision);
  const updated = await patchCandidate(candidate.id, {
    status: nextStatus,
    manualReview: nextManualReview,
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action:
          decision === 'pass'
            ? '人工通过，进入面试邀约'
            : decision === 'reject'
              ? '人工不通过'
              : '撤销人工判断',
        detail: req.body.reason || ''
      }
    ]
  });
  await addVerificationRun({
    type: 'manual-review',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：${decision === 'pass' ? '通过' : decision === 'reject' ? '不通过' : '撤销判断'}`,
    mode: 'manual'
  });
  res.json(stripPrivateCandidate(updated, { detail: true }));
}));

async function interviewPayload(candidate, body) {
  const settings = await getSettings();
  const template = normalizeInterviewTemplate(settings.interviewTemplate || defaultInterviewTemplate);
  const start = body.start || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const end =
    body.end ||
    new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString().slice(0, 16);
  const interview = {
    start,
    end,
    locationOrLink: body.locationOrLink || '线上面试间',
    contactName: body.contactName || config.recruiting.contactName,
    contactPhone: body.contactPhone || config.recruiting.contactPhone
  };
  const email = buildInterviewEmail({ candidate, interview, template });
  const event = buildCalendarEvent({ candidate, interview, emailBodyHtml: email.bodyHtml });
  const webCalendarUrl = buildOutlookWebCalendarUrl({ event, interview, email, candidate });
  return { interview, email, event, template, webCalendarUrl };
}

function statusFromInterviewDecision(decision = '') {
  const value = String(decision);
  if (/offer|录用|强推|通过/i.test(value)) return 'Offer跟进';
  if (/备选|候补/i.test(value)) return '备选';
  if (/不通过|淘汰|拒绝/i.test(value)) return '不通过';
  return '面试记录';
}

app.post('/api/candidates/:id/interview/preview', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  res.json(await interviewPayload(candidate, req.body));
}));

app.post('/api/candidates/:id/interview/schedule', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const payload = await interviewPayload(candidate, req.body);
  const live = Boolean(req.body.live);
  const actions = [];

  if (live) {
    if (!candidate.email) {
      const error = new Error('候选人缺少邮箱，无法真实发送面邀或创建参会人。');
      error.status = 400;
      throw error;
    }
    const outlook = await getOutlookStatus();
    if (!outlook.connected) {
      const error = new Error('Outlook 尚未连接，不能执行真实发送。请先完成 OAuth 连接。');
      error.status = 400;
      throw error;
    }
    const eventResult = await createInterviewEvent({ event: payload.event });
    actions.push({
      type: 'calendar',
      status: 'created',
      id: eventResult.id || null,
      webLink: eventResult.webLink || null
    });
    actions.push({
      type: 'teams-meeting',
      status: eventResult.onlineMeeting?.joinUrl ? 'created' : 'pending-sync',
      joinUrl: eventResult.onlineMeeting?.joinUrl || null
    });
    actions.push({ type: 'meeting-invite', status: 'sent-by-outlook-calendar' });
  } else {
    actions.push({ type: 'calendar', status: 'dry-run' });
    actions.push({ type: 'email', status: 'dry-run' });
  }

  const updated = await patchCandidate(candidate.id, {
    status: live ? '已预约面试' : '面试待确认',
    interview: {
      ...payload.interview,
      subject: payload.email.subject,
      live,
      inviteStatus: live ? 'graph-sent' : 'dry-run',
      graphEventId: live ? actions.find((item) => item.type === 'calendar')?.id || null : null,
      teamsJoinUrl: live ? actions.find((item) => item.type === 'teams-meeting')?.joinUrl || null : null,
      actions
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: live ? '已创建 Outlook/Teams 日程邀请' : '已生成面邀和日程预览',
        detail: payload.email.subject
      }
    ]
  });

  await addVerificationRun({
    type: 'interview-schedule',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：${live ? '真实发送' : 'dry-run 验证'}`,
    mode: live ? 'live' : 'dry-run'
  });

  res.json({ candidate: stripPrivateCandidate(updated, { detail: true }), payload, actions });
}));

app.post('/api/candidates/:id/interview/export', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const payload = await interviewPayload(candidate, req.body);
  const artifacts = await exportInterviewArtifacts({
    candidate,
    interview: payload.interview,
    email: payload.email
  });
  const updated = await patchCandidate(candidate.id, {
    status: '面邀包已生成',
    interview: {
      ...payload.interview,
      artifacts
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: '已生成面邀邮件与 ICS 日程邀请文件',
        detail: artifacts.emlPath
      }
    ]
  });
  await addVerificationRun({
    type: 'interview-artifacts',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：已生成 .eml 与 .ics`,
    mode: artifacts.missingEmail ? 'desktop-fallback/manual-email' : 'desktop-fallback'
  });
  res.json({ candidate: stripPrivateCandidate(updated, { detail: true }), payload, artifacts });
}));

app.post('/api/candidates/:id/interview/outlook-web-calendar', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const payload = await interviewPayload(candidate, req.body);
  const updated = await patchCandidate(candidate.id, {
    status: 'Outlook日程待发送',
    interview: {
      ...payload.interview,
      webCalendarUrl: payload.webCalendarUrl,
      subject: payload.email.subject,
      inviteStatus: 'web-link-generated',
      inviteGeneratedAt: new Date().toISOString(),
      actions: [
        { type: 'outlook-web-calendar', status: 'link-generated' },
        { type: 'teams-meeting', status: 'pending-user-send' }
      ]
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: '已打开 Outlook Web 日程邀请',
        detail: payload.event.subject
      }
    ]
  });
  await addVerificationRun({
    type: 'outlook-web-calendar',
    status: 'pending',
    detail: `${updated.name || updated.email || updated.id}：已生成 Outlook Web 日程邀请链接，待人工发送确认`,
    mode: 'exchange-web-meeting-compose'
  });
  res.json({ candidate: stripPrivateCandidate(updated, { detail: true }), payload, webCalendarUrl: payload.webCalendarUrl });
}));

app.post('/api/candidates/:id/interview/outlook-web-mail', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  if (!candidate.email) {
    const error = new Error('候选人缺少邮箱，无法打开 Outlook 邮件草稿。');
    error.status = 400;
    throw error;
  }
  const payload = await interviewPayload(candidate, req.body);
  const webMailUrl = buildOutlookWebMailUrl({ email: payload.email, candidate });
  const updated = await patchCandidate(candidate.id, {
    status: 'Outlook邮件待发送',
    interview: {
      ...(candidate.interview || {}),
      ...payload.interview,
      webMailUrl,
      subject: payload.email.subject,
      emailDraftStatus: 'web-mail-generated',
      emailDraftGeneratedAt: new Date().toISOString(),
      actions: [
        ...((candidate.interview || {}).actions || []).filter((item) => item.type !== 'outlook-web-mail'),
        { type: 'outlook-web-mail', status: 'link-generated' }
      ]
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: '已打开 Outlook 邮件草稿',
        detail: payload.email.subject
      }
    ]
  });
  await addVerificationRun({
    type: 'outlook-web-mail',
    status: 'pending',
    detail: `${updated.name || updated.email || updated.id}：已生成 Outlook 邮件草稿链接，待人工发送`,
    mode: 'outlook-web-mail-compose'
  });
  res.json({
    candidate: stripPrivateCandidate(updated, { detail: true }),
    payload: { ...payload, webMailUrl },
    webMailUrl
  });
}));

app.post('/api/candidates/:id/interview/confirm-sent', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const sentAt = new Date().toISOString();
  const updated = await patchCandidate(candidate.id, {
    status: '已预约面试',
    interview: {
      ...(candidate.interview || {}),
      inviteStatus: 'web-sent-confirmed',
      inviteSentAt: sentAt,
      teamsConfirmation: req.body?.teamsConfirmation || 'outlook-web',
      actions: [
        ...((candidate.interview || {}).actions || []).filter((item) => item.type !== 'meeting-invite-confirmation'),
        { type: 'meeting-invite-confirmation', status: 'confirmed-by-user', at: sentAt }
      ]
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: sentAt,
        action: '已确认 Outlook 日程邀请发送',
        detail: req.body?.note || '用户已在 Outlook Web/新 Outlook 点击发送'
      }
    ]
  });
  await addVerificationRun({
    type: 'outlook-web-calendar-confirm',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：已确认 Outlook 日程邀请发送`,
    mode: 'manual-confirmation'
  });
  res.json(stripPrivateCandidate(updated, { detail: true }));
}));

app.post('/api/candidates/:id/interview/outlook-desktop-draft', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const payload = await interviewPayload(candidate, req.body);
  const artifacts = await exportInterviewArtifacts({
    candidate,
    interview: payload.interview,
    email: payload.email
  });
  const desktop = await createOutlookDraftAndCalendar({
    candidate,
    interview: payload.interview,
    email: payload.email,
    icsPath: artifacts.icsPath,
    createCalendar: Boolean(req.body?.createLocalCalendar)
  });
  const updated = await patchCandidate(candidate.id, {
    status: 'Outlook草稿已打开',
    interview: {
      ...payload.interview,
      artifacts,
      desktop
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: desktop.mode === 'draft-and-calendar' ? '已打开 Outlook 草稿并写入本机日历' : '已打开 Outlook 草稿并生成网页日程链接',
        detail: payload.email.subject
      }
    ]
  });
  await addVerificationRun({
    type: 'outlook-desktop-draft',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：已打开 Outlook 草稿${desktop.mode === 'draft-and-calendar' ? '并创建本机日历事件' : '并生成网页日程链接'}`,
    mode: desktop.mode
  });
  res.json({ candidate: stripPrivateCandidate(updated, { detail: true }), payload, artifacts, desktop });
}));

app.post('/api/candidates/:id/interview/record', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const record = {
    id: newId('interview'),
    createdAt: new Date().toISOString(),
    interviewTime: req.body.interviewTime || candidate.interview?.start || '',
    interviewer: req.body.interviewer || config.recruiting.contactName,
    decision: req.body.decision || '待定',
    score: req.body.score === '' || req.body.score == null ? null : Number(req.body.score),
    communication: req.body.communication || '',
    aiUnderstanding: req.body.aiUnderstanding || '',
    productSense: req.body.productSense || '',
    motivation: req.body.motivation || '',
    strengths: req.body.strengths || '',
    concerns: req.body.concerns || '',
    summary: req.body.summary || '',
    nextAction: req.body.nextAction || ''
  };
  const updated = await patchCandidate(candidate.id, {
    status: req.body.nextStatus || statusFromInterviewDecision(record.decision),
    interviewRecords: [record, ...(candidate.interviewRecords || [])],
    interview: {
      ...(candidate.interview || {}),
      lastRecord: record
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: new Date().toISOString(),
        action: '记录面试表现',
        detail: `${record.decision}${record.score == null ? '' : ` / ${record.score}`}`
      }
    ]
  });
  await addVerificationRun({
    type: 'interview-record',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：面试记录 ${record.decision}`,
    mode: record.interviewer || 'manual'
  });
  res.json(stripPrivateCandidate(updated, { detail: true }));
}));

function statusFromOfferAcceptance(value = '') {
  const text = String(value || '');
  if (/已入职|入职完成/i.test(text)) return '已入职';
  if (/拒绝|放弃|不接受/i.test(text)) return 'Offer未接受';
  if (/待|考虑|沟通/i.test(text)) return 'Offer跟进';
  if (/接受|确认|同意/i.test(text)) return 'Offer已接受';
  return 'Offer跟进';
}

app.post('/api/candidates/:id/offer', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  const createdAt = new Date().toISOString();
  const record = {
    id: newId('offer'),
    createdAt,
    acceptanceStatus: String(req.body?.acceptanceStatus || '待确认').trim() || '待确认',
    offerSentAt: req.body?.offerSentAt || '',
    acceptedAt: req.body?.acceptedAt || '',
    expectedOnboard: req.body?.expectedOnboard || '',
    internshipDuration: req.body?.internshipDuration || '',
    note: req.body?.note || '',
    owner: req.body?.owner || config.recruiting.contactName
  };
  const updated = await patchCandidate(candidate.id, {
    status: req.body?.nextStatus || statusFromOfferAcceptance(record.acceptanceStatus),
    offer: {
      ...(candidate.offer || {}),
      acceptanceStatus: record.acceptanceStatus,
      offerSentAt: record.offerSentAt,
      acceptedAt: record.acceptedAt,
      expectedOnboard: record.expectedOnboard,
      internshipDuration: record.internshipDuration,
      note: record.note,
      owner: record.owner,
      updatedAt: createdAt,
      latestRecordId: record.id
    },
    offerRecords: [record, ...(candidate.offerRecords || [])],
    timeline: [
      ...(candidate.timeline || []),
      {
        at: createdAt,
        action: '记录 Offer 接受情况',
        detail: `${record.acceptanceStatus}${record.expectedOnboard ? ` · ${record.expectedOnboard}入职` : ''}`
      }
    ]
  });
  await addVerificationRun({
    type: 'offer-followup',
    status: 'passed',
    detail: `${updated.name || updated.email || updated.id}：Offer ${record.acceptanceStatus}`,
    mode: record.owner || 'manual'
  });
  res.json(stripPrivateCandidate(updated, { detail: true }));
}));

app.post('/api/candidates/:id/offer/outlook-web-mail', asyncRoute(async (req, res) => {
  const candidate = requireCandidate(await getCandidate(req.params.id));
  if (!candidate.email) {
    const error = new Error('候选人缺少邮箱，无法打开 Offer 邮件草稿。');
    error.status = 400;
    throw error;
  }
  const createdAt = new Date().toISOString();
  const offer = {
    acceptanceStatus: String(req.body?.acceptanceStatus || candidate.offer?.acceptanceStatus || '待确认').trim() || '待确认',
    offerSentAt: req.body?.offerSentAt || candidate.offer?.offerSentAt || '',
    acceptedAt: req.body?.acceptedAt || candidate.offer?.acceptedAt || '',
    expectedOnboard: req.body?.expectedOnboard || candidate.offer?.expectedOnboard || '',
    internshipDuration: req.body?.internshipDuration || candidate.offer?.internshipDuration || '',
    note: req.body?.note || candidate.offer?.note || '',
    owner: req.body?.owner || candidate.offer?.owner || config.recruiting.contactName
  };
  const email = buildOfferEmail({ candidate, offer });
  const webMailUrl = buildOutlookWebMailUrl({ email, candidate });
  const updated = await patchCandidate(candidate.id, {
    status: 'Offer邮件待发送',
    offer: {
      ...(candidate.offer || {}),
      ...offer,
      emailSubject: email.subject,
      emailDraftStatus: 'web-mail-generated',
      emailDraftGeneratedAt: createdAt,
      webMailUrl,
      updatedAt: createdAt
    },
    timeline: [
      ...(candidate.timeline || []),
      {
        at: createdAt,
        action: '已打开 Offer 邮件草稿',
        detail: email.subject
      }
    ]
  });
  await addVerificationRun({
    type: 'offer-web-mail',
    status: 'pending',
    detail: `${updated.name || updated.email || updated.id}：已生成 Offer 邮件草稿链接，待人工发送`,
    mode: 'outlook-web-mail-compose'
  });
  res.json({
    candidate: stripPrivateCandidate(updated, { detail: true }),
    payload: { email, webMailUrl },
    webMailUrl
  });
}));

app.post('/api/self-test', asyncRoute(async (req, res) => {
  const sync = await syncOutlookResumes({ mock: true });
  const candidate = sync.imported[0];
  const screened = await screenCandidate(candidate);
  const preview = await interviewPayload(screened, {
    start: '2026-06-03T14:30',
    end: '2026-06-03T15:00',
    locationOrLink: 'Teams 线上会议'
  });
  const scheduled = await patchCandidate(screened.id, {
    status: '面试待确认',
    interview: {
      ...preview.interview,
      live: false,
      actions: [
        { type: 'calendar', status: 'dry-run' },
        { type: 'email', status: 'dry-run' }
      ]
    }
  });
  const run = await addVerificationRun({
    type: 'self-test',
    status: 'passed',
    mode: 'mock',
    detail: `样例链路通过：导入 -> 筛选 ${screened.screening.recommendation}/${screened.screening.score} -> 面邀预览 -> dry-run 日程`
  });
  res.json({
    run,
    steps: [
      { name: '导入样例简历', status: 'passed', candidateId: candidate.id },
      { name: '简历筛选', status: 'passed', result: screened.screening },
      { name: '生成面邀邮件', status: 'passed', subject: preview.email.subject },
      { name: '生成 Outlook 日程 payload', status: 'passed', event: preview.event },
      { name: 'dry-run 状态落库', status: scheduled.status }
    ]
  });
}));

app.get('/api/verification', asyncRoute(async (req, res) => {
  res.json(await listVerificationRuns());
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API not found' });
});

if (hasBuiltFrontend) {
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(paths.dist, 'index.html'));
  });
}

app.use((error, req, res, next) => {
  console.error(`[${new Date().toISOString()}]`, error.message);
  res.status(error.status || 500).json({
    error: error.message || 'Internal Server Error'
  });
});

function startLarkAutoSync() {
  if (!config.lark.autoSync.enabled || !config.lark.baseToken) return;
  const intervalMinutes = Math.max(Number(config.lark.autoSync.intervalMinutes || 5), 1);
  const intervalMs = intervalMinutes * 60 * 1000;
  const run = async () => {
    if (larkSyncState.running) return;
    try {
      await syncLarkBaseCandidates(
        { limit: config.lark.autoSync.limit },
        { trigger: 'auto', mode: `server-auto/${intervalMinutes}m` }
      );
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 飞书自动同步失败：${error.message}`);
    }
  };
  const initialDelay = Math.min(30_000, intervalMs);
  const firstTimer = setTimeout(run, initialDelay);
  firstTimer.unref?.();
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
}

app.listen(config.port, config.host, () => {
  console.log(`LeAI Recruiting Platform: ${config.appBaseUrl}`);
  startLarkAutoSync();
});
