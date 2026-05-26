import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config, paths } from './config.js';

const execFileAsync = promisify(execFile);

const HEADER_ALIASES = {
  sequence: ['序号', '编号'],
  name: ['姓名', '候选人', '应聘者'],
  phone: ['联系电话', '电话', '手机', '手机号', '联系方式'],
  interviewTime: ['面试时间', '电话时间', '沟通时间'],
  expectedOnboard: ['预计入职时间', '到岗时间', '最快到岗时间', '入职时间'],
  background: ['简历核心背景（学历、关键经历）', '简历核心背景', '核心背景', '学历', '关键经历'],
  duration: ['实习时长', '可实习时长'],
  interviewer: ['面试官'],
  evaluation: ['面试评价', '电话面评价', '评价', '面评'],
  resume: ['简历PDF', '简历', '附件'],
  offerStatus: ['offer情况', 'Offer情况', '录用情况', '结果']
};

function compact(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return compact(value).replace(/[\s_\-:：/\\|（）()【】\[\]]+/g, '').toLowerCase();
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
        // Keep scanning because lark-cli may print warnings before JSON.
      }
    }
  }
  throw new Error(`飞书 Sheet 返回内容不是 JSON：${text.slice(0, 240)}`);
}

async function runLark(args, options = {}) {
  const next = [...args];
  const profile = compact(options.profile) || config.interviewSheet.profile;
  const as = compact(options.as) || config.interviewSheet.as;
  if (profile) next.push('--profile', profile);
  if (as) next.push('--as', as);
  const { stdout } = await execFileAsync(config.lark.cliPath, next, {
    cwd: paths.root,
    maxBuffer: 30 * 1024 * 1024,
    timeout: options.timeoutMs || 60_000
  });
  return parseJsonOutput(stdout);
}

function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(cellToText).filter(Boolean).join('、');
  if (typeof value === 'object') {
    return compact(
      value.text ||
        value.name ||
        value.fileName ||
        value.file_name ||
        value.link ||
        Object.values(value).map(cellToText).filter(Boolean).join('、')
    );
  }
  return '';
}

function attachmentList(value) {
  const cells = Array.isArray(value) ? value : [value];
  return cells
    .filter(Boolean)
    .flatMap((cell) => {
      if (Array.isArray(cell)) return attachmentList(cell);
      if (typeof cell !== 'object') return [];
      const fileToken = cell.fileToken || cell.file_token || cell.token;
      if (!fileToken) return [];
      return [
        {
          fileToken,
          name: compact(cell.text || cell.name || cell.fileName || cell.file_name || fileToken),
          mimeType: compact(cell.mimeType || cell.mime_type),
          size: Number(cell.size || 0)
        }
      ];
    });
}

function pickIndex(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeKey);
  return headers.findIndex((header) => {
    const normalized = normalizeKey(header);
    return (
      normalizedAliases.includes(normalized) ||
      normalizedAliases.some((alias) => normalized.includes(alias))
    );
  });
}

function getCell(row, indexes, key) {
  const index = indexes[key];
  return index >= 0 ? row[index] : null;
}

function textCell(row, indexes, key) {
  return cellToText(getCell(row, indexes, key));
}

function stableId({ spreadsheetToken, sheetId, rowNumber }) {
  const digest = crypto
    .createHash('sha1')
    .update(`${spreadsheetToken || 'sheet'}:${sheetId || 'tab'}:${rowNumber}`)
    .digest('hex')
    .slice(0, 12);
  return `sheet_${digest}`;
}

function statusFrom({ offerStatus, evaluation }) {
  const text = `${offerStatus}\n${evaluation}`;
  if (/已入职|入职完成|onboard/i.test(text)) return '已入职';
  if (/offer|录用|发放/i.test(text)) return 'Offer跟进';
  if (/不合适|淘汰|拒绝|pass/i.test(text)) return '不推进';
  if (/约面|正式面|电话面|面试/i.test(text)) return '已面试';
  return '面试记录';
}

function buildResumeText(fields) {
  return [
    '真实面试表记录：',
    fields.name ? `姓名：${fields.name}` : '',
    fields.phone ? `联系电话：${fields.phone}` : '',
    fields.interviewTime ? `面试时间：${fields.interviewTime}` : '',
    fields.expectedOnboard ? `预计入职时间：${fields.expectedOnboard}` : '',
    fields.duration ? `实习时长：${fields.duration}` : '',
    fields.background ? `简历核心背景：${fields.background}` : '',
    fields.evaluation ? `面试评价：${fields.evaluation}` : '',
    fields.offerStatus ? `offer情况：${fields.offerStatus}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export async function pullInterviewSheetCandidates(options = {}) {
  const profile = compact(options.profile) || config.interviewSheet.profile;
  const as = compact(options.as) || config.interviewSheet.as;
  const spreadsheetToken = compact(options.spreadsheetToken || config.interviewSheet.spreadsheetToken);
  const url = compact(options.url || config.interviewSheet.url);
  const sheetId = compact(options.sheetId || config.interviewSheet.sheetId);
  const range = compact(options.range || config.interviewSheet.range);
  const limit = Math.min(
    Math.max(Number(options.limit || config.interviewSheet.defaultLimit || 200), 1),
    500
  );

  if (!spreadsheetToken && !url) throw new Error('缺少面试表 URL 或 spreadsheet token。');
  if (!sheetId) throw new Error('缺少面试表 sheet id。');

  const args = ['sheets', '+read', '--sheet-id', sheetId, '--range', range, '--value-render-option', 'FormattedValue'];
  if (spreadsheetToken) args.push('--spreadsheet-token', spreadsheetToken);
  else args.push('--url', url);

  const data = await runLark(args, { profile, as });
  const valueRange = data?.data?.valueRange || {};
  const values = valueRange.values || [];
  const headers = (values[0] || []).map(cellToText);
  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, pickIndex(headers, aliases)])
  );
  const sourceRows = values.slice(1, limit + 1);
  const candidates = [];

  sourceRows.forEach((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const fields = {
      sequence: textCell(row, indexes, 'sequence'),
      name: textCell(row, indexes, 'name'),
      phone: textCell(row, indexes, 'phone'),
      interviewTime: textCell(row, indexes, 'interviewTime'),
      expectedOnboard: textCell(row, indexes, 'expectedOnboard'),
      background: textCell(row, indexes, 'background'),
      duration: textCell(row, indexes, 'duration'),
      interviewer: textCell(row, indexes, 'interviewer'),
      evaluation: textCell(row, indexes, 'evaluation'),
      offerStatus: textCell(row, indexes, 'offerStatus')
    };
    const hasContent = Object.values(fields).some(Boolean);
    if (!hasContent) return;

    const resumeAttachments = attachmentList(getCell(row, indexes, 'resume'));
    const displayFields = Object.fromEntries(
      headers.map((header, index) => [header || `列${index + 1}`, cellToText(row[index])])
    );
    const resolvedSpreadsheetToken =
      spreadsheetToken || data?.data?.spreadsheetToken || valueRange.spreadsheetToken || '';

    candidates.push({
      id: stableId({ spreadsheetToken: resolvedSpreadsheetToken || url, sheetId, rowNumber }),
      name: fields.name.slice(0, 48),
      email: '',
      phone: fields.phone,
      school: '',
      source: 'interview-sheet',
      status: statusFrom(fields),
      resumeFile: resumeAttachments[0]
        ? {
            source: 'lark-sheet',
            fileToken: resumeAttachments[0].fileToken,
            originalName: resumeAttachments[0].name,
            mimeType: resumeAttachments[0].mimeType,
            size: resumeAttachments[0].size
          }
        : null,
      resumeText: buildResumeText(fields),
      messageSubject: `面试表第 ${rowNumber} 行`,
      interviewRecord: {
        spreadsheetToken: resolvedSpreadsheetToken,
        sheetId,
        rowNumber,
        sequence: fields.sequence,
        interviewTime: fields.interviewTime,
        expectedOnboard: fields.expectedOnboard,
        duration: fields.duration,
        interviewer: fields.interviewer,
        evaluation: fields.evaluation,
        offerStatus: fields.offerStatus,
        resumeAttachments
      },
      application: {
        fields: displayFields,
        picked: indexes
      }
    });
  });

  return {
    profile,
    as,
    spreadsheetToken: spreadsheetToken || data?.data?.spreadsheetToken || '',
    sheetId,
    range: valueRange.range || `${sheetId}!${range}`,
    totalRows: Math.max(values.length - 1, 0),
    headers,
    candidates
  };
}
