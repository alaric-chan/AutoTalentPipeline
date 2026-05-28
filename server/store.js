import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { paths } from './config.js';

const initialState = {
  candidates: [],
  settings: {
    interviewTemplate: null
  },
  outlook: {
    token: null,
    profile: null,
    oauthState: null,
    publicOauth: null,
    deviceFlow: null
  },
  verificationRuns: [],
  users: [],
  sessions: []
};

async function ensureDataFiles() {
  await fs.mkdir(paths.uploads, { recursive: true });
  try {
    await fs.access(paths.db);
  } catch {
    await fs.writeFile(paths.db, JSON.stringify(initialState, null, 2), 'utf8');
  }
}

export async function readDb() {
  await ensureDataFiles();
  const raw = await fs.readFile(paths.db, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    ...initialState,
    ...parsed,
    settings: { ...initialState.settings, ...(parsed.settings || {}) },
    outlook: { ...initialState.outlook, ...(parsed.outlook || {}) },
    candidates: parsed.candidates || [],
    verificationRuns: parsed.verificationRuns || [],
    users: parsed.users || [],
    sessions: parsed.sessions || []
  };
}

export async function writeDb(next) {
  await ensureDataFiles();
  await fs.writeFile(paths.db, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function updateDb(mutator) {
  const db = await readDb();
  const result = await mutator(db);
  await writeDb(db);
  return result ?? db;
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '');
}

export const PROFILE_OVERRIDE_ORDER = [
  'name',
  'email',
  'phone',
  'degree',
  'schoolBackground',
  'receivedAt',
  'arrival',
  'duration'
];

const PROFILE_OVERRIDE_FIELD_CONFIG = {
  name: {
    topLevel: 'name',
    picked: 'name',
    aliases: ['姓名', '名字', '候选人', '应聘者', 'Name']
  },
  email: {
    topLevel: 'email',
    picked: 'email',
    aliases: ['联系邮箱', '邮箱', '电子邮箱', 'Email', 'email']
  },
  phone: {
    topLevel: 'phone',
    picked: 'phone',
    aliases: ['联系电话', '手机', '电话', '手机号', '联系方式', 'Phone']
  },
  degree: {
    topLevel: 'degree',
    picked: 'degree',
    aliases: ['学历', '学位', '最高学历', 'Degree']
  },
  schoolBackground: {
    topLevel: 'school',
    picked: 'school',
    aliases: ['院校背景', '教育背景', '学校背景', '学校', '院校', '毕业院校', 'School']
  },
  receivedAt: {
    topLevel: 'receivedAt',
    picked: 'submittedAt',
    aliases: ['投递时间', '提交时间', '提交日期', '创建时间', '导入时间', '收集时间', '报名时间', 'Submitted At']
  },
  arrival: {
    picked: 'arrival',
    aliases: ['最快到岗时间', '预计入职时间', '到岗时间', '最快到岗', '入职时间', 'Arrival']
  },
  duration: {
    picked: 'duration',
    aliases: ['可实习时长', '实习时长', '可实习月份', 'Internship Duration']
  }
};

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function normalizeProfileOverrideFields(profileOverrides = {}) {
  profileOverrides = profileOverrides || {};
  const rawFields = Array.isArray(profileOverrides)
    ? profileOverrides
    : Array.isArray(profileOverrides.fields)
      ? profileOverrides.fields
      : profileOverrides.fields && typeof profileOverrides.fields === 'object'
        ? Object.entries(profileOverrides.fields)
            .filter(([, enabled]) => Boolean(enabled))
            .map(([field]) => field)
        : [];
  const fields = new Set(rawFields.map((field) => String(field || '').trim()).filter(Boolean));
  return PROFILE_OVERRIDE_ORDER.filter((field) => fields.has(field));
}

function firstApplicationValue(candidate, names) {
  const fields = candidate?.application?.fields || {};
  for (const name of names) {
    if (fields[name]) return fields[name];
  }
  return '';
}

export function candidateIdentityKey(candidate = {}) {
  const email = normalizeEmail(
    candidate.email || firstApplicationValue(candidate, ['邮箱', '电子邮箱', '联系邮箱', 'Email'])
  );
  if (email) return `email:${email}`;

  const phone = normalizePhone(
    candidate.phone || firstApplicationValue(candidate, ['电话', '手机', '手机号', '联系电话', '联系方式'])
  );
  if (phone.length >= 8) return `phone:${phone}`;

  if (candidate.lark?.recordId) return `lark:${candidate.lark.recordId}`;
  if (candidate.messageId && candidate.resumeFile?.originalName) {
    return `outlook:${candidate.messageId}:${candidate.resumeFile.originalName}`;
  }
  if (candidate.interviewRecord?.spreadsheetToken && candidate.interviewRecord?.rowNumber) {
    return `sheet:${candidate.interviewRecord.spreadsheetToken}:${candidate.interviewRecord.rowNumber}`;
  }
  return '';
}

function mergeTimeline(existingTimeline = [], incomingTimeline = []) {
  const seen = new Set();
  return [...existingTimeline, ...incomingTimeline].filter((item) => {
    const key = `${item.at || ''}|${item.action || ''}|${item.detail || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cloneApplication(application = {}) {
  return {
    ...application,
    fields: { ...(application.fields || {}) },
    picked: { ...(application.picked || {}) }
  };
}

function preserveApplicationOverride(existing, merged, field) {
  const config = PROFILE_OVERRIDE_FIELD_CONFIG[field];
  if (!config?.aliases?.length) return merged;

  const existingApplication = existing.application || {};
  const existingFields = existingApplication.fields || {};
  const application = cloneApplication(merged.application || {});
  const existingPickedKey = config.picked ? existingApplication.picked?.[config.picked] : '';
  const incomingPickedKey = config.picked ? application.picked?.[config.picked] : '';
  const existingKey =
    [existingPickedKey, ...config.aliases].find((key) => key && hasOwn(existingFields, key)) ||
    existingPickedKey ||
    config.aliases[0];
  const targetKey =
    [incomingPickedKey, existingKey, ...config.aliases].find(
      (key) => key && (hasOwn(application.fields, key) || hasOwn(existingFields, key))
    ) ||
    incomingPickedKey ||
    existingKey ||
    config.aliases[0];

  if (!targetKey) return merged;
  if (existingKey && hasOwn(existingFields, existingKey)) {
    application.fields[targetKey] = existingFields[existingKey];
  } else {
    delete application.fields[targetKey];
  }
  if (config.picked) application.picked[config.picked] = targetKey;

  return {
    ...merged,
    application
  };
}

function preserveManualProfileOverrides(existing, merged) {
  const overrideFields = normalizeProfileOverrideFields(existing.profileOverrides);
  if (!overrideFields.length) return merged;

  let next = {
    ...merged,
    profileOverrides: existing.profileOverrides || merged.profileOverrides
  };

  for (const field of overrideFields) {
    const config = PROFILE_OVERRIDE_FIELD_CONFIG[field];
    if (!config) continue;
    if (config.topLevel && hasOwn(existing, config.topLevel)) {
      next[config.topLevel] = existing[config.topLevel];
    }
    next = preserveApplicationOverride(existing, next, field);
  }

  if (overrideFields.includes('email') || overrideFields.includes('phone')) {
    next.identityKey = candidateIdentityKey(next) || existing.identityKey || next.identityKey;
  }

  return next;
}

export function mergeCandidateForUpsert(existing, nextCandidate) {
  const merged = {
    ...existing,
    ...nextCandidate,
    id: existing.id,
    createdAt: existing.createdAt || nextCandidate.createdAt,
    screening: nextCandidate.screening ?? existing.screening ?? null,
    manualReview: nextCandidate.manualReview ?? existing.manualReview ?? null,
    interview: nextCandidate.interview ?? existing.interview ?? null,
    interviewRecords: nextCandidate.interviewRecords ?? existing.interviewRecords,
    timeline: mergeTimeline(existing.timeline, nextCandidate.timeline),
    identityKey: nextCandidate.identityKey || existing.identityKey || candidateIdentityKey(existing)
  };
  return preserveManualProfileOverrides(existing, merged);
}

export async function listCandidates() {
  const db = await readDb();
  return db.candidates.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getCandidate(id) {
  const db = await readDb();
  return db.candidates.find((candidate) => candidate.id === id);
}

export async function upsertCandidate(candidate) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    const identityKey = candidate.identityKey || candidateIdentityKey(candidate);
    const existingIndex = db.candidates.findIndex((item) => item.id === candidate.id);
    const identityIndex =
      existingIndex >= 0 || !identityKey
        ? -1
        : db.candidates.findIndex((item) => (item.identityKey || candidateIdentityKey(item)) === identityKey);
    const targetIndex = existingIndex >= 0 ? existingIndex : identityIndex;
    const nextCandidate = {
      ...candidate,
      identityKey,
      updatedAt: now,
      createdAt: candidate.createdAt || now
    };
    if (targetIndex >= 0) {
      const existing = db.candidates[targetIndex];
      db.candidates[targetIndex] = mergeCandidateForUpsert(existing, nextCandidate);
      return db.candidates[targetIndex];
    }
    db.candidates.push(nextCandidate);
    return nextCandidate;
  });
}

export async function patchCandidate(id, patch) {
  return updateDb((db) => {
    const existing = db.candidates.find((candidate) => candidate.id === id);
    if (!existing) {
      return null;
    }
    Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
    return existing;
  });
}

export async function getSettings() {
  const db = await readDb();
  return db.settings || initialState.settings;
}

export async function patchSettings(patch) {
  return updateDb((db) => {
    db.settings = {
      ...(db.settings || initialState.settings),
      ...patch,
      updatedAt: new Date().toISOString()
    };
    return db.settings;
  });
}

export async function setOutlookToken(token) {
  return updateDb((db) => {
    db.outlook.token = token;
    return db.outlook.token;
  });
}

export async function getOutlookToken() {
  const db = await readDb();
  return db.outlook.token;
}

export async function setOutlookProfile(profile) {
  return updateDb((db) => {
    db.outlook.profile = profile;
    return db.outlook.profile;
  });
}

export async function setOauthState(state) {
  return updateDb((db) => {
    db.outlook.oauthState = state;
    return state;
  });
}

export async function getOauthState() {
  const db = await readDb();
  return db.outlook.oauthState;
}

export async function getOutlookState() {
  const db = await readDb();
  return db.outlook;
}

export async function setPublicOauth(flow) {
  return updateDb((db) => {
    db.outlook.publicOauth = flow;
    return flow;
  });
}

export async function getPublicOauth() {
  const db = await readDb();
  return db.outlook.publicOauth;
}

export async function setDeviceFlow(flow) {
  return updateDb((db) => {
    db.outlook.deviceFlow = flow;
    return flow;
  });
}

export async function getDeviceFlow() {
  const db = await readDb();
  return db.outlook.deviceFlow;
}

export async function addVerificationRun(run) {
  return updateDb((db) => {
    const next = {
      id: newId('run'),
      createdAt: new Date().toISOString(),
      ...run
    };
    db.verificationRuns.unshift(next);
    db.verificationRuns = db.verificationRuns.slice(0, 30);
    return next;
  });
}

export async function listVerificationRuns() {
  const db = await readDb();
  return db.verificationRuns;
}

function normalizeUsername(value = '') {
  return String(value).trim().toLowerCase();
}

export async function listUsers() {
  const db = await readDb();
  return [...db.users].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

export async function getUser(id) {
  const db = await readDb();
  return db.users.find((user) => user.id === id) || null;
}

export async function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  const db = await readDb();
  return db.users.find((user) => normalizeUsername(user.username) === normalized) || null;
}

export async function upsertUser(user) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    const username = normalizeUsername(user.username);
    const index = db.users.findIndex(
      (item) => item.id === user.id || normalizeUsername(item.username) === username
    );
    const next = {
      ...user,
      username,
      updatedAt: now,
      createdAt: user.createdAt || now
    };
    if (index >= 0) {
      db.users[index] = {
        ...db.users[index],
        ...next,
        id: db.users[index].id,
        createdAt: db.users[index].createdAt || next.createdAt
      };
      return db.users[index];
    }
    db.users.push({
      id: user.id || newId('user'),
      ...next
    });
    return db.users[db.users.length - 1];
  });
}

export async function patchUser(id, patch) {
  return updateDb((db) => {
    const existing = db.users.find((user) => user.id === id);
    if (!existing) return null;
    Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
    if (patch.username) existing.username = normalizeUsername(patch.username);
    return existing;
  });
}

export async function deleteUser(id) {
  return updateDb((db) => {
    const index = db.users.findIndex((user) => user.id === id);
    if (index < 0) return null;
    const [deleted] = db.users.splice(index, 1);
    db.sessions = db.sessions.filter((session) => session.userId !== id);
    return deleted;
  });
}

export async function createSession(session) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    db.sessions = db.sessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now());
    const next = {
      id: session.id || newId('session'),
      createdAt: now,
      ...session
    };
    db.sessions.push(next);
    return next;
  });
}

export async function getSessionByTokenHash(tokenHash) {
  const db = await readDb();
  return (
    db.sessions.find(
      (session) => session.tokenHash === tokenHash && new Date(session.expiresAt).getTime() > Date.now()
    ) || null
  );
}

export async function deleteSessionByTokenHash(tokenHash) {
  return updateDb((db) => {
    const before = db.sessions.length;
    db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
    return before !== db.sessions.length;
  });
}
