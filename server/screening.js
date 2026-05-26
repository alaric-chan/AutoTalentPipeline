import { config } from './config.js';

const aiTools = ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', '通义', 'Kimi', '豆包', 'Copilot'];
const llmTerms = ['RAG', 'SFT', 'Agent', 'MCP', 'Context Engineering', 'Workflow', 'WorkFlow', '知识库', '评测', '微调', 'Prompt'];

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

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function recommendationFromScore(score) {
  if (score >= 85) return '强推';
  if (score >= 70) return '可面';
  if (score >= 55) return '备选';
  return '不建议';
}

function normalizeRecommendation(value, score) {
  const text = String(value || '');
  if (['强推', '可面', '备选', '不建议'].includes(text)) return text;
  if (/强|推荐|优先/.test(text) && score >= 80) return '强推';
  if (/面|通过|合适/.test(text) && score >= 65) return '可面';
  if (/备|保留/.test(text)) return '备选';
  if (/不|淘汰|拒/.test(text)) return '不建议';
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
  const text = safeResumeText || '';
  const toolHits = unique(aiTools.filter((tool) => text.toLowerCase().includes(tool.toLowerCase())));
  const llmHits = unique(llmTerms.filter((term) => text.toLowerCase().includes(term.toLowerCase())));
  const productHits = countMatches(text, ['产品', '需求', '竞品', '原型', '用户', 'PRD', '项目']);
  const dataHits = countMatches(text, ['数据', '清洗', '标注', '质量', '评测', '知识库']);
  const months = availableMonths(text);

  const aiScore = Math.min(25, toolHits.length * 8 + (toolHits.length > 0 ? 5 : 0));
  const productScore = Math.min(20, productHits * 3);
  const llmScore = Math.min(20, llmHits.length * 4);
  const dataScore = Math.min(15, dataHits * 3);
  const stabilityScore = months ? Math.min(15, months >= 3 ? 15 : months * 4) : 7;
  const expressionScore = safeResumeText && safeResumeText.length > 600 ? 5 : 3;
  const score = clampScore(aiScore + productScore + llmScore + dataScore + stabilityScore + expressionScore);

  return {
    candidate_name: candidate.name || '',
    school: '',
    major: '',
    degree: '',
    ai_experience_summary: toolHits.length
      ? `简历中出现 ${toolHits.join('、')} 等 AI 工具经验。`
      : '未在简历中明显识别到 AI 工具经验，需要电话或表单追问。',
    tool_usage: toolHits,
    llm_knowledge: llmHits,
    product_experience: productHits ? '简历包含产品、需求、竞品、原型或项目相关描述。' : '',
    data_work_experience: dataHits ? '简历包含数据、质量、标注、评测或知识库相关描述。' : '',
    available_months: months,
    arrival_date: '',
    risk_notes:
      score >= 70
        ? '建议面试重点追问具体 AI 项目、Agent/Workflow 配置细节和可到岗时间。'
        : '简历匹配度偏低或关键信息不足，建议先通过意向确认表补充实习时长、到岗时间和 AI 实操经验。',
    score,
    recommendation: recommendationFromScore(score),
    interview_focus: ['AI工具使用深度', 'RAG/Agent/MCP理解', '可实习时长与到岗时间', '数据清洗或评测经验'],
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

export async function screenResume({ resumeText, candidate = {} }) {
  const safeResumeText = redactSensitiveText(resumeText);
  const safeCandidate = sanitizeCandidateForModel(candidate);
  const fallback = heuristicScreenResume({ resumeText: safeResumeText, candidate: safeCandidate });
  if (!config.bailian.apiKey) {
    return {
      ...fallback,
      source: 'heuristic',
      privacy: { pii_redacted_before_model: true },
      warning: '未配置 BAILIAN_API_KEY，已使用本地启发式评分。'
    };
  }

  const prompt = `你是联想乐享AI团队的招聘筛选助手。请根据岗位JD和简历文本输出严格JSON，不要输出Markdown。

岗位JD：
${config.recruiting.jd}

评分规则：
- AI工具深度 25%
- 产品与项目经历 20%
- LLM基础认知 20%
- 数据处理与评测经验 15%
- 实习稳定性 15%
- 表达与简历质量 5%

输出JSON字段：
candidate_name, school, major, degree, ai_experience_summary, tool_usage, llm_knowledge, product_experience, data_work_experience, available_months, arrival_date, risk_notes, score, recommendation, interview_focus

候选人基础信息：
${JSON.stringify(safeCandidate, null, 2)}

简历文本：
${safeResumeText.slice(0, 18000)}`;

  try {
    const response = await fetch(`${config.bailian.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bailian.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.bailian.model,
        temperature: 0.1,
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
      tool_usage: normalizeList(parsed.tool_usage ?? fallback.tool_usage),
      llm_knowledge: normalizeList(parsed.llm_knowledge ?? fallback.llm_knowledge),
      interview_focus: normalizeList(parsed.interview_focus ?? fallback.interview_focus),
      risk_notes: normalizeText(parsed.risk_notes || fallback.risk_notes),
      source: 'bailian',
      privacy: { pii_redacted_before_model: true },
      raw_response_id: data.id || ''
    };
  } catch (error) {
    return {
      ...fallback,
      source: 'heuristic',
      privacy: { pii_redacted_before_model: true },
      warning: `百炼筛选失败，已回退本地评分：${error.message}`
    };
  }
}
