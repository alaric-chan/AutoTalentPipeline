import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, paths } from './config.js';
import { extractResumeText, parseEmailAddress } from './resumeParser.js';

const execFileAsync = promisify(execFile);

const FIELD_ALIASES = {
  name: ['姓名', '名字', '候选人', '应聘者', 'Name'],
  email: ['邮箱', '电子邮箱', '联系邮箱', 'Email'],
  phone: ['电话', '手机', '手机号', '联系方式', 'Phone'],
  school: ['学校', '院校', '毕业院校', 'School'],
  degree: ['学历', '学位', 'Degree'],
  major: ['专业', 'Major'],
  duration: ['可实习时长', '实习时长', '可实习月份', 'Internship Duration'],
  arrival: ['到岗时间', '最快到岗', '入职时间', 'Arrival'],
  aiExperience: ['AI工具经验', 'AI使用经验', 'AI经验', 'LLM经验', 'AI Experience'],
  resume: ['简历', '附件', '上传简历', '简历附件', 'Resume', 'CV']
};

function compact(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return compact(value).replace(/[\s_\-:：/\\|（）()【】\[\]]+/g, '').toLowerCase();
}

function larkContext(options = {}) {
  return {
    profile: compact(options.profile) || config.lark.profile,
    as: compact(options.as) || config.lark.as,
    includeAs: options.includeAs !== false
  };
}

function cliArgs(args, context) {
  const next = [...args];
  if (context.profile) next.push('--profile', context.profile);
  if (context.includeAs && context.as) next.push('--as', context.as);
  return next;
}

function safeErrorOutput(error) {
  return compact(`${error.stderr || ''}\n${error.stdout || ''}`).slice(0, 2000);
}

function parseJsonOutput(stdout) {
  const text = compact(stdout);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const starts = [];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '{' || text[index] === '[') starts.push(index);
    }
    for (const index of starts.reverse()) {
      try {
        return JSON.parse(text.slice(index));
      } catch {
        // Continue until we find a JSON envelope. Some CLI commands print tips first.
      }
    }
  }
  throw new Error(`飞书 CLI 返回内容不是 JSON：${text.slice(0, 240)}`);
}

async function runLark(args, options = {}) {
  const context = larkContext(options);
  try {
    const { stdout } = await execFileAsync(config.lark.cliPath, cliArgs(args, context), {
      cwd: paths.root,
      maxBuffer: 20 * 1024 * 1024,
      timeout: options.timeoutMs || 60_000
    });
    if (options.json === false) return { stdout };
    return parseJsonOutput(stdout);
  } catch (error) {
    const detail = safeErrorOutput(error);
    throw new Error(detail || error.message);
  }
}

function getArrayPayload(data) {
  const candidates = [
    data?.items ||
      data?.data?.items,
    data?.data?.data,
    data?.data?.tables,
    data?.data?.fields,
    data?.data?.forms,
    data?.data?.questions,
    data?.records,
    data?.data?.records,
    data?.data?.items?.records
  ];
  return candidates.find(Array.isArray) || [];
}

function getRecordListMeta(data) {
  const meta = data?.data || data || {};
  return {
    hasMore: Boolean(meta.has_more || meta.hasMore),
    total: Number(meta.total || meta.count || 0),
    offset: Number(meta.offset || 0),
    count: Number(meta.count || getArrayPayload(data).length)
  };
}

function textFromCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textFromCell).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    const direct =
      value.text ||
      value.name ||
      value.en_name ||
      value.email ||
      value.link ||
      value.phone_number ||
      value.full_address ||
      value.value;
    if (direct !== undefined && direct !== value) return textFromCell(direct);
    if (value.file_name || value.filename || value.title) {
      return compact(value.file_name || value.filename || value.title);
    }
    return Object.values(value).map(textFromCell).filter(Boolean).join('、');
  }
  return '';
}

function hasCellValue(value) {
  return Boolean(compact(textFromCell(value)));
}

function attachmentList(value) {
  const cells = Array.isArray(value) ? value : [value];
  return cells
    .filter(Boolean)
    .flatMap((cell) => {
      if (Array.isArray(cell)) return attachmentList(cell);
      if (typeof cell !== 'object') return [];
      const token = cell.file_token || cell.fileToken || cell.token;
      if (!token) return [];
      return [
        {
          fileToken: token,
          name: compact(cell.name || cell.file_name || cell.filename || cell.title || token)
        }
      ];
    });
}

function pickField(fields, explicitName, aliases) {
  const names = Object.keys(fields || {});
  if (explicitName && Object.prototype.hasOwnProperty.call(fields, explicitName)) return explicitName;
  const normalizedExplicit = normalizeKey(explicitName);
  if (normalizedExplicit) {
    const exact = names.find((name) => normalizeKey(name) === normalizedExplicit);
    if (exact) return exact;
  }
  const normalizedAliases = aliases.map(normalizeKey);
  const exactMatches = names.filter((name) => normalizedAliases.includes(normalizeKey(name)));
  const partialMatches = names.filter((name) =>
    normalizedAliases.some((alias) => normalizeKey(name).includes(alias))
  );
  const matches = [...exactMatches, ...partialMatches];
  return matches.find((name) => hasCellValue(fields[name])) || matches[0];
}

function normalizeRecordListPayload(data) {
  const payload = data?.data || data || {};
  const rows = payload.data;
  const fieldNames = payload.fields;
  const recordIds = payload.record_id_list || payload.recordIdList || [];
  if (Array.isArray(rows) && Array.isArray(fieldNames) && Array.isArray(recordIds)) {
    return rows.map((row, index) => {
      const fields = Object.fromEntries(
        fieldNames.map((name, fieldIndex) => [String(name), Array.isArray(row) ? row[fieldIndex] : undefined])
      );
      return {
        record_id: recordIds[index],
        fields
      };
    });
  }

  const items = getArrayPayload(data);
  return items.map((item) => {
    if (item?.record_id || item?.recordId || item?.id || item?.fields || item?.record?.fields) return item;
    return {
      record_id: '',
      fields: {}
    };
  });
}

function displayFields(fields) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, textFromCell(value)])
  );
}

function makeCandidateId(recordId) {
  return `lark_${String(recordId || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 36)}`;
}

function applicationSummary(fields, picked) {
  const display = displayFields(fields);
  return [
    picked.name ? `姓名：${textFromCell(fields[picked.name])}` : '',
    picked.email ? `邮箱：${textFromCell(fields[picked.email])}` : '',
    picked.phone ? `电话：${textFromCell(fields[picked.phone])}` : '',
    picked.school ? `学校：${textFromCell(fields[picked.school])}` : '',
    picked.major ? `专业：${textFromCell(fields[picked.major])}` : '',
    picked.duration ? `可实习时长：${textFromCell(fields[picked.duration])}` : '',
    picked.arrival ? `到岗时间：${textFromCell(fields[picked.arrival])}` : '',
    picked.aiExperience ? `AI经验：${textFromCell(fields[picked.aiExperience])}` : '',
    '',
    '飞书表单字段：',
    ...Object.entries(display).map(([key, value]) => `${key}：${value}`)
  ]
    .filter(Boolean)
    .join('\n');
}

async function resolveBaseToken(input, options = {}) {
  const raw = compact(input || config.lark.baseToken);
  if (!raw) return '';
  const wikiMatch = raw.match(/\/wiki\/([^/?#]+)/i);
  if (wikiMatch || raw.startsWith('wik')) {
    const data = await runLark(
      ['wiki', '+node-get', '--token', raw, '--format', 'json'],
      options
    );
    const node = data?.data || data;
    if (node.obj_type !== 'bitable') {
      throw new Error(`飞书 Wiki 节点不是多维表格：${node.obj_type || 'unknown'}`);
    }
    return node.obj_token;
  }
  const baseMatch = raw.match(/\/base\/([^/?#]+)/i) || raw.match(/\/bitable\/([^/?#]+)/i);
  return baseMatch ? baseMatch[1] : raw;
}

export async function getLarkStatus(options = {}) {
  const context = larkContext({ ...options, includeAs: false });
  const data = await runLark(['doctor', '--offline'], context);
  const checks = data.checks || [];
  const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
  return {
    ok: Boolean(data.ok),
    profile: context.profile,
    as: context.as,
    app: byName.app_resolved?.message || '',
    bot: byName.bot_identity?.status || 'unknown',
    user: byName.user_identity?.status || 'unknown',
    checks
  };
}

export async function listLarkTables(options = {}) {
  const context = larkContext(options);
  const baseToken = await resolveBaseToken(options.baseToken || options.baseUrl, context);
  if (!baseToken) throw new Error('缺少飞书多维表格 Base Token 或链接。');
  const data = await runLark(
    ['base', '+table-list', '--base-token', baseToken, '--offset', '0', '--limit', '100'],
    context
  );
  return {
    baseToken,
    tables: getArrayPayload(data)
  };
}

export async function listLarkFields(options = {}) {
  const context = larkContext(options);
  const baseToken = await resolveBaseToken(options.baseToken || options.baseUrl, context);
  const tableId = compact(options.tableId || config.lark.tableId);
  if (!baseToken) throw new Error('缺少飞书多维表格 Base Token 或链接。');
  if (!tableId) throw new Error('缺少飞书数据表 ID 或名称。');
  const data = await runLark(
    [
      'base',
      '+field-list',
      '--base-token',
      baseToken,
      '--table-id',
      tableId,
      '--offset',
      '0',
      '--limit',
      '200'
    ],
    context
  );
  return {
    baseToken,
    tableId,
    fields: getArrayPayload(data)
  };
}

async function listLarkRecords(options = {}) {
  const context = larkContext(options);
  const baseToken = await resolveBaseToken(options.baseToken || options.baseUrl, context);
  let tableId = compact(options.tableId || config.lark.tableId);
  const viewId = compact(options.viewId || config.lark.viewId);
  const limit = Math.min(Math.max(Number(options.limit || config.lark.defaultLimit || 100), 1), 200);
  if (!baseToken) throw new Error('缺少飞书多维表格 Base Token 或链接。');
  if (!tableId) {
    const tables = await listLarkTables({ ...context, baseToken });
    if (tables.tables.length !== 1) {
      throw new Error(`请指定数据表 ID 或名称。当前 Base 下有 ${tables.tables.length} 张表。`);
    }
    tableId = tables.tables[0].table_id || tables.tables[0].tableId || tables.tables[0].name;
  }

  const records = [];
  let offset = 0;
  let page = 0;
  while (records.length < limit && page < 20) {
    const pageLimit = Math.min(200, limit - records.length);
    const args = [
      'base',
      '+record-list',
      '--base-token',
      baseToken,
      '--table-id',
      tableId,
      '--offset',
      String(offset),
      '--limit',
      String(pageLimit),
      '--format',
      'json'
    ];
    if (viewId) args.push('--view-id', viewId);
    const data = await runLark(args, context);
    const items = normalizeRecordListPayload(data);
    records.push(...items);
    const meta = getRecordListMeta(data);
    if (!meta.hasMore || items.length === 0 || records.length >= limit) break;
    offset = meta.offset + (meta.count || items.length);
    page += 1;
  }

  return { baseToken, tableId, viewId, records };
}

async function downloadResume({ baseToken, tableId, recordId, fields, resumeField, context }) {
  const chosenResumeField = pickField(fields, resumeField, FIELD_ALIASES.resume);
  const files = chosenResumeField ? attachmentList(fields[chosenResumeField]) : [];
  if (!files.length) return null;

  const outputDir = path.join(paths.larkDownloads, String(recordId));
  const cliOutputDir = path.relative(paths.root, outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const args = [
    'base',
    '+record-download-attachment',
    '--base-token',
    baseToken,
    '--table-id',
    tableId,
    '--record-id',
    String(recordId),
    '--output',
    cliOutputDir,
    '--overwrite'
  ];
  for (const file of files) {
    args.push('--file-token', file.fileToken);
  }
  await runLark(args, { ...context, json: false });
  const downloaded = await fs.readdir(outputDir);
  const supported = downloaded.find((name) => /\.(pdf|docx|txt|md)$/i.test(name)) || downloaded[0];
  if (!supported) return null;
  const filePath = path.join(outputDir, supported);
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    originalName: supported,
    size: stat.size,
    mimeType: ''
  };
}

export async function pullLarkCandidates(options = {}) {
  const context = larkContext(options);
  const resumeField = compact(options.resumeField || config.lark.resumeField);
  const { baseToken, tableId, viewId, records } = await listLarkRecords({ ...options, ...context });
  const candidates = [];

  for (const record of records) {
    const recordId = record.record_id || record.recordId || record.id;
    const fields = record.fields || record.record?.fields || {};
    const picked = Object.fromEntries(
      Object.entries(FIELD_ALIASES).map(([key, aliases]) => [
        key,
        pickField(fields, options.fieldMap?.[key], aliases)
      ])
    );
    const resumeFile = await downloadResume({
      baseToken,
      tableId,
      recordId,
      fields,
      resumeField: options.fieldMap?.resume || resumeField,
      context
    });
    const fallbackText = applicationSummary(fields, picked);
    const resumeText = resumeFile
      ? await extractResumeText(resumeFile.path, resumeFile.mimeType)
      : fallbackText;
    const emailText = picked.email ? textFromCell(fields[picked.email]) : fallbackText;
    const name = picked.name ? textFromCell(fields[picked.name]) : '';

    candidates.push({
      id: makeCandidateId(recordId),
      name: compact(name).slice(0, 48),
      email: parseEmailAddress(emailText),
      phone: picked.phone ? textFromCell(fields[picked.phone]) : '',
      school: picked.school ? textFromCell(fields[picked.school]) : '',
      source: 'lark-base',
      status: '待筛选',
      resumeFile,
      resumeText,
      messageSubject: `飞书投递记录 ${recordId}`,
      lark: {
        profile: context.profile,
        as: context.as,
        baseToken,
        tableId,
        viewId,
        recordId
      },
      application: {
        fields: displayFields(fields),
        picked
      }
    });
  }

  return { baseToken, tableId, viewId, profile: context.profile, as: context.as, candidates };
}
