import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  PlayCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  Users
} from 'lucide-react';
import './styles.css';

const pageSize = 12;
const defaultInterviewDurationMinutes = 30;
const interviewDurationOptions = [15, 30, 45, 60];
const offerAcceptanceOptions = ['待确认', '考虑中', '已接受', '已拒绝', '放弃', '已入职'];
const fullDateTokenPattern = '(?:19|20)\\d{2}(?:(?:[年./-]\\d{1,2})(?:(?:[月./-]\\d{1,2}日?)|月份|月)?)?';
const shortDateTokenPattern = '\\d{1,2}(?:[月./-]\\d{1,2}日?)?';
const riskDateRangePattern = `${fullDateTokenPattern}(?:\\s*[-—–~至到]\\s*(?:${fullDateTokenPattern}|${shortDateTokenPattern}))?`;
const defaultUserDraft = {
  username: '',
  displayName: '',
  password: '',
  role: 'member',
  status: 'active'
};

function storedAccessToken() {
  return window.localStorage?.getItem('leai_session_token') || window.localStorage?.getItem('leai_app_token') || '';
}

function storedNavCollapsed() {
  return window.localStorage?.getItem('leai_nav_collapsed') === 'true';
}

function currentConfirmationToken() {
  const match = window.location.hash.match(/^#\/confirm\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function apiPath(path) {
  return path.startsWith('/api/') ? `.${path}` : path;
}

function authenticatedFileUrl(path) {
  const token = storedAccessToken();
  const url = apiPath(path);
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = storedAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-App-Token', token);
  }
  const fetchPath = apiPath(path);
  const response = await fetch(fetchPath, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data.error || data || `请求失败：${response.status}`);
  }
  return data;
}

function StatusPill({ value }) {
  const key = String(value || '未知');
  return <span className={`pill pill-${key}`}>{key}</span>;
}

function displayMatchLevel(value, score) {
  const text = String(value || '').trim();
  const legacyMap = {
    强推: '高匹配',
    可面: '较匹配',
    备选: '可培养',
    不建议: '不匹配'
  };
  if (legacyMap[text]) return legacyMap[text];
  if (['高匹配', '较匹配', '可培养', '不匹配'].includes(text)) return text;
  const numericScore = Number(score);
  if (Number.isFinite(numericScore)) {
    if (numericScore >= 85) return '高匹配';
    if (numericScore >= 72) return '较匹配';
    if (numericScore >= 60) return '可培养';
    return '不匹配';
  }
  return text || '待确认';
}

function NewBadge({ compact = false }) {
  return <span className={`new-badge ${compact ? 'new-badge-compact' : ''}`}>{compact ? '新' : 'New'}</span>;
}

function Score({ value }) {
  const score = Number(value || 0);
  return (
    <div className="score">
      <span>{score}</span>
      <meter min="0" max="100" value={score} />
    </div>
  );
}

function sliderValue(value, fallback = 75) {
  const score = Number(value);
  if (Number.isFinite(score)) return Math.min(Math.max(score, 0), 100);
  return fallback;
}

function ScoreSlider({ label, value, onChange, wide = false }) {
  const score = sliderValue(value);
  return (
    <label className={`score-slider ${wide ? 'wide' : ''}`}>
      <span>
        {label}
        <strong>{score}</strong>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={score}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function InterviewRecordSummary({ record }) {
  const scoreItems = [
    ['面试评分', record.score],
    ['沟通表达', record.communication],
    ['AI理解/工具经验', record.aiUnderstanding],
    ['产品感觉/推进能力', record.productSense]
  ].filter(([, value]) => value !== '' && value != null);
  const textItems = [
    ['优势', record.strengths],
    ['风险', record.concerns],
    ['总结与下一步', record.summary || record.nextAction]
  ].filter(([, value]) => String(value || '').trim());

  if (!scoreItems.length && !textItems.length) {
    return <p className="muted">暂无文字记录</p>;
  }

  return (
    <div className="record-summary">
      {scoreItems.length ? (
        <div className="record-scores">
          {scoreItems.map(([label, value]) => (
            <span key={label}>
              {label}
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {textItems.map(([label, value]) => (
        <div key={label} className="record-note">
          <span>{label}</span>
          <p>{value}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="empty">
      <Users size={32} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

const candidateStageViews = ['screening', 'schedule', 'interview', 'onboarding'];

const stageMeta = {
  screening: {
    title: '简历筛选',
    description: '按岗位匹配度、可靠度和风险备注筛选候选人',
    columns: ['姓名', '电话', '匹配分', '状态'],
    columnTemplate: 'minmax(82px, 1.28fr) minmax(88px, 1.1fr) minmax(42px, 0.48fr) minmax(58px, 0.72fr)'
  },
  schedule: {
    title: '面试安排',
    description: '先发时间确认邮件，候选人确认后再发 Outlook/Teams 日程',
    columns: ['姓名', '联系方式', '面试时间', '状态']
  },
  interview: {
    title: '面试记录',
    description: '在平台内记录面试表现、结论和下一步动作',
    columns: ['姓名', '面试官', '结论', '记录时间']
  },
  onboarding: {
    title: 'Offer/入职',
    description: '跟进 Offer、到岗时间和入职材料',
    columns: ['姓名', 'Offer情况', '到岗', '实习时长']
  }
};

function formatDateTime(value) {
  if (!value) return '待定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function parseDisplayDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return {
        year: String(date.getFullYear()),
        month: padDatePart(date.getMonth() + 1),
        day: padDatePart(date.getDate()),
        hour: padDatePart(date.getHours()),
        minute: padDatePart(date.getMinutes())
      };
    }
  }
  const normalized = text.replace(/年|月|\//g, '-').replace(/日/g, '').replace(/\./g, '-');
  const matched = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (matched) {
    return {
      year: matched[1],
      month: padDatePart(matched[2]),
      day: padDatePart(matched[3]),
      hour: matched[4] ? padDatePart(matched[4]) : '',
      minute: matched[5] ? padDatePart(matched[5]) : ''
    };
  }
  const date = new Date(normalized.includes('T') ? normalized : normalized.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: String(date.getFullYear()),
    month: padDatePart(date.getMonth() + 1),
    day: padDatePart(date.getDate()),
    hour: padDatePart(date.getHours()),
    minute: padDatePart(date.getMinutes())
  };
}

function formatDateOnly(value) {
  const date = parseDisplayDate(value);
  if (!date) return cleanFieldValue(value);
  return `${date.year}-${date.month}-${date.day}`;
}

function formatProfileDateTime(value) {
  const date = parseDisplayDate(value);
  if (!date) return cleanFieldValue(value);
  const day = `${date.year}-${date.month}-${date.day}`;
  return date.hour && date.minute ? `${day} ${date.hour}:${date.minute}` : day;
}

function endOfMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function parseResumeDateToken(value, fallbackYear = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text
    .replace(/年/g, '-')
    .replace(/月份|月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-')
    .replace(/-+$/g, '');
  if (/^(?:19|20)\d{2}$/.test(normalized)) {
    return new Date(Number(normalized), 11, 31);
  }
  const matched = normalized.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/) || normalized.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  if (!matched) return null;
  const year = matched[1].length === 4 ? matched[1] : fallbackYear;
  const month = matched[1].length === 4 ? matched[2] : matched[1];
  const day = matched[1].length === 4 ? matched[3] : matched[2];
  if (!year || !month) return null;
  const normalizedMonth = Number(month);
  if (normalizedMonth < 1 || normalizedMonth > 12) return null;
  const normalizedDay = day ? Number(day) : endOfMonth(year, normalizedMonth);
  const date = new Date(Number(year), normalizedMonth - 1, normalizedDay);
  return Number.isNaN(date.getTime()) ? null : date;
}

function riskRangeEndsInFuture(rangeText) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const normalized = String(rangeText || '').replace(/\s+/g, '');
  const yearRange = normalized.match(/^((?:19|20)\d{2})[-—–~至到]((?:19|20)\d{2})年?$/);
  if (yearRange) return Number(yearRange[2]) > today.getFullYear();
  const hasMonthOrDay = /(?:19|20)\d{2}[年./-]\d{1,2}|\d{1,2}[月./-]\d{1,2}/.test(normalized);
  if (!hasMonthOrDay) {
    const years = (normalized.match(/(?:19|20)\d{2}/g) || []).map(Number);
    return years.length ? Math.max(...years) > today.getFullYear() : true;
  }
  const tokens = normalized.match(/(?:19|20)\d{2}(?:(?:[年./-]\d{1,2})(?:(?:[月./-]\d{1,2}日?)|月份|月)?)?|\b\d{1,2}(?:[月./-]\d{1,2}日?)?\b/g) || [];
  const start = parseResumeDateToken(tokens[0]);
  const startYear = tokens[0]?.match(/\d{4}/)?.[0] || '';
  const end = parseResumeDateToken(tokens.at(-1), startYear) || start;
  if (!end) return true;
  return end.getTime() > today.getTime();
}

function riskRangeLooksReversed(rangeText) {
  const normalized = String(rangeText || '').replace(/\s+/g, '');
  const tokens = normalized.match(/(?:19|20)\d{2}(?:(?:[年./-]\d{1,2})(?:(?:[月./-]\d{1,2}日?)|月份|月)?)?|\b\d{1,2}(?:[月./-]\d{1,2}日?)?\b/g) || [];
  if (tokens.length < 2) return false;
  const startYear = tokens[0]?.match(/\d{4}/)?.[0] || '';
  const start = parseResumeDateToken(tokens[0]);
  const end = parseResumeDateToken(tokens.at(-1), startYear);
  if (!start || !end) return false;
  return start.getTime() > end.getTime();
}

function stripRiskMarker(line) {
  return String(line || '').replace(/^(\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s*/, '').trim();
}

function splitRiskItems(text) {
  const withBreaks = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/([。；;])\s*((?:\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s*)/g, '$1\n$2')
    .replace(/\s+((?:\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s+)/g, '\n$1');
  return withBreaks
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (/^(\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s+/.test(trimmed)) return [trimmed];
      return trimmed.split(/[；;]/).map((item) => item.trim()).filter(Boolean);
    });
}

function isFalseTimelineRiskItem(line) {
  const cleanLine = stripRiskMarker(line);
  const yearRanges = cleanLine.match(/(?:19|20)\d{2}\s*[-—–~至到]\s*(?:19|20)\d{2}年?/g) || [];
  const dateRanges = (cleanLine.match(new RegExp(riskDateRangePattern, 'g')) || []).filter(
    (range) => !yearRanges.some((yearRange) => yearRange.replace(/\s+/g, '').includes(range.replace(/\s+/g, '')))
  );
  const ranges = [...yearRanges, ...dateRanges];
  if (!ranges.length) return false;
  if (ranges.some((range) => riskRangeEndsInFuture(range) || riskRangeLooksReversed(range))) return false;
  return /未来时间|未来日期|时间线异常|规划版简历|疑似.*(?:笔误|规划)|笔误或规划|疑似.*排版错误/.test(cleanLine);
}

function removeFalseTimelineRiskItems(text) {
  const items = splitRiskItems(text);
  if (items.length <= 1) return isFalseTimelineRiskItem(text) ? '' : text;
  return items.filter((item) => !isFalseTimelineRiskItem(item)).join('\n');
}

function normalizeFutureRiskLabels(value) {
  const text = cleanFieldValue(value);
  if (!text) return '';
  const cleaned = text.includes('未来时间')
    ? text
      .replace(new RegExp(`(${riskDateRangePattern})([^。；;，,]*?)(?:（未来时间）|\\(未来时间\\)|未来时间)`, 'g'), (match, range, middle) => {
        if (riskRangeEndsInFuture(range)) return match;
        return `${range}${middle}`;
      })
      .replace(/（\s*）|\(\s*\)/g, '')
      .replace(/\s+([，,。；;])/g, '$1')
    : text;
  return removeFalseTimelineRiskItems(cleaned);
}

function dateTimeValue(value) {
  const text = cleanFieldValue(value);
  if (!text) return '';
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const normalized = text.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  const date = new Date(normalized.includes('T') ? normalized : normalized.replace(' ', 'T'));
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return text;
}

function candidateSubmittedAt(candidate) {
  return (
    dateTimeValue(candidate?.receivedAt) ||
    dateTimeValue(applicationField(candidate, ['投递时间', '提交时间', '提交日期', '创建时间', '导入时间'])) ||
    dateTimeValue(candidate?.newAt) ||
    dateTimeValue(candidate?.createdAt) ||
    ''
  );
}

function candidateSubmittedSortValue(candidate) {
  const date = new Date(candidateSubmittedAt(candidate));
  if (!Number.isNaN(date.getTime())) return date.getTime();
  const fallback = new Date(candidate?.createdAt || candidate?.updatedAt || 0);
  return Number.isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

function candidateScheduleSortValue(candidate) {
  const stableDate =
    candidate?.manualReview?.decidedAt ||
    candidate?.newAt ||
    candidate?.receivedAt ||
    candidate?.createdAt ||
    '';
  const date = new Date(dateTimeValue(stableDate));
  if (!Number.isNaN(date.getTime())) return date.getTime();
  return candidateSubmittedSortValue(candidate);
}

function sortCandidatesForStage(candidates, view) {
  if (view === 'schedule') {
    return [...candidates].sort((a, b) => {
      const dateDiff = candidateScheduleSortValue(b) - candidateScheduleSortValue(a);
      if (dateDiff) return dateDiff;
      return String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''), 'zh-Hans-CN');
    });
  }
  if (view !== 'screening') return candidates;
  return [...candidates].sort((a, b) => candidateSubmittedSortValue(b) - candidateSubmittedSortValue(a));
}

function toDateInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDatetimeLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutes(value, minutes) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  date.setMinutes(date.getMinutes() + Number(minutes || defaultInterviewDurationMinutes));
  return toDatetimeLocal(date);
}

function isWeekday(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function buildInterviewTimeOptions() {
  const slotTimes = [
    { hour: 10, minute: 30 },
    { hour: 11, minute: 0 },
    { hour: 14, minute: 30 },
    { hour: 15, minute: 0 },
    { hour: 15, minute: 30 }
  ];
  const options = [];
  const now = new Date();
  const earliest = new Date(now.getTime() + 30 * 60 * 1000);

  for (let dayOffset = 0; options.length < 15 && dayOffset < 21; dayOffset += 1) {
    const date = new Date();
    date.setDate(now.getDate() + dayOffset);
    if (!isWeekday(date)) continue;
    for (const slot of slotTimes) {
      const startDate = new Date(date);
      startDate.setHours(slot.hour, slot.minute, 0, 0);
      if (startDate <= earliest) continue;
      const start = toDatetimeLocal(startDate);
      options.push({
        value: `slot-${options.length}`,
        start,
        end: addMinutes(start, defaultInterviewDurationMinutes),
        label: `${formatDateTime(start)} 开始`
      });
      if (options.length >= 15) break;
    }
  }

  return options;
}

function resolveInterviewEnd(start, durationMinutes) {
  return addMinutes(start, Number(durationMinutes || defaultInterviewDurationMinutes));
}

function applicationField(candidate, names) {
  const fields = candidate?.application?.fields || {};
  for (const name of names) {
    if (fields[name]) return fields[name];
  }
  return '';
}

function parseShortInterviewDateTime(value) {
  const text = cleanFieldValue(value).replace(/\s+/g, ' ').trim();
  const match = text.match(/(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?(?:（[^）]+）)?\s*(\d{1,2})[:：](\d{2})/);
  if (!match) return '';
  const [, month, day, hour, minute] = match;
  const date = new Date(new Date().getFullYear(), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0);
  return Number.isNaN(date.getTime()) ? '' : toDatetimeLocal(date);
}

function toDatetimeLocalValue(value) {
  const text = cleanFieldValue(value);
  if (!text || /待/.test(text)) return '';
  const direct = text.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(direct)) return direct.slice(0, 16);
  const shortDateTime = parseShortInterviewDateTime(text);
  if (shortDateTime) return shortDateTime;
  const parsed = new Date(dateTimeValue(text));
  return Number.isNaN(parsed.getTime()) ? '' : toDatetimeLocal(parsed);
}

function interviewDurationFromCandidate(interview = {}) {
  const duration = Number(interview.durationMinutes);
  if (Number.isFinite(duration) && duration > 0) return duration;
  const startDate = new Date(interview.start || '');
  const endDate = new Date(interview.end || '');
  if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate > startDate) {
    return Math.round((endDate.getTime() - startDate.getTime()) / 60000);
  }
  return defaultInterviewDurationMinutes;
}

function defaultInterviewDraft(candidate) {
  const savedInterview = candidate?.interview || {};
  const start = toDatetimeLocalValue(savedInterview.start || applicationField(candidate, ['面试时间']));
  const durationMinutes = interviewDurationFromCandidate(savedInterview);
  const savedEnd = toDatetimeLocalValue(savedInterview.end);
  return {
    start,
    end: savedEnd || resolveInterviewEnd(start, durationMinutes),
    durationMinutes,
    locationOrLink: savedInterview.locationOrLink || 'Teams 线上会议',
    live: Boolean(savedInterview.live)
  };
}

function cleanFieldValue(value) {
  const text = String(value ?? '').trim();
  const mailtoMatch = text.match(/^\[([^\]]+)\]\(mailto:([^)]+)\)$/i);
  if (mailtoMatch) return mailtoMatch[2] || mailtoMatch[1];
  const linkMatch = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (linkMatch) return linkMatch[1] || linkMatch[2];
  return text.replace(/^mailto:/i, '').trim();
}

function extractEmail(value) {
  return cleanFieldValue(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
}

function meaningfulValue(value) {
  const text = cleanFieldValue(value);
  return text && !['空', '无', '暂无', 'null', 'undefined'].includes(text.toLowerCase());
}

function candidateEmail(candidate) {
  return (
    candidate?.email ||
    extractEmail(applicationField(candidate, ['联系邮箱', '邮箱', '电子邮箱', 'Email', 'email'])) ||
    candidate?.emailMasked ||
    ''
  );
}

function candidatePhone(candidate) {
  return candidate?.phone || applicationField(candidate, ['联系电话', '手机', '电话']) || candidate?.phoneMasked || '';
}

function editableCandidateEmail(candidate) {
  return candidate?.email || extractEmail(applicationField(candidate, ['联系邮箱', '邮箱', '电子邮箱', 'Email', 'email'])) || '';
}

function editableCandidatePhone(candidate) {
  return candidate?.phone || applicationField(candidate, ['联系电话', '手机', '电话']) || '';
}

function candidateOfferStatus(candidate) {
  return (
    candidate?.offer?.acceptanceStatus ||
    candidate?.interviewRecord?.offerStatus ||
    applicationField(candidate, ['offer情况', 'Offer情况']) ||
    '待确认'
  );
}

function candidateOfferOnboard(candidate) {
  return (
    candidate?.offer?.expectedOnboard ||
    candidate?.interviewRecord?.expectedOnboard ||
    applicationField(candidate, ['预计入职时间', '最快到岗时间']) ||
    ''
  );
}

function candidateOfferDuration(candidate) {
  return candidate?.offer?.internshipDuration || applicationField(candidate, ['实习时长', '可实习时长']) || '';
}

function candidateHasEmail(candidate) {
  return Boolean(candidate?.email || candidate?.hasEmail || extractEmail(applicationField(candidate, ['联系邮箱', '邮箱', '电子邮箱', 'Email', 'email'])));
}

function displayContact(candidate) {
  return candidateEmail(candidate) || candidatePhone(candidate) || applicationField(candidate, ['联系电话']) || '待补充';
}

function uniqueTextValues(values) {
  const seen = new Set();
  return values
    .map(cleanFieldValue)
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function candidateDegree(candidate) {
  return (
    candidate?.degree ||
    applicationField(candidate, ['学历', '学位', '最高学历', 'Degree']) ||
    candidate?.screening?.degree ||
    ''
  );
}

function candidateSchoolBackground(candidate) {
  const explicit = applicationField(candidate, ['院校背景', '教育背景', '学校背景']);
  if (explicit) return explicit;
  return uniqueTextValues([
    candidate?.school || applicationField(candidate, ['学校', '院校', '毕业院校', 'School']) || candidate?.screening?.school,
    candidate?.major || applicationField(candidate, ['专业', 'Major']) || candidate?.screening?.major
  ]).join(' · ');
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function fileKind(file = {}) {
  const name = file.name || file.originalName || '';
  const mimeType = file.mimeType || '';
  if (/pdf/i.test(mimeType) || /\.pdf$/i.test(name)) return 'pdf';
  if (/text|markdown/i.test(mimeType) || /\.(txt|md)$/i.test(name)) return 'text';
  if (/word|officedocument/i.test(mimeType) || /\.(doc|docx)$/i.test(name)) return 'doc';
  return 'file';
}

function canPreviewInline(file = {}) {
  return ['pdf', 'text'].includes(fileKind(file));
}

function listFromValue(value) {
  if (Array.isArray(value)) return value.map(cleanFieldValue).filter(Boolean);
  return cleanFieldValue(value)
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRiskNotesMarkdown(value) {
  const text = normalizeFutureRiskLabels(value).replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  const listMarker = '(?:\\d{1,2}|[一二三四五六七八九十]+)[.、)）]\\s*';
  const bulletMarker = '[-*+]\\s+';
  const merged = text.replace(new RegExp(`\\n(?!\\s*(?:${listMarker}|${bulletMarker}))`, 'g'), ' ');
  const normalized = merged
    .replace(/([；;。！？?])\s*((?:\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s*)/g, '$1\n$2')
    .replace(/([；;。！？?])\s*([-*+]\s+)/g, '$1\n$2');
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasMarkdownList = lines.some((line) => /^(\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s+/.test(line) || /^[-*+]\s+/.test(line));
  const sourceLines = hasMarkdownList ? lines : normalized.split(/[；;]/).map((line) => line.trim()).filter(Boolean);
  return sourceLines
    .map((line, index) => {
      const cleanLine = line.replace(/[；;]\s*$/, '').trim();
      const ordered = cleanLine.match(/^(\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s*(.+)$/);
      if (ordered) return `${index + 1}. ${ordered[2].trim()}`;
      const bullet = cleanLine.match(/^[-*+]\s+(.+)$/);
      if (bullet) return `- ${bullet[1].trim()}`;
      return hasMarkdownList ? cleanLine : `- ${cleanLine}`;
    })
    .join('\n');
}

function renderMarkdownInline(text) {
  const nodes = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2]) {
      nodes.push(<strong key={`strong-${match.index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<code key={`code-${match.index}`}>{match[3]}</code>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownContent({ value }) {
  const lines = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks = [];
  let listType = '';
  let listItems = [];

  function flushList() {
    if (!listType) return;
    const Tag = listType;
    blocks.push(
      <Tag key={`list-${blocks.length}`} className="markdown-list">
        {listItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderMarkdownInline(item)}</li>
        ))}
      </Tag>
    );
    listType = '';
    listItems = [];
  }

  lines.forEach((line) => {
    const ordered = line.match(/^\d{1,2}[.)]\s+(.+)$/);
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (ordered || unordered) {
      const nextType = ordered ? 'ol' : 'ul';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((ordered?.[1] || unordered?.[1] || '').trim());
      return;
    }
    flushList();
    blocks.push(<p key={`p-${blocks.length}`}>{renderMarkdownInline(line)}</p>);
  });
  flushList();

  return <div className="markdown-content">{blocks}</div>;
}

function buildScreeningSummaryMarkdown(screening) {
  if (!screening) return '';
  const existingSummary = cleanFieldValue(screening.ai_experience_summary);
  if (/实习经历匹配|院校背景|项目\/AI潜力|可靠度|到岗与时长/.test(existingSummary)) {
    return existingSummary;
  }
  const llmTags = listFromValue(screening.llm_knowledge).slice(0, 5).join('、');
  const rows = [
    ['实习经历匹配', screening.internship_match || screening.product_experience || '待面试核实AI产品或产品相邻经历'],
    ['院校背景', screening.school_assessment || [screening.school, screening.degree].filter(Boolean).join(' / ') || '待补充'],
    ['项目/AI潜力', screening.project_match || llmTags || '待面试核实AI项目、产品拆解和学习潜力'],
    ['可靠度', screening.reliability_assessment || '待面试追问稳定交付、承诺兑现、细心程度和目标导向'],
    ['到岗与时长', screening.availability_assessment || (screening.available_months ? `${screening.available_months}个月` : '待确认是否至少3个月')],
    ['综合判断', existingSummary || `${displayMatchLevel(screening.recommendation, screening.score)}，匹配分 ${screening.score ?? '待评估'}`]
  ];
  return rows
    .filter(([, value]) => meaningfulValue(value))
    .map(([label, value]) => `- **${label}**：${cleanFieldValue(value)}`)
    .join('\n');
}

function questionSnippet(value, maxLength = 54) {
  const text = cleanFieldValue(value).replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildInterviewQuestionGroups(candidate) {
  const screening = candidate?.screening || {};
  const projectSignal = questionSnippet(screening.project_match || screening.ai_experience_summary);
  const internshipSignal = questionSnippet(screening.internship_match || screening.product_experience);
  const riskSignal = questionSnippet(screening.risk_notes || screening.reliability_assessment);
  const llmTags = listFromValue(screening.llm_knowledge).slice(0, 4);
  const aiStack = llmTags.length ? llmTags.join(' / ') : 'AI工具或智能体工作流';
  const focusItems = listFromValue(screening.interview_focus).slice(0, 3);

  return [
    {
      title: '项目深挖',
      questions: [
        '选一个最核心的项目，按背景、目标用户、方案拆解、你的具体贡献、结果数据完整讲一遍。',
        projectSignal
          ? `AI评价里提到「${projectSignal}」，你亲自做过哪三个关键决策？每个决策分别依据什么信息？`
          : '项目里最难拆的一步是什么？你当时如何把模糊问题拆成可执行任务？',
        '如果今天重做这个项目，你会优先改哪一处？用什么指标判断改得更好？'
      ]
    },
    {
      title: '真实性校验',
      questions: [
        internshipSignal
          ? `围绕「${internshipSignal}」，请讲一个真实推进细节：你和谁协作、遇到什么阻力、最后如何验证？`
          : '讲一个你真正从0到1推动过的任务，具体产出物是什么？谁用了它？',
        '项目中有没有失败、返工或判断失误？当时你怎么发现问题，又怎么调整？',
        `简历里涉及 ${aiStack} 时，你做的是需求定义、流程编排、Prompt调优、数据处理还是效果评估？请举具体例子。`
      ]
    },
    {
      title: 'JD能力匹配',
      questions: [
        '如果把企业知识库问答或智能体需求交给你，你会如何拆用户场景、设计流程、定义输入输出和验收指标？',
        '给你一批用户Badcase，你会如何分类、判断优先级、推动产品或知识库优化？',
        '如果第一周加入乐享AI团队，你会先补齐哪些业务信息，并产出什么文档、原型或评估表？'
      ]
    },
    {
      title: '可靠度与风险',
      questions: [
        riskSignal
          ? `AI筛选风险里提到「${riskSignal}」，请你正面回应这个风险，并给一个可验证的例子。`
          : '讲一次需求不清或时间很紧的任务，你怎么排计划、同步风险、保证交付？',
        '每周出勤、连续实习周期、课程或论文冲突怎么安排？哪些情况会影响稳定交付？',
        focusItems.length ? `面试重点追问：${focusItems.join('；')}。请各用一个具体项目证据回答。` : '请举一个能证明你认真、细致、靠谱的项目或工作细节。'
      ]
    }
  ];
}

function AIInterviewQuestionsPanel({ candidate }) {
  const groups = buildInterviewQuestionGroups(candidate);
  const [activeTitle, setActiveTitle] = useState(groups[0]?.title || '');
  const activeGroup = groups.find((group) => group.title === activeTitle) || groups[0];
  return (
    <section className="panel interview-question-panel">
      <div className="panel-heading">
        <div>
          <h3>AI推荐面试问题</h3>
          <p className="muted">选择一个方向，边面边追问。</p>
        </div>
        {candidate?.screening ? <StatusPill value={displayMatchLevel(candidate.screening.recommendation, candidate.screening.score)} /> : null}
      </div>
      <div className="question-filter" role="tablist" aria-label="面试问题方向">
        {groups.map((group) => (
          <button
            key={group.title}
            className={group.title === activeGroup.title ? 'active' : ''}
            onClick={() => setActiveTitle(group.title)}
            type="button"
          >
            {group.title}
          </button>
        ))}
      </div>
      <div className="interview-question-scroll">
        <article className="interview-question-card">
          <h4>{activeGroup.title}</h4>
          <div className="question-list">
            <ol>
              {activeGroup.questions.map((question, index) => (
                <li key={`${activeGroup.title}-${index}`}>{question}</li>
              ))}
            </ol>
          </div>
        </article>
      </div>
    </section>
  );
}

function ScreeningInsightPanel({ candidate }) {
  const screening = candidate?.screening;
  const tags = listFromValue(screening?.llm_knowledge);
  return (
    <section className="panel wide-panel screening-context-panel">
      <div className="panel-heading">
        <div>
          <h3>AI筛选回顾</h3>
          <p className="muted">邀约前快速回忆候选人的匹配点、风险和追问方向。</p>
        </div>
        {screening ? <StatusPill value={displayMatchLevel(screening.recommendation, screening.score)} /> : null}
      </div>
      {screening ? (
        <div className="screening-context-grid">
          <div className="screening">
            <div className="score-line">
              <Score value={screening.score} />
              <span className="source-text">
                {screening.source || candidate?.source || 'manual'}
                {screening.warning ? ` · ${screening.warning}` : ''}
              </span>
            </div>
            <MarkdownContent value={buildScreeningSummaryMarkdown(screening)} />
            <div className="keyword-chips">
              {tags.length ? tags.map((item, index) => <span key={`${item}-${index}`}>{item}</span>) : <span>待确认</span>}
            </div>
          </div>
          <div className="screening-risk">
            <strong>风险与追问</strong>
            {screening.risk_notes ? (
              <MarkdownContent value={normalizeRiskNotesMarkdown(screening.risk_notes)} />
            ) : (
              <p className="muted">暂无风险备注。</p>
            )}
          </div>
        </div>
      ) : (
        <p className="muted">尚未生成 AI 筛选评价，可回到简历筛选页补跑匹配评估。</p>
      )}
    </section>
  );
}

function ConfirmationStatusPanel({ candidate }) {
  const confirmation = candidate?.interview?.confirmation;
  if (!confirmation?.url) return null;
  const history = Array.isArray(candidate?.interview?.confirmationHistory)
    ? candidate.interview.confirmationHistory.slice(0, 4)
    : [];
  return (
    <section className="panel wide-panel">
      <div className="panel-heading">
        <div>
          <h3>候选人确认状态</h3>
          <p className="muted">从候选人视角打开同一个确认页，核对是否已同意、改期或放弃。</p>
        </div>
        <StatusPill value={confirmationStatusLabel(confirmation.status)} />
      </div>
      <div className="confirmation-summary persistent-confirmation">
        <div>
          <span>确认链接</span>
          <strong>{confirmationStatusLabel(confirmation.status)}</strong>
          {confirmation.respondedAt ? <small>{formatProfileDateTime(confirmation.respondedAt)}</small> : null}
        </div>
        <a className="button-link ghost-button" href={confirmation.url} target="_blank" rel="noreferrer">
          <ExternalLink size={16} />
          打开确认页
        </a>
      </div>
      <dl className="confirmation-detail-grid">
        <div>
          <dt>当前面试时间</dt>
          <dd>{candidate?.interview?.start ? formatDateTime(candidate.interview.start) : '待安排'}</dd>
        </div>
        <div>
          <dt>确认邮件发送</dt>
          <dd>{confirmation.sentAt ? formatProfileDateTime(confirmation.sentAt) : '尚未标记已发送'}</dd>
        </div>
        <div>
          <dt>候选人反馈</dt>
          <dd>{confirmation.respondedAt ? formatProfileDateTime(confirmation.respondedAt) : '尚未提交'}</dd>
        </div>
        <div>
          <dt>候选人留言/可面时间</dt>
          <dd className={confirmation.note ? 'candidate-response-note' : ''}>
            {confirmation.note || (confirmation.status === 'reschedule_requested' ? '候选人未填写留言，请联系确认可面时间。' : '暂无留言')}
          </dd>
        </div>
      </dl>
      {history.length ? (
        <div className="confirmation-history">
          <strong>历史确认链接</strong>
          {history.map((item) => (
            <a key={item.token} href={item.url || `#/confirm/${encodeURIComponent(item.token)}`} target="_blank" rel="noreferrer">
              <span>{confirmationStatusLabel(item.status)}</span>
              <small>{item.respondedAt ? formatProfileDateTime(item.respondedAt) : item.archivedAt ? `替换于 ${formatProfileDateTime(item.archivedAt)}` : '未反馈'}</small>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function candidateProfileItems(candidate) {
  return [
    ['姓名', candidate?.name || candidateEmail(candidate) || candidate?.id],
    ['联系邮箱', candidateEmail(candidate)],
    ['联系电话', candidatePhone(candidate)],
    ['学历', candidateDegree(candidate)],
    ['院校背景', candidateSchoolBackground(candidate)],
    ['投递/导入时间', formatProfileDateTime(candidateSubmittedAt(candidate))],
    ['最快到岗', formatDateOnly(applicationField(candidate, ['最快到岗时间', '预计入职时间']))],
    ['可实习时长', applicationField(candidate, ['可实习时长', '实习时长'])],
    ['简历文件', candidate?.resumeFile?.originalName || applicationField(candidate, ['简历', '简历PDF'])],
    ['投递来源', candidate?.source || 'manual']
  ];
}

function visibleApplicationEntries(candidate) {
  const hiddenFields = new Set([
    '姓名',
    '联系电话',
    '手机',
    '电话',
    '邮箱',
    '联系邮箱',
    '电子邮箱',
    'Email',
    'email',
    '投递时间',
    '提交时间',
    '提交日期',
    '创建时间',
    '导入时间',
    '最快到岗时间',
    '预计入职时间',
    '可实习时长',
    '实习时长',
    '简历',
    '简历PDF'
  ]);
  return Object.entries(candidate?.application?.fields || {}).filter(
    ([key, value]) => !hiddenFields.has(key) && meaningfulValue(value)
  );
}

function FieldValue({ value, fallback = '待补充' }) {
  const text = cleanFieldValue(value);
  const email = extractEmail(text);
  if (!text) return fallback;
  if (email && email === text) return <a href={`mailto:${email}`}>{email}</a>;
  return text;
}

function screeningListStatus(candidate) {
  const decision = candidate?.manualReview?.decision;
  if (decision === 'pass') return '已通过';
  if (decision === 'reject') return '不通过';
  if (!candidate?.screening) return '待筛';
  return displayMatchLevel(candidate.screening.recommendation, candidate.screening.score);
}

function confirmationStatusLabel(status = '') {
  const value = String(status || '');
  if (value === 'confirmed') return '候选人已确认';
  if (value === 'reschedule_requested') return '申请改期';
  if (value === 'declined') return '暂不参加';
  if (value === 'mail-draft-generated') return '确认邮件待发送';
  if (value === 'pending') return '等待候选人确认';
  return '待发送确认邮件';
}

function candidateScheduleStatus(candidate) {
  const confirmationStatus = candidate?.interview?.confirmation?.status;
  const inviteStatus = candidate?.interview?.inviteStatus;
  if (['web-sent-confirmed', 'graph-sent'].includes(inviteStatus)) return '已预约面试';
  if (['已预约面试', '面试记录', 'Offer跟进'].includes(candidate?.status)) return candidate.status;
  if (inviteStatus === 'web-link-generated') return 'Outlook日程待发送';
  if (candidate?.status === '候选人已确认' && !['reschedule_requested', 'declined'].includes(confirmationStatus)) {
    return '候选人已确认';
  }
  if (confirmationStatus) {
    const label = confirmationStatusLabel(confirmationStatus);
    if (confirmationStatus === 'reschedule_requested') return '待重新安排';
    if (confirmationStatus === 'declined') return '候选人放弃';
    return label;
  }
  if (candidate?.interview?.start) return '待发送确认邮件';
  return candidate?.status || (candidate?.manualReview?.decision === 'pass' ? '待安排时间' : '待邀约');
}

function candidateScheduleTime(candidate) {
  if (candidate?.interview?.start) return formatDateTime(candidate.interview.start);
  return applicationField(candidate, ['面试时间']) || '待安排';
}

function formalCalendarReady(candidate) {
  const confirmationStatus = candidate?.interview?.confirmation?.status;
  return (
    confirmationStatus === 'confirmed' ||
    ['web-link-generated', 'web-sent-confirmed', 'graph-sent'].includes(candidate?.interview?.inviteStatus)
  );
}

function statusTone(value) {
  if (['已通过', '高匹配', '较匹配', '强推', '可面', '候选人已确认', '已预约面试', '已确认发送'].includes(value)) return 'positive';
  if (['不通过', '不匹配', '不建议', '候选人放弃', '暂不参加'].includes(value)) return 'negative';
  if (
    [
      '待筛',
      '待确认',
      '可培养',
      '备选',
      '待安排时间',
      '待发送确认邮件',
      '确认邮件待发送',
      '等待候选人确认',
      '待重新安排',
      '申请改期',
      'Outlook日程待发送'
    ].includes(value)
  ) return 'pending';
  return 'neutral';
}

function ListStatusBadge({ value }) {
  const label = value || '待确认';
  return <span className={`list-status list-status-${statusTone(label)}`}>{label}</span>;
}

function latestInterviewRecord(candidate) {
  return candidate?.interviewRecords?.[0] || candidate?.interview?.lastRecord || null;
}

function filterCandidatesByStage(candidates, view) {
  if (view === 'schedule') {
    return candidates.filter((candidate) =>
      candidate.manualReview?.decision === 'pass' ||
      candidate.interview ||
      /待邀约|面试|确认|改期|已邀约|已预约|Outlook/i.test(candidate.status || '')
    );
  }
  if (view === 'interview') {
    return candidates.filter((candidate) => {
      return (
        candidate.interview ||
        candidate.interviewRecord ||
        candidate.interviewRecords?.length ||
        applicationField(candidate, ['面试评价', '面试官', '面试时间'])
      );
    });
  }
  if (view === 'onboarding') {
    return candidates.filter((candidate) => {
      return (
        /offer|入职/i.test(candidate.status || '') ||
        candidate.offer ||
        candidate.offerRecords?.length ||
        applicationField(candidate, ['offer情况', '预计入职时间'])
      );
    });
  }
  return candidates.filter((candidate) => candidate.source !== 'interview-sheet');
}

function stageCells(candidate, view) {
  const record = latestInterviewRecord(candidate);
  if (view === 'schedule') {
    return [
      candidate.name || candidateEmail(candidate) || candidate.id,
      displayContact(candidate),
      candidateScheduleTime(candidate),
      <ListStatusBadge value={candidateScheduleStatus(candidate)} />
    ];
  }
  if (view === 'interview') {
    return [
      candidate.name || candidateEmail(candidate) || candidate.id,
      record?.interviewer || applicationField(candidate, ['面试官']) || '待记录',
      record?.decision || (applicationField(candidate, ['面试评价']) ? '已有面评' : '待记录'),
      record?.createdAt ? formatDateTime(record.createdAt) : '待记录'
    ];
  }
  if (view === 'onboarding') {
    return [
      candidate.name || candidateEmail(candidate) || candidate.id,
      candidateOfferStatus(candidate),
      candidateOfferOnboard(candidate) || '待确认',
      candidateOfferDuration(candidate) || '待确认'
    ];
  }
  return [
    candidate.name || candidateEmail(candidate) || candidate.id,
    candidatePhone(candidate) || displayContact(candidate),
    candidate.screening?.score ?? '待筛',
    <ListStatusBadge value={screeningListStatus(candidate)} />
  ];
}

function reviewText(candidate) {
  const decision = candidate?.manualReview?.decision;
  if (decision === 'pass') return '已通过';
  if (decision === 'reject') return '不通过';
  return '待确认';
}

function nextCandidateIdAfterCurrent(candidates, currentId) {
  const ids = candidates.map((candidate) => candidate.id).filter(Boolean);
  const currentIndex = ids.indexOf(currentId);
  if (currentIndex === -1) return ids[0] || '';
  return ids[currentIndex + 1] || ids[currentIndex - 1] || '';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openPendingWindow(title) {
  const popup = window.open('', '_blank');
  if (!popup) return null;
  popup.document.title = title;
  popup.document.body.innerHTML = `<p style="font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;">${escapeHtml(title)}...</p>`;
  return popup;
}

function navigatePendingWindow(popup, url) {
  if (!url) {
    popup?.close();
    return;
  }
  if (popup) {
    popup.location.href = url;
  } else {
    window.open(url, '_blank');
  }
}

function defaultRecordDraft(candidate, interviewer = '陈百科') {
  return {
    interviewTime: candidate?.interview?.start || toDatetimeLocal(new Date()),
    interviewer,
    decision: '待定',
    score: '75',
    communication: '75',
    aiUnderstanding: '75',
    productSense: '75',
    motivation: '',
    strengths: '',
    concerns: '',
    summary: '',
    nextAction: ''
  };
}

function defaultOfferDraft(candidate) {
  const offer = candidate?.offer || {};
  return {
    acceptanceStatus: offer.acceptanceStatus || candidateOfferStatus(candidate),
    offerSentAt: toDateInput(offer.offerSentAt),
    acceptedAt: toDateInput(offer.acceptedAt),
    expectedOnboard: toDateInput(offer.expectedOnboard || candidateOfferOnboard(candidate)),
    internshipDuration: offer.internshipDuration || candidateOfferDuration(candidate),
    note: offer.note || '',
    owner: offer.owner || '陈百科'
  };
}

function defaultProfileDraft(candidate) {
  return {
    name: candidate?.name || '',
    email: editableCandidateEmail(candidate),
    phone: editableCandidatePhone(candidate),
    degree: candidateDegree(candidate),
    schoolBackground: candidateSchoolBackground(candidate),
    receivedAt: candidateSubmittedAt(candidate),
    arrival: applicationField(candidate, ['最快到岗时间', '预计入职时间']),
    duration: applicationField(candidate, ['可实习时长', '实习时长'])
  };
}

function SidebarButton({ active, icon, label, meta, onClick }) {
  return (
    <button className={`side-button ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {meta ? <small>{meta}</small> : null}
    </button>
  );
}

function Collapsible({ title, icon, meta, open, onToggle, children }) {
  return (
    <section className="collapsible">
      <button className="collapse-trigger" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {icon}
        <strong>{title}</strong>
        {meta ? <span>{meta}</span> : null}
      </button>
      {open ? <div className="collapse-body">{children}</div> : null}
    </section>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="status-item">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InterviewConfirmationPage({ token }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function loadConfirmation() {
    setError('');
    try {
      setData(await api(`/api/interview-confirmations/${encodeURIComponent(token)}`));
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    loadConfirmation();
  }, [token]);

  async function submit(response) {
    setBusy(response);
    setError('');
    try {
      const result = await api(`/api/interview-confirmations/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, note })
      });
      setData(result);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy('');
    }
  }

  const isDone = ['confirmed', 'reschedule_requested', 'declined'].includes(data?.status);
  const isHistoricalLink = data && data.isCurrent === false;

  return (
    <main className="public-confirm-shell">
      <section className="public-confirm-panel">
        <div className="public-confirm-brand">
          <span>乐享AI招聘</span>
          <strong>面试时间确认</strong>
        </div>
        {error ? (
          <div className="confirm-error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : null}
        {!data && !error ? <p className="muted">正在读取面试安排...</p> : null}
        {data ? (
          <>
            <div className="confirm-hero">
              <StatusPill value={data.statusText} />
              <h1>{data.candidateName}，请确认面试时间</h1>
              <p>{isHistoricalLink ? '这是历史确认链接，请以最新邮件中的链接为准。' : '确认后，我们会再发送正式 Outlook/Teams 日程邀请。'}</p>
            </div>
            <dl className="confirm-info">
              <dt>岗位</dt>
              <dd>{data.position}</dd>
              <dt>面试时间</dt>
              <dd>{data.timeText}</dd>
              <dt>面试方式</dt>
              <dd>{data.locationOrLink || '线上面试'}</dd>
              <dt>联系人</dt>
              <dd>
                {data.contactName}
                {data.contactPhone ? ` · ${data.contactPhone}` : ''}
              </dd>
            </dl>
            {isHistoricalLink && !isDone ? (
              <div className="confirm-result neutral-result">
                <AlertTriangle size={22} />
                <div>
                  <strong>历史链接已替换</strong>
                  <span>这条确认链接对应的面试时间已经更新，请查看最新确认邮件。</span>
                </div>
              </div>
            ) : isDone ? (
              <div className="confirm-result">
                <CheckCircle2 size={22} />
                <div>
                  <strong>{data.statusText}</strong>
                  <span>
                    {data.status === 'confirmed'
                      ? '感谢确认，请留意后续正式日程邮件。'
                      : data.status === 'reschedule_requested'
                        ? '我们已收到改期申请，会尽快重新协调时间。'
                        : '已收到反馈，感谢你的告知。'}
                  </span>
                  {data.note ? <span>备注：{data.note}</span> : null}
                </div>
              </div>
            ) : (
              <>
                <label className="confirm-note">
                  备注或可面时间
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="如果需要改期，可以写下你方便的时间段。"
                  />
                </label>
                <div className="confirm-actions">
                  <button onClick={() => submit('confirm')} disabled={Boolean(busy)}>
                    <CheckCircle2 size={16} />
                    确认参加
                  </button>
                  <button className="ghost-button" onClick={() => submit('reschedule')} disabled={Boolean(busy)}>
                    申请改期
                  </button>
                  <button className="danger-button" onClick={() => submit('decline')} disabled={Boolean(busy)}>
                    暂不参加
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}

function App() {
  const [security, setSecurity] = useState(null);
  const [accessToken, setAccessToken] = useState(() => storedAccessToken());
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: 'chenbk1', password: '' });
  const [activeView, setActiveView] = useState('screening');
  const [navCollapsed, setNavCollapsed] = useState(() => storedNavCollapsed());
  const [openPanels, setOpenPanels] = useState({
    larkForm: true,
    larkAdvanced: false,
    interviewSheet: false,
    outlook: false
  });
  const [health, setHealth] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [runs, setRuns] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('全部');
  const [candidatePage, setCandidatePage] = useState(1);
  const [syncQuery, setSyncQuery] = useState('超级智能体 实习申请');
  const [interview, setInterview] = useState(() => defaultInterviewDraft(null));
  const [timePreset, setTimePreset] = useState('custom');
  const [recordDraft, setRecordDraft] = useState(() => defaultRecordDraft(null));
  const [offerDraft, setOfferDraft] = useState(() => defaultOfferDraft(null));
  const [profileDraft, setProfileDraft] = useState(() => defaultProfileDraft(null));
  const [profileEditing, setProfileEditing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [deviceCode, setDeviceCode] = useState(null);
  const [larkStatus, setLarkStatus] = useState(null);
  const [larkFields, setLarkFields] = useState([]);
  const [larkConfig, setLarkConfig] = useState({
    profile: 'cli_a955ff0940789cca',
    as: 'bot',
    baseToken: '',
    tableId: '',
    viewId: '',
    resumeField: '简历',
    limit: 100
  });
  const [interviewTemplate, setInterviewTemplate] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [batchSelection, setBatchSelection] = useState([]);
  const [uploadFileName, setUploadFileName] = useState('');
  const [showResumeText, setShowResumeText] = useState(false);
  const [resumePreview, setResumePreview] = useState({
    candidateId: '',
    loading: false,
    url: '',
    error: '',
    mimeType: '',
    name: ''
  });
  const [detailLoadingId, setDetailLoadingId] = useState('');
  const [users, setUsers] = useState([]);
  const [userDraft, setUserDraft] = useState(defaultUserDraft);
  const [passwordDrafts, setPasswordDrafts] = useState({});

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) || candidates[0] || null,
    [candidates, selectedId]
  );

  const interviewTimeOptions = useMemo(() => buildInterviewTimeOptions(), []);
  const stageCandidates = useMemo(
    () => sortCandidatesForStage(filterCandidatesByStage(candidates, activeView), activeView),
    [activeView, candidates]
  );

  const statusOptions = useMemo(
    () => ['全部', ...Array.from(new Set(stageCandidates.map((item) => item.status).filter(Boolean)))],
    [stageCandidates]
  );

  const filteredCandidates = useMemo(() => {
    const query = candidateQuery.trim().toLowerCase();
    return stageCandidates.filter((candidate) => {
      const statusMatched = statusFilter === '全部' || candidate.status === statusFilter;
      const haystack = [
        candidate.name,
        candidateEmail(candidate),
        candidatePhone(candidate),
        candidate.status,
        candidate.source,
        candidate.school,
        candidate.messageSubject,
        candidate.screening?.recommendation,
        displayMatchLevel(candidate.screening?.recommendation, candidate.screening?.score),
        screeningListStatus(candidate),
        reviewText(candidate),
        latestInterviewRecord(candidate)?.decision,
        applicationField(candidate, ['offer情况', '面试评价', '预计入职时间'])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return statusMatched && (!query || haystack.includes(query));
    });
  }, [candidateQuery, stageCandidates, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / pageSize));
  const page = Math.min(candidatePage, totalPages);
  const pagedCandidates = filteredCandidates.slice((page - 1) * pageSize, page * pageSize);
  const selectedBatchCandidates = useMemo(
    () => candidates.filter((candidate) => batchSelection.includes(candidate.id)),
    [batchSelection, candidates]
  );
  const screenedCount = candidates.filter((candidate) => candidate.screening).length;
  const offerCount = candidates.filter(
    (candidate) => /offer|入职/i.test(candidate.status || '') || candidate.offer || candidate.offerRecords?.length
  ).length;
  const pipelineCounts = {
    screening: filterCandidatesByStage(candidates, 'screening').length,
    schedule: filterCandidatesByStage(candidates, 'schedule').length,
    interview: filterCandidatesByStage(candidates, 'interview').length,
    onboarding: filterCandidatesByStage(candidates, 'onboarding').length
  };
  const editableTemplate = templateDraft || interviewTemplate?.template || { subject: '', body: '' };
  const isAdmin = currentUser?.role === 'admin';
  const showStatusBand = activeView === 'overview' || activeView === 'intake';
  const larkSyncState = health?.larkSync || {};
  const larkAutoSyncEnabled = Boolean(health?.config?.lark?.autoSyncEnabled);
  const larkAutoSyncInterval = Number(health?.config?.lark?.autoSyncIntervalMinutes || 5);

  async function refresh() {
    const [nextHealth, nextCandidates, nextRuns, nextTemplate] = await Promise.all([
      api('/api/health'),
      api('/api/candidates'),
      api('/api/verification'),
      api('/api/settings/interview-template')
    ]);
    setHealth(nextHealth);
    setCandidates(nextCandidates);
    setRuns(nextRuns);
    setInterviewTemplate(nextTemplate);
    if (!templateDirty) setTemplateDraft(nextTemplate.template);
  }

  async function runAction(label, fn) {
    setBusy(label);
    setNotice('');
    try {
      const result = await fn();
      await refresh();
      setNotice(`${label}完成`);
      return result;
    } catch (error) {
      setNotice(error.message);
      return null;
    } finally {
      setBusy('');
    }
  }

  function togglePanel(key) {
    setOpenPanels((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleNavCollapsed() {
    setNavCollapsed((current) => {
      const next = !current;
      window.localStorage?.setItem('leai_nav_collapsed', String(next));
      return next;
    });
  }

  async function selectCandidate(candidate) {
    setSelectedId(candidate.id);
    setPreview(null);
    if (!candidate.isNew) return;
    try {
      const updated = await api(`/api/candidates/${candidate.id}/viewed`, { method: 'POST' });
      setCandidates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setNotice(error.message);
    }
  }

  useEffect(() => {
    setCandidatePage(1);
    if (activeView !== 'schedule') setBatchSelection([]);
  }, [activeView, candidateQuery, statusFilter]);

  useEffect(() => {
    if (!candidateStageViews.includes(activeView) || !stageCandidates.length) return;
    if (!stageCandidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(stageCandidates[0].id);
    }
  }, [activeView, selectedId, stageCandidates]);

  useEffect(() => {
    setShowResumeText(false);
  }, [selectedId]);

  useEffect(() => {
    setInterview(defaultInterviewDraft(selected));
    setTimePreset('custom');
    setPreview(null);
  }, [
    selected?.id,
    selected?.interview?.start,
    selected?.interview?.end,
    selected?.interview?.durationMinutes,
    selected?.interview?.locationOrLink,
    selected?.interview?.live,
    selected?.interview?.confirmation?.token,
    selected?.interview?.inviteStatus
  ]);

  useEffect(() => {
    const file = selected?.resumeFile;

    if (!selected?.id || !file || !security || (security.authRequired && !security.authenticated)) {
      setResumePreview({ candidateId: selected?.id || '', loading: false, url: '', error: '', mimeType: '', name: '' });
      return;
    }

    setResumePreview({
      candidateId: selected.id,
      loading: false,
      url: authenticatedFileUrl(`/api/candidates/${selected.id}/resume-file`),
      error: '',
      mimeType: file.mimeType || '',
      name: file.originalName || '简历原文件'
    });
  }, [
    accessToken,
    security,
    selected?.id,
    selected?.resumeFile?.mimeType,
    selected?.resumeFile?.originalName,
    selected?.resumeFile?.size
  ]);

  useEffect(() => {
    if (!selectedId || !security || (security.authRequired && !security.authenticated)) return;
    const current = candidates.find((candidate) => candidate.id === selectedId);
    if (current?._detailLoaded) return;
    let cancelled = false;
    setDetailLoadingId(selectedId);
    api(`/api/candidates/${selectedId}`)
      .then((detail) => {
        if (cancelled) return;
        setCandidates((items) =>
          items.map((item) => (item.id === selectedId ? { ...item, ...detail, _detailLoaded: true } : item))
        );
      })
      .catch((error) => {
        if (!cancelled) setNotice(error.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoadingId('');
      });
    return () => {
      cancelled = true;
    };
  }, [candidates, security, selectedId]);

  useEffect(() => {
    setRecordDraft(defaultRecordDraft(selected, health?.config?.recruiting?.contactName || '陈百科'));
  }, [health?.config?.recruiting?.contactName, selected?.id]);

  useEffect(() => {
    setOfferDraft(defaultOfferDraft(selected));
  }, [selected?.id, selected?.offer?.updatedAt, selected?.offerRecords?.length]);

  useEffect(() => {
    if (!profileEditing) setProfileDraft(defaultProfileDraft(selected));
  }, [profileEditing, selected?.id, selected?.updatedAt]);

  useEffect(() => {
    api('/api/security/status')
      .then((nextSecurity) => {
        setSecurity(nextSecurity);
        setCurrentUser(nextSecurity.user || null);
        if (!nextSecurity.authRequired || nextSecurity.authenticated) {
          refresh().catch((error) => {
            if (/登录|访问令牌|token/i.test(String(error.message || ''))) {
              window.localStorage?.removeItem('leai_session_token');
              window.localStorage?.removeItem('leai_app_token');
              setAccessToken('');
              setCurrentUser(null);
            }
            setNotice(error.message);
          });
        }
      })
      .catch((error) => setNotice(error.message));
  }, [accessToken]);

  useEffect(() => {
    if (activeView !== 'accounts' || !isAdmin) return;
    loadUsers().catch((error) => setNotice(error.message));
  }, [activeView, isAdmin]);

  useEffect(() => {
    if (!health?.config?.lark) return;
    setLarkConfig((current) => ({
      ...current,
      profile: current.profile || health.config.lark.profile,
      as: current.as || health.config.lark.as,
      baseToken: current.baseToken || '',
      tableId: current.tableId || '',
      viewId: current.viewId || health.config.lark.viewId || '',
      resumeField: current.resumeField || health.config.lark.resumeField,
      limit: current.limit || health.config.lark.defaultLimit
    }));
  }, [health?.config?.lark]);

  async function connectOutlook() {
    if (health?.config?.outlook?.hasClientId) {
      const { authUrl } = await runAction('生成 Outlook 授权链接', () => api('/api/outlook/auth-url'));
      if (authUrl) window.location.href = authUrl;
      return;
    }
    const { authUrl } = await runAction('生成 Outlook 浏览器授权链接', () => api('/api/outlook/public-auth-url'));
    if (authUrl) window.location.href = authUrl;
  }

  async function pollOutlookDeviceCode() {
    const result = await runAction('检查 Outlook 授权状态', () =>
      api('/api/outlook/device-code/poll', { method: 'POST' })
    );
    if (result?.status === 'connected') setDeviceCode(null);
  }

  async function syncMock() {
    await runAction('导入样例简历', () =>
      api('/api/outlook/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mock: true })
      })
    );
  }

  async function syncOutlook() {
    await runAction('同步 Outlook 简历', () =>
      api('/api/outlook/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: syncQuery, limit: 30 })
      })
    );
  }

  async function checkLark() {
    const result = await runAction('检查飞书机器人', () => api('/api/lark/status'));
    if (result) setLarkStatus(result);
  }

  async function loadLarkFields() {
    const result = await runAction('读取飞书字段', () =>
      api('/api/lark/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(larkConfig)
      })
    );
    if (result?.fields) setLarkFields(result.fields);
  }

  async function syncLark() {
    const result = await runAction('同步表单投递', () =>
      api('/api/lark/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(larkConfig)
      })
    );
    if (result?.imported?.[0]?.id) {
      setSelectedId(result.imported[0].id);
      setActiveView('screening');
    }
  }

  async function syncInterviewSheet() {
    const result = await runAction('同步历史面试表', () =>
      api('/api/interview-sheet/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
    );
    if (result?.imported?.[0]?.id && !selectedId) {
      setSelectedId(result.imported[0].id);
    }
    if (result?.imported?.length) setActiveView('interview');
  }

  async function loadUsers() {
    const result = await api('/api/users');
    setUsers(result.users || []);
  }

  async function createUser(event) {
    event.preventDefault();
    await runAction('创建账号', async () => {
      const result = await api('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userDraft)
      });
      setUserDraft(defaultUserDraft);
      await loadUsers();
      return result;
    });
  }

  async function updateUser(userId, patch) {
    await runAction('更新账号', async () => {
      const result = await api(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      await loadUsers();
      return result;
    });
  }

  async function resetUserPassword(userId) {
    const password = passwordDrafts[userId] || '';
    if (!password) {
      setNotice('请先输入新密码。');
      return;
    }
    await updateUser(userId, { password });
    setPasswordDrafts((current) => ({ ...current, [userId]: '' }));
  }

  async function removeUser(user) {
    if (!window.confirm(`确认删除账号 ${user.username}？`)) return;
    await runAction('删除账号', async () => {
      const result = await api(`/api/users/${user.id}`, { method: 'DELETE' });
      await loadUsers();
      return result;
    });
  }

  async function login(event) {
    event.preventDefault();
    const result = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm)
    });
    if (result?.ok) {
      window.localStorage?.setItem('leai_session_token', result.token);
      window.localStorage?.removeItem('leai_app_token');
      setAccessToken(result.token);
      setCurrentUser(result.user || null);
      setSecurity((current) => ({
        ...(current || {}),
        authRequired: true,
        authenticated: true,
        user: result.user || null,
        authMode: 'session'
      }));
      setLoginForm((current) => ({ ...current, password: '' }));
      setNotice('');
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Local logout should still clear the browser session if the server token expired.
    }
    window.localStorage?.removeItem('leai_session_token');
    window.localStorage?.removeItem('leai_app_token');
    setAccessToken('');
    setCurrentUser(null);
    setSecurity((current) => ({ ...(current || {}), authenticated: false, user: null, authMode: 'none' }));
    setCandidates([]);
    setRuns([]);
    setSelectedId('');
    setUsers([]);
    setNotice('');
  }

  async function selfTest() {
    await runAction('端到端自检', () => api('/api/self-test', { method: 'POST' }));
  }

  async function uploadResume(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('resume');
    if (!(file instanceof File) || !file.name) {
      setNotice('请选择 Word 或 PDF 简历文件。');
      return;
    }
    const result = await runAction('上传简历', () =>
      api('/api/candidates/upload', {
        method: 'POST',
        body: form
      })
    );
    if (result?.id) setSelectedId(result.id);
    event.currentTarget.reset();
    setUploadFileName('');
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!selected) return;
    const result = await runAction('保存投递档案', () =>
      api(`/api/candidates/${selected.id}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileDraft)
      })
    );
    if (result?.id) {
      setSelectedId(result.id);
      setProfileEditing(false);
      setProfileDraft(defaultProfileDraft(result));
    }
  }

  async function openProfileEditor() {
    if (!selected) return;
    let editableCandidate = selected;
    if (!selected._detailLoaded) {
      try {
        const detail = await api(`/api/candidates/${selected.id}`);
        editableCandidate = { ...selected, ...detail, _detailLoaded: true };
        setCandidates((items) =>
          items.map((item) => (item.id === selected.id ? editableCandidate : item))
        );
      } catch (error) {
        setNotice(error.message);
        return;
      }
    }
    setProfileDraft(defaultProfileDraft(editableCandidate));
    setProfileEditing(true);
  }

  async function screenSelected() {
    if (!selected) return;
    const result = await runAction(selected.screening ? '重跑匹配评估' : '岗位匹配评估', () =>
      api(`/api/candidates/${selected.id}/screen`, { method: 'POST' })
    );
    if (result?.id) setSelectedId(result.id);
  }

  async function rescreenCurrentList() {
    if (!filteredCandidates.length) {
      setNotice('当前列表没有可重跑的候选人。');
      return;
    }
    const ids = filteredCandidates.map((candidate) => candidate.id);
    const label = `AI批量评估 ${ids.length}人`;
    const result = await runAction(label, () =>
      api('/api/candidates/screen-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, limit: ids.length })
      })
    );
    if (result?.screened?.[0]?.id) setSelectedId(result.screened[0].id);
    if (result?.failed?.length) {
      setNotice(`${label}完成，${result.failed.length}人失败`);
    }
  }

  async function reviewSelected(decision) {
    if (!selected) return;
    const nextScreeningCandidateId =
      decision === 'pass' && activeView === 'screening'
        ? nextCandidateIdAfterCurrent(filteredCandidates, selected.id)
        : '';
    const labels = {
      pass: '通过简历',
      reject: '标记不通过',
      undo: '撤销人工判断'
    };
    const result = await runAction(labels[decision], () =>
      api(`/api/candidates/${selected.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      })
    );
    if (result?.id) {
      setSelectedId(nextScreeningCandidateId || result.id);
      if (decision === 'pass') setActiveView('screening');
      if (decision === 'undo') setActiveView('screening');
    }
  }

  function applyInterviewTimePreset(value) {
    setTimePreset(value);
    const option = interviewTimeOptions.find((item) => item.value === value);
    if (!option) return;
    setInterview((current) => {
      const durationMinutes = Number(current.durationMinutes || defaultInterviewDurationMinutes);
      return {
        ...current,
        start: option.start,
        end: resolveInterviewEnd(option.start, durationMinutes),
        durationMinutes
      };
    });
    setRecordDraft((current) => ({
      ...current,
      interviewTime: option.start
    }));
  }

  function updateInterviewStart(start) {
    setTimePreset('custom');
    setInterview((current) => ({
      ...current,
      start,
      end: resolveInterviewEnd(start, current.durationMinutes)
    }));
    setRecordDraft((current) => ({
      ...current,
      interviewTime: start
    }));
  }

  function updateInterviewDuration(durationValue) {
    const durationMinutes = Number(durationValue || defaultInterviewDurationMinutes);
    setInterview((current) => ({
      ...current,
      durationMinutes,
      end: resolveInterviewEnd(current.start, durationMinutes)
    }));
  }

  async function previewInterview() {
    if (!selected) return;
    const result = await runAction('生成面邀预览', () =>
      api(`/api/candidates/${selected.id}/interview/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(interview)
      })
    );
    setPreview(result);
  }

  async function scheduleInterview() {
    if (!selected) return;
    const result = await runAction(interview.live ? 'Graph创建Outlook/Teams日程邀请' : 'dry-run 预定验证', () =>
      api(`/api/candidates/${selected.id}/interview/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(interview)
      })
    );
    if (result?.payload) setPreview(result.payload);
  }

  async function openInterviewConfirmationMail() {
    if (!selected) return;
    const mailWindow = openPendingWindow('正在打开面试确认邮件草稿');
    const result = await runAction('打开面试确认邮件草稿', () =>
      api(`/api/candidates/${selected.id}/interview/confirmation-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(interview)
      })
    );
    if (result?.payload) {
      setPreview(result.payload);
      navigatePendingWindow(mailWindow, result.webMailUrl || result.payload.webMailUrl);
    } else {
      mailWindow?.close();
    }
  }

  async function confirmInterviewConfirmationMailSent() {
    if (!selected) return;
    const result = await runAction('确认面试确认邮件已发送', () =>
      api(`/api/candidates/${selected.id}/interview/confirmation-mail-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: '已在 Outlook Web 点击发送' })
      })
    );
    if (result?.id) setSelectedId(result.id);
  }

  async function openOfferMail() {
    if (!selected) return;
    const mailWindow = openPendingWindow('正在打开 Offer 邮件草稿');
    const result = await runAction('打开Offer邮件草稿', () =>
      api(`/api/candidates/${selected.id}/offer/outlook-web-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offerDraft)
      })
    );
    if (result?.webMailUrl) {
      navigatePendingWindow(mailWindow, result.webMailUrl);
    } else {
      mailWindow?.close();
    }
  }

  async function openOutlookCalendarInvite() {
    if (!selected) return;
    const calendarWindow = openPendingWindow('正在打开 Outlook 日程邀请');
    const result = await runAction('打开 Outlook 日程邀请', () =>
      api(`/api/candidates/${selected.id}/interview/outlook-web-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(interview)
      })
    );
    if (result?.payload) {
      setPreview(result.payload);
      navigatePendingWindow(calendarWindow, result.webCalendarUrl || result.payload.webCalendarUrl);
    } else {
      calendarWindow?.close();
    }
  }

  async function confirmOutlookCalendarSent() {
    if (!selected) return;
    const result = await runAction('确认 Outlook 日程已发送', () =>
      api(`/api/candidates/${selected.id}/interview/confirm-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamsConfirmation: 'outlook-web' })
      })
    );
    if (result?.id) setSelectedId(result.id);
  }

  async function saveOfferStatus() {
    if (!selected) return;
    const result = await runAction('保存Offer接受情况', () =>
      api(`/api/candidates/${selected.id}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offerDraft)
      })
    );
    if (result?.id) setSelectedId(result.id);
  }

  function toggleBatchCandidate(candidateId, checked) {
    setBatchSelection((current) => {
      if (checked) return Array.from(new Set([...current, candidateId]));
      return current.filter((id) => id !== candidateId);
    });
  }

  function selectCurrentPageForBatch() {
    const selectableIds = pagedCandidates
      .filter((candidate) => candidateHasEmail(candidate) && formalCalendarReady(candidate))
      .map((candidate) => candidate.id);
    setBatchSelection((current) => Array.from(new Set([...current, ...selectableIds])));
  }

  async function bulkOpenOutlookCalendarInvites() {
    const targets = selectedBatchCandidates.filter((candidate) => candidateHasEmail(candidate) && formalCalendarReady(candidate));
    if (!targets.length) {
      setNotice('请先勾选已确认面试时间且有邮箱的候选人。');
      return;
    }
    const calendarHub = openPendingWindow('正在生成批量 Outlook 日程邀请链接');
    setBusy('批量生成 Outlook 日程邀请链接');
    setNotice('');
    const failures = [];
    const calendarLinks = [];
    let done = 0;
    try {
      for (const candidate of targets) {
        const candidateInterview = {
          start: candidate.interview?.start || interview.start,
          end:
            candidate.interview?.end ||
            resolveInterviewEnd(candidate.interview?.start || interview.start, interview.durationMinutes),
          durationMinutes: interview.durationMinutes,
          locationOrLink: candidate.interview?.locationOrLink || interview.locationOrLink,
          createCalendar: false
        };
        try {
          const result = await api(`/api/candidates/${candidate.id}/interview/outlook-web-calendar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(candidateInterview)
          });
          if (result?.payload?.webCalendarUrl) {
            calendarLinks.push({
              name: candidate.name || candidateEmail(candidate) || candidate.id,
              url: result.payload.webCalendarUrl
            });
          }
          done += 1;
        } catch (error) {
          failures.push(`${candidate.name || candidateEmail(candidate) || candidate.id}：${error.message}`);
        }
      }
      if (calendarHub) {
        const rows = calendarLinks
          .map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.name)} - 打开 Outlook 日程邀请</a></li>`)
          .join('');
        calendarHub.document.body.innerHTML = `
          <main style="font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;padding:24px;max-width:760px;">
            <h1 style="font-size:20px;margin:0 0 12px;">批量 Outlook 日程邀请链接</h1>
            <p>逐个打开链接，确认 Teams 会议开关已开启后点击发送。Outlook 会给候选人发会议邀请，并同步到 Outlook/Teams 日历。</p>
            <ol>${rows || '<li>没有可用日程链接</li>'}</ol>
          </main>
        `;
      }
      await refresh();
      setBatchSelection([]);
      setNotice(failures.length ? `批量完成 ${done}/${targets.length}；失败：${failures.join('；')}` : `批量完成 ${done}/${targets.length}，已生成 Outlook 日程邀请链接。`);
    } finally {
      setBusy('');
    }
  }

  async function copyInterviewDraft() {
    if (!preview?.email) return;
    const text = [
      `收件人：${candidateEmail(selected) || '请手动补充候选人邮箱'}`,
      `主题：${preview.email.subject}`,
      '',
      preview.email.bodyText
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice('邮件内容已复制，可粘贴到 Outlook 新邮件后发送。');
    } catch {
      setNotice('复制失败，请直接从预览区复制正文。');
    }
  }

  function updateTemplateDraft(field, value) {
    setTemplateDirty(true);
    setTemplateDraft((current) => ({
      ...(current || interviewTemplate?.template || {}),
      [field]: value
    }));
  }

  async function saveInterviewTemplate() {
    const result = await runAction('保存面邀模板', () =>
      api('/api/settings/interview-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: editableTemplate })
      })
    );
    if (result?.template) {
      setTemplateDirty(false);
      setInterviewTemplate((current) => ({ ...(current || {}), template: result.template }));
      setTemplateDraft(result.template);
    }
  }

  async function resetInterviewTemplate() {
    const result = await runAction('恢复默认面邀模板', () =>
      api('/api/settings/interview-template/reset', { method: 'POST' })
    );
    if (result?.template) {
      setTemplateDirty(false);
      setInterviewTemplate((current) => ({ ...(current || {}), template: result.template }));
      setTemplateDraft(result.template);
    }
  }

  async function saveInterviewRecord() {
    if (!selected) return;
    const result = await runAction('保存面试记录', () =>
      api(`/api/candidates/${selected.id}/interview/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordDraft)
      })
    );
    if (result?.id) {
      setSelectedId(result.id);
      setRecordDraft(defaultRecordDraft(result, health?.config?.recruiting?.contactName || '陈百科'));
    }
  }

  const outlookConnected = Boolean(health?.outlook?.connected);
  const interviewHasStart = Boolean(interview.start);
  const officialInviteSent = ['web-sent-confirmed', 'graph-sent'].includes(selected?.interview?.inviteStatus);
  const confirmationCompleted = ['confirmed', 'declined'].includes(selected?.interview?.confirmation?.status);
  const confirmationMailSentVisible =
    selected?.interview?.confirmation?.status === 'mail-draft-generated' && !officialInviteSent;
  const confirmationMailDisabled =
    Boolean(busy) ||
    !interviewHasStart ||
    !candidateHasEmail(selected) ||
    confirmationCompleted ||
    (officialInviteSent && !['待重新安排', '申请改期'].includes(selected?.status));
  const formalCalendarDisabled =
    Boolean(busy) ||
    !interviewHasStart ||
    !candidateHasEmail(selected) ||
    !formalCalendarReady(selected) ||
    officialInviteSent;
  const interviewScheduleDisabled =
    Boolean(busy) || !interviewHasStart || !outlookConnected || (interview.live && !formalCalendarReady(selected));
  const scheduleUndoVisible =
    selected?.manualReview && !selected?.interview?.confirmation && !selected?.interview?.inviteStatus && !selected?.interview?.start;
  const bailianReady = Boolean(health?.config?.bailian?.hasApiKey);
  const larkProfile = larkStatus?.profile || health?.config?.lark?.profile || larkConfig.profile;
  const larkBackendReady = Boolean(health?.config?.lark?.hasBaseToken && health?.config?.lark?.hasTableId);
  const larkCanReadFields = Boolean((larkConfig.baseToken && larkConfig.tableId) || larkBackendReady);
  const larkCanSync = Boolean(larkConfig.baseToken || health?.config?.lark?.hasBaseToken);
  const larkFormShareUrl = health?.config?.lark?.formShareUrl;
  const larkBaseUrl = health?.config?.lark?.baseUrl;
  const larkTableId = health?.config?.lark?.tableId || 'tblAg0ejOVZePTOI';
  const interviewSheetVisible = Boolean(health?.config?.interviewSheet?.enabled);
  const interviewSheetUrl = health?.config?.interviewSheet?.url;
  const interviewSheetReady = Boolean(
    interviewSheetVisible &&
      (health?.config?.interviewSheet?.hasUrl || health?.config?.interviewSheet?.hasSpreadsheetToken)
  );

  if (security?.authRequired && !security.authenticated) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={login}>
          <KeyRound size={28} />
          <h1>乐享AI招聘工作台</h1>
          <p>使用工作台账号登录。管理员初始账号为 chenbk1。</p>
          <label>
            账号
            <input
              value={loginForm.username}
              onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
              placeholder="chenbk1"
              autoFocus
            />
          </label>
          <label>
            密码
            <input
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
              placeholder="请输入密码"
              type="password"
            />
          </label>
          <button type="submit" disabled={!loginForm.username || !loginForm.password}>登录</button>
          {notice ? <span className="login-error">{notice}</span> : null}
        </form>
      </main>
    );
  }

  return (
    <main className={`app-shell ${navCollapsed ? 'nav-collapsed' : ''}`} data-ui-version="match-rubric-20260528">
      <aside className="side-nav">
        <div className="brand-block">
          <strong>乐享AI招聘</strong>
          <span>Intern Ops</span>
        </div>
        <nav>
          <SidebarButton
            active={activeView === 'overview'}
            icon={<LayoutDashboard size={17} />}
            label="总览"
            onClick={() => setActiveView('overview')}
          />
          <SidebarButton
            active={activeView === 'intake'}
            icon={<Database size={17} />}
            label="投递采集"
            onClick={() => setActiveView('intake')}
          />
          <SidebarButton
            active={activeView === 'screening'}
            icon={<FileSearch size={17} />}
            label="简历筛选"
            meta={String(pipelineCounts.screening)}
            onClick={() => setActiveView('screening')}
          />
          <SidebarButton
            active={activeView === 'schedule'}
            icon={<CalendarPlus size={17} />}
            label="面试安排"
            meta={String(pipelineCounts.schedule)}
            onClick={() => setActiveView('schedule')}
          />
          <SidebarButton
            active={activeView === 'interview'}
            icon={<ListChecks size={17} />}
            label="面试记录"
            meta={String(pipelineCounts.interview)}
            onClick={() => setActiveView('interview')}
          />
          <SidebarButton
            active={activeView === 'onboarding'}
            icon={<CheckCircle2 size={17} />}
            label="Offer/入职"
            meta={String(pipelineCounts.onboarding)}
            onClick={() => setActiveView('onboarding')}
          />
          <SidebarButton
            active={activeView === 'verification'}
            icon={<ListChecks size={17} />}
            label="操作日志"
            onClick={() => setActiveView('verification')}
          />
          {isAdmin ? (
            <SidebarButton
              active={activeView === 'accounts'}
              icon={<ShieldCheck size={17} />}
              label="账号管理"
              meta={String(users.length || '')}
              onClick={() => setActiveView('accounts')}
            />
          ) : null}
        </nav>
        <div className="side-foot">
          <ShieldCheck size={16} />
          <span>{currentUser?.displayName || currentUser?.username || (security?.localOnly ? '本机访问' : '网络访问')}</span>
        </div>
      </aside>

      <section className="workbench">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button nav-toggle"
              onClick={toggleNavCollapsed}
              title={navCollapsed ? '显示左侧导航' : '隐藏左侧导航'}
              aria-label={navCollapsed ? '显示左侧导航' : '隐藏左侧导航'}
            >
              {navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <div>
              <h1>乐享AI实习生招聘工作台</h1>
              <p>飞书投递、AI 筛选、Outlook 日程邀请和 Teams 面试链接</p>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="current-user">
              <ShieldCheck size={16} />
              {currentUser?.displayName || currentUser?.username || '已登录'}
              <small>{currentUser?.role === 'admin' ? '管理员' : '成员'}</small>
            </span>
            <button className="icon-button" onClick={refresh} disabled={Boolean(busy)} title="刷新">
              <RefreshCw size={18} />
              刷新
            </button>
            <button className="ghost-button" onClick={logout} disabled={Boolean(busy)}>
              退出
            </button>
          </div>
        </header>

        {showStatusBand ? (
          <section className="status-band">
            <Metric icon={<Inbox size={18} />} label="Outlook" value={outlookConnected ? '已连接' : '未连接'} />
            <Metric icon={<ShieldCheck size={18} />} label="百炼" value={bailianReady ? '已配置' : '启发式'} />
            <Metric icon={<Database size={18} />} label="飞书" value={larkProfile} />
            <Metric icon={<Users size={18} />} label="候选人" value={candidates.length} />
            <Metric icon={<CheckCircle2 size={18} />} label="已筛选" value={screenedCount} />
          </section>
        ) : null}

        {notice ? <div className="notice">{notice}</div> : null}
        {busy ? <div className="busy">{busy}中...</div> : null}

        {activeView === 'overview' ? (
          <section className="overview-grid">
            <div className="summary-card">
              <span>候选人总数</span>
              <strong>{candidates.length}</strong>
            </div>
            <div className="summary-card">
              <span>已筛选</span>
              <strong>{screenedCount}</strong>
            </div>
            <div className="summary-card">
              <span>Offer/入职跟进</span>
              <strong>{offerCount}</strong>
            </div>
            <div className="summary-card">
              <span>最近验证</span>
              <strong>{runs[0]?.status || '待运行'}</strong>
            </div>
          </section>
        ) : null}

        {activeView === 'intake' ? (
          <section className="stack">
            <Collapsible
              title="飞书表单投递"
              icon={<Database size={16} />}
              meta="候选人入口 + Base 同步"
              open={openPanels.larkForm}
              onToggle={() => togglePanel('larkForm')}
            >
              <div className="quick-actions">
                {larkFormShareUrl ? (
                  <a className="primary-link" href={larkFormShareUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    打开候选人投递入口
                  </a>
                ) : null}
                <button onClick={syncLark} disabled={Boolean(busy) || !larkCanSync}>
                  <Inbox size={16} />
                  同步表单投递
                </button>
              </div>
              <dl className="data-map">
                <dt>收集数据位置</dt>
                <dd>
                  {larkBaseUrl ? (
                    <a href={larkBaseUrl} target="_blank" rel="noreferrer">飞书多维表格</a>
                  ) : (
                    '飞书多维表格'
                  )}
                  <span> / 投递入口表 / {larkTableId}</span>
                </dd>
                <dt>同步方式</dt>
                <dd>
                  {larkAutoSyncEnabled
                    ? `服务器每 ${larkAutoSyncInterval} 分钟自动拉取一次；手动按钮用于立即刷新。`
                    : '候选人提交后进入 Base 表，本地平台点击“同步表单投递”拉取最新记录。'}
                </dd>
                {larkSyncState.lastFinishedAt ? (
                  <>
                    <dt>最近同步</dt>
                    <dd>
                      {new Date(larkSyncState.lastFinishedAt).toLocaleString()}
                      {larkSyncState.lastStatus === 'failed'
                        ? ` · 失败：${larkSyncState.lastError}`
                        : ` · ${larkSyncState.lastScanned || 0} 条`}
                    </dd>
                  </>
                ) : null}
              </dl>
              <Collapsible
                title="高级配置"
                icon={<Settings size={16} />}
                open={openPanels.larkAdvanced}
                onToggle={() => togglePanel('larkAdvanced')}
              >
                <div className="lark-grid">
                  <input
                    value={larkConfig.profile}
                    onChange={(event) => setLarkConfig({ ...larkConfig, profile: event.target.value })}
                    placeholder="飞书 profile"
                  />
                  <input
                    value={larkConfig.baseToken}
                    onChange={(event) => setLarkConfig({ ...larkConfig, baseToken: event.target.value })}
                    placeholder="Base 链接或 token"
                  />
                  <input
                    value={larkConfig.tableId}
                    onChange={(event) => setLarkConfig({ ...larkConfig, tableId: event.target.value })}
                    placeholder="数据表 ID 或名称"
                  />
                  <input
                    value={larkConfig.viewId}
                    onChange={(event) => setLarkConfig({ ...larkConfig, viewId: event.target.value })}
                    placeholder="视图 ID 或名称"
                  />
                  <input
                    value={larkConfig.resumeField}
                    onChange={(event) => setLarkConfig({ ...larkConfig, resumeField: event.target.value })}
                    placeholder="简历附件字段"
                  />
                  <input
                    value={larkConfig.limit}
                    type="number"
                    min="1"
                    max="200"
                    onChange={(event) => setLarkConfig({ ...larkConfig, limit: Number(event.target.value) })}
                    placeholder="拉取数量"
                  />
                </div>
                <div className="toolbar">
                  <button onClick={checkLark} disabled={Boolean(busy)}>
                    <ShieldCheck size={16} />
                    检查机器人
                  </button>
                  <button onClick={loadLarkFields} disabled={Boolean(busy) || !larkCanReadFields}>
                    <FileSearch size={16} />
                    读取字段
                  </button>
                </div>
                {larkFields.length ? (
                  <div className="field-chips">
                    {larkFields.map((field) => (
                      <span key={field.field_id || field.field_name || field.name}>
                        {field.field_name || field.name || field.field_id}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Collapsible>
            </Collapsible>

            {interviewSheetVisible ? (
              <Collapsible
                title="历史面试表回填"
                icon={<FileSpreadsheet size={16} />}
                meta={`${health?.config?.interviewSheet?.sheetId || 'sheet'} · ${health?.config?.interviewSheet?.range || ''}`}
                open={openPanels.interviewSheet}
                onToggle={() => togglePanel('interviewSheet')}
              >
                <div className="quick-actions">
                  {interviewSheetUrl ? (
                    <a className="primary-link" href={interviewSheetUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      打开历史面试表
                    </a>
                  ) : null}
                  <button onClick={syncInterviewSheet} disabled={Boolean(busy) || !interviewSheetReady}>
                    <FileSpreadsheet size={16} />
                    同步历史面试表
                  </button>
                </div>
                <dl className="data-map">
                  <dt>用途边界</dt>
                  <dd>只读回填既有面试/Offer 记录，用于对照历史数据；不会进入当前“简历筛选”候选池。</dd>
                  <dt>当前投递</dt>
                  <dd>新候选人以“同步表单投递”为主，进入简历筛选、人工通过和面邀链路。</dd>
                </dl>
              </Collapsible>
            ) : null}

            <Collapsible
              title="Outlook 备选链路"
              icon={<Mail size={16} />}
              meta={outlookConnected ? '已连接' : '未连接'}
              open={openPanels.outlook}
              onToggle={() => togglePanel('outlook')}
            >
              <div className="toolbar">
                <button onClick={connectOutlook} disabled={Boolean(busy)}>
                  <Mail size={16} />
                  连接 Outlook
                </button>
                <button onClick={syncMock} disabled={Boolean(busy)}>
                  <PlayCircle size={16} />
                  导入样例
                </button>
                <button onClick={selfTest} disabled={Boolean(busy)}>
                  <CheckCircle2 size={16} />
                  端到端自检
                </button>
              </div>
              {deviceCode ? (
                <div className="device-code">
                  <span>打开 {deviceCode.verificationUri} 并输入代码</span>
                  <strong>{deviceCode.userCode}</strong>
                  <button onClick={pollOutlookDeviceCode} disabled={Boolean(busy)}>
                    检查授权
                  </button>
                </div>
              ) : null}
              <div className="sync-row">
                <input
                  value={syncQuery}
                  onChange={(event) => setSyncQuery(event.target.value)}
                  placeholder="Outlook 邮件关键词"
                />
                <button onClick={syncOutlook} disabled={Boolean(busy) || !outlookConnected}>
                  <Inbox size={16} />
                  同步 Outlook 简历
                </button>
              </div>
            </Collapsible>
          </section>
        ) : null}

        {candidateStageViews.includes(activeView) ? (
          <section className="main-grid">
            <aside className="candidate-pane" data-view={activeView}>
              <div className="pane-title">
                <div className="pane-title-main">
                  <div className="pane-heading-row">
                    <h2>{stageMeta[activeView].title}</h2>
                    <small className="candidate-count">{filteredCandidates.length}/{stageCandidates.length}</small>
                  </div>
                  {activeView === 'screening' ? (
                    <div className="pane-action-row">
                      <button
                        className="compact-button"
                        onClick={syncLark}
                        disabled={Boolean(busy) || !larkCanSync}
                        title="立即同步飞书表单投递"
                      >
                        <Inbox size={15} />
                        同步表单投递
                      </button>
                      <button
                        className="compact-button"
                        onClick={rescreenCurrentList}
                        disabled={Boolean(busy) || !filteredCandidates.length}
                        title="按当前搜索和状态筛选结果批量评估岗位匹配度"
                      >
                        <FileSearch size={15} />
                        AI批量评估
                      </button>
                    </div>
                  ) : null}
                  <small className="pane-description">{stageMeta[activeView].description}</small>
                </div>
              </div>
              <div className="candidate-tools">
                <label className="search-box">
                  <Search size={16} />
                  <input
                    value={candidateQuery}
                    onChange={(event) => setCandidateQuery(event.target.value)}
                    placeholder="搜索姓名、电话、状态"
                  />
                </label>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              {activeView === 'screening' ? (
                <details className="upload-drawer">
                  <summary>
                    <Upload size={16} />
                    <span>上传简历</span>
                  </summary>
                  <form className="upload-form" onSubmit={uploadResume}>
                    <input name="name" placeholder="姓名" />
                    <input name="email" placeholder="联系邮箱" type="email" />
                    <input name="phone" placeholder="联系电话" inputMode="tel" />
                    <label className="file-input">
                      <Upload size={16} />
                      <span>{uploadFileName || '选择 Word/PDF'}</span>
                      <input
                        name="resume"
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={(event) => setUploadFileName(event.target.files?.[0]?.name || '')}
                      />
                    </label>
                    <button type="submit" disabled={Boolean(busy)}>上传</button>
                  </form>
                </details>
              ) : null}
              {activeView === 'schedule' ? (
                <div className="batch-toolbar">
                  <span>已选 {batchSelection.length}</span>
                  <button className="ghost-button" onClick={selectCurrentPageForBatch} disabled={Boolean(busy)}>
                    选择本页
                  </button>
                  <button className="ghost-button" onClick={() => setBatchSelection([])} disabled={Boolean(busy) || !batchSelection.length}>
                    清空
                  </button>
                  <button onClick={bulkOpenOutlookCalendarInvites} disabled={Boolean(busy) || !batchSelection.length}>
                    <CalendarPlus size={16} />
                    批量日程邀请
                  </button>
                </div>
              ) : null}

              <div className="candidate-list">
                {filteredCandidates.length === 0 ? (
                  <EmptyState title="没有匹配候选人" description="调整搜索或状态筛选" />
                ) : (
                  <div className="stage-table">
                    <div
                      className="stage-row stage-header"
                      style={{
                        '--cols': stageMeta[activeView].columns.length,
                        '--stage-columns': stageMeta[activeView].columnTemplate || `repeat(${stageMeta[activeView].columns.length}, minmax(0, 1fr))`
                      }}
                    >
                      {stageMeta[activeView].columns.map((column) => (
                        <span key={column}>{column}</span>
                      ))}
                    </div>
                    {pagedCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className={`stage-row ${selected?.id === candidate.id ? 'active' : ''}`}
                        style={{
                          '--cols': stageMeta[activeView].columns.length,
                          '--stage-columns': stageMeta[activeView].columnTemplate || `repeat(${stageMeta[activeView].columns.length}, minmax(0, 1fr))`
                        }}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectCandidate(candidate)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') selectCandidate(candidate);
                        }}
                      >
                        {stageCells(candidate, activeView).map((cell, index) => (
                          <span
                            key={`${candidate.id}-${stageMeta[activeView].columns[index]}`}
                            data-label={stageMeta[activeView].columns[index]}
                          >
                            {index === 0 && activeView === 'schedule' ? (
                              <label className="row-check" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={batchSelection.includes(candidate.id)}
                                  disabled={!candidateHasEmail(candidate) || !formalCalendarReady(candidate)}
                                  onChange={(event) => toggleBatchCandidate(candidate.id, event.target.checked)}
                                />
                                <strong className="name-cell">
                                  {candidate.isNew ? <NewBadge compact /> : null}
                                  <span className="candidate-name-text">{cell}</span>
                                </strong>
                              </label>
                            ) : index === 0 ? (
                              <strong className="name-cell">
                                {candidate.isNew ? <NewBadge compact /> : null}
                                <span className="candidate-name-text">{cell}</span>
                              </strong>
                            ) : (
                              cell
                            )}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pagination">
                <button className="ghost-button" onClick={() => setCandidatePage((next) => Math.max(1, next - 1))} disabled={page <= 1}>
                  上一页
                </button>
                <span>{page} / {totalPages}</span>
                <button className="ghost-button" onClick={() => setCandidatePage((next) => Math.min(totalPages, next + 1))} disabled={page >= totalPages}>
                  下一页
                </button>
              </div>
            </aside>

            <section className="detail-pane">
              {!selected ? (
                <EmptyState title="请选择候选人" description="候选人详情、筛选和面试动作会显示在这里" />
              ) : (
                <>
                  <div className="detail-header">
                    <div>
                      <h2>
                        {selected.isNew ? <NewBadge /> : null}
                        {selected.name || candidateEmail(selected) || selected.id}
                      </h2>
                      <div className="contact-strip">
                        <span>
                          <Mail size={14} />
                          {candidateEmail(selected) || '未填写邮箱'}
                        </span>
                        <span>
                          <Phone size={14} />
                          {candidatePhone(selected) || '待补充电话'}
                        </span>
                        <span>
                          <Database size={14} />
                          {selected.school || selected.source || 'manual'}
                        </span>
                        {detailLoadingId === selected.id ? <span>详情加载中</span> : null}
                      </div>
                    </div>
                    <StatusPill value={activeView === 'schedule' ? candidateScheduleStatus(selected) : selected.status} />
                  </div>

                  <div className="actions-row">
                    {activeView === 'screening' ? (
                      <>
                        <button
                          onClick={() => reviewSelected('pass')}
                          disabled={Boolean(busy) || selected.manualReview?.decision === 'pass'}
                        >
                          <CheckCircle2 size={16} />
                          通过简历
                        </button>
                        <button
                          className="danger-button"
                          onClick={() => reviewSelected('reject')}
                          disabled={Boolean(busy) || selected.manualReview?.decision === 'reject'}
                        >
                          不通过
                        </button>
                        {selected.manualReview ? (
                          <button className="ghost-button" onClick={() => reviewSelected('undo')} disabled={Boolean(busy)}>
                            撤销判断
                          </button>
                        ) : null}
                        <button className="ghost-button" onClick={screenSelected} disabled={Boolean(busy)}>
                          <FileSearch size={16} />
                          {selected.screening ? '重跑匹配评估' : '补跑匹配评估'}
                        </button>
                      </>
                    ) : null}
                    {activeView === 'schedule' ? (
                      <>
                        <button
                          onClick={previewInterview}
                          disabled={Boolean(busy) || !interviewHasStart}
                          title={!interviewHasStart ? '请先为当前候选人选择面试时间。' : undefined}
                        >
                          <Mail size={16} />
                          面邀预览
                        </button>
                        <button
                          onClick={scheduleInterview}
                          disabled={interviewScheduleDisabled}
                          title={
                            !interviewHasStart
                              ? '请先为当前候选人选择面试时间。'
                              : !outlookConnected
                              ? 'Outlook 未连接，不能执行预定验证或真实创建。'
                              : interview.live && !formalCalendarReady(selected)
                                ? '候选人确认面试时间后，再执行真实创建。'
                                : undefined
                          }
                        >
                          <CalendarPlus size={16} />
                          {interview.live ? 'Graph真实创建' : 'dry-run 预定'}
                        </button>
                        <button
                          onClick={openInterviewConfirmationMail}
                          disabled={confirmationMailDisabled}
                          title={
                            !interviewHasStart
                              ? '请先为当前候选人选择面试时间。'
                              : confirmationCompleted
                                ? '候选人已反馈当前确认邮件，请进入下一步。'
                              : officialInviteSent
                                ? '正式日程已确认发送，不再回退到确认邮件环节。'
                                : undefined
                          }
                        >
                          <Mail size={16} />
                          发送确认邮件
                        </button>
                        {confirmationMailSentVisible ? (
                          <button className="ghost-button" onClick={confirmInterviewConfirmationMailSent} disabled={Boolean(busy)}>
                            <CheckCircle2 size={16} />
                            已发确认邮件
                          </button>
                        ) : null}
                        {selected.interview?.confirmation?.url ? (
                          <a
                            className="button-link ghost-button"
                            href={selected.interview.confirmation.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={16} />
                            查看确认页
                          </a>
                        ) : null}
                        <button
                          onClick={openOutlookCalendarInvite}
                          disabled={formalCalendarDisabled}
                          title={
                            !interviewHasStart
                              ? '请先为当前候选人选择面试时间。'
                              : !candidateHasEmail(selected)
                              ? '候选人缺少邮箱。'
                              : officialInviteSent
                                ? '正式日程已确认发送。'
                              : !formalCalendarReady(selected)
                                ? '候选人确认面试时间后，再发送正式 Outlook/Teams 日程。'
                                : undefined
                          }
                        >
                          <CalendarPlus size={16} />
                          Outlook日程邀请
                        </button>
                        {selected.interview?.inviteStatus === 'web-link-generated' ? (
                          <button className="ghost-button" onClick={confirmOutlookCalendarSent} disabled={Boolean(busy)}>
                            <CheckCircle2 size={16} />
                            已在Outlook发送
                          </button>
                        ) : null}
                        {scheduleUndoVisible ? (
                          <button className="ghost-button" onClick={() => reviewSelected('undo')} disabled={Boolean(busy)}>
                            撤销通过
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {activeView === 'interview' ? (
                      <button onClick={saveInterviewRecord} disabled={Boolean(busy)}>
                        <ListChecks size={16} />
                        保存面试记录
                      </button>
                    ) : null}
                    {activeView === 'onboarding' ? (
                      <>
                        <button onClick={saveOfferStatus} disabled={Boolean(busy)}>
                          <CheckCircle2 size={16} />
                          保存Offer状态
                        </button>
                        <button className="ghost-button" onClick={openOfferMail} disabled={Boolean(busy) || !candidateHasEmail(selected)}>
                          <Mail size={16} />
                          发送Offer邮件
                        </button>
                      </>
                    ) : null}
                  </div>

                  {activeView === 'screening' ? (
                    <div className="screening-layout">
                      <section className="panel decision-panel">
                        <div className="panel-heading">
                          <h3>筛选判断</h3>
                          <StatusPill value={selected.screening ? displayMatchLevel(selected.screening.recommendation, selected.screening.score) : selected.status || '待筛选'} />
                        </div>
                        <div className="decision-grid">
                          <div>
                            <span>匹配分</span>
                            <strong>{selected.screening?.score ?? '待筛'}</strong>
                          </div>
                          <div>
                            <span>岗位匹配度</span>
                            <strong>{selected.screening ? displayMatchLevel(selected.screening.recommendation, selected.screening.score) : '待筛选'}</strong>
                          </div>
                          <div>
                            <span>人工判断</span>
                            <strong>{reviewText(selected)}</strong>
                          </div>
                          <div>
                            <span>当前状态</span>
                            <strong>{selected.status || '待处理'}</strong>
                          </div>
                        </div>
                      </section>
                      <section className="panel evidence-panel">
                        <h3>岗位匹配分析</h3>
                        {selected.screening ? (
                          <div className="screening">
                            <div className="score-line">
                              <Score value={selected.screening.score} />
                              <span className="source-text">
                                {selected.screening.source || selected.source || 'manual'}
                                {selected.screening.warning ? ` · ${selected.screening.warning}` : ''}
                              </span>
                            </div>
                            <MarkdownContent value={buildScreeningSummaryMarkdown(selected.screening)} />
                            <div className="keyword-chips">
                              {listFromValue(selected.screening.llm_knowledge).length ? (
                                listFromValue(selected.screening.llm_knowledge).map((item, index) => <span key={`${item}-${index}`}>{item}</span>)
                              ) : (
                                <span>待确认</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="muted">尚未筛选。</p>
                        )}
                      </section>
                      <section className="panel evidence-panel">
                        <div className="panel-heading">
                          <h3>风险与追问</h3>
                          <AlertTriangle size={17} />
                        </div>
                        {selected.screening?.risk_notes ? (
                          <MarkdownContent value={normalizeRiskNotesMarkdown(selected.screening.risk_notes)} />
                        ) : (
                          <p className="muted">暂无风险备注。</p>
                        )}
                      </section>
                    </div>
                  ) : null}

                  {activeView === 'schedule' ? (
                    <div className="detail-columns">
                      <section className="panel">
                        <h3>面试安排</h3>
                        <div className="form-grid">
                          <label className="wide">
                            面试时间
                            <select value={timePreset} onChange={(event) => applyInterviewTimePreset(event.target.value)}>
                              <option value="custom">自定义时间</option>
                              {interviewTimeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            开始时间
                            <input
                              type="datetime-local"
                              value={interview.start}
                              onChange={(event) => updateInterviewStart(event.target.value)}
                            />
                          </label>
                          <label>
                            面试时长
                            <select
                              value={interview.durationMinutes || defaultInterviewDurationMinutes}
                              onChange={(event) => updateInterviewDuration(event.target.value)}
                            >
                              {interviewDurationOptions.map((minutes) => (
                                <option key={minutes} value={minutes}>{minutes} 分钟</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            结束时间
                            <input className="readonly-input" value={formatDateTime(interview.end)} readOnly />
                          </label>
                          <label className="wide">
                            面试方式
                            <input
                              value={interview.locationOrLink}
                              onChange={(event) => setInterview({ ...interview, locationOrLink: event.target.value })}
                            />
                          </label>
                          <label className="toggle wide">
                            <input
                              type="checkbox"
                              checked={interview.live}
                              onChange={(event) => setInterview({ ...interview, live: event.target.checked })}
                            />
                            Graph真实发送并创建Exchange日程
                          </label>
                        </div>
                      </section>

                      <section className="panel">
                        <h3>面邀预览</h3>
                        {preview ? (
                          <div className="preview">
                            <strong>{preview.email.subject}</strong>
                            <button className="ghost-button compact-button" onClick={copyInterviewDraft}>
                              <Copy size={16} />
                              复制邮件内容
                            </button>
                            <pre>{preview.email.bodyText}</pre>
                            {preview.confirmationUrl || selected.interview?.confirmation ? (
                              <div className="confirmation-summary">
                                <div>
                                  <span>候选人确认</span>
                                  <strong>
                                    {preview.confirmationUrl
                                      ? '确认邮件待发送'
                                      : confirmationStatusLabel(selected.interview?.confirmation?.status)}
                                  </strong>
                                </div>
                                {preview.confirmationUrl || selected.interview?.confirmation?.url ? (
                                  <a href={preview.confirmationUrl || selected.interview.confirmation.url} target="_blank" rel="noreferrer">
                                    打开确认页
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                            {preview.webCalendarUrl ? (
                              <p className="export-note">
                                <a href={preview.webCalendarUrl} target="_blank" rel="noreferrer">打开 Outlook 日程邀请页</a>
                                <span>，确认 Teams 会议开关后点击发送。</span>
                              </p>
                            ) : null}
                            {selected.interview?.inviteStatus ? (
                              <dl className="application-fields compact">
                                <dt>发送状态</dt>
                                <dd>
                                  {selected.interview.inviteStatus === 'web-link-generated'
                                    ? '待在 Outlook 发送'
                                    : selected.interview.inviteStatus === 'web-sent-confirmed'
                                      ? '已确认发送'
                                      : selected.interview.inviteStatus}
                                </dd>
                                <dt>Teams</dt>
                                <dd>{selected.interview.teamsJoinUrl ? '已获取链接' : '由 Outlook 发送后生成'}</dd>
                              </dl>
                            ) : null}
                            {preview.artifacts ? (
                              <>
                                {preview.desktop ? (
                                  <p className="export-note">
                                    已打开备用 Outlook 草稿；日程和 Teams 链接仍以“Outlook日程邀请”为准。
                                  </p>
                                ) : (
                                  <p className="export-note">
                                    导出包不会自动发送，也不会生成 Teams 链接；主链路请使用“Outlook日程邀请”。
                                  </p>
                                )}
                                <dl className="application-fields compact">
                                  <dt>EML</dt>
                                  <dd>{preview.artifacts.emlPath}</dd>
                                  <dt>ICS</dt>
                                  <dd>{preview.artifacts.icsPath}</dd>
                                  <dt>邮箱</dt>
                                  <dd>{preview.artifacts.missingEmail ? '候选人缺少邮箱，导出为草稿包，请手动补收件人。' : '已写入收件人'}</dd>
                                </dl>
                              </>
                            ) : null}
                          </div>
                        ) : (
                          <p className="muted">先选择面试时间，再生成预览、dry-run 或 Outlook 日程邀请。</p>
                        )}
                      </section>

                      <ConfirmationStatusPanel candidate={selected} />

                      <ScreeningInsightPanel candidate={selected} />

                      <section className="panel wide-panel">
                        <h3>面邀模板</h3>
                        <div className="form-grid">
                          <label className="wide">
                            主题模板
                            <input
                              value={editableTemplate.subject}
                              onChange={(event) => updateTemplateDraft('subject', event.target.value)}
                              placeholder="联想{{position}}面试邀请-{{name}}"
                            />
                          </label>
                          <label className="wide">
                            正文模板
                            <textarea
                              className="template-body"
                              value={editableTemplate.body}
                              onChange={(event) => updateTemplateDraft('body', event.target.value)}
                              placeholder="Hi {{name}}，"
                            />
                          </label>
                        </div>
                        <div className="template-footer">
                          <div className="template-vars">
                            {(interviewTemplate?.variables || []).map((item) => (
                              <code key={item}>{`{{${item}}}`}</code>
                            ))}
                          </div>
                          <div className="actions-row bare">
                            <button onClick={saveInterviewTemplate} disabled={Boolean(busy) || !templateDirty}>
                              保存模板
                            </button>
                            <button className="ghost-button" onClick={resetInterviewTemplate} disabled={Boolean(busy)}>
                              恢复默认
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {activeView === 'interview' ? (
                    <div className="detail-columns">
                      <section className="panel">
                        <h3>记录面试表现</h3>
                        <div className="form-grid">
                          <label>
                            面试时间
                            <input
                              type="datetime-local"
                              value={recordDraft.interviewTime}
                              onChange={(event) => setRecordDraft({ ...recordDraft, interviewTime: event.target.value })}
                            />
                          </label>
                          <label>
                            面试官
                            <input
                              value={recordDraft.interviewer}
                              onChange={(event) => setRecordDraft({ ...recordDraft, interviewer: event.target.value })}
                            />
                          </label>
                          <label>
                            结论
                            <select
                              value={recordDraft.decision}
                              onChange={(event) => setRecordDraft({ ...recordDraft, decision: event.target.value })}
                            >
                              <option>待定</option>
                              <option>强推</option>
                              <option>通过</option>
                              <option>备选</option>
                              <option>不通过</option>
                              <option>建议Offer</option>
                            </select>
                          </label>
                          <ScoreSlider
                            label="面试评分"
                            value={recordDraft.score}
                            onChange={(score) => setRecordDraft({ ...recordDraft, score })}
                          />
                          <ScoreSlider
                            label="沟通表达"
                            value={recordDraft.communication}
                            onChange={(communication) => setRecordDraft({ ...recordDraft, communication })}
                            wide
                          />
                          <ScoreSlider
                            label="AI理解/工具经验"
                            value={recordDraft.aiUnderstanding}
                            onChange={(aiUnderstanding) => setRecordDraft({ ...recordDraft, aiUnderstanding })}
                            wide
                          />
                          <ScoreSlider
                            label="产品感觉/推进能力"
                            value={recordDraft.productSense}
                            onChange={(productSense) => setRecordDraft({ ...recordDraft, productSense })}
                            wide
                          />
                          <label className="wide">
                            优势
                            <textarea
                              value={recordDraft.strengths}
                              onChange={(event) => setRecordDraft({ ...recordDraft, strengths: event.target.value })}
                            />
                          </label>
                          <label className="wide">
                            风险
                            <textarea
                              value={recordDraft.concerns}
                              onChange={(event) => setRecordDraft({ ...recordDraft, concerns: event.target.value })}
                            />
                          </label>
                          <label className="wide">
                            总结与下一步
                            <textarea
                              value={recordDraft.summary}
                              onChange={(event) => setRecordDraft({ ...recordDraft, summary: event.target.value })}
                            />
                          </label>
                        </div>
                      </section>
                      <AIInterviewQuestionsPanel candidate={selected} />
                      <section className="panel wide-panel">
                        <h3>历史记录</h3>
                        {selected.interviewRecords?.length ? (
                          <div className="record-list">
                            {selected.interviewRecords.map((record) => (
                              <article key={record.id}>
                                <strong>{record.decision}{record.score == null ? '' : ` / ${record.score}`}</strong>
                                <span>{record.interviewer || '未填面试官'} · {formatDateTime(record.createdAt)}</span>
                                <InterviewRecordSummary record={record} />
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="muted">暂无平台内面试记录。真实面试表中的历史面评仍在“投递信息”里可查。</p>
                        )}
                      </section>
                    </div>
                  ) : null}

                  {activeView === 'onboarding' ? (
                    <div className="detail-columns">
                      <section className="panel">
                        <h3>Offer 接受情况</h3>
                        <div className="offer-summary">
                          <div>
                            <span>当前状态</span>
                            <StatusPill value={candidateOfferStatus(selected)} />
                          </div>
                          <div>
                            <span>预计入职</span>
                            <strong>{candidateOfferOnboard(selected) || '待确认'}</strong>
                          </div>
                          <div>
                            <span>实习时长</span>
                            <strong>{candidateOfferDuration(selected) || '待确认'}</strong>
                          </div>
                          <div>
                            <span>联系电话</span>
                            <strong>{candidatePhone(selected) || applicationField(selected, ['联系电话']) || '待补充'}</strong>
                          </div>
                        </div>
                      </section>
                      <section className="panel">
                        <h3>记录 Offer 跟进</h3>
                        <div className="form-grid">
                          <label>
                            接受状态
                            <select
                              value={offerDraft.acceptanceStatus}
                              onChange={(event) => setOfferDraft({ ...offerDraft, acceptanceStatus: event.target.value })}
                            >
                              {offerAcceptanceOptions.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Offer发出日期
                            <input
                              type="date"
                              value={offerDraft.offerSentAt}
                              onChange={(event) => setOfferDraft({ ...offerDraft, offerSentAt: event.target.value })}
                            />
                          </label>
                          <label>
                            接受日期
                            <input
                              type="date"
                              value={offerDraft.acceptedAt}
                              onChange={(event) => setOfferDraft({ ...offerDraft, acceptedAt: event.target.value })}
                            />
                          </label>
                          <label>
                            预计入职
                            <input
                              type="date"
                              value={offerDraft.expectedOnboard}
                              onChange={(event) => setOfferDraft({ ...offerDraft, expectedOnboard: event.target.value })}
                            />
                          </label>
                          <label>
                            实习时长
                            <input
                              value={offerDraft.internshipDuration}
                              onChange={(event) => setOfferDraft({ ...offerDraft, internshipDuration: event.target.value })}
                              placeholder="例如 3个月 / 6个月"
                            />
                          </label>
                          <label>
                            跟进人
                            <input
                              value={offerDraft.owner}
                              onChange={(event) => setOfferDraft({ ...offerDraft, owner: event.target.value })}
                            />
                          </label>
                          <label className="wide">
                            备注
                            <textarea
                              value={offerDraft.note}
                              onChange={(event) => setOfferDraft({ ...offerDraft, note: event.target.value })}
                              placeholder="记录候选人反馈、卡点、下一步动作"
                            />
                          </label>
                        </div>
                      </section>
                      <section className="panel">
                        <h3>Offer 跟进记录</h3>
                        {selected.offerRecords?.length ? (
                          <div className="record-list">
                            {selected.offerRecords.map((record) => (
                              <article key={record.id}>
                                <strong>{record.acceptanceStatus}</strong>
                                <span>{record.owner || '未填跟进人'} · {formatDateTime(record.createdAt)}</span>
                                <dl className="application-fields compact">
                                  <dt>发出日期</dt>
                                  <dd>{record.offerSentAt || '未填'}</dd>
                                  <dt>接受日期</dt>
                                  <dd>{record.acceptedAt || '未填'}</dd>
                                  <dt>预计入职</dt>
                                  <dd>{record.expectedOnboard || '未填'}</dd>
                                  <dt>实习时长</dt>
                                  <dd>{record.internshipDuration || '未填'}</dd>
                                </dl>
                                {record.note ? (
                                  <div className="record-note">
                                    <span>备注</span>
                                    <p>{record.note}</p>
                                  </div>
                                ) : null}
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="muted">暂无 Offer 跟进记录。</p>
                        )}
                      </section>
                      <section className="panel">
                        <h3>入职材料</h3>
                        <ul className="check-list">
                          <li>在校证明 PDF</li>
                          <li>身份证正反面 PDF</li>
                          <li>招商银行借记卡一类账户 PDF</li>
                          <li>白底照片 JPG/PNG</li>
                          <li>身份证号、银行卡号、电话、邮箱、入离职时间</li>
                        </ul>
                      </section>
                    </div>
                  ) : null}

                  <section className="panel full applicant-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>投递档案</h3>
                      </div>
                      {profileEditing ? null : (
                        <button className="compact-button" onClick={openProfileEditor} disabled={Boolean(busy)}>
                          编辑档案
                        </button>
                      )}
                    </div>
                    {profileEditing ? (
                      <form className="profile-edit-form" onSubmit={saveProfile}>
                        <label>
                          姓名
                          <input
                            value={profileDraft.name}
                            onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}
                            placeholder="候选人姓名"
                          />
                        </label>
                        <label>
                          联系邮箱
                          <input
                            value={profileDraft.email}
                            onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })}
                            placeholder="候选人邮箱"
                            type="email"
                          />
                        </label>
                        <label>
                          联系电话
                          <input
                            value={profileDraft.phone}
                            onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })}
                            placeholder="候选人电话"
                          />
                        </label>
                        <label>
                          学历
                          <input
                            value={profileDraft.degree}
                            onChange={(event) => setProfileDraft({ ...profileDraft, degree: event.target.value })}
                            placeholder="例如 硕士"
                          />
                        </label>
                        <label>
                          院校背景
                          <input
                            value={profileDraft.schoolBackground}
                            onChange={(event) => setProfileDraft({ ...profileDraft, schoolBackground: event.target.value })}
                            placeholder="例如 西安交通大学 · 社会学"
                          />
                        </label>
                        <label>
                          投递/导入时间
                          <input
                            value={profileDraft.receivedAt}
                            onChange={(event) => setProfileDraft({ ...profileDraft, receivedAt: event.target.value })}
                            placeholder="2026-05-27 15:30"
                          />
                        </label>
                        <label>
                          最快到岗
                          <input
                            value={profileDraft.arrival}
                            onChange={(event) => setProfileDraft({ ...profileDraft, arrival: event.target.value })}
                            placeholder="最快到岗时间"
                          />
                        </label>
                        <label>
                          可实习时长
                          <input
                            value={profileDraft.duration}
                            onChange={(event) => setProfileDraft({ ...profileDraft, duration: event.target.value })}
                            placeholder="例如 3个月"
                          />
                        </label>
                        <div className="actions-row bare wide">
                          <button type="submit" disabled={Boolean(busy)}>保存档案</button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setProfileDraft(defaultProfileDraft(selected));
                              setProfileEditing(false);
                            }}
                            disabled={Boolean(busy)}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : (
                      <dl className="profile-grid">
                        {candidateProfileItems(selected).map(([key, value]) => (
                          <React.Fragment key={key}>
                            <dt>{key}</dt>
                            <dd>
                              <FieldValue value={value} />
                            </dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    )}
                    {visibleApplicationEntries(selected).length ? (
                      <details className="raw-fields">
                        <summary>原始字段</summary>
                        <dl className="application-fields">
                          {visibleApplicationEntries(selected).map(([key, value]) => (
                            <React.Fragment key={key}>
                              <dt>{key}</dt>
                              <dd>
                                <FieldValue value={value} fallback="空" />
                              </dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      </details>
                    ) : null}
                  </section>

                  <section className="panel full resume-panel">
                    <div className="panel-heading">
                      <h3>简历原文件</h3>
                      {selected.resumeFile ? (
                        <span className="source-text">
                          {selected.resumeFile.originalName}
                          {formatFileSize(selected.resumeFile.size) ? ` · ${formatFileSize(selected.resumeFile.size)}` : ''}
                        </span>
                      ) : null}
                    </div>
                    {selected.resumeFile ? (
                      <>
                        <div className="resume-filebar">
                          <div>
                            <FileText size={18} />
                            <strong>{selected.resumeFile.originalName || resumePreview.name || '简历原文件'}</strong>
                          </div>
                          {resumePreview.url ? (
                            <div className="resume-actions">
                              <a className="icon-link" href={resumePreview.url} target="_blank" rel="noreferrer">
                                <ExternalLink size={16} />
                                打开
                              </a>
                              <a className="icon-link" href={resumePreview.url} download={selected.resumeFile.originalName || 'resume'}>
                                <Download size={16} />
                                下载
                              </a>
                            </div>
                          ) : null}
                        </div>
                        {resumePreview.loading ? <p className="muted">原文件加载中...</p> : null}
                        {resumePreview.error ? <p className="muted">{resumePreview.error}</p> : null}
                        {resumePreview.url && fileKind({ ...selected.resumeFile, mimeType: resumePreview.mimeType }) === 'pdf' ? (
                          <div className="resume-frame-wrap resume-pdf-frame-wrap">
                            <iframe
                              className="resume-frame"
                              src={`${resumePreview.url}#view=FitH`}
                              title={`${selected.resumeFile.originalName || '简历'}预览`}
                            />
                          </div>
                        ) : null}
                        {resumePreview.url && fileKind({ ...selected.resumeFile, mimeType: resumePreview.mimeType }) === 'text' ? (
                          <div className="resume-frame-wrap">
                            <iframe
                              className="resume-frame"
                              src={resumePreview.url}
                              title={`${selected.resumeFile.originalName || '简历'}预览`}
                            />
                          </div>
                        ) : null}
                        {resumePreview.url && !canPreviewInline({ ...selected.resumeFile, mimeType: resumePreview.mimeType }) ? (
                          <p className="muted">该格式无法在浏览器内直接预览，可打开原文件查看。</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="muted">暂无简历附件。</p>
                    )}
                    <div className="privacy-toolbar">
                      <span>解析文本</span>
                      <button className="ghost-button compact-button" onClick={() => setShowResumeText((value) => !value)}>
                        {showResumeText ? '隐藏文本' : '显示文本'}
                      </button>
                    </div>
                    {showResumeText ? (
                      <pre className="resume-text">{selected.resumeText || '暂无可读文本'}</pre>
                    ) : null}
                  </section>
                </>
              )}
            </section>
          </section>
        ) : null}

        {activeView === 'accounts' && isAdmin ? (
          <section className="accounts-page">
            <div className="account-header">
              <div>
                <h2>账号管理</h2>
                <p>管理员可以创建账号、重置密码、调整角色和停用成员。</p>
              </div>
              <button className="ghost-button" onClick={loadUsers} disabled={Boolean(busy)}>
                <RefreshCw size={16} />
                刷新账号
              </button>
            </div>

            <div className="account-layout">
              <section className="account-panel">
                <h3>新增账号</h3>
                <form className="account-form" onSubmit={createUser}>
                  <label>
                    账号名
                    <input
                      value={userDraft.username}
                      onChange={(event) => setUserDraft({ ...userDraft, username: event.target.value })}
                      placeholder="name"
                      required
                    />
                  </label>
                  <label>
                    显示名
                    <input
                      value={userDraft.displayName}
                      onChange={(event) => setUserDraft({ ...userDraft, displayName: event.target.value })}
                      placeholder="姓名"
                    />
                  </label>
                  <label>
                    初始密码
                    <input
                      value={userDraft.password}
                      onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })}
                      placeholder="至少 6 位"
                      type="password"
                      required
                    />
                  </label>
                  <label>
                    角色
                    <select
                      value={userDraft.role}
                      onChange={(event) => setUserDraft({ ...userDraft, role: event.target.value })}
                    >
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                  </label>
                  <button type="submit" disabled={Boolean(busy)}>
                    <Users size={16} />
                    创建账号
                  </button>
                </form>
              </section>

              <section className="account-panel">
                <h3>已有账号</h3>
                <div className="account-list">
                  {users.length === 0 ? (
                    <p className="muted">暂无账号数据，点击刷新账号。</p>
                  ) : (
                    users.map((user) => (
                      <article key={user.id} className="account-row">
                        <div className="account-identity">
                          <strong>{user.username}</strong>
                          <span>
                            {user.displayName || user.username}
                            {user.lastLoginAt ? ` · 最近登录 ${formatDateTime(user.lastLoginAt)}` : ' · 尚未登录'}
                          </span>
                        </div>
                        <select
                          value={user.role}
                          onChange={(event) => updateUser(user.id, { role: event.target.value })}
                          disabled={Boolean(busy)}
                        >
                          <option value="member">成员</option>
                          <option value="admin">管理员</option>
                        </select>
                        <select
                          value={user.status}
                          onChange={(event) => updateUser(user.id, { status: event.target.value })}
                          disabled={Boolean(busy)}
                        >
                          <option value="active">启用</option>
                          <option value="disabled">停用</option>
                        </select>
                        <input
                          value={passwordDrafts[user.id] || ''}
                          onChange={(event) =>
                            setPasswordDrafts((current) => ({ ...current, [user.id]: event.target.value }))
                          }
                          placeholder="新密码"
                          type="password"
                        />
                        <button
                          className="ghost-button"
                          onClick={() => resetUserPassword(user.id)}
                          disabled={Boolean(busy) || !passwordDrafts[user.id]}
                        >
                          重置密码
                        </button>
                        <button
                          className="danger-button"
                          onClick={() => removeUser(user)}
                          disabled={Boolean(busy) || user.id === currentUser?.id}
                        >
                          删除
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeView === 'verification' ? (
          <section className="verification standalone">
            <h2>操作日志</h2>
            <div className="run-list">
              {runs.length === 0 ? (
                <p className="muted">暂无操作日志。</p>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="run-row">
                    <CheckCircle2 size={16} />
                    <span>{run.detail}</span>
                    <small>{run.mode} · {new Date(run.createdAt).toLocaleString()}</small>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function Root() {
  const confirmationToken = currentConfirmationToken();
  return confirmationToken ? <InterviewConfirmationPage token={confirmationToken} /> : <App />;
}

createRoot(document.getElementById('root')).render(<Root />);
