# 乐享 AI 实习生招聘自动化（MVP）

自动从 Outlook 邮箱拉取实习申请简历 → LLM 四维度评分 → 写入飞书多维表格；面试后自动生成 LLM 面试小结。

## 能做什么

- 每 15 分钟自动拉取 `chenbk1@lenovo.com` 未读邮件（标题以 "超级智能体实习申请" 开头）
- 下载简历附件到飞书云空间
- 用 Dashscope（qwen-max）做四维度评分（AI 经验、项目深度、逻辑表达、硬门槛），写入飞书多维表格「候选人」表
- 面试后你在「面试记录」表填四项打分，自动触发 LLM 生成面试小结
- 异常通过飞书机器人告警

## 快速开始

### 1. 准备

- Python 3.9+
- 飞书开放平台自建应用（App ID / Secret）
- Microsoft Azure AD 应用（Graph API 委托权限：`Mail.Read`、`Mail.ReadWrite`、`Mail.Send`）
- Dashscope API Key（阿里云境内，兼容 OpenAI 协议）

### 2. 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# 编辑 .env 填入真实 key
```

### 3. 建飞书表

见 [docs/base_setup.md](docs/base_setup.md)。

### 4. 生成测试 fixture（本地跑测试用）

```bash
python tests/fixtures/make_fixture.py
```

### 5. 跑测试

```bash
pytest -v
```

### 6. 启动服务

```bash
uvicorn app.webhook_server:app --host 0.0.0.0 --port 8080
```

把 8080 端口暴露给飞书 Base 自动化（ngrok、frp 或联想内部反向代理）。

### 7. 手动触发一次流程 A 验证

```bash
curl -X POST http://localhost:8080/admin/run-flow-resume
```

## 目录结构

```
app/          应用代码
├─ config.py          环境变量配置
├─ models.py          LLM 输出契约
├─ scrubber.py        PII 脱敏
├─ resume_parser.py   PDF/DOCX 文本抽取
├─ prompts.py         Prompt 模板加载
├─ llm_client.py      Dashscope 封装
├─ lark_client.py     飞书开放平台封装
├─ outlook_client.py  Microsoft Graph 封装
├─ flow_resume.py     流程 A：邮件 → LLM → Base
├─ flow_interview.py  流程 C：面试打分 → LLM 小结
├─ scheduler.py       APScheduler 定时调度
└─ webhook_server.py  FastAPI 入口

prompts/      LLM 提示词模板
tests/        单元测试
docs/
├─ base_setup.md                飞书建表指引
└─ superpowers/
    ├─ specs/*.md                设计文档
    └─ plans/*.md                实现计划
```

## 日常使用

99% 的时间只在飞书多维表格里做 3 件事：

1. **「待人工初筛」视图**：看 LLM 评分和评语，把要推进的候选人状态改为"已发问卷"（MVP 手动发）
2. **面试后**：在「面试记录」表填四项打分（1-5 分）+ 2-3 句观察笔记
3. **「待决策」视图**：按综合分排序，手动改"终轮结果"

## 后续规划

- V2：自动问卷 + 时段预约（见 [spec 8.2](docs/superpowers/specs/2026-05-07-intern-recruitment-automation-design.md)）
- V3：日历动态读取 + Offer 自动流
