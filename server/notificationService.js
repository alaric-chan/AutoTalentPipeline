import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, paths } from './config.js';
import { addVerificationRun, patchCandidate } from './store.js';
import { buildInterviewContext } from './templates.js';

const execFileAsync = promisify(execFile);

const responseLabels = {
  confirm: '候选人已确认',
  reschedule: '候选人申请改期',
  decline: '候选人暂不参加'
};

const statusLabels = {
  confirmed: '候选人已确认',
  reschedule_requested: '候选人申请改期',
  declined: '候选人暂不参加'
};

function compact(value) {
  return String(value || '').trim();
}

function larkNotificationEnabled() {
  return Boolean(
    config.notifications.lark.enabled &&
      (config.notifications.lark.webhookUrl || config.notifications.lark.userId || config.notifications.lark.chatId)
  );
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
        // Keep scanning because lark-cli can print warnings before JSON.
      }
    }
  }
  throw new Error(`飞书 IM 返回内容不是 JSON：${text.slice(0, 240)}`);
}

function safeErrorOutput(error) {
  return compact(`${error.stderr || ''}\n${error.stdout || ''}`).slice(0, 2000);
}

function notificationChannel() {
  if (config.notifications.lark.chatId || config.notifications.lark.userId) return 'lark-im';
  return 'lark-webhook';
}

export function feishuBotSign(timestamp, secret) {
  return crypto.createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

function notificationEventKey(confirmation = {}) {
  return [
    confirmation.token || '',
    confirmation.status || '',
    confirmation.response || '',
    compact(confirmation.note)
  ].join(':');
}

export function buildCandidateConfirmationNotification(candidate) {
  const confirmation = candidate?.interview?.confirmation || {};
  const context = buildInterviewContext({
    candidate,
    interview: {
      ...(candidate?.interview || {}),
      ...(confirmation.interview || {})
    }
  });
  const statusText = statusLabels[confirmation.status] || responseLabels[confirmation.response] || '候选人已反馈';
  const lines = [
    `【乐享AI招聘】${statusText}`,
    `候选人：${candidate?.name || context.name || candidate?.email || candidate?.id || '未知候选人'}`,
    `岗位：${context.position || config.recruiting.position}`,
    `面试时间：${context.timeText || '待安排'}`,
    `联系方式：${[candidate?.email, candidate?.phone].filter(Boolean).join(' / ') || '待补充'}`
  ];
  if (confirmation.respondedAt) lines.push(`反馈时间：${confirmation.respondedAt.slice(0, 16).replace('T', ' ')}`);
  if (compact(confirmation.note)) lines.push(`候选人留言：${compact(confirmation.note)}`);
  if (confirmation.url) lines.push(`确认页：${confirmation.url}`);
  if (config.appBaseUrl) lines.push(`工作台：${String(config.appBaseUrl).replace(/\/+$/, '')}`);
  return lines.join('\n');
}

export async function sendLarkWebhookText(text) {
  if (!config.notifications.lark.enabled || !config.notifications.lark.webhookUrl) {
    return { status: 'disabled' };
  }
  const body = {
    msg_type: 'text',
    content: { text }
  };
  if (config.notifications.lark.secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    body.timestamp = timestamp;
    body.sign = feishuBotSign(timestamp, config.notifications.lark.secret);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(config.notifications.lark.timeoutMs || 8000)));
  try {
    const response = await fetch(config.notifications.lark.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const textResponse = await response.text();
    let parsed = null;
    try {
      parsed = textResponse ? JSON.parse(textResponse) : null;
    } catch {
      parsed = null;
    }
    const code = parsed?.code ?? parsed?.StatusCode;
    if (!response.ok || (code != null && Number(code) !== 0)) {
      throw new Error(parsed?.msg || parsed?.StatusMessage || textResponse || `飞书机器人通知失败：${response.status}`);
    }
    return { status: 'sent', response: parsed || textResponse };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendLarkImText(text) {
  if (!config.notifications.lark.enabled || !(config.notifications.lark.chatId || config.notifications.lark.userId)) {
    return { status: 'disabled' };
  }
  const args = ['im', '+messages-send'];
  if (config.notifications.lark.profile) args.push('--profile', config.notifications.lark.profile);
  if (config.notifications.lark.as) args.push('--as', config.notifications.lark.as);
  if (config.notifications.lark.chatId) {
    args.push('--chat-id', config.notifications.lark.chatId);
  } else {
    args.push('--user-id', config.notifications.lark.userId);
  }
  args.push('--text', text);
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(text)
    .digest('hex')
    .slice(0, 32);
  args.push('--idempotency-key', `recruiting-${idempotencyKey}`);

  try {
    const { stdout } = await execFileAsync(config.lark.cliPath, args, {
      cwd: paths.root,
      maxBuffer: 2 * 1024 * 1024,
      timeout: Math.max(1000, Number(config.notifications.lark.timeoutMs || 8000))
    });
    const parsed = parseJsonOutput(stdout);
    if (parsed?.ok === false) {
      throw new Error(parsed?.error?.message || parsed?.error || '飞书 IM 通知失败');
    }
    return { status: 'sent', response: parsed };
  } catch (error) {
    const detail = safeErrorOutput(error);
    throw new Error(detail || error.message);
  }
}

export async function sendLarkNotificationText(text) {
  if (config.notifications.lark.chatId || config.notifications.lark.userId) {
    return sendLarkImText(text);
  }
  return sendLarkWebhookText(text);
}

async function markNotification(candidate, notification, timelineEntry) {
  await patchCandidate(candidate.id, {
    interview: {
      ...(candidate.interview || {}),
      confirmation: {
        ...(candidate.interview?.confirmation || {}),
        notification
      }
    },
    timeline: timelineEntry ? [...(candidate.timeline || []), timelineEntry] : candidate.timeline
  });
}

export async function notifyCandidateConfirmation(candidate) {
  if (!candidate?.id || candidate.source === 'mock') return { status: 'skipped' };
  const confirmation = candidate.interview?.confirmation || {};
  const eventKey = notificationEventKey(confirmation);
  if (!eventKey || confirmation.notification?.eventKey === eventKey) {
    return { status: 'duplicate' };
  }
  if (!larkNotificationEnabled()) return { status: 'disabled' };

  const now = new Date().toISOString();
  try {
    const text = buildCandidateConfirmationNotification(candidate);
    const channel = notificationChannel();
    const result = await sendLarkNotificationText(text);
    const notification = {
      channel,
      status: result.status,
      eventKey,
      sentAt: now
    };
    await markNotification(candidate, notification, {
      at: now,
      action: '飞书提醒已发送',
      detail: statusLabels[confirmation.status] || confirmation.status || ''
    });
    await addVerificationRun({
      type: 'lark-confirmation-notification',
      status: 'passed',
      detail: `${candidate.name || candidate.email || candidate.id}：飞书确认提醒已发送`,
      mode: channel
    });
    return notification;
  } catch (error) {
    const channel = notificationChannel();
    const notification = {
      channel,
      status: 'failed',
      eventKey,
      failedAt: now,
      error: error.name === 'AbortError' ? `飞书通知超时（${config.notifications.lark.timeoutMs}ms）` : error.message
    };
    await markNotification(candidate, notification, {
      at: now,
      action: '飞书提醒发送失败',
      detail: notification.error
    }).catch(() => {});
    await addVerificationRun({
      type: 'lark-confirmation-notification',
      status: 'failed',
      detail: `${candidate.name || candidate.email || candidate.id}：${notification.error}`,
      mode: channel
    }).catch(() => {});
    throw error;
  }
}

export function queueCandidateConfirmationNotification(candidate) {
  notifyCandidateConfirmation(candidate).catch((error) => {
    console.error(`[${new Date().toISOString()}] 飞书确认提醒失败：${error.message}`);
  });
}
