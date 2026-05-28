import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const paths = {
  root: rootDir,
  data: path.join(rootDir, 'data'),
  uploads: path.join(rootDir, 'data', 'uploads'),
  larkDownloads: path.join(rootDir, 'data', 'lark-downloads'),
  db: path.join(rootDir, 'data', 'recruiting.json'),
  dist: path.join(rootDir, 'dist')
};

export const config = {
  port: Number(process.env.PORT || 4317),
  host: process.env.HOST || '127.0.0.1',
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4317}`,
  security: {
    authToken: process.env.APP_AUTH_TOKEN || '',
    initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME || 'chenbk1',
    initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD || '123456',
    sessionDays: Number(process.env.AUTH_SESSION_DAYS || 14)
  },
  microsoft: {
    tenantId: process.env.MS_TENANT_ID || 'organizations',
    clientId: process.env.MS_CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
    publicClientId: process.env.MS_PUBLIC_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e',
    redirectUri:
      process.env.MS_REDIRECT_URI ||
      `${process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4317}`}/api/outlook/callback`,
    scopes:
      process.env.MS_SCOPES ||
      'offline_access User.Read Mail.Read Calendars.ReadWrite'
  },
  bailian: {
    baseUrl: process.env.BAILIAN_OPENAI_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    apiKey: process.env.BAILIAN_API_KEY || '',
    model: process.env.BAILIAN_MODEL || 'qwen-plus',
    timeoutMs: Number(process.env.BAILIAN_TIMEOUT_MS || 45_000)
  },
  lark: {
    cliPath: process.env.LARK_CLI_PATH || 'lark-cli',
    profile: process.env.LARK_CLI_PROFILE || 'cli_a955ff0940789cca',
    as: process.env.LARK_CLI_AS || 'bot',
    baseToken: process.env.LARK_BASE_TOKEN || '',
    tableId: process.env.LARK_TABLE_ID || '',
    viewId: process.env.LARK_VIEW_ID || '',
    formShareUrl: process.env.LARK_FORM_SHARE_URL || '',
    resumeField: process.env.LARK_RESUME_FIELD || '简历',
    defaultLimit: Number(process.env.LARK_SYNC_LIMIT || 100),
    autoSync: {
      enabled: process.env.LARK_AUTO_SYNC_ENABLED !== 'false',
      intervalMinutes: Number(process.env.LARK_AUTO_SYNC_INTERVAL_MINUTES || 5),
      limit: Number(process.env.LARK_AUTO_SYNC_LIMIT || process.env.LARK_SYNC_LIMIT || 100)
    }
  },
  notifications: {
    lark: {
      enabled: process.env.LARK_NOTIFICATION_ENABLED !== 'false',
      webhookUrl: process.env.LARK_NOTIFICATION_WEBHOOK_URL || '',
      secret: process.env.LARK_NOTIFICATION_SECRET || '',
      timeoutMs: Number(process.env.LARK_NOTIFICATION_TIMEOUT_MS || 8000)
    }
  },
  interviewSheet: {
    enabled: process.env.INTERVIEW_SHEET_ENABLED === 'true',
    profile: process.env.INTERVIEW_SHEET_CLI_PROFILE || process.env.LARK_CLI_PROFILE || 'cli_a955ff0940789cca',
    as: process.env.INTERVIEW_SHEET_CLI_AS || process.env.LARK_CLI_AS || 'bot',
    url: process.env.INTERVIEW_SHEET_URL || '',
    spreadsheetToken: process.env.INTERVIEW_SPREADSHEET_TOKEN || '',
    sheetId: process.env.INTERVIEW_SHEET_ID || '',
    range: process.env.INTERVIEW_SHEET_RANGE || 'A1:K200',
    defaultLimit: Number(process.env.INTERVIEW_SHEET_LIMIT || 200)
  },
  recruiting: {
    contactName: process.env.RECRUITING_CONTACT_NAME || '陈百科',
    contactEmail: process.env.RECRUITING_CONTACT_EMAIL || 'chenbk1@lenovo.com',
    contactPhone: process.env.RECRUITING_CONTACT_PHONE || '',
    position: process.env.RECRUITING_POSITION || 'AI产品经理实习生',
    timezone: process.env.RECRUITING_TIMEZONE || 'China Standard Time',
    jd: `加入联想前沿AI团队，深度参与「超级智能体」产品的全生命周期，探索下一代AI交互体验。
岗位职责：协助完成用户需求分析、竞品调研及原型设计，用数据驱动产品迭代；参与AI能力落地场景挖掘，设计智能体交互方案（Agent配置、WorkFlow编排）；关键数据清洗与质量控制工作，确保为大模型提供高质量、高价值的输入。
基本要求：本科及以上学历，计算机/工业设计等专业优先；重度AI工具使用者；了解LLM能力边界与底层逻辑（RAG、SFT、Context Engineering等技术范式）。
加分潜质：关注Agent、MCP、Skills等AI前沿趋势；有创业心态；有大模型评测经验、知识库经验等优先。`
  }
};

export function publicConfigStatus() {
  return {
    server: {
      port: config.port,
      host: config.host,
      appBaseUrl: config.appBaseUrl
    },
    security: {
      authRequired: true,
      accountLogin: true,
      legacyTokenEnabled: Boolean(config.security.authToken),
      localOnly: config.host === '127.0.0.1' || config.host === 'localhost'
    },
    outlook: {
      hasClientId: Boolean(config.microsoft.clientId),
      hasClientSecret: Boolean(config.microsoft.clientSecret),
      publicClientId: config.microsoft.publicClientId,
      redirectUri: config.microsoft.redirectUri,
      scopes: config.microsoft.scopes
    },
    bailian: {
      baseUrl: config.bailian.baseUrl,
      hasApiKey: Boolean(config.bailian.apiKey),
      model: config.bailian.model,
      timeoutMs: config.bailian.timeoutMs
    },
    lark: {
      profile: config.lark.profile,
      as: config.lark.as,
      hasBaseToken: Boolean(config.lark.baseToken),
      hasTableId: Boolean(config.lark.tableId),
      baseUrl: config.lark.baseToken ? `https://lenovoleai.feishu.cn/base/${config.lark.baseToken}` : '',
      tableId: config.lark.tableId,
      viewId: config.lark.viewId,
      formShareUrl: config.lark.formShareUrl,
      resumeField: config.lark.resumeField,
      defaultLimit: config.lark.defaultLimit,
      autoSyncEnabled: config.lark.autoSync.enabled && Boolean(config.lark.baseToken),
      autoSyncIntervalMinutes: config.lark.autoSync.intervalMinutes,
      autoSyncLimit: config.lark.autoSync.limit
    },
    notifications: {
      lark: {
        enabled: config.notifications.lark.enabled && Boolean(config.notifications.lark.webhookUrl),
        configured: Boolean(config.notifications.lark.webhookUrl),
        hasSecret: Boolean(config.notifications.lark.secret)
      }
    },
    interviewSheet: {
      enabled: config.interviewSheet.enabled,
      profile: config.interviewSheet.profile,
      as: config.interviewSheet.as,
      url:
        config.interviewSheet.url ||
        (config.interviewSheet.spreadsheetToken
          ? `https://lenovoleai.feishu.cn/sheets/${config.interviewSheet.spreadsheetToken}`
          : ''),
      hasUrl: Boolean(config.interviewSheet.url),
      hasSpreadsheetToken: Boolean(config.interviewSheet.spreadsheetToken),
      sheetId: config.interviewSheet.sheetId,
      range: config.interviewSheet.range,
      defaultLimit: config.interviewSheet.defaultLimit
    },
    recruiting: {
      contactName: config.recruiting.contactName,
      contactEmail: config.recruiting.contactEmail,
      hasContactPhone: Boolean(config.recruiting.contactPhone),
      position: config.recruiting.position,
      timezone: config.recruiting.timezone
    }
  };
}
