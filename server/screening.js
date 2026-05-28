import { config } from './config.js';

const aiTools = ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', '通义', 'Kimi', '豆包', 'Copilot'];
const llmTerms = ['RAG', 'SFT', 'Agent', 'MCP', 'Context Engineering', 'Workflow', 'WorkFlow', '知识库', '评测', '微调', 'Prompt'];
const relevantInternshipTerms = ['AI产品', '产品经理', '产品实习', '数据产品', '策略产品', 'Agent', 'RAG', '知识库', '大模型', '智能体', '模型评测'];
const transferableInternshipTerms = ['运营', '数据分析', '数分', '策略运营', '产品运营', '咨询', '用户研究', '商业分析', '项目管理'];
const reliabilityTerms = [
  '负责',
  '主导',
  '独立',
  '推进',
  '落地',
  '交付',
  '闭环',
  '复盘',
  '细致',
  '严谨',
  '协调',
  '跨部门',
  '目标',
  '结果',
  '提升',
  '按时',
  '稳定',
  '长期',
  '连续',
  '优秀实习生',
  '负责人'
];
const reliabilityRiskTerms = ['频繁', '短期', '一个月', '1个月', '两个月', '2个月', '不稳定', '待验证', '无明确成果', '描述空泛'];
const topTierCompanyTerms = ['字节', '阿里', '腾讯', '百度', '美团', '快手', '京东', '小红书', '滴滴'];
const strongSchoolTerms = [
  '985',
  '211',
  '双一流',
  '清华',
  '北大',
  '复旦',
  '交大',
  '浙江大学',
  '南京大学',
  '中国人民大学',
  '中国科学技术大学',
  '哈尔滨工业大学',
  '西安交通大学',
  '北京航空航天大学',
  '北京理工大学',
  '北京师范大学',
  '北京邮电大学',
  '同济大学',
  '武汉大学',
  '华中科技大学',
  '中山大学',
  '厦门大学',
  '东南大学',
  '天津大学',
  '南开大学',
  '华南理工大学',
  '四川大学',
  '电子科技大学',
  '湖南大学',
  '重庆大学',
  '大连理工大学',
  '东北大学',
  '西北工业大学',
  '中央财经大学',
  '对外经济贸易大学',
  '上海财经大学',
  '香港大学',
  '香港中文大学',
  '香港科技大学',
  '香港城市大学',
  '新加坡国立大学',
  '南洋理工',
  'Stanford',
  'Duke',
  'Columbia',
  'Cornell',
  'UCL',
  'LSE',
  'Imperial',
  'Manchester',
  'Edinburgh',
  'Melbourne',
  'Sydney',
  'Toronto',
  'Berkeley',
  'CMU',
  'NYU'
];
const fullDateToken = '(?:19|20)\\d{2}(?:(?:[年./-]\\d{1,2})(?:(?:[月./-]\\d{1,2}日?)|月份|月)?)?';
const shortDateToken = '\\d{1,2}(?:[月./-]\\d{1,2}日?)?';
const dateRangePattern = `${fullDateToken}(?:\\s*[-—–~至到]\\s*(?:${fullDateToken}|${shortDateToken}))?`;
const dateRangeRegex = new RegExp(dateRangePattern, 'g');

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countMatches(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase())).length;
}

function matchedTerms(text, terms) {
  const lower = text.toLowerCase();
  return unique(terms.filter((term) => lower.includes(term.toLowerCase())));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function recommendationFromScore(score) {
  if (score >= 85) return '高匹配';
  if (score >= 72) return '较匹配';
  if (score >= 60) return '可培养';
  return '不匹配';
}

function normalizeRecommendation(value, score) {
  const text = String(value || '');
  if (['高匹配', '较匹配', '可培养', '不匹配'].includes(text)) return text;
  if (['强推', '可面', '备选', '不建议'].includes(text)) {
    return {
      强推: '高匹配',
      可面: '较匹配',
      备选: '可培养',
      不建议: '不匹配'
    }[text];
  }
  if (/强|高匹配|推荐|优先/.test(text) && score >= 82) return '高匹配';
  if (/较匹配|面|通过|合适/.test(text) && score >= 68) return '较匹配';
  if (/培养|备|保留|潜力/.test(text)) return '可培养';
  if (/不|淘汰|拒|低匹配/.test(text)) return '不匹配';
  return recommendationFromScore(score);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  if (Array.isArray(value)) return value.join('；');
  if (value == null) return '';
  return String(value);
}

function currentRecruitingDateInfo(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    timeZone: 'Asia/Shanghai',
    date: `${parts.year}-${parts.month}-${parts.day}`
  };
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
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function rangeEndsInFuture(rangeText, todayText = currentRecruitingDateInfo().date) {
  const today = parseResumeDateToken(todayText);
  if (!today) return true;
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

function rangeLooksReversed(rangeText) {
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
  const lines = withBreaks
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (/^(\d{1,2}|[一二三四五六七八九十]+)[.、)）]\s+/.test(trimmed)) return [trimmed];
      return trimmed.split(/[；;]/).map((item) => item.trim()).filter(Boolean);
    });
  return lines;
}

function isFalseTimelineRiskItem(line, todayText) {
  const cleanLine = stripRiskMarker(line);
  const yearRanges = cleanLine.match(/(?:19|20)\d{2}\s*[-—–~至到]\s*(?:19|20)\d{2}年?/g) || [];
  const dateRanges = (cleanLine.match(dateRangeRegex) || []).filter(
    (range) => !yearRanges.some((yearRange) => yearRange.replace(/\s+/g, '').includes(range.replace(/\s+/g, '')))
  );
  const ranges = [...yearRanges, ...dateRanges];
  if (!ranges.length) return false;
  if (ranges.some((range) => rangeEndsInFuture(range, todayText) || rangeLooksReversed(range))) return false;
  return /未来时间|未来日期|时间线异常|规划版简历|疑似.*(?:笔误|规划)|笔误或规划|疑似.*排版错误/.test(cleanLine);
}

function removeFalseTimelineRiskItems(text, todayText) {
  const items = splitRiskItems(text);
  if (items.length <= 1) return isFalseTimelineRiskItem(text, todayText) ? '' : text;
  return items
    .filter((item) => !isFalseTimelineRiskItem(item, todayText))
    .join('\n');
}

export function normalizeScreeningRiskNotes(value, todayText = currentRecruitingDateInfo().date) {
  const text = normalizeText(value);
  if (!text) return '';
  const cleaned = text.includes('未来时间')
    ? text
      .replace(new RegExp(`(${dateRangePattern})([^。；;，,]*?)(?:（未来时间）|\\(未来时间\\)|未来时间)`, 'g'), (match, range, middle) => {
        if (rangeEndsInFuture(range, todayText)) return match;
        return `${range}${middle}`;
      })
      .replace(/（\s*）|\(\s*\)/g, '')
      .replace(/\s+([，,。；;])/g, '$1')
    : text;
  return removeFalseTimelineRiskItems(cleaned, todayText);
}

export function normalizeScreeningForDisplay(screening) {
  if (!screening) return screening;
  const rawScore = Number(screening.score);
  const hasScore = Number.isFinite(rawScore);
  const score = hasScore ? clampScore(rawScore) : screening.score;
  return {
    ...screening,
    score,
    recommendation: screening.recommendation || hasScore
      ? normalizeRecommendation(screening.recommendation, hasScore ? score : 0)
      : screening.recommendation,
    risk_notes: normalizeScreeningRiskNotes(screening.risk_notes)
  };
}

function availableMonths(text) {
  const explicit = text.match(/([3-9]|1[0-2])\s*(个月|月)/);
  if (explicit) return Number(explicit[1]);
  if (/半年|6个月/.test(text)) return 6;
  if (/长期|长期实习/.test(text)) return 4;
  return null;
}

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/((?:联系)?邮箱|Email|email)\s*[:：]\s*[^\n\r]+/g, '$1：[已脱敏]')
    .replace(/(联系电话|联系方式|手机号|手机|电话|Phone|phone)\s*[:：]\s*[^\n\r]+/g, '$1：[已脱敏]')
    .replace(/(身份证号?|银行卡号?|银行账号)\s*[:：]\s*[^\n\r]+/g, '$1：[已脱敏]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]')
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, '[phone-redacted]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[id-redacted]')
    .replace(/(?<!\d)\d{12,19}(?!\d)/g, '[number-redacted]');
}

function sanitizeCandidateForModel(candidate = {}) {
  return {
    source: candidate.source || '',
    status: candidate.status || '',
    school: candidate.school || '',
    interviewRecord: candidate.interviewRecord
      ? {
          interviewTime: candidate.interviewRecord.interviewTime || '',
          expectedOnboard: candidate.interviewRecord.expectedOnboard || '',
          duration: candidate.interviewRecord.duration || '',
          evaluation: redactSensitiveText(candidate.interviewRecord.evaluation || ''),
          offerStatus: candidate.interviewRecord.offerStatus || ''
        }
      : null
  };
}

export function heuristicScreenResume({ resumeText, candidate = {} }) {
  const safeResumeText = redactSensitiveText(resumeText);
  const text = [safeResumeText, candidate.school, candidate.status].filter(Boolean).join('\n') || '';
  const toolHits = matchedTerms(text, aiTools);
  const llmHits = matchedTerms(text, llmTerms);
  const relevantInternshipHits = matchedTerms(text, relevantInternshipTerms);
  const transferableInternshipHits = matchedTerms(text, transferableInternshipTerms);
  const reliabilityHits = matchedTerms(text, reliabilityTerms);
  const reliabilityRiskHits = matchedTerms(text, reliabilityRiskTerms);
  const schoolHits = matchedTerms(text, strongSchoolTerms);
  const topTierHits = matchedTerms(text, topTierCompanyTerms);
  const productHits = countMatches(text, ['产品', '需求', '竞品', '原型', '用户', 'PRD', '项目']);
  const dataHits = countMatches(text, ['数据', '清洗', '标注', '质量', '评测', '知识库']);
  const months = availableMonths(text);

  const internshipScore = Math.min(
    30,
    relevantInternshipHits.length * 7 +
      transferableInternshipHits.length * 3 +
      Math.min(productHits, 5) * 2 +
      (/实习|intern/i.test(text) ? 4 : 0)
  );
  const schoolScore = schoolHits.length
    ? 20
    : candidate.school || /大学|学院|本科|硕士|博士/.test(text)
      ? 12
      : 7;
  const projectScore = Math.min(
    20,
    llmHits.length * 3 +
      toolHits.length * 2 +
      Math.min(dataHits, 4) * 2 +
      Math.min(productHits, 4)
  );
  const reliabilityScore = Math.max(
    5,
    Math.min(15, reliabilityHits.length * 2 + (months && months >= 4 ? 3 : 0) - reliabilityRiskHits.length * 3)
  );
  const availabilityScore = months ? (months >= 5 ? 10 : months >= 3 ? 8 : 4) : 5;
  const expressionScore = safeResumeText && safeResumeText.length > 600 ? 5 : 3;
  const score = clampScore(internshipScore + schoolScore + projectScore + reliabilityScore + availabilityScore + expressionScore);
  const recommendation = recommendationFromScore(score);
  const internshipMatch = relevantInternshipHits.length
    ? `有 ${relevantInternshipHits.slice(0, 4).join('、')} 等AI产品/产品相关经历，优先进入面试核实。`
    : transferableInternshipHits.length
      ? `有 ${transferableInternshipHits.slice(0, 4).join('、')} 等可迁移经历，可重点考察产品转化能力。`
      : '未明显识别到AI产品或产品相邻实习经历，需结合项目和院校潜力判断。';
  const schoolAssessment = schoolHits.length
    ? `识别到 ${schoolHits.slice(0, 3).join('、')} 等较强院校背景。`
    : '院校背景未明确达到国内211/海外QS100，建议面试或投递信息中核实。';
  const projectMatch = llmHits.length || toolHits.length || dataHits
    ? `项目/技能中出现 ${unique([...llmHits, ...toolHits]).slice(0, 5).join('、') || '数据/评测'}，具备AI方向可培养信号。`
    : 'AI相关项目证据不足，不作为一票否决，但需追问学习动机和实操样例。';
  const reliabilityAssessment = reliabilityHits.length
    ? `出现 ${reliabilityHits.slice(0, 5).join('、')} 等稳定交付信号，面试需验证是否为本人主导。`
    : '可靠度证据不足，需追问承诺兑现、细心程度、目标导向和闭环交付案例。';
  const availabilityAssessment = months
    ? `${months}个月${months >= 3 ? '，达到最低3个月要求；更长周期可作为加分但权重较低。' : '，低于3个月底线，需要谨慎。'}`
    : '未明确识别可实习时长，需先确认是否至少3个月。';
  const riskNotes = [
    schoolHits.length ? '' : '院校背景需核实是否达到国内211以上或海外QS100以内。',
    months && months < 3 ? '可实习时长低于3个月底线，需谨慎推进。' : '',
    relevantInternshipHits.length || transferableInternshipHits.length ? '' : '实习经历与AI产品/产品相邻岗位的直接匹配度不足。',
    reliabilityHits.length ? '' : '可靠度证据不足，需面试追问稳定交付、承诺兑现和细节意识。',
    topTierHits.length >= 2 && score >= 85 ? '候选人竞争力较强，需确认对联想岗位的优先级与实际入职意愿。' : ''
  ].filter(Boolean).join('\n');
  const summary = [
    `**实习经历匹配**：${internshipMatch}`,
    `**院校背景**：${schoolAssessment}`,
    `**项目/AI潜力**：${projectMatch}`,
    `**可靠度**：${reliabilityAssessment}`,
    `**到岗与时长**：${availabilityAssessment}`,
    `**综合判断**：${recommendation}，匹配分 ${score}。`
  ].join('\n');

  return {
    candidate_name: candidate.name || '',
    school: '',
    major: '',
    degree: '',
    ai_experience_summary: summary,
    internship_match: internshipMatch,
    school_assessment: schoolAssessment,
    project_match: projectMatch,
    reliability_assessment: reliabilityAssessment,
    availability_assessment: availabilityAssessment,
    tool_usage: toolHits,
    llm_knowledge: llmHits,
    product_experience: productHits ? '简历包含产品、需求、竞品、原型或项目相关描述。' : '',
    data_work_experience: dataHits ? '简历包含数据、质量、标注、评测或知识库相关描述。' : '',
    available_months: months,
    arrival_date: '',
    risk_notes: riskNotes || '建议面试重点追问候选人的真实项目贡献、交付稳定性和入职意愿。',
    score,
    recommendation,
    interview_focus: ['AI/产品相关经历真实性', '项目中本人贡献与产品思维', '可靠度与稳定交付案例', '可实习时长与到岗时间'],
    source: 'heuristic'
  };
}

function safeJsonParse(content) {
  const jsonBlock = String(content || '').match(/\{[\s\S]*\}/);
  if (!jsonBlock) return null;
  try {
    return JSON.parse(jsonBlock[0]);
  } catch {
    return null;
  }
}

function questionSnippet(value, maxLength = 76) {
  const text = normalizeText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeQuestionGroups(value) {
  const groups = Array.isArray(value?.groups) ? value.groups : Array.isArray(value) ? value : [];
  return groups
    .map((group) => ({
      title: normalizeText(group?.title).trim(),
      questions: normalizeList(group?.questions).map((question) => normalizeText(question).trim()).filter(Boolean).slice(0, 4)
    }))
    .filter((group) => group.title && group.questions.length)
    .slice(0, 6);
}

function fallbackInterviewQuestionGroups(candidate = {}) {
  const screening = candidate.screening || {};
  const projectSignal = questionSnippet(screening.project_match || screening.ai_experience_summary);
  const internshipSignal = questionSnippet(screening.internship_match || screening.product_experience);
  const riskSignal = questionSnippet(screening.risk_notes || screening.reliability_assessment);
  const llmTags = normalizeList(screening.llm_knowledge).slice(0, 4);
  const aiStack = llmTags.length ? llmTags.join(' / ') : 'AI工具或智能体工作流';
  const focusItems = normalizeList(screening.interview_focus).slice(0, 3);
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

export async function generateInterviewQuestions({ candidate = {}, forceLocal = false } = {}) {
  const fallbackGroups = fallbackInterviewQuestionGroups(candidate);
  const fallback = {
    groups: fallbackGroups,
    source: 'heuristic',
    privacy: { pii_redacted_before_model: true }
  };
  if (forceLocal || !config.bailian.apiKey) {
    return {
      ...fallback,
      warning: forceLocal ? '使用本地规则生成面试问题。' : '未配置 BAILIAN_API_KEY，已使用本地规则生成面试问题。'
    };
  }

  const safeCandidate = sanitizeCandidateForModel(candidate);
  const safeResumeText = redactSensitiveText(candidate.resumeText || '');
  const safeScreening = {
    ...(candidate.screening || {}),
    risk_notes: redactSensitiveText(candidate.screening?.risk_notes || '')
  };
  const prompt = `你是联想乐享AI团队的面试官助手。请基于岗位JD、候选人简历和AI筛选评价，生成面试问题。输出严格JSON，不要输出JSON以外的内容。

岗位JD：
${config.recruiting.jd}

出题目标：
- 主要围绕项目经历深挖，判断候选人是否真实做过、是否理解项目、是否能解释自己的具体贡献。
- 校验候选人的靠谱程度：交付稳定性、细心程度、目标导向、承诺兑现、复盘能力。
- 考察与JD相关的能力：AI产品思维、用户需求拆解、智能体/Workflow/知识库/RAG/评测等技术理解和落地意识。
- 问题要具体、可追问、适合面试现场直接读，不要泛泛而谈。
- 不要询问隐私信息，不要包含候选人的邮箱、电话、身份证等PII。

输出JSON格式：
{
  "groups": [
    {"title": "项目深挖", "questions": ["问题1", "问题2", "问题3"]},
    {"title": "真实性校验", "questions": ["问题1", "问题2", "问题3"]},
    {"title": "JD能力匹配", "questions": ["问题1", "问题2", "问题3"]},
    {"title": "可靠度与风险", "questions": ["问题1", "问题2", "问题3"]}
  ]
}

候选人基础信息：
${JSON.stringify(safeCandidate, null, 2)}

AI筛选评价：
${JSON.stringify(safeScreening, null, 2)}

简历文本：
${safeResumeText.slice(0, 14000)}`;

  const timeoutMs = Math.max(1000, Number(config.bailian.timeoutMs || 45_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.bailian.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.bailian.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.bailian.model,
        temperature: 0.35,
        enable_thinking: false,
        max_tokens: 1800,
        messages: [
          {
            role: 'system',
            content: '你只输出可被JSON.parse解析的JSON对象。'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`百炼接口返回 ${response.status}`);
    }
    const data = await response.json();
    const parsed = safeJsonParse(data.choices?.[0]?.message?.content || '');
    const groups = normalizeQuestionGroups(parsed);
    if (!groups.length) {
      throw new Error('百炼返回的问题格式无法解析');
    }
    return {
      groups,
      source: 'bailian',
      model: config.bailian.model,
      privacy: { pii_redacted_before_model: true },
      raw_response_id: data.id || ''
    };
  } catch (error) {
    const message = error.name === 'AbortError' ? `百炼接口超时（${timeoutMs}ms）` : error.message;
    return {
      ...fallback,
      warning: `百炼出题失败，已回退本地规则：${message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function screenResume({ resumeText, candidate = {} }) {
  const safeResumeText = redactSensitiveText(resumeText);
  const safeCandidate = sanitizeCandidateForModel(candidate);
  const fallback = heuristicScreenResume({ resumeText: safeResumeText, candidate: safeCandidate });
  const currentDateInfo = currentRecruitingDateInfo();
  if (!config.bailian.apiKey) {
    return {
      ...fallback,
      risk_notes: normalizeScreeningRiskNotes(fallback.risk_notes, currentDateInfo.date),
      source: 'heuristic',
      privacy: { pii_redacted_before_model: true },
      warning: '未配置 BAILIAN_API_KEY，已使用本地启发式评分。'
    };
  }

  const prompt = `你是联想乐享AI团队的招聘筛选助手。请根据岗位JD和简历文本输出严格JSON，不要输出JSON以外的内容。

岗位JD：
${config.recruiting.jd}

筛选价值观：
- 这是联想乐享AI产品经理实习岗。不要把“顶级大厂经历”当作唯一标准，也不要因为候选人没有字节、阿里、腾讯、百度等实习就过度扣分。
- 真实可推进的岗位匹配更重要：小厂AI产品实习、大厂运营/数分/策略/产品运营等相邻岗位、AI项目落地经历，都可以视为有效潜力信号。
- 极强候选人可以高分，但如果明显会有更强外部offer竞争，需要在 risk_notes 中提示“需确认岗位优先级/入职意愿”，不要直接因此淘汰。
- 院校背景是重要门槛：国内优先211/985/双一流及以上，海外优先QS100以内。未明确达到时写成风险，但可被强实习或强项目部分弥补。
- AI相关项目优先，但不是硬性一票否决；关键是能否解释清楚需求、工作流、效果评估、数据或用户反馈闭环。
- 实习时长和到岗时间是低权重因素：3个月是底线，越长越好，但不要因为候选人在投递表中写了很长就过度加分。
- 可靠度必须单独评估：稳定交付、兑现承诺、细心、目标导向、闭环推进、跨团队协调和可复盘成果，是实习表现的重要预测指标。

评分规则（总分100）：
- 实习经历/岗位相邻度 30%：AI产品/产品实习优先；AI运营、数据分析、策略、产品运营等相邻经历可作为有效迁移信号。
- 院校背景 20%：国内211/985/双一流及以上、海外QS100以内为强信号；不清楚时标记为需核实。
- 项目与AI潜力 20%：AI项目、Agent/RAG/知识库/模型评测/Prompt/Workflow等实操证据；没有AI项目时看产品拆解和学习潜力。
- 可靠度 15%：是否有主导、负责、落地、交付、复盘、量化结果、长期连续投入等证据；短期频繁、描述空泛为风险。
- 到岗与实习时长 10%：至少3个月；5个月及以上是加分但不主导结论。
- 表达与简历清晰度 5%。

当前日期上下文：
- 今天是 ${currentDateInfo.date}，时区为 ${currentDateInfo.timeZone}。
- 你不能联网获取实时日期，所有“当前/未来/过去”的判断必须只以这个日期为准。
- 只有晚于 ${currentDateInfo.date} 的日期或日期区间结束时间，才可以在 risk_notes 中称为“未来时间”。
- 早于或等于 ${currentDateInfo.date} 的日期、月份或区间不能被标记为“未来时间”；如时间线不清晰，可以写“需核实时间线”，不要误判为未来。
- 只有“2025-2026年”这类年份范围、且结束年份不晚于当前年份时，不能据此判断为未来、异常或规划版简历；除非简历内部存在起止倒挂、冲突或明确晚于今天的月份/日期。

输出JSON字段：
candidate_name, school, major, degree, ai_experience_summary, internship_match, school_assessment, project_match, reliability_assessment, availability_assessment, tool_usage, llm_knowledge, product_experience, data_work_experience, available_months, arrival_date, risk_notes, score, recommendation, interview_focus

字段要求：
- recommendation 只能是：高匹配、较匹配、可培养、不匹配。
- ai_experience_summary 用简短Markdown结构表达，按“实习经历匹配、院校背景、项目/AI潜力、可靠度、到岗与时长、综合判断”6项总结，不要堆工具名。
- internship_match/school_assessment/project_match/reliability_assessment/availability_assessment 都要给出一句可读判断。
- risk_notes 只写真实需要面试追问的风险：院校门槛、岗位优先级、可靠度证据、低于3个月、项目真实性、信息缺失等；不要把早于或等于今天的日期误判为未来。
- score 必须体现岗位匹配度，不是传统“大厂经历强度分”。

候选人基础信息：
${JSON.stringify(safeCandidate, null, 2)}

简历文本：
${safeResumeText.slice(0, 18000)}`;

  const timeoutMs = Math.max(1000, Number(config.bailian.timeoutMs || 45_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.bailian.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.bailian.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.bailian.model,
        temperature: 0.1,
        enable_thinking: false,
        max_tokens: 1800,
        messages: [
          {
            role: 'system',
            content: '你只输出可被JSON.parse解析的JSON对象。'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`百炼接口返回 ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(content);
    if (!parsed) {
      throw new Error('百炼返回内容无法解析为JSON');
    }
    const score = clampScore(Number(parsed.score ?? fallback.score));
    const recommendation = normalizeRecommendation(parsed.recommendation, score);
    return {
      ...fallback,
      ...parsed,
      score,
      recommendation,
      ai_experience_summary: normalizeText(parsed.ai_experience_summary ?? fallback.ai_experience_summary),
      internship_match: normalizeText(parsed.internship_match ?? fallback.internship_match),
      school_assessment: normalizeText(parsed.school_assessment ?? fallback.school_assessment),
      project_match: normalizeText(parsed.project_match ?? fallback.project_match),
      reliability_assessment: normalizeText(parsed.reliability_assessment ?? fallback.reliability_assessment),
      availability_assessment: normalizeText(parsed.availability_assessment ?? fallback.availability_assessment),
      product_experience: normalizeText(parsed.product_experience ?? fallback.product_experience),
      data_work_experience: normalizeText(parsed.data_work_experience ?? fallback.data_work_experience),
      tool_usage: normalizeList(parsed.tool_usage ?? fallback.tool_usage),
      llm_knowledge: normalizeList(parsed.llm_knowledge ?? fallback.llm_knowledge),
      interview_focus: normalizeList(parsed.interview_focus ?? fallback.interview_focus),
      risk_notes: normalizeScreeningRiskNotes(parsed.risk_notes || fallback.risk_notes, currentDateInfo.date),
      source: 'bailian',
      privacy: { pii_redacted_before_model: true },
      raw_response_id: data.id || ''
    };
  } catch (error) {
    const message = error.name === 'AbortError' ? `百炼接口超时（${timeoutMs}ms）` : error.message;
    return {
      ...fallback,
      risk_notes: normalizeScreeningRiskNotes(fallback.risk_notes, currentDateInfo.date),
      source: 'heuristic',
      privacy: { pii_redacted_before_model: true },
      warning: `百炼筛选失败，已回退本地评分：${message}`
    };
  } finally {
    clearTimeout(timeout);
  }
}
