import crypto from 'node:crypto';
import { config } from './config.js';

export const defaultInterviewTemplate = {
  subject: '联想{{position}}面试邀请-{{name}}',
  body: `Hi {{name}}，

感谢投递联想，以下是{{position}}的面试邀请，请按沟通时间进入面试间。

面试时间：{{timeText}}
面试方式：{{location}}

Best wishes
{{contactName}}
{{contactPhone}}`.trim()
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bodyTextToHtml(text = '') {
  return String(text)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split(/\n/).map(escapeHtml).join('<br/>')}</p>`)
    .join('\n');
}

function renderTemplate(templateText = '', values = {}) {
  return String(templateText).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '');
}

export function buildInterviewContext({ candidate, interview }) {
  const name = candidate.name || candidate.screening?.candidate_name || '同学';
  const start = new Date(interview.start);
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(start).map((part) => [part.type, part.value]));
  const timeText = `${parts.month}月${parts.day}日（${parts.weekday}）${parts.hour}:${parts.minute}`;
  const location = interview.locationOrLink || '后续邮件/日历邀请中查看';
  const contactName = interview.contactName || config.recruiting.contactName;
  const contactPhone = interview.contactPhone || config.recruiting.contactPhone;
  return {
    name,
    position: config.recruiting.position,
    timeText,
    location,
    contactName,
    contactPhone,
    contactEmail: config.recruiting.contactEmail,
    candidateEmail: candidate.email || ''
  };
}

export function normalizeInterviewTemplate(template = {}) {
  return {
    subject: String(template.subject || defaultInterviewTemplate.subject),
    body: String(template.body || defaultInterviewTemplate.body)
  };
}

export function buildInterviewEmail({ candidate, interview, template }) {
  const normalizedTemplate = normalizeInterviewTemplate(template);
  const values = buildInterviewContext({ candidate, interview });
  const subject = renderTemplate(normalizedTemplate.subject, values).trim();
  const bodyText = renderTemplate(normalizedTemplate.body, values).trim();

  return {
    subject,
    bodyText,
    bodyHtml: bodyTextToHtml(bodyText)
  };
}

export function buildInterviewConfirmationEmail({ candidate, interview, confirmationUrl }) {
  const values = buildInterviewContext({ candidate, interview });
  const subject = `请确认联想${values.position}面试时间-${values.name}`;
  const bodyText = `Hi ${values.name}，

感谢投递联想${values.position}岗位。我们为你预留了以下面试时间，请点击链接确认是否参加。

面试时间：${values.timeText}
面试方式：${values.location}

确认链接：
${confirmationUrl}

如果这个时间不方便，也可以在页面里选择“申请改期”并留下可面时间。收到你的确认后，我们会再发送正式 Outlook/Teams 日程邀请。

Best wishes
${values.contactName}
${values.contactPhone || values.contactEmail}`.trim();

  return {
    subject,
    bodyText,
    bodyHtml: bodyTextToHtml(bodyText)
  };
}

export function buildOfferEmail({ candidate, offer = {} }) {
  const name = candidate.name || candidate.screening?.candidate_name || '同学';
  const contactName = offer.owner || candidate.offer?.owner || config.recruiting.contactName;
  const contactPhone = offer.contactPhone || config.recruiting.contactPhone;
  const subject = `联想${config.recruiting.position}Offer通知-${name}`;
  const bodyText = `Hi ${name}，

恭喜你通过联想${config.recruiting.position}岗位的面试评估，我们很高兴正式向你发放实习 Offer。

岗位：${config.recruiting.position}

请回复本邮件确认是否接受 Offer。后续我会再电话联系你，确认到岗时间、实习周期、入职材料等细节。收到确认后，我们会继续同步入职流程和材料清单。

再次欢迎你加入乐享AI团队，期待一起共事。

Best wishes
${contactName}
${contactPhone}`.trim();

  return {
    subject,
    bodyText,
    bodyHtml: bodyTextToHtml(bodyText)
  };
}

function formatOutlookWebDateTime(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return `${text.slice(0, 16)}:00`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export function buildOutlookWebCalendarUrl({ event, interview, email, candidate }) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.subject,
    startdt: formatOutlookWebDateTime(interview.start),
    enddt: formatOutlookWebDateTime(interview.end),
    location: event.location?.displayName || interview.locationOrLink || '线上面试',
    body: email.bodyText,
    allday: 'false',
    online: '1'
  });
  if (candidate?.email) {
    params.set('to', candidate.email);
  }
  return `https://outlook.office.com/calendar/deeplink/compose?${params.toString()}`;
}

export function buildOutlookWebMailUrl({ email, candidate }) {
  const params = new URLSearchParams({
    to: candidate?.email || '',
    subject: email.subject,
    body: email.bodyText
  });
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
}

export function buildCalendarEvent({ candidate, interview, emailBodyHtml }) {
  const name = candidate.name || candidate.screening?.candidate_name || '候选人';
  const transactionId = crypto
    .createHash('sha256')
    .update(`${candidate.id}:${interview.start}:${candidate.email}`)
    .digest('hex')
    .slice(0, 32);

  const event = {
    subject: `面试：${name} - ${config.recruiting.position}`,
    body: {
      contentType: 'HTML',
      content: emailBodyHtml
    },
    start: {
      dateTime: interview.start,
      timeZone: config.recruiting.timezone
    },
    end: {
      dateTime: interview.end,
      timeZone: config.recruiting.timezone
    },
    location: {
      displayName: interview.locationOrLink || '线上面试'
    },
    transactionId
  };

  if (/teams/i.test(interview.locationOrLink || '') || interview.createTeamsMeeting) {
    event.isOnlineMeeting = true;
    event.onlineMeetingProvider = 'teamsForBusiness';
  }

  if (candidate.email) {
    event.attendees = [
      {
        emailAddress: {
          address: candidate.email,
          name
        },
        type: 'required'
      }
    ];
  }

  return event;
}
