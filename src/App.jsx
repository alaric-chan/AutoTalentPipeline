import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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

function NewBadge() {
  return <span className="new-badge">New</span>;
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
    description: '按 AI 分数、推荐结论和风险备注筛选候选人',
    columns: ['姓名', '来源', 'AI分', '推荐']
  },
  schedule: {
    title: '面试安排',
    description: '生成 Outlook 日程邀请，自动带候选人邮箱和面试信息',
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

function buildInterviewTimeOptions() {
  const slots = [
    { dayOffset: 1, hour: 10, minute: 30 },
    { dayOffset: 1, hour: 14, minute: 30 },
    { dayOffset: 2, hour: 10, minute: 30 },
    { dayOffset: 2, hour: 15, minute: 0 },
    { dayOffset: 3, hour: 14, minute: 30 }
  ];
  return slots.map((slot, index) => {
    const date = new Date();
    date.setDate(date.getDate() + slot.dayOffset);
    date.setHours(slot.hour, slot.minute, 0, 0);
    const start = toDatetimeLocal(date);
    return {
      value: `slot-${index}`,
      start,
      end: addMinutes(start, defaultInterviewDurationMinutes),
      label: `${formatDateTime(start)} 开始`
    };
  });
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

function candidateOfferStatus(candidate) {
  return (
    candidate?.offer?.acceptanceStatus ||
    candidate?.interviewRecord?.offerStatus ||
    applicationField(candidate, ['offer情况', 'Offer情况']) ||
    candidate?.status ||
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

function splitEvidenceText(value) {
  return cleanFieldValue(value)
    .split(/\n+|(?=\d+[.、]\s*)/)
    .map((item) => item.replace(/^\d+[.、]\s*/, '').trim())
    .filter(Boolean);
}

function candidateProfileItems(candidate) {
  return [
    ['姓名', candidate?.name || candidateEmail(candidate) || candidate?.id],
    ['联系邮箱', candidateEmail(candidate)],
    ['联系电话', candidatePhone(candidate)],
    ['最快到岗', applicationField(candidate, ['最快到岗时间', '预计入职时间'])],
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

function latestInterviewRecord(candidate) {
  return candidate?.interviewRecords?.[0] || candidate?.interview?.lastRecord || null;
}

function filterCandidatesByStage(candidates, view) {
  if (view === 'schedule') {
    return candidates.filter((candidate) =>
      candidate.manualReview?.decision === 'pass' || /待邀约|面试|已邀约|已预约/i.test(candidate.status || '')
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
      candidate.interview?.start ? formatDateTime(candidate.interview.start) : applicationField(candidate, ['面试时间']) || '待安排',
      candidate.status || '待处理'
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
    candidate.source || 'manual',
    candidate.screening?.score ?? '待筛',
    candidate.screening?.recommendation || candidate.status || '待筛选'
  ];
}

function reviewText(candidate) {
  const decision = candidate?.manualReview?.decision;
  if (decision === 'pass') return '已通过';
  if (decision === 'reject') return '不通过';
  return '待确认';
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

function App() {
  const [security, setSecurity] = useState(null);
  const [accessToken, setAccessToken] = useState(() => storedAccessToken());
  const [currentUser, setCurrentUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: 'chenbk1', password: '' });
  const [activeView, setActiveView] = useState('screening');
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
  const [interview, setInterview] = useState({
    start: '2026-05-27T14:30',
    end: '2026-05-27T15:00',
    durationMinutes: defaultInterviewDurationMinutes,
    locationOrLink: 'Teams 线上会议',
    live: false
  });
  const [timePreset, setTimePreset] = useState('custom');
  const [recordDraft, setRecordDraft] = useState(() => defaultRecordDraft(null));
  const [offerDraft, setOfferDraft] = useState(() => defaultOfferDraft(null));
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
  const [showResumeText, setShowResumeText] = useState(false);
  const [resumePreview, setResumePreview] = useState({
    candidateId: '',
    loading: false,
    url: '',
    error: '',
    mimeType: '',
    name: ''
  });
  const [pdfPreviewState, setPdfPreviewState] = useState({ loading: false, error: '' });
  const resumeCanvasRef = useRef(null);
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
    () => filterCandidatesByStage(candidates, activeView),
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
    if (!selectedId && nextCandidates[0]) setSelectedId(nextCandidates[0].id);
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
    let cancelled = false;
    const file = selected?.resumeFile ? { ...selected.resumeFile, mimeType: resumePreview.mimeType } : null;
    const canvas = resumeCanvasRef.current;

    if (!resumePreview.url || !file || fileKind(file) !== 'pdf' || !canvas) {
      setPdfPreviewState({ loading: false, error: '' });
      return;
    }

    setPdfPreviewState({ loading: true, error: '' });
    import('pdfjs-dist')
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return pdfjsLib.getDocument(resumePreview.url).promise;
      })
      .then(async (pdf) => {
        if (cancelled) return;
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = canvas.parentElement?.clientWidth || baseViewport.width;
        const scale = Math.min(1.7, Math.max(0.72, (containerWidth - 28) / baseViewport.width));
        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const context = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) setPdfPreviewState({ loading: false, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setPdfPreviewState({ loading: false, error: error.message });
      });

    return () => {
      cancelled = true;
    };
  }, [resumePreview.mimeType, resumePreview.url, selected?.resumeFile]);

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
    const result = await runAction('上传简历', () =>
      api('/api/candidates/upload', {
        method: 'POST',
        body: form
      })
    );
    if (result?.id) setSelectedId(result.id);
    event.currentTarget.reset();
  }

  async function screenSelected() {
    if (!selected) return;
    const result = await runAction('筛选简历', () =>
      api(`/api/candidates/${selected.id}/screen`, { method: 'POST' })
    );
    if (result?.id) setSelectedId(result.id);
  }

  async function reviewSelected(decision) {
    if (!selected) return;
    const labels = {
      pass: '通过并进入面试邀约',
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
      setSelectedId(result.id);
      if (decision === 'pass') setActiveView('schedule');
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

  async function openOutlookMailInvite() {
    if (!selected) return;
    const mailWindow = openPendingWindow('正在打开 Outlook 邮件草稿');
    const result = await runAction('打开 Outlook 邮件草稿', () =>
      api(`/api/candidates/${selected.id}/interview/outlook-web-mail`, {
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
    const selectableIds = pagedCandidates.filter(candidateHasEmail).map((candidate) => candidate.id);
    setBatchSelection((current) => Array.from(new Set([...current, ...selectableIds])));
  }

  async function bulkOpenOutlookCalendarInvites() {
    const targets = selectedBatchCandidates.filter(candidateHasEmail);
    if (!targets.length) {
      setNotice('请先勾选有邮箱的候选人。');
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
      setNotice('面邀内容已复制，可粘贴到 Outlook 新邮件后发送。');
    } catch {
      setNotice('复制失败，请直接从面邀预览区复制正文。');
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
    <main className="app-shell">
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
          <div>
            <h1>乐享AI实习生招聘工作台</h1>
            <p>飞书投递、AI 筛选、Outlook 日程邀请和 Teams 面试链接</p>
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

        <section className="status-band">
          <Metric icon={<Inbox size={18} />} label="Outlook" value={outlookConnected ? '已连接' : '未连接'} />
          <Metric icon={<ShieldCheck size={18} />} label="百炼" value={bailianReady ? '已配置' : '启发式'} />
          <Metric icon={<Database size={18} />} label="飞书" value={larkProfile} />
          <Metric icon={<Users size={18} />} label="候选人" value={candidates.length} />
          <Metric icon={<CheckCircle2 size={18} />} label="已筛选" value={screenedCount} />
        </section>

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
                <dd>候选人提交后进入 Base 表，本地平台点击“同步表单投递”拉取最新记录。</dd>
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
            <aside className="candidate-pane">
              <div className="pane-title">
                <div>
                  <h2>{stageMeta[activeView].title}</h2>
                  <small>{stageMeta[activeView].description}</small>
                </div>
                <small>{filteredCandidates.length} / {stageCandidates.length}</small>
              </div>
              <div className="candidate-tools">
                <label className="search-box">
                  <Search size={16} />
                  <input
                    value={candidateQuery}
                    onChange={(event) => setCandidateQuery(event.target.value)}
                    placeholder="搜索姓名、状态、来源"
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
                    <label className="file-input">
                      <Upload size={16} />
                      <input name="resume" type="file" accept=".pdf,.docx,.txt,.md" required />
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
                    <div className="stage-row stage-header" style={{ '--cols': stageMeta[activeView].columns.length }}>
                      {stageMeta[activeView].columns.map((column) => (
                        <span key={column}>{column}</span>
                      ))}
                    </div>
                    {pagedCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className={`stage-row ${selected?.id === candidate.id ? 'active' : ''}`}
                        style={{ '--cols': stageMeta[activeView].columns.length }}
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
                                  disabled={!candidateHasEmail(candidate)}
                                  onChange={(event) => toggleBatchCandidate(candidate.id, event.target.checked)}
                                />
                                <strong className="name-cell">
                                  {candidate.isNew ? <NewBadge /> : null}
                                  {cell}
                                </strong>
                              </label>
                            ) : index === 0 ? (
                              <strong className="name-cell">
                                {candidate.isNew ? <NewBadge /> : null}
                                {cell}
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
                    <StatusPill value={selected.status} />
                  </div>

                  <div className="actions-row">
                    {activeView === 'screening' ? (
                      <>
                        <button
                          onClick={() => reviewSelected('pass')}
                          disabled={Boolean(busy) || selected.manualReview?.decision === 'pass'}
                        >
                          <CheckCircle2 size={16} />
                          通过，进入面试邀请
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
                        {!selected.screening ? (
                          <button className="ghost-button" onClick={screenSelected} disabled={Boolean(busy)}>
                            <FileSearch size={16} />
                            补跑AI评分
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {activeView === 'schedule' ? (
                      <>
                        <button onClick={previewInterview} disabled={Boolean(busy)}>
                          <Mail size={16} />
                          面邀预览
                        </button>
                        <button onClick={scheduleInterview} disabled={Boolean(busy)}>
                          <CalendarPlus size={16} />
                          {interview.live ? 'Graph真实创建' : 'dry-run 预定'}
                        </button>
                        <button onClick={openOutlookCalendarInvite} disabled={Boolean(busy) || !candidateHasEmail(selected)}>
                          <CalendarPlus size={16} />
                          Outlook日程邀请
                        </button>
                        {selected.interview?.inviteStatus === 'web-link-generated' ? (
                          <button className="ghost-button" onClick={confirmOutlookCalendarSent} disabled={Boolean(busy)}>
                            <CheckCircle2 size={16} />
                            已在Outlook发送
                          </button>
                        ) : null}
                        <button onClick={openOutlookMailInvite} disabled={Boolean(busy) || !candidateHasEmail(selected)}>
                          <Mail size={16} />
                          Outlook发面邀邮件
                        </button>
                        {selected.manualReview ? (
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
                        <button className="ghost-button" onClick={openOutlookMailInvite} disabled={Boolean(busy) || !candidateHasEmail(selected)}>
                          <Mail size={16} />
                          Outlook发面邀邮件
                        </button>
                      </>
                    ) : null}
                  </div>

                  {activeView === 'screening' ? (
                    <div className="screening-layout">
                      <section className="panel decision-panel">
                        <div className="panel-heading">
                          <h3>筛选判断</h3>
                          <StatusPill value={selected.screening?.recommendation || selected.status || '待筛选'} />
                        </div>
                        <div className="decision-grid">
                          <div>
                            <span>AI 分</span>
                            <strong>{selected.screening?.score ?? '待筛'}</strong>
                          </div>
                          <div>
                            <span>推荐等级</span>
                            <strong>{selected.screening?.recommendation || '待筛选'}</strong>
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
                        <h3>AI 筛选证据</h3>
                        {selected.screening ? (
                          <div className="screening">
                            <div className="score-line">
                              <Score value={selected.screening.score} />
                              <span className="source-text">
                                {selected.screening.source || selected.source || 'manual'}
                                {selected.screening.warning ? ` · ${selected.screening.warning}` : ''}
                              </span>
                            </div>
                            <p>{selected.screening.ai_experience_summary}</p>
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
                          <ol className="risk-list">
                            {splitEvidenceText(selected.screening.risk_notes).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ol>
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
                              复制面邀内容
                            </button>
                            <pre>{preview.email.bodyText}</pre>
                            {preview.webCalendarUrl ? (
                              <p className="export-note">
                                <a href={preview.webCalendarUrl} target="_blank" rel="noreferrer">打开 Outlook 日程邀请页</a>
                                <span>，确认 Teams 会议开关后点击发送。</span>
                              </p>
                            ) : null}
                            {preview.webMailUrl ? (
                              <p className="export-note">
                                <a href={preview.webMailUrl} target="_blank" rel="noreferrer">打开 Outlook 邮件草稿</a>
                                <span>，确认内容后点击发送。</span>
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
                      <section className="panel">
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
                      <h3>投递档案</h3>
                      <span className="source-text">{selected.application?.picked?.email ? `邮箱字段：${selected.application.picked.email}` : ''}</span>
                    </div>
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
                          <div className="pdf-preview-wrap">
                            {pdfPreviewState.loading ? <span className="preview-loading">正在渲染第一页...</span> : null}
                            {pdfPreviewState.error ? <span className="preview-error">{pdfPreviewState.error}</span> : null}
                            <canvas ref={resumeCanvasRef} className="pdf-canvas" />
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

createRoot(document.getElementById('root')).render(<App />);
