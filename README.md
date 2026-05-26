# 乐享AI实习生招聘自动化平台

本工具交付一个本地可运行的招聘工作台，覆盖：

- 连接 Outlook 邮箱与日历
- 按招聘链路拆分：投递采集、简历筛选、面试安排、面试记录、Offer/入职、验证记录
- 从 Outlook 邮件附件同步简历
- 从飞书多维表格表单自动拉取投递记录和简历附件
- 解析 PDF / DOCX / TXT 简历
- 使用阿里云百炼兼容 OpenAI 接口进行简历筛选
- 无密钥时自动回退本地启发式评分
- 生成面试邀请邮件
- 通过 Graph 创建 Outlook/Teams 日程，或通过 Outlook Web 日程邀请页发送会议邀请
- 在平台内直接记录面试表现、结论、评分和下一步动作
- 提供 mock / dry-run / live 三种可验证运行模式

## 快速启动

```bash
npm install
cp .env.example .env
npm run dev
```

打开：

```text
http://localhost:4317
```

首次打开工作台使用账号密码登录。默认管理员账号：

```text
账号：chenbk1
初始密码：123456
```

登录后可在“账号管理”中创建成员、重置密码、调整角色或停用账号。生产环境建议首次登录后立即修改管理员密码。

## 服务器部署与同步方案

推荐把本项目作为独立服务部署，不直接改 `/opt/projects/lexiang` 主项目：

- 服务器目录：`/opt/projects/leai-recruiting`
- PM2 进程：`leai-recruiting`
- 本机端口：`127.0.0.1:4317`
- 对外路径：`https://new.leaibot.cn/recruiting/`

手动部署：

```bash
npm run deploy
```

如果你只是自己在这台 Mac 上改项目，最省心的是开启“本地自动同步”。开启后，只要本地 `src/`、`server/`、部署配置等代码文件变化，后台就会自动构建、同步到服务器并重载 PM2：

```bash
npm run sync:on
```

查看它是否正在运行：

```bash
npm run sync:status
```

关闭自动同步：

```bash
npm run sync:off
```

如果开启时想立即把当前版本也同步一次：

```bash
RUN_INITIAL=1 npm run sync:on
```

这个本地同步不依赖 GitHub，也不要求你先学 Git；但它要求这台 Mac 能 SSH 到服务器。它适合个人快速迭代。多人协作、需要回滚、需要留发布记录时，仍建议走 GitHub Actions。

默认只同步代码和构建产物，不覆盖服务器上的候选人数据库 `data/recruiting.json`。首次需要把本地测试数据也带上服务器时，可显式执行：

```bash
SYNC_DATA=1 ./scripts/deploy-server.sh
```

CI/CD 方案已经放在 `.github/workflows/deploy.yml`：本地修改提交到 GitHub `main` 分支后，由 GitHub Actions 构建、rsync 到服务器、再用 PM2 热重载。注意：本地 Git 只能记录版本，不能自己把代码同步到服务器；要触发 GitHub Actions，项目必须连接到一个 GitHub 仓库并 push 到 `main`。需要在 GitHub 仓库 Secrets 配置：

- `LEAI_RECRUITING_HOST`
- `LEAI_RECRUITING_USER`
- `LEAI_RECRUITING_SSH_KEY`

快速本地联调时，可以启动本地监听同步：

```bash
npm run deploy:watch
```

该脚本会监听 `server/`、`src/`、部署脚本和配置文件；检测到本地修改后自动执行构建、rsync 和 PM2 热重载。它适合个人快速迭代；多人协作和可回滚发布仍建议走 GitHub Actions。

服务器 Nginx 需要把 `/recruiting/` 反代到本服务：

```nginx
location = /recruiting {
    return 301 /recruiting/;
}

location /recruiting/ {
    proxy_pass http://127.0.0.1:4317/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_buffering off;
}
```

部署后前台使用账号体系保护候选人数据；`APP_AUTH_TOKEN` 仅作为命令行脚本和应急兼容令牌保留，不再要求日常用户输入。

## 必填配置

### 0. 平台安全与账号

真实候选人数据会落到本机 `data/` 目录，建议默认只绑定本机或通过 Nginx 受控暴露。账号系统会在首次启动时自动初始化管理员：

```bash
HOST=127.0.0.1
INITIAL_ADMIN_USERNAME=chenbk1
INITIAL_ADMIN_PASSWORD=123456
AUTH_SESSION_DAYS=14
```

候选人对外只访问飞书表单分享链接，不访问工作台。管理员登录后可进入“账号管理”创建内部成员账号。

`APP_AUTH_TOKEN` 仍可配置为脚本兼容令牌。配置后命令行可用 `X-App-Token` 或 `Authorization: Bearer` 访问 API，但前端登录页不会再让用户输入该令牌。

### 1. 阿里云百炼

将百炼密钥写入 `.env`，不要写入代码或文档：

```bash
BAILIAN_OPENAI_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
BAILIAN_API_KEY=你的服务端密钥
BAILIAN_MODEL=qwen3.6-plus
```

未配置 `BAILIAN_API_KEY` 时，平台会使用本地启发式规则完成筛选，便于验证流程。

### 2. 飞书多维表格表单

当前招聘项目显式使用乐享团队机器人 profile，不依赖全局默认机器人：

```bash
LARK_CLI_PATH=lark-cli
LARK_CLI_PROFILE=cli_a955ff0940789cca
LARK_CLI_AS=bot
LARK_BASE_TOKEN=
LARK_TABLE_ID=
LARK_VIEW_ID=
LARK_FORM_SHARE_URL=
LARK_RESUME_FIELD=简历
LARK_SYNC_LIMIT=100
```

本项目已创建并配置的飞书入口：

- Base：`https://lenovoleai.feishu.cn/base/VQPQb7OI8a4oxNsinmWcXjpynbd`
- 候选人填写链接：`https://lenovoleai.feishu.cn/share/base/form/shrcnEx4nzHyd1Yd4WdejDKocKf`
- 数据表：`tblAg0ejOVZePTOI`
- 表单：`vewVRSVWUe`

表单收集建议字段：

- 姓名、邮箱、电话、学校、专业、学历
- 到岗时间、可实习时长、AI 工具经验
- 简历附件字段，默认字段名为 `简历`

如果 `LARK_BASE_TOKEN`、`LARK_TABLE_ID` 不写入 `.env`，也可以直接在前端输入 Base 链接/token 和数据表 ID/名称后点击“拉取投递”。

### 3. 历史面试表回填

这是隐藏的历史回填能力，只用于把既有面试表中的电话沟通、面评、预计入职、offer 状态导入平台做对照，不作为当前投递入口。默认不在前端显示，需要使用时显式开启：

```bash
INTERVIEW_SHEET_ENABLED=true
INTERVIEW_SHEET_CLI_PROFILE=cli_a955ff0940789cca
INTERVIEW_SHEET_CLI_AS=bot
INTERVIEW_SHEET_URL=
INTERVIEW_SPREADSHEET_TOKEN=
INTERVIEW_SHEET_ID=
INTERVIEW_SHEET_RANGE=A1:K200
INTERVIEW_SHEET_LIMIT=200
```

当前已适配的表头包括：

- `姓名`、`联系电话`、`面试时间`、`预计入职时间`
- `简历核心背景（学历、关键经历）`、`实习时长`
- `面试官`、`面试评价`、`简历PDF`、`offer情况`

### 4. Microsoft Outlook / Graph

在 Microsoft Entra 创建应用注册，配置 Web Redirect URI：

```text
http://localhost:4317/api/outlook/callback
```

`.env` 中填写：

```bash
MS_TENANT_ID=organizations
MS_CLIENT_ID=你的应用client_id
MS_CLIENT_SECRET=你的client_secret
MS_REDIRECT_URI=http://localhost:4317/api/outlook/callback
MS_SCOPES=offline_access User.Read Mail.Read Calendars.ReadWrite
```

需要的 Graph delegated scopes：

- `offline_access`：刷新 token
- `User.Read`：读取当前用户信息
- `Mail.Read`：读取投递邮件和简历附件
- `Calendars.ReadWrite`：创建 Outlook 日程

如果企业租户禁止用户自行创建应用或禁止未分配的 Microsoft Graph 公共客户端，Outlook Graph 模式会被拦截。已观察到的阻断包括：

- Azure Portal App registrations 返回 `401` / “你没有访问权限”
- Microsoft Graph Command Line Tools 返回 `AADSTS50105`
- device code 登录返回“你无权访问此”，提示浏览器、应用、位置或身份验证流不满足条件

这种情况下需要管理员任选一种方式放开：

- 给当前账号分配 Microsoft Graph Command Line Tools 的访问权限
- 允许当前账号创建 Entra 应用注册
- 由管理员创建应用并提供 `MS_CLIENT_ID` / `MS_CLIENT_SECRET`，授予 `Mail.Read`、`Calendars.ReadWrite`

在 Graph 被企业策略拦截时，平台使用“Outlook日程邀请”打开 Outlook Web/新 Outlook 的日程创建页；用户确认候选人邮箱和 Teams 会议开关后点击发送，Outlook 会给候选人发送会议邀请、生成 Teams 链接，并同步到 Teams 日历。也可用“导出备用面邀包”生成 `.eml` 面邀邮件和 `.ics` 候选人日程邀请文件。

如果候选人缺少邮箱，“真实发送”和“Outlook日程邀请”会被拦截，但“导出备用面邀包”仍会生成草稿 `.eml` 和 `.ics`，需要手动补收件人。

## 每步验证

### A. 服务与配置验证

```bash
curl http://localhost:4317/api/security/status
curl -X POST http://localhost:4317/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"chenbk1","password":"123456"}'
```

预期：

- 未登录时 `authenticated: false`
- 登录成功返回会话 `token` 和管理员用户信息
- 返回内容不会包含密码哈希或任何 API Key 明文

登录后可带会话 token 验证配置：

```bash
TOKEN=上一步返回的token
curl http://localhost:4317/api/health -H "Authorization: Bearer $TOKEN"
```

### B. 无外部权限的端到端自检

```bash
npm run self-test
```

预期链路：

```text
导入样例简历 -> 简历筛选 -> 生成面邀邮件 -> 生成 Outlook 日程 payload -> dry-run 状态落库
```

也可以在前端点击“端到端自检”。

### C. Outlook 授权验证

前端点击“连接 Outlook”，完成 Microsoft 登录授权。

验证接口：

```bash
curl http://localhost:4317/api/outlook/status
```

预期：

- `connected: true`
- `profile` 中有当前 Outlook 用户信息

### D. 同步简历验证

飞书表单路径：

1. 将候选人填写链接放到 JD 或社媒投递入口
2. 前端确认 profile 为 `cli_a955ff0940789cca`
3. 输入 Base 链接或 token、数据表 ID 或名称，或直接使用 `.env` 默认配置
4. 点击“检查机器人”
5. 点击“读取字段”
6. 点击“拉取投递”

命令行验证：

```bash
curl -X POST http://localhost:4317/api/lark/sync \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"baseToken":"<base token or url>","tableId":"<table id or name>","resumeField":"简历","limit":20}'
```

预期：

- 候选人来源为 `lark-base`
- 简历附件下载到 `data/lark-downloads/`
- 验证记录出现 `lark-base-sync`

Outlook 路径：

前端输入关键词，例如：

```text
超级智能体 实习申请
```

点击“同步 Outlook 简历”。

后端会读取最近邮件，筛选包含关键词且带附件的邮件，导入 `.pdf`、`.docx`、`.txt`、`.md` 简历附件。

验证：

```bash
curl http://localhost:4317/api/candidates
```

命令行请求需要登录后带会话 token：

```bash
-H "Authorization: Bearer $TOKEN"
```

如果配置了 `APP_AUTH_TOKEN`，也可用 `-H "X-App-Token: $APP_AUTH_TOKEN"` 作为脚本兼容方式。

预期列表中能看到候选人状态为 `待筛选`。生产/服务器模式下，`GET /api/candidates` 只返回列表所需的最小字段；完整 `resumeText` 只在 `GET /api/candidates/<id>` 详情接口返回，前端默认也会隐藏简历原文，需要显式点击查看。

### E. 简历筛选验证

前端选择候选人，点击“筛选简历”。

验证点：

- 输出 `score`
- 输出 `recommendation`
- 输出 `risk_notes`
- `source` 为 `bailian` 或 `heuristic`

### F. 面邀与日程 dry-run 验证

前端进入“面试安排”，可在“面试时间”下拉框选择快捷时间，或手动修改开始时间和面试时长。保持“Graph真实发送并创建Exchange日程”未勾选，点击“dry-run 预定”。

预期：

- 生成面试邀请邮件正文
- 生成 Graph calendar event payload
- 候选人状态更新为 `面试待确认`
- 不会真实发送邮件或创建日程

### F2. Outlook Graph 被拦截时的面邀包验证

前端选择候选人后点击“Outlook日程邀请”，应打开 Outlook Web/新 Outlook 日程创建页，预填标题、候选人邮箱、时间、地点和正文。也可以点击“导出备用面邀包”，或调用：

```bash
curl -X POST http://localhost:4317/api/candidates/<candidate_id>/interview/export \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"start":"2026-06-03T14:30","end":"2026-06-03T15:00","locationOrLink":"Teams 线上会议"}'
```

预期：

- 在 `data/outbox/` 下生成 `.eml` 面邀邮件
- 在 `data/outbox/` 下生成 `.ics` 日程邀请
- 返回 `webCalendarUrl`，可打开 Outlook Web 日程邀请页并发送会议邀请
- 生成链接只记录为“待发送”；在 Outlook 点击发送后，需要回到平台点击“已在Outlook发送”，验证记录才会标记发送闭环通过
- 验证记录出现 `outlook-web-calendar`、`outlook-web-calendar-confirm` 或 `interview-artifacts / desktop-fallback`
- 候选人缺少邮箱时仍可导出草稿包，返回 `missingEmail: true`

### G. 面试记录验证

前端进入“面试记录”，填写面试官、结论、评分、优势、风险和总结，点击“保存面试记录”。

预期：

- 候选人写入 `interviewRecords`
- `通过`、`强推`、`建议Offer` 会流转到 `Offer跟进`
- `备选` 会流转到 `备选`
- `不通过` 会流转到 `不通过`
- 验证记录出现 `interview-record`

### H. 真实发送与日程预定验证

确认候选人邮箱正确、Outlook Graph 已连接后，勾选“Graph真实发送并创建Exchange日程”，点击“真实发送”。

预期：

- 调用 `POST /me/calendar/events` 创建日程
- 候选人状态更新为 `已预约面试`

## API 速查

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/security/status` | 查看登录状态、账号模式和本机/网络访问状态 |
| POST | `/api/auth/login` | 使用账号密码登录并获取会话 token |
| POST | `/api/auth/logout` | 注销当前会话 |
| GET | `/api/users` | 管理员查看账号列表 |
| POST | `/api/users` | 管理员创建账号 |
| PATCH | `/api/users/:id` | 管理员更新角色、状态、显示名或密码 |
| DELETE | `/api/users/:id` | 管理员删除账号 |
| POST | `/api/security/login` | 兼容旧脚本：校验 `APP_AUTH_TOKEN` |
| GET | `/api/health` | 服务、配置、Outlook 状态 |
| GET | `/api/outlook/auth-url` | 生成 Microsoft OAuth 授权链接 |
| GET | `/api/outlook/status` | 查看 Outlook 连接状态 |
| POST | `/api/outlook/sync` | 同步 Outlook 简历，支持 `mock: true` |
| GET | `/api/lark/status` | 检查飞书 CLI 与当前机器人 profile |
| POST | `/api/lark/tables` | 列出 Base 下的数据表 |
| POST | `/api/lark/fields` | 读取数据表字段 |
| POST | `/api/lark/sync` | 拉取飞书表单投递并下载简历附件 |
| POST | `/api/interview-sheet/sync` | 同步真实面试表记录 |
| GET | `/api/candidates` | 查看候选人池 |
| POST | `/api/candidates/upload` | 手动上传简历 |
| POST | `/api/candidates/:id/screen` | 筛选单个候选人 |
| POST | `/api/candidates/:id/interview/preview` | 生成面邀与日程预览 |
| POST | `/api/candidates/:id/interview/schedule` | dry-run 或真实发送面邀并创建日程 |
| POST | `/api/candidates/:id/interview/export` | 生成 `.eml` 面邀邮件和 `.ics` 日程邀请文件 |
| POST | `/api/candidates/:id/interview/outlook-web-calendar` | 生成 Outlook Web 日程邀请链接 |
| POST | `/api/candidates/:id/interview/confirm-sent` | 人工确认已在 Outlook 发送日程邀请 |
| POST | `/api/candidates/:id/interview/outlook-desktop-draft` | 备用：打开 Outlook 桌面草稿并返回网页日程链接 |
| POST | `/api/candidates/:id/interview/record` | 保存平台内面试记录并流转状态 |
| POST | `/api/self-test` | 端到端自检 |
| GET | `/api/verification` | 查看验证记录 |

## 安全说明

- `.env` 已被 `.gitignore` 排除。
- 默认建议 `HOST=127.0.0.1`，工作台只在本机访问。
- 工作台 API 默认需要账号会话；管理员初始账号 `chenbk1` / `123456` 应在首次部署后修改。
- `APP_AUTH_TOKEN` 只作为命令行脚本和应急兼容方式，前端不再要求用户输入。
- 对外只暴露飞书表单填写链接，不暴露本地候选人池或管理 API。
- `BAILIAN_API_KEY`、Microsoft token 不会返回到前端。
- 真实发送和真实日程创建需要前端显式勾选 live 开关。
- 候选人简历与 token 存储在本地 `data/`，该目录已被 `.gitignore` 排除。
- 生产部署前建议接入公司级密钥管理、访问控制和候选人数据留存策略。

## 官方接口依据

- Microsoft Graph OAuth 授权码流程：`/authorize`、`/token`、`offline_access`
- Microsoft Graph 邮件读取：`GET /me/messages`
- Microsoft Graph 附件读取：`GET /me/messages/{id}/attachments`
- Microsoft Graph 创建日程：`POST /me/calendar/events`
