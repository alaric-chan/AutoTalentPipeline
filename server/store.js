import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { paths } from './config.js';

const SCHEMA_VERSION = 2;
const DEFAULT_WORKSPACE_ID = 'workspace_lexiang_ai';
const DEFAULT_REQUISITION_ID = 'req_lexiang_ai_pm_intern';

const initialState = {
  schemaVersion: SCHEMA_VERSION,
  currentRequisitionId: DEFAULT_REQUISITION_ID,
  workspaces: [
    {
      id: DEFAULT_WORKSPACE_ID,
      name: '乐享AI',
      owner: '陈百科',
      createdAt: '2026-05-29T00:00:00.000Z',
      updatedAt: '2026-05-29T00:00:00.000Z'
    }
  ],
  requisitions: [
    {
      id: DEFAULT_REQUISITION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: 'AI 产品经理实习生',
      teamName: '乐享AI',
      owner: '陈百科',
      positionType: '产品',
      sourceConfigSummary: '飞书表单 + Outlook + 手工上传',
      jdSummary: '保留现有乐享AI实习生招聘链路，作为默认招聘项目。',
      status: 'active',
      createdAt: '2026-05-29T00:00:00.000Z',
      updatedAt: '2026-05-29T00:00:00.000Z'
    }
  ],
  candidates: [],
  applications: [],
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

function defaultWorkspace() {
  return { ...initialState.workspaces[0] };
}

function defaultRequisition() {
  return { ...initialState.requisitions[0] };
}

function ensureProjectCollections(db) {
  db.schemaVersion = SCHEMA_VERSION;
  db.workspaces = Array.isArray(db.workspaces) ? db.workspaces : [];
  db.requisitions = Array.isArray(db.requisitions) ? db.requisitions : [];
  db.applications = Array.isArray(db.applications) ? db.applications : [];
  if (!db.workspaces.some((workspace) => workspace.id === DEFAULT_WORKSPACE_ID)) {
    db.workspaces.unshift(defaultWorkspace());
  }
  if (!db.requisitions.some((requisition) => requisition.id === DEFAULT_REQUISITION_ID)) {
    db.requisitions.unshift(defaultRequisition());
  }
  db.currentRequisitionId =
    db.requisitions.some((requisition) => requisition.id === db.currentRequisitionId)
      ? db.currentRequisitionId
      : DEFAULT_REQUISITION_ID;
}

function safeBackupStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function backupLegacyDb(raw) {
  const parsedPath = path.parse(paths.db);
  const backupPath = path.join(parsedPath.dir, `${parsedPath.name}.pre-v2-${safeBackupStamp()}${parsedPath.ext}`);
  await fs.writeFile(backupPath, raw, 'utf8');
  return backupPath;
}

function applicationIdFor(candidateId, requisitionId = DEFAULT_REQUISITION_ID) {
  const source = `${requisitionId}:${candidateId}`;
  return `app_${crypto.createHash('sha1').update(source).digest('hex').slice(0, 12)}`;
}

const PROFILE_KEYS = new Set([
  'id',
  'candidateId',
  'identityKey',
  'name',
  'email',
  'phone',
  'school',
  'degree',
  'major',
  'resumeFile',
  'resumeText',
  'lark',
  'messageId',
  'messageSubject',
  'profileOverrides',
  'createdAt',
  'updatedAt'
]);

function splitCandidateProfile(candidate = {}) {
  const identityKey = candidate.identityKey || candidateIdentityKey(candidate);
  return {
    id: candidate.id,
    identityKey,
    name: candidate.name || '',
    email: candidate.email || '',
    phone: candidate.phone || '',
    school: candidate.school || '',
    degree: candidate.degree || '',
    major: candidate.major || '',
    resumeFile: candidate.resumeFile || null,
    resumeText: candidate.resumeText || '',
    lark: candidate.lark || null,
    messageId: candidate.messageId || '',
    messageSubject: candidate.messageSubject || '',
    profileOverrides: candidate.profileOverrides || null,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function splitApplicationSnapshot(candidate = {}, requisitionId = DEFAULT_REQUISITION_ID, existing = null) {
  const snapshot = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!PROFILE_KEYS.has(key) && key !== 'applicationId' && key !== 'requisitionId') {
      snapshot[key] = value;
    }
  }
  return {
    ...(existing || {}),
    ...snapshot,
    id: existing?.id || candidate.applicationId || applicationIdFor(candidate.id, requisitionId),
    candidateId: candidate.id,
    requisitionId,
    createdAt: existing?.createdAt || candidate.createdAt || new Date().toISOString(),
    updatedAt: candidate.updatedAt || new Date().toISOString()
  };
}

function joinCandidate(profile, application = null, requisition = null) {
  if (!profile) return null;
  const joined = {
    ...(profile || {}),
    ...(application || {}),
    id: profile.id,
    candidateId: profile.id,
    applicationId: application?.id || '',
    requisitionId: application?.requisitionId || requisition?.id || '',
    requisition: requisition
      ? {
          id: requisition.id,
          name: requisition.name,
          workspaceId: requisition.workspaceId,
          teamName: requisition.teamName,
          owner: requisition.owner,
          status: requisition.status
        }
      : null,
    identityKey: profile.identityKey || application?.identityKey || candidateIdentityKey({ ...profile, ...(application || {}) })
  };
  return joined;
}

function joinedCandidatesForDb(db, requisitionId = db.currentRequisitionId) {
  const requisition = db.requisitions.find((item) => item.id === requisitionId) || db.requisitions[0] || null;
  const applications = db.applications.filter((application) => application.requisitionId === requisitionId);
  return applications
    .map((application) => {
      const profile = db.candidates.find((candidate) => candidate.id === application.candidateId);
      return joinCandidate(profile, application, requisition);
    })
    .filter(Boolean);
}

function normalizeDbShape(parsed) {
  const db = {
    ...initialState,
    ...parsed,
    settings: { ...initialState.settings, ...(parsed.settings || {}) },
    outlook: { ...initialState.outlook, ...(parsed.outlook || {}) },
    candidates: parsed.candidates || [],
    applications: parsed.applications || [],
    verificationRuns: parsed.verificationRuns || [],
    users: parsed.users || [],
    sessions: parsed.sessions || []
  };
  ensureProjectCollections(db);
  return db;
}

function migrateLegacyDb(parsed) {
  const db = normalizeDbShape({
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    workspaces: parsed.workspaces?.length ? parsed.workspaces : [defaultWorkspace()],
    requisitions: parsed.requisitions?.length ? parsed.requisitions : [defaultRequisition()],
    currentRequisitionId: parsed.currentRequisitionId || DEFAULT_REQUISITION_ID,
    applications: Array.isArray(parsed.applications) ? parsed.applications : []
  });

  const existingApplicationKeys = new Set(
    db.applications.map((application) => `${application.requisitionId}:${application.candidateId}`)
  );
  const profiles = [];
  const seenProfiles = new Set();
  for (const candidate of parsed.candidates || []) {
    if (!candidate?.id || seenProfiles.has(candidate.id)) continue;
    const profile = splitCandidateProfile(candidate);
    profiles.push(profile);
    seenProfiles.add(candidate.id);

    const key = `${DEFAULT_REQUISITION_ID}:${candidate.id}`;
    if (!existingApplicationKeys.has(key)) {
      db.applications.push(splitApplicationSnapshot(candidate, DEFAULT_REQUISITION_ID));
      existingApplicationKeys.add(key);
    }
  }
  db.candidates = profiles;
  ensureProjectCollections(db);
  return db;
}

export async function readDb() {
  await ensureDataFiles();
  const raw = await fs.readFile(paths.db, 'utf8');
  const parsed = JSON.parse(raw);
  const needsMigration =
    parsed.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(parsed.workspaces) ||
    !Array.isArray(parsed.requisitions) ||
    !Array.isArray(parsed.applications);
  if (!needsMigration) return normalizeDbShape(parsed);

  const migrated = migrateLegacyDb(parsed);
  const backupPath = await backupLegacyDb(raw);
  migrated.migrations = [
    ...(parsed.migrations || []),
    {
      version: SCHEMA_VERSION,
      migratedAt: new Date().toISOString(),
      backupPath,
      defaultRequisitionId: DEFAULT_REQUISITION_ID,
      legacyCandidateCount: (parsed.candidates || []).length
    }
  ];
  await fs.writeFile(paths.db, JSON.stringify(migrated, null, 2), 'utf8');
  return migrated;
}

export async function writeDb(next) {
  await ensureDataFiles();
  const shaped = normalizeDbShape(next);
  await fs.writeFile(paths.db, JSON.stringify(shaped, null, 2), 'utf8');
  return shaped;
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
  return joinedCandidatesForDb(db).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function listCandidateLibrary() {
  const db = await readDb();
  const firstApplications = new Map();
  for (const application of db.applications) {
    if (!firstApplications.has(application.candidateId)) firstApplications.set(application.candidateId, application);
  }
  return db.candidates
    .map((candidate) => {
      const application = firstApplications.get(candidate.id);
      const requisition = db.requisitions.find((item) => item.id === application?.requisitionId) || null;
      return joinCandidate(candidate, application, requisition);
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getCandidate(id) {
  const db = await readDb();
  const application =
    db.applications.find((item) => item.requisitionId === db.currentRequisitionId && item.candidateId === id) ||
    db.applications.find((item) => item.id === id) ||
    db.applications.find((item) => item.candidateId === id);
  const candidateId = application?.candidateId || id;
  const profile = db.candidates.find((candidate) => candidate.id === candidateId);
  const requisition = db.requisitions.find((item) => item.id === application?.requisitionId) || null;
  return joinCandidate(profile, application, requisition);
}

export async function upsertCandidate(candidate) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    ensureProjectCollections(db);
    const requisitionId = candidate.requisitionId || db.currentRequisitionId || DEFAULT_REQUISITION_ID;
    const identityKey = candidate.identityKey || candidateIdentityKey(candidate);
    const existingIndex = db.candidates.findIndex((item) => item.id === candidate.id);
    const identityIndex =
      existingIndex >= 0 || !identityKey
        ? -1
        : db.candidates.findIndex((item) => {
            const application = db.applications.find((candidateApplication) => candidateApplication.candidateId === item.id);
            return (item.identityKey || candidateIdentityKey(joinCandidate(item, application))) === identityKey;
          });
    const targetIndex = existingIndex >= 0 ? existingIndex : identityIndex;
    const candidateId = targetIndex >= 0 ? db.candidates[targetIndex].id : candidate.id;
    const existingApplication = db.applications.find(
      (application) => application.candidateId === candidateId && application.requisitionId === requisitionId
    );
    const existingJoined =
      targetIndex >= 0
        ? joinCandidate(db.candidates[targetIndex], existingApplication, db.requisitions.find((item) => item.id === requisitionId))
        : {};
    const nextCandidate = {
      ...existingJoined,
      ...candidate,
      id: candidateId,
      identityKey,
      updatedAt: now,
      createdAt: candidate.createdAt || existingJoined.createdAt || now
    };
    if (targetIndex >= 0) {
      const merged = mergeCandidateForUpsert(existingJoined, nextCandidate);
      db.candidates[targetIndex] = {
        ...db.candidates[targetIndex],
        ...splitCandidateProfile(merged),
        id: candidateId,
        updatedAt: now
      };
      const nextApplication = splitApplicationSnapshot(merged, requisitionId, existingApplication);
      if (existingApplication) {
        Object.assign(existingApplication, nextApplication);
      } else {
        db.applications.push(nextApplication);
      }
      return joinCandidate(
        db.candidates[targetIndex],
        existingApplication || nextApplication,
        db.requisitions.find((item) => item.id === requisitionId)
      );
    }
    const profile = splitCandidateProfile(nextCandidate);
    const application = splitApplicationSnapshot(nextCandidate, requisitionId);
    db.candidates.push(profile);
    db.applications.push(application);
    return joinCandidate(profile, application, db.requisitions.find((item) => item.id === requisitionId));
  });
}

export async function patchCandidate(id, patch) {
  return updateDb((db) => {
    ensureProjectCollections(db);
    const existingApplication =
      db.applications.find((application) => application.requisitionId === db.currentRequisitionId && application.candidateId === id) ||
      db.applications.find((application) => application.id === id) ||
      db.applications.find((application) => application.candidateId === id);
    const profileIndex = db.candidates.findIndex((candidate) => candidate.id === (existingApplication?.candidateId || id));
    if (profileIndex < 0) {
      return null;
    }
    const requisitionId = patch.requisitionId || existingApplication?.requisitionId || db.currentRequisitionId || DEFAULT_REQUISITION_ID;
    const existingJoined = joinCandidate(
      db.candidates[profileIndex],
      existingApplication,
      db.requisitions.find((item) => item.id === requisitionId)
    );
    const next = {
      ...existingJoined,
      ...patch,
      id: db.candidates[profileIndex].id,
      updatedAt: new Date().toISOString()
    };
    db.candidates[profileIndex] = {
      ...db.candidates[profileIndex],
      ...splitCandidateProfile(next),
      id: db.candidates[profileIndex].id
    };
    const nextApplication = splitApplicationSnapshot(next, requisitionId, existingApplication);
    if (existingApplication) {
      Object.assign(existingApplication, nextApplication);
    } else {
      db.applications.push(nextApplication);
    }
    return joinCandidate(
      db.candidates[profileIndex],
      existingApplication || nextApplication,
      db.requisitions.find((item) => item.id === requisitionId)
    );
  });
}

export async function listRequisitions() {
  const db = await readDb();
  const counts = db.applications.reduce((acc, application) => {
    acc[application.requisitionId] = (acc[application.requisitionId] || 0) + 1;
    return acc;
  }, {});
  return db.requisitions.map((requisition) => ({
    ...requisition,
    candidateCount: counts[requisition.id] || 0,
    isCurrent: requisition.id === db.currentRequisitionId
  }));
}

export async function getCurrentRequisition() {
  const db = await readDb();
  return db.requisitions.find((requisition) => requisition.id === db.currentRequisitionId) || db.requisitions[0] || null;
}

export async function upsertRequisition(requisition = {}) {
  const now = new Date().toISOString();
  return updateDb((db) => {
    ensureProjectCollections(db);
    const id = requisition.id || newId('req');
    const workspaceId = requisition.workspaceId || DEFAULT_WORKSPACE_ID;
    if (!db.workspaces.some((workspace) => workspace.id === workspaceId)) {
      db.workspaces.push({
        id: workspaceId,
        name: requisition.teamName || requisition.workspaceName || '新团队',
        owner: requisition.owner || '',
        createdAt: now,
        updatedAt: now
      });
    }
    const index = db.requisitions.findIndex((item) => item.id === id);
    const next = {
      id,
      workspaceId,
      name: String(requisition.name || '新设置的招聘项目').trim() || '新设置的招聘项目',
      teamName: String(requisition.teamName || requisition.workspaceName || '').trim(),
      owner: String(requisition.owner || '').trim(),
      positionType: String(requisition.positionType || '').trim(),
      sourceConfigSummary: String(requisition.sourceConfigSummary || '').trim(),
      jdSummary: String(requisition.jdSummary || '').trim(),
      status: requisition.status || 'active',
      createdAt: requisition.createdAt || now,
      updatedAt: now
    };
    if (index >= 0) {
      db.requisitions[index] = {
        ...db.requisitions[index],
        ...next,
        id: db.requisitions[index].id,
        createdAt: db.requisitions[index].createdAt || next.createdAt
      };
      return db.requisitions[index];
    }
    db.requisitions.push(next);
    return next;
  });
}

export async function setCurrentRequisition(id) {
  return updateDb((db) => {
    ensureProjectCollections(db);
    const requisition = db.requisitions.find((item) => item.id === id);
    if (!requisition) return null;
    db.currentRequisitionId = requisition.id;
    return requisition;
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
