# 实习生招聘自动化 — MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 MVP：从 Outlook 邮箱自动拉取简历 → 脱敏 → LLM 四维评分 → 写入飞书多维表格；面试后手填打分触发 LLM 生成面试小结；异常通过飞书机器人告警。

**Architecture:** 单一 Python 进程 = FastAPI（接收飞书 Base 自动化的 Webhook） + APScheduler（每 15 分钟拉邮件）。飞书多维表格是唯一 UI 和真源。LLM 通过 Dashscope 兼容 OpenAI 协议调用。所有密钥走 `.env`。

**Tech Stack:** Python 3.11+, FastAPI, APScheduler, pdfplumber, python-docx, msgraph-sdk (Outlook), lark-oapi (飞书), openai SDK (Dashscope 端点), pydantic v2, pytest, loguru。

**Spec reference:** `docs/superpowers/specs/2026-05-07-intern-recruitment-automation-design.md`

**Scope:** MVP 阶段（spec 8.1）—— 自动筛简历 + 手动约面试 + 面试小结 + 告警。不包括：V2 自动问卷预约、V3 日历动态读取、Offer 邮件自动发。

---

## File Structure

```
实习生招聘/
├── app/
│   ├── __init__.py
│   ├── config.py              # Pydantic Settings，加载 .env
│   ├── models.py              # Pydantic 模型（Candidate、LLMResumeScore 等）
│   ├── scrubber.py            # PII 脱敏（纯函数）
│   ├── resume_parser.py       # PDF/DOCX → 纯文本
│   ├── prompts.py             # Prompt 模板加载 + 渲染
│   ├── llm_client.py          # Dashscope 调用 + JSON 校验 + retry
│   ├── outlook_client.py      # Graph API: 列邮件、下附件、标已读
│   ├── lark_client.py         # 飞书 Base CRUD + 云空间上传 + 机器人消息
│   ├── flow_resume.py         # 流程 A：邮件 → 简历 → 评分 → 写 Base
│   ├── flow_interview.py      # 流程 C：面试打分 → LLM 小结 → 写回
│   ├── scheduler.py           # APScheduler 调度入口
│   └── webhook_server.py      # FastAPI 应用（主入口），挂载 scheduler
├── prompts/
│   ├── resume_screening.txt   # Prompt 1 模板
│   └── interview_summary.txt  # Prompt 2 模板
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_scrubber.py
│   ├── test_resume_parser.py
│   ├── test_prompts.py
│   ├── test_llm_client.py
│   ├── test_flow_resume.py
│   ├── test_flow_interview.py
│   ├── test_webhook_server.py
│   └── fixtures/
│       ├── sample_resume.pdf
│       └── sample_resume.docx
├── .env.example
├── .gitignore
├── pyproject.toml
├── README.md
└── docs/
    └── base_setup.md          # 飞书多维表格手动建表指引
```

**设计原则：**
- `flow_*.py` 是编排层，组合 `*_client` 和纯函数模块
- `scrubber.py`、`resume_parser.py`、`prompts.py`、`llm_client.py` 是可单测的纯函数/本地逻辑
- `outlook_client.py`、`lark_client.py` 是外部 API 封装，用 mock 单测
- `webhook_server.py` 是唯一进程入口（同时挂 scheduler 和 FastAPI），便于本地 `uvicorn` 跑起来

---

## Task 1: 项目骨架与依赖

**Files:**
- Create: `pyproject.toml`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `app/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: 创建 `pyproject.toml`**

```toml
[project]
name = "intern-recruitment"
version = "0.1.0"
description = "乐享 AI 实习生招聘自动化"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "apscheduler>=3.10",
    "pdfplumber>=0.11",
    "python-docx>=1.1",
    "msgraph-sdk>=1.0",
    "azure-identity>=1.15",
    "lark-oapi>=1.2",
    "openai>=1.12",
    "pydantic>=2.6",
    "pydantic-settings>=2.2",
    "python-dotenv>=1.0",
    "loguru>=0.7",
    "httpx>=0.26",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-mock>=3.12",
    "respx>=0.20",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["app*"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: 创建 `.gitignore`**

```
.env
.venv/
__pycache__/
*.pyc
.pytest_cache/
logs/
tests/fixtures/*.pdf
tests/fixtures/*.docx
*.egg-info/
dist/
build/
```

简历 fixture 不入库（可能含真人信息）；本仓只放一份合成/假简历时再单独 unignore。

- [ ] **Step 3: 创建 `.env.example`**

```
# Dashscope (OpenAI 兼容端点)
DASHSCOPE_API_KEY=sk-xxx
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
DASHSCOPE_MODEL=qwen-max

# Microsoft Graph (Outlook)
MS_TENANT_ID=xxx
MS_CLIENT_ID=xxx
MS_CLIENT_SECRET=xxx
MS_USER_EMAIL=chenbk1@lenovo.com

# 飞书
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
LARK_BASE_APP_TOKEN=xxx
LARK_TABLE_CANDIDATE=tblxxx
LARK_TABLE_INTERVIEW=tblxxx
LARK_TABLE_SLOT=tblxxx
LARK_TABLE_JD=tblxxx
LARK_RESUME_FOLDER_TOKEN=fldxxx
LARK_ALERT_CHAT_ID=oc_xxx

# 运行配置
RESUME_POLL_INTERVAL_MINUTES=15
LOG_LEVEL=INFO
```

- [ ] **Step 4: 创建 `app/__init__.py`（空）和 `tests/__init__.py`（空）**

```python
# app/__init__.py
```

```python
# tests/__init__.py
```

- [ ] **Step 5: 创建 `tests/conftest.py`**

```python
import os
from pathlib import Path
import pytest


@pytest.fixture(autouse=True)
def _test_env(monkeypatch):
    """所有测试默认用占位环境变量，避免意外打真 API"""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setenv("DASHSCOPE_BASE_URL", "https://test.example/v1")
    monkeypatch.setenv("DASHSCOPE_MODEL", "test-model")
    monkeypatch.setenv("MS_TENANT_ID", "test-tenant")
    monkeypatch.setenv("MS_CLIENT_ID", "test-client")
    monkeypatch.setenv("MS_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("MS_USER_EMAIL", "test@example.com")
    monkeypatch.setenv("LARK_APP_ID", "test-app")
    monkeypatch.setenv("LARK_APP_SECRET", "test-secret")
    monkeypatch.setenv("LARK_BASE_APP_TOKEN", "test-base")
    monkeypatch.setenv("LARK_TABLE_CANDIDATE", "tblcandidate")
    monkeypatch.setenv("LARK_TABLE_INTERVIEW", "tblinterview")
    monkeypatch.setenv("LARK_TABLE_SLOT", "tblslot")
    monkeypatch.setenv("LARK_TABLE_JD", "tbljd")
    monkeypatch.setenv("LARK_RESUME_FOLDER_TOKEN", "fldtoken")
    monkeypatch.setenv("LARK_ALERT_CHAT_ID", "oc_test")


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).parent / "fixtures"
```

- [ ] **Step 6: 验证项目可安装**

```bash
cd "/Users/chenbaike/Documents/联想工作/LeAI-Demo/实习生招聘"
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Expected: 安装成功。如果 msgraph-sdk 或 lark-oapi 版本冲突，允许微调版本号。

- [ ] **Step 7: 提交**

```bash
git init
git add pyproject.toml .gitignore .env.example app/ tests/
git commit -m "feat: 项目骨架与依赖"
```

---

## Task 2: 配置加载（Pydantic Settings）

**Files:**
- Create: `app/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1: 写失败测试 `tests/test_config.py`**

```python
from app.config import get_settings


def test_settings_loaded_from_env():
    s = get_settings()
    assert s.dashscope_api_key == "test-key"
    assert s.dashscope_model == "test-model"
    assert s.ms_user_email == "test@example.com"
    assert s.lark_base_app_token == "test-base"
    assert s.resume_poll_interval_minutes == 15  # 默认


def test_settings_cached():
    a = get_settings()
    b = get_settings()
    assert a is b
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_config.py -v
```

Expected: ImportError / ModuleNotFoundError。

- [ ] **Step 3: 实现 `app/config.py`**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    dashscope_api_key: str
    dashscope_base_url: str = "https://coding.dashscope.aliyuncs.com/v1"
    dashscope_model: str = "qwen-max"

    ms_tenant_id: str
    ms_client_id: str
    ms_client_secret: str
    ms_user_email: str

    lark_app_id: str
    lark_app_secret: str
    lark_base_app_token: str
    lark_table_candidate: str
    lark_table_interview: str
    lark_table_slot: str
    lark_table_jd: str
    lark_resume_folder_token: str
    lark_alert_chat_id: str

    resume_poll_interval_minutes: int = 15
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_config.py -v
```

Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add app/config.py tests/test_config.py
git commit -m "feat: 配置加载（Pydantic Settings）"
```

---

## Task 3: PII 脱敏（纯函数）

**Files:**
- Create: `app/scrubber.py`
- Create: `tests/test_scrubber.py`

**目的**：发给 LLM 前去掉身份证、银行卡、手机中段，保留前 6 位身份证（便于地区识别）。

- [ ] **Step 1: 写失败测试 `tests/test_scrubber.py`**

```python
from app.scrubber import scrub_pii


def test_scrub_id_card_18_digits():
    text = "身份证: 110101199001011234"
    assert "110101****1234" in scrub_pii(text)
    assert "199001011234" not in scrub_pii(text)


def test_scrub_id_card_with_X():
    text = "身份证: 11010119900101123X"
    assert "110101****123X" in scrub_pii(text)


def test_scrub_bank_card_16_19_digits():
    text = "银行卡号 6222021234567890123"
    assert "6222021234567890123" not in scrub_pii(text)
    assert "****" in scrub_pii(text)


def test_scrub_phone_middle():
    text = "联系电话 13812345678"
    result = scrub_pii(text)
    assert "13812345678" not in result
    assert "138****5678" in result


def test_scrub_email_preserved():
    text = "邮箱 zhang@example.com"
    assert "zhang@example.com" in scrub_pii(text)


def test_scrub_mixed_content():
    text = """
    张三 | 13812345678 | zhang@x.com
    身份证 110101199001011234
    卡号 6222021234567890123
    """
    result = scrub_pii(text)
    assert "张三" in result
    assert "138****5678" in result
    assert "110101****1234" in result
    assert "6222021234567890123" not in result
    assert "zhang@x.com" in result


def test_scrub_no_false_positive_on_short_numbers():
    """短数字（如年份、项目编号）不应被当作银行卡/身份证"""
    text = "2024 年 GPA 3.8，项目 #12345"
    result = scrub_pii(text)
    assert "2024" in result
    assert "3.8" in result
    assert "12345" in result
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_scrubber.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/scrubber.py`**

```python
import re


_ID_CARD_RE = re.compile(r"(?<!\d)(\d{6})\d{8}(\d{3}[\dXx])(?!\d)")
_BANK_CARD_RE = re.compile(r"(?<!\d)\d{16,19}(?!\d)")
_PHONE_RE = re.compile(r"(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)")


def scrub_pii(text: str) -> str:
    """对原始简历文本做 PII 脱敏，用于喂给 LLM。

    - 身份证（18 位）：保留前 6 位 + 后 4 位
    - 银行卡（16-19 位连续数字）：整段替换为 ****
    - 手机（1X 开头 11 位）：中 4 位替换为 ****
    - 邮箱、姓名、项目中的短数字保持不变
    """
    text = _ID_CARD_RE.sub(r"\1****\2", text)
    text = _BANK_CARD_RE.sub("****", text)
    text = _PHONE_RE.sub(r"\1****\2", text)
    return text
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_scrubber.py -v
```

Expected: 7 passed。

- [ ] **Step 5: 提交**

```bash
git add app/scrubber.py tests/test_scrubber.py
git commit -m "feat: PII 脱敏工具"
```

---

## Task 4: 简历文本抽取

**Files:**
- Create: `app/resume_parser.py`
- Create: `tests/test_resume_parser.py`
- Create: `tests/fixtures/make_fixture.py`（一次性生成脚本）

- [ ] **Step 1: 创建 fixture 生成脚本**

因为真实简历不入库，先生成一份合成简历作为测试 fixture。

```python
# tests/fixtures/make_fixture.py
"""一次性脚本：生成测试用的合成简历 PDF 与 DOCX。"""
from pathlib import Path
from docx import Document
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

HERE = Path(__file__).parent

CONTENT = """张三 | 138 1234 5678 | zhang@example.com
教育背景：清华大学 计算机科学与技术 硕士 2025 届
项目经历：
- 毕业设计：基于 LangChain + Pinecone 的企业知识库 RAG 系统
- Kaggle 大模型评测比赛 Top 10%
实习经历：字节跳动 AI 平台组，3 个月
可实习：6 个月，每周 4 天
身份证 110101199001011234
""".strip()


def make_docx():
    doc = Document()
    for line in CONTENT.split("\n"):
        doc.add_paragraph(line)
    out = HERE / "sample_resume.docx"
    doc.save(out)
    print(f"wrote {out}")


def make_pdf():
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    out = HERE / "sample_resume.pdf"
    c = canvas.Canvas(str(out))
    c.setFont("STSong-Light", 12)
    y = 800
    for line in CONTENT.split("\n"):
        c.drawString(50, y, line)
        y -= 20
    c.save()
    print(f"wrote {out}")


if __name__ == "__main__":
    make_docx()
    make_pdf()
```

- [ ] **Step 2: 安装 reportlab 作为 dev 依赖并生成 fixture**

```bash
pip install reportlab
python tests/fixtures/make_fixture.py
```

Expected: `tests/fixtures/sample_resume.pdf` 和 `sample_resume.docx` 生成。

**注意**：fixture 被 gitignore，但本地存在即可运行测试。CI 需要另行补充（MVP 不涉及 CI）。

- [ ] **Step 3: 写失败测试 `tests/test_resume_parser.py`**

```python
import pytest
from app.resume_parser import extract_text


def test_extract_text_from_pdf(fixtures_dir):
    pdf = fixtures_dir / "sample_resume.pdf"
    if not pdf.exists():
        pytest.skip("fixture 未生成，见 tests/fixtures/make_fixture.py")
    text = extract_text(pdf.read_bytes(), filename="sample_resume.pdf")
    assert "张三" in text
    assert "清华大学" in text
    assert "LangChain" in text


def test_extract_text_from_docx(fixtures_dir):
    docx = fixtures_dir / "sample_resume.docx"
    if not docx.exists():
        pytest.skip("fixture 未生成，见 tests/fixtures/make_fixture.py")
    text = extract_text(docx.read_bytes(), filename="sample_resume.docx")
    assert "张三" in text
    assert "清华大学" in text


def test_extract_text_unsupported_format():
    with pytest.raises(ValueError, match="unsupported"):
        extract_text(b"random", filename="resume.rtf")


def test_extract_text_empty_pdf_raises():
    with pytest.raises(ValueError, match="empty"):
        extract_text(b"", filename="a.pdf")
```

- [ ] **Step 4: 运行测试应失败**

```bash
pytest tests/test_resume_parser.py -v
```

Expected: ImportError。

- [ ] **Step 5: 实现 `app/resume_parser.py`**

```python
import io
from pathlib import PurePath
import pdfplumber
from docx import Document


def extract_text(data: bytes, *, filename: str) -> str:
    """从 PDF/DOC/DOCX 附件字节抽取纯文本。

    支持扩展名: .pdf, .docx, .doc（.doc 不是 OOXML，本函数走 docx 解析失败后直接报错）
    """
    if not data:
        raise ValueError("empty attachment")
    ext = PurePath(filename).suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(data)
    if ext in {".docx"}:
        return _extract_docx(data)
    if ext == ".doc":
        raise ValueError(
            "unsupported legacy .doc format; 请候选人用 PDF 或 .docx 重新投递"
        )
    raise ValueError(f"unsupported file type: {ext}")


def _extract_pdf(data: bytes) -> str:
    parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            parts.append(text)
    return "\n".join(parts).strip()


def _extract_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
```

- [ ] **Step 6: 运行测试应通过**

```bash
pytest tests/test_resume_parser.py -v
```

Expected: 4 passed。

- [ ] **Step 7: 提交**

```bash
git add app/resume_parser.py tests/test_resume_parser.py tests/fixtures/make_fixture.py
git commit -m "feat: 简历文本抽取（PDF/DOCX）"
```

---

## Task 5: Prompt 模板加载

**Files:**
- Create: `prompts/resume_screening.txt`
- Create: `prompts/interview_summary.txt`
- Create: `app/prompts.py`
- Create: `tests/test_prompts.py`

- [ ] **Step 1: 创建 `prompts/resume_screening.txt`**

```
你是联想乐享 AI 团队的招聘助手。请基于以下岗位 JD 严格评估候选人的简历。

# 岗位 JD
{jd_text}

# 评分维度（每项每分必须对应至少一条可验证证据）
1. 硬门槛（bool）：学历 ≥ 本科 AND 可实习时长 ≥ 3 个月 AND 有手机与邮箱
2. AI 经验分（0-10 整数）：AI 工具使用深度、Agent/RAG/知识库经验、大模型评测经验
3. 逻辑表达分（0-10 整数）：简历结构清晰度、STAR、量化结果、语言精炼
4. 项目深度分（0-10 整数）：demo 级 vs 有真实用户/数据；与 AI 产品相关性

# 简历（已脱敏）
{resume_text}

# 输出约定
严格输出 JSON，不要 markdown 代码块包裹。字段定义：

{{
  "name": "姓名",
  "school": "学校",
  "degree": "本科|硕士|博士",
  "major": "专业",
  "grade_or_graduate_date": "年级或预计毕业时间",
  "available_duration": "<3月|3-6月|6月+",
  "phone": "手机号（脱敏后）",
  "email": "邮箱",
  "hard_pass": true/false,
  "ai_exp_score": 0-10,
  "ai_exp_reason": "基于简历原文引用的 1-2 句依据",
  "logic_score": 0-10,
  "logic_reason": "依据",
  "project_score": 0-10,
  "project_reason": "依据",
  "summary": "综合评语 2-3 句，先写亮点再写隐忧"
}}

硬门槛信息缺失时 hard_pass 置 false，summary 中标注"待人工确认"。
评分证据不足时应扣分而非猜测。
```

- [ ] **Step 2: 创建 `prompts/interview_summary.txt`**

```
你是联想乐享 AI 团队的招聘助手。基于以下信息生成一份简短、结构化的面试评估。

# 岗位 JD
{jd_text}

# 简历亮点（LLM 先前生成的评语）
{resume_summary}

# 面试打分（各 1-5 分）
- 技术理解：{tech_score}
- 产品思维：{product_score}
- 学习能力：{learning_score}
- 文化匹配：{culture_score}

# 面试官观察笔记
{observation}

# 输出格式（plain text，非 JSON）
一句话综合判断：
亮点（2-3 条，优先于简历未提到的新信息）：
- ...
隐忧（1-2 条，必须输出，不可省略）：
- ...
推荐结论：强推 / 推荐 / 待定 / 不推
```

- [ ] **Step 3: 写失败测试 `tests/test_prompts.py`**

```python
import pytest
from app.prompts import render_prompt


def test_render_resume_screening():
    p = render_prompt(
        "resume_screening",
        jd_text="JD 内容",
        resume_text="张三，清华大学",
    )
    assert "JD 内容" in p
    assert "张三" in p
    assert "hard_pass" in p


def test_render_interview_summary():
    p = render_prompt(
        "interview_summary",
        jd_text="JD",
        resume_summary="简历摘要",
        tech_score=4,
        product_score=3,
        learning_score=5,
        culture_score=4,
        observation="候选人主动提问",
    )
    assert "候选人主动提问" in p
    assert "技术理解：4" in p


def test_render_unknown_template():
    with pytest.raises(FileNotFoundError):
        render_prompt("nonexistent", foo="bar")


def test_missing_placeholder_raises():
    with pytest.raises(KeyError):
        render_prompt("resume_screening", jd_text="only jd")
```

- [ ] **Step 4: 运行测试应失败**

```bash
pytest tests/test_prompts.py -v
```

Expected: ImportError。

- [ ] **Step 5: 实现 `app/prompts.py`**

```python
from functools import lru_cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


@lru_cache(maxsize=16)
def _load_template(name: str) -> str:
    path = _PROMPTS_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"prompt template not found: {name}")
    return path.read_text(encoding="utf-8")


def render_prompt(name: str, **kwargs) -> str:
    """用关键字参数填充 prompt 模板。

    模板使用 str.format_map 风格的 {placeholder}。缺失的占位符抛 KeyError，
    避免悄悄把 '{foo}' 原样发到 LLM。
    """
    template = _load_template(name)
    # 用 format_map + 严格 dict，缺字段即抛 KeyError
    try:
        return template.format(**kwargs)
    except KeyError as e:
        raise KeyError(f"missing placeholder in prompt {name!r}: {e}") from e
```

- [ ] **Step 6: 运行测试应通过**

```bash
pytest tests/test_prompts.py -v
```

Expected: 4 passed。

**注意**：`resume_screening.txt` 里有 JSON 示例 `{{...}}`，`str.format` 会把双花括号解释成单花括号。测试里 `"hard_pass" in p` 检查通过即正确。

- [ ] **Step 7: 提交**

```bash
git add app/prompts.py prompts/ tests/test_prompts.py
git commit -m "feat: prompt 模板加载"
```

---

## Task 6: LLM 输出数据模型

**Files:**
- Create: `app/models.py`
- Create: `tests/test_models.py`

- [ ] **Step 1: 写失败测试 `tests/test_models.py`**

```python
import pytest
from pydantic import ValidationError
from app.models import LLMResumeScore


def test_valid_llm_resume_score():
    m = LLMResumeScore(
        name="张三",
        school="清华大学",
        degree="硕士",
        major="计算机",
        grade_or_graduate_date="2025 届",
        available_duration="6月+",
        phone="138****5678",
        email="zhang@x.com",
        hard_pass=True,
        ai_exp_score=8,
        ai_exp_reason="毕设做 RAG",
        logic_score=7,
        logic_reason="结构清晰",
        project_score=6,
        project_reason="demo 级",
        summary="亮点...隐忧...",
    )
    assert m.hard_pass
    assert m.ai_exp_score == 8


def test_score_out_of_range():
    with pytest.raises(ValidationError):
        LLMResumeScore(
            name="张三", school="清华", degree="硕士", major="计算机",
            grade_or_graduate_date="2025", available_duration="6月+",
            phone="138****5678", email="a@b.c",
            hard_pass=True,
            ai_exp_score=11,  # 越界
            ai_exp_reason="", logic_score=5, logic_reason="",
            project_score=5, project_reason="", summary="",
        )


def test_degree_enum():
    with pytest.raises(ValidationError):
        LLMResumeScore(
            name="x", school="x", degree="小学",  # 非法
            major="x", grade_or_graduate_date="x",
            available_duration="6月+", phone="x", email="a@b.c",
            hard_pass=True, ai_exp_score=5, ai_exp_reason="",
            logic_score=5, logic_reason="", project_score=5,
            project_reason="", summary="",
        )
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_models.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/models.py`**

```python
from typing import Literal
from pydantic import BaseModel, Field


Degree = Literal["本科", "硕士", "博士"]
Duration = Literal["<3月", "3-6月", "6月+"]


class LLMResumeScore(BaseModel):
    """LLM 对一份简历的结构化输出契约。"""

    name: str
    school: str
    degree: Degree
    major: str
    grade_or_graduate_date: str
    available_duration: Duration
    phone: str
    email: str

    hard_pass: bool
    ai_exp_score: int = Field(ge=0, le=10)
    ai_exp_reason: str
    logic_score: int = Field(ge=0, le=10)
    logic_reason: str
    project_score: int = Field(ge=0, le=10)
    project_reason: str
    summary: str
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_models.py -v
```

Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add app/models.py tests/test_models.py
git commit -m "feat: LLM 输出数据模型"
```

---

## Task 7: LLM 客户端（Dashscope 兼容 OpenAI）

**Files:**
- Create: `app/llm_client.py`
- Create: `tests/test_llm_client.py`

**目的**：封装 Dashscope 调用；解析 JSON 失败重试一次；超时/异常向上抛。

- [ ] **Step 1: 写失败测试 `tests/test_llm_client.py`**

```python
import json
from unittest.mock import MagicMock
import pytest
from app.llm_client import LLMClient, LLMParseError
from app.models import LLMResumeScore


VALID_JSON = {
    "name": "张三", "school": "清华", "degree": "硕士",
    "major": "计算机", "grade_or_graduate_date": "2025",
    "available_duration": "6月+", "phone": "138****5678",
    "email": "a@b.c", "hard_pass": True,
    "ai_exp_score": 8, "ai_exp_reason": "X",
    "logic_score": 7, "logic_reason": "Y",
    "project_score": 6, "project_reason": "Z",
    "summary": "OK",
}


def _make_response(content: str) -> MagicMock:
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = content
    return resp


def test_score_resume_parses_valid_json():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response(
        json.dumps(VALID_JSON, ensure_ascii=False)
    )
    client = LLMClient(openai_client=mock_openai, model="test-model")
    score = client.score_resume(jd_text="jd", resume_text="resume")
    assert isinstance(score, LLMResumeScore)
    assert score.name == "张三"


def test_score_resume_strips_markdown_fences():
    wrapped = f"```json\n{json.dumps(VALID_JSON, ensure_ascii=False)}\n```"
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response(wrapped)
    client = LLMClient(openai_client=mock_openai, model="test-model")
    score = client.score_resume(jd_text="jd", resume_text="r")
    assert score.name == "张三"


def test_score_resume_retries_once_on_bad_json():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.side_effect = [
        _make_response("this is not json"),
        _make_response(json.dumps(VALID_JSON, ensure_ascii=False)),
    ]
    client = LLMClient(openai_client=mock_openai, model="test-model")
    score = client.score_resume(jd_text="jd", resume_text="r")
    assert score.name == "张三"
    assert mock_openai.chat.completions.create.call_count == 2


def test_score_resume_raises_after_second_failure():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response("nope")
    client = LLMClient(openai_client=mock_openai, model="test-model")
    with pytest.raises(LLMParseError):
        client.score_resume(jd_text="jd", resume_text="r")
    assert mock_openai.chat.completions.create.call_count == 2


def test_summarize_interview_returns_text():
    mock_openai = MagicMock()
    mock_openai.chat.completions.create.return_value = _make_response(
        "综合判断：不错\n亮点：\n- A\n隐忧：\n- B\n推荐结论：推荐"
    )
    client = LLMClient(openai_client=mock_openai, model="test-model")
    out = client.summarize_interview(
        jd_text="jd", resume_summary="s",
        tech=4, product=3, learning=5, culture=4,
        observation="主动提问",
    )
    assert "推荐结论：推荐" in out
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_llm_client.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/llm_client.py`**

```python
import json
import re
from typing import Optional
from loguru import logger
from pydantic import ValidationError
from openai import OpenAI
from app.config import get_settings
from app.models import LLMResumeScore
from app.prompts import render_prompt


class LLMParseError(Exception):
    """LLM 输出无法被解析为预期结构。"""


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text).strip()


class LLMClient:
    def __init__(self, openai_client: Optional[OpenAI] = None, model: Optional[str] = None):
        s = get_settings()
        self._client = openai_client or OpenAI(
            api_key=s.dashscope_api_key,
            base_url=s.dashscope_base_url,
        )
        self._model = model or s.dashscope_model

    def score_resume(self, *, jd_text: str, resume_text: str) -> LLMResumeScore:
        prompt = render_prompt(
            "resume_screening", jd_text=jd_text, resume_text=resume_text
        )
        last_err: Optional[Exception] = None
        for attempt in range(2):
            raw = self._chat(prompt)
            try:
                data = json.loads(_strip_fences(raw))
                return LLMResumeScore.model_validate(data)
            except (json.JSONDecodeError, ValidationError) as e:
                last_err = e
                logger.warning(
                    "LLM 响应解析失败 attempt={}: {}", attempt + 1, e
                )
        raise LLMParseError(f"LLM 两次解析均失败: {last_err}")

    def summarize_interview(
        self,
        *,
        jd_text: str,
        resume_summary: str,
        tech: int,
        product: int,
        learning: int,
        culture: int,
        observation: str,
    ) -> str:
        prompt = render_prompt(
            "interview_summary",
            jd_text=jd_text,
            resume_summary=resume_summary,
            tech_score=tech,
            product_score=product,
            learning_score=learning,
            culture_score=culture,
            observation=observation,
        )
        return self._chat(prompt).strip()

    def _chat(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        return resp.choices[0].message.content or ""
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_llm_client.py -v
```

Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add app/llm_client.py tests/test_llm_client.py
git commit -m "feat: LLM 客户端（Dashscope + 重试 + JSON 校验）"
```

---

## Task 8: 飞书 Base 客户端

**Files:**
- Create: `app/lark_client.py`
- Create: `tests/test_lark_client.py`

**目的**：封装飞书 4 类能力 —— Base CRUD、Drive 文件上传、发机器人消息、token 自动刷新。外部 API 用 mock 单测。

- [ ] **Step 1: 写失败测试 `tests/test_lark_client.py`**

```python
from unittest.mock import MagicMock, patch
import pytest
from app.lark_client import LarkClient


@pytest.fixture
def mock_httpx_client():
    """mock httpx.Client 返回预设响应"""
    with patch("app.lark_client.httpx.Client") as cls:
        inst = MagicMock()
        cls.return_value = inst
        yield inst


def _resp(status=200, json_body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = json_body or {"code": 0, "msg": "ok", "data": {}}
    r.raise_for_status = MagicMock()
    return r


def test_get_tenant_token_caches(mock_httpx_client):
    mock_httpx_client.post.return_value = _resp(
        json_body={"code": 0, "tenant_access_token": "t_xxx", "expire": 7200}
    )
    c = LarkClient()
    tok1 = c._get_token()
    tok2 = c._get_token()
    assert tok1 == "t_xxx"
    assert tok2 == "t_xxx"
    assert mock_httpx_client.post.call_count == 1


def test_create_candidate_record(mock_httpx_client):
    mock_httpx_client.post.side_effect = [
        _resp(json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}),
        _resp(json_body={"code": 0, "data": {"record": {"record_id": "rec_123"}}}),
    ]
    c = LarkClient()
    rid = c.create_candidate({"姓名": "张三", "邮箱": "a@b.c"})
    assert rid == "rec_123"


def test_send_alert_message(mock_httpx_client):
    mock_httpx_client.post.side_effect = [
        _resp(json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}),
        _resp(json_body={"code": 0, "data": {"message_id": "om_xxx"}}),
    ]
    c = LarkClient()
    c.send_alert("系统告警：LLM 解析失败 候选人 rec_123")
    # 第二次 POST 是发消息
    assert mock_httpx_client.post.call_count == 2


def test_upload_resume_to_drive(mock_httpx_client):
    mock_httpx_client.post.side_effect = [
        _resp(json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}),
        _resp(json_body={"code": 0, "data": {"file_token": "file_xxx"}}),
    ]
    c = LarkClient()
    tok = c.upload_resume(b"pdf-bytes", filename="resume.pdf")
    assert tok == "file_xxx"


def test_update_candidate_status(mock_httpx_client):
    mock_httpx_client.post.return_value = _resp(
        json_body={"code": 0, "tenant_access_token": "t", "expire": 7200}
    )
    mock_httpx_client.put.return_value = _resp(
        json_body={"code": 0, "data": {}}
    )
    c = LarkClient()
    c.update_candidate("rec_123", {"状态": "LLM解析失败"})
    mock_httpx_client.put.assert_called_once()
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_lark_client.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/lark_client.py`**

```python
import json
import time
from typing import Any, Optional
import httpx
from loguru import logger
from app.config import get_settings


_OPENAPI = "https://open.feishu.cn/open-apis"


class LarkClient:
    """飞书开放平台封装。

    关注 5 个能力：
    - tenant_access_token 的获取与缓存
    - 多维表格 record 创建 / 更新 / 查询
    - 云空间文件上传
    - 群机器人文本消息
    """

    def __init__(self):
        s = get_settings()
        self._app_id = s.lark_app_id
        self._app_secret = s.lark_app_secret
        self._base_app = s.lark_base_app_token
        self._table_candidate = s.lark_table_candidate
        self._table_interview = s.lark_table_interview
        self._table_jd = s.lark_table_jd
        self._folder_token = s.lark_resume_folder_token
        self._alert_chat = s.lark_alert_chat_id
        self._http = httpx.Client(timeout=30.0)
        self._token: Optional[str] = None
        self._token_expire_at: float = 0.0

    # ---------- token ----------
    def _get_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expire_at - 60:
            return self._token
        resp = self._http.post(
            f"{_OPENAPI}/auth/v3/tenant_access_token/internal",
            json={"app_id": self._app_id, "app_secret": self._app_secret},
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"获取 tenant_access_token 失败: {data}")
        self._token = data["tenant_access_token"]
        self._token_expire_at = now + data.get("expire", 7200)
        return self._token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._get_token()}"}

    # ---------- Base ----------
    def create_candidate(self, fields: dict) -> str:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records"
        )
        resp = self._http.post(url, headers=self._headers(), json={"fields": fields})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"create_candidate 失败: {data}")
        return data["data"]["record"]["record_id"]

    def update_candidate(self, record_id: str, fields: dict) -> None:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records/{record_id}"
        )
        resp = self._http.put(url, headers=self._headers(), json={"fields": fields})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"update_candidate 失败: {data}")

    def get_interview(self, record_id: str) -> dict:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_interview}/records/{record_id}"
        )
        resp = self._http.get(url, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"get_interview 失败: {data}")
        return data["data"]["record"]["fields"]

    def update_interview(self, record_id: str, fields: dict) -> None:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_interview}/records/{record_id}"
        )
        resp = self._http.put(url, headers=self._headers(), json={"fields": fields})
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"update_interview 失败: {data}")

    def query_candidate_by_email(self, email: str) -> list[dict]:
        """按邮箱过滤查询候选人记录（用于去重）。"""
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records/search"
        )
        payload = {
            "filter": {
                "conjunction": "and",
                "conditions": [
                    {"field_name": "邮箱", "operator": "is", "value": [email]}
                ],
            }
        }
        resp = self._http.post(url, headers=self._headers(), json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"query 失败: {data}")
        return data.get("data", {}).get("items", [])

    def get_jd_config(self) -> dict:
        """读取表 4 第一条 JD 配置（MVP 单岗位）。"""
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_jd}/records"
        )
        resp = self._http.get(
            url, headers=self._headers(), params={"page_size": 1}
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"get_jd_config 失败: {data}")
        items = data["data"].get("items", [])
        if not items:
            raise RuntimeError("JD 配置表为空，请先在表 4 填一条")
        return items[0]["fields"]

    # ---------- Drive ----------
    def upload_resume(self, data: bytes, *, filename: str) -> str:
        url = f"{_OPENAPI}/drive/v1/medias/upload_all"
        files = {
            "file": (filename, data, "application/octet-stream"),
        }
        form = {
            "file_name": filename,
            "parent_type": "explorer",
            "parent_node": self._folder_token,
            "size": str(len(data)),
        }
        resp = self._http.post(
            url,
            headers=self._headers(),
            data=form,
            files=files,
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("code") != 0:
            raise RuntimeError(f"upload_resume 失败: {body}")
        return body["data"]["file_token"]

    # ---------- Message ----------
    def send_alert(self, text: str) -> None:
        url = f"{_OPENAPI}/im/v1/messages?receive_id_type=chat_id"
        payload = {
            "receive_id": self._alert_chat,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        }
        resp = self._http.post(url, headers=self._headers(), json=payload)
        resp.raise_for_status()
        body = resp.json()
        if body.get("code") != 0:
            logger.error("send_alert 失败 body={}", body)
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_lark_client.py -v
```

Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add app/lark_client.py tests/test_lark_client.py
git commit -m "feat: 飞书开放平台客户端"
```

---

## Task 9: Outlook 客户端

**Files:**
- Create: `app/outlook_client.py`
- Create: `tests/test_outlook_client.py`

**目的**：列出符合标题规则的未读邮件 + 下载附件 + 标记已读。用 Graph SDK 的 mock 化测试。

- [ ] **Step 1: 写失败测试 `tests/test_outlook_client.py`**

```python
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from app.outlook_client import OutlookClient, IncomingEmail


@pytest.fixture
def mock_graph():
    with patch("app.outlook_client.GraphServiceClient") as cls:
        inst = MagicMock()
        cls.return_value = inst
        yield inst


def _mk_msg(subject: str, sender_email: str, has_attachments: bool, mid: str):
    m = MagicMock()
    m.id = mid
    m.subject = subject
    from_addr = MagicMock()
    from_addr.email_address.address = sender_email
    m.from_ = from_addr
    m.has_attachments = has_attachments
    m.received_date_time = None
    return m


async def test_fetch_new_emails_filters_subject(mock_graph):
    msgs = [
        _mk_msg("超级智能体实习申请-张三-清华-6月", "zhang@x.com", True, "m1"),
        _mk_msg("Re: 工作汇报", "bob@x.com", False, "m2"),
    ]
    page = MagicMock()
    page.value = msgs
    mock_graph.users.by_user_id.return_value.messages.get = AsyncMock(
        return_value=page
    )
    client = OutlookClient(graph_client=mock_graph)
    result = await client.fetch_new_emails()
    assert len(result) == 1
    assert result[0].sender == "zhang@x.com"
    assert result[0].subject.startswith("超级智能体实习申请")


async def test_fetch_skips_no_attachment(mock_graph):
    msgs = [_mk_msg("超级智能体实习申请-李四", "li@x.com", False, "m3")]
    page = MagicMock()
    page.value = msgs
    mock_graph.users.by_user_id.return_value.messages.get = AsyncMock(
        return_value=page
    )
    client = OutlookClient(graph_client=mock_graph)
    result = await client.fetch_new_emails()
    assert result == []
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_outlook_client.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/outlook_client.py`**

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from loguru import logger
from azure.identity import ClientSecretCredential
from msgraph import GraphServiceClient
from app.config import get_settings


_SUBJECT_PREFIX = "超级智能体实习申请"


@dataclass
class EmailAttachment:
    filename: str
    content: bytes


@dataclass
class IncomingEmail:
    message_id: str
    subject: str
    sender: str
    received_at: Optional[datetime]
    attachments: list[EmailAttachment]


class OutlookClient:
    def __init__(self, graph_client: Optional[GraphServiceClient] = None):
        s = get_settings()
        self._user = s.ms_user_email
        if graph_client is not None:
            self._graph = graph_client
        else:
            creds = ClientSecretCredential(
                tenant_id=s.ms_tenant_id,
                client_id=s.ms_client_id,
                client_secret=s.ms_client_secret,
            )
            self._graph = GraphServiceClient(
                credentials=creds,
                scopes=["https://graph.microsoft.com/.default"],
            )

    async def fetch_new_emails(self, limit: int = 50) -> list[IncomingEmail]:
        """拉取未读、标题以 {_SUBJECT_PREFIX} 开头、含附件的邮件（不含附件字节）。"""
        user_req = self._graph.users.by_user_id(self._user)
        page = await user_req.messages.get()
        msgs = (page.value or [])[:limit]
        result: list[IncomingEmail] = []
        for m in msgs:
            subject = (m.subject or "").strip()
            if not subject.startswith(_SUBJECT_PREFIX):
                continue
            if not m.has_attachments:
                continue
            sender = ""
            try:
                sender = m.from_.email_address.address or ""
            except AttributeError:
                pass
            result.append(
                IncomingEmail(
                    message_id=m.id,
                    subject=subject,
                    sender=sender,
                    received_at=m.received_date_time,
                    attachments=[],  # 懒加载，见 download_attachments
                )
            )
        return result

    async def download_attachments(self, message_id: str) -> list[EmailAttachment]:
        user_req = self._graph.users.by_user_id(self._user)
        page = await user_req.messages.by_message_id(message_id).attachments.get()
        items = page.value or []
        out: list[EmailAttachment] = []
        for a in items:
            name = getattr(a, "name", "") or ""
            content = getattr(a, "content_bytes", None)
            if content is None:
                logger.warning("附件无内容 mid={} name={}", message_id, name)
                continue
            out.append(EmailAttachment(filename=name, content=content))
        return out

    async def mark_read(self, message_id: str) -> None:
        from msgraph.generated.models.message import Message
        patch = Message(is_read=True)
        await (
            self._graph.users.by_user_id(self._user)
            .messages.by_message_id(message_id)
            .patch(patch)
        )
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_outlook_client.py -v
```

Expected: 2 passed。

**说明**：msgraph-sdk 的响应结构随版本变化，上面的 mock 基于 1.x。真实 API 调用时，如果字段路径不一致，在真机 smoke 阶段再细调。

- [ ] **Step 5: 提交**

```bash
git add app/outlook_client.py tests/test_outlook_client.py
git commit -m "feat: Outlook Graph API 客户端"
```

---

## Task 10: 流程 A 编排 —— 邮件到 Base

**Files:**
- Create: `app/flow_resume.py`
- Create: `tests/test_flow_resume.py`

**目的**：串起 Outlook 拉邮件 → 解析 → 脱敏 → LLM → 写 Base。用 mock 组件单测整条流程的决策分支。

- [ ] **Step 1: 写失败测试 `tests/test_flow_resume.py`**

```python
import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock
import pytest
from app.flow_resume import process_new_resumes
from app.models import LLMResumeScore
from app.outlook_client import EmailAttachment, IncomingEmail


def _make_score(hard_pass: bool = True, ai=8, logic=7, project=6) -> LLMResumeScore:
    return LLMResumeScore(
        name="张三", school="清华", degree="硕士", major="计算机",
        grade_or_graduate_date="2025", available_duration="6月+",
        phone="138****5678", email="z@x.com",
        hard_pass=hard_pass,
        ai_exp_score=ai, ai_exp_reason="r1",
        logic_score=logic, logic_reason="r2",
        project_score=project, project_reason="r3",
        summary="ok",
    )


def _mock_email(mid="m1", sender="z@x.com") -> IncomingEmail:
    return IncomingEmail(
        message_id=mid, subject="超级智能体实习申请-张三",
        sender=sender, received_at=datetime(2026, 5, 7, 10),
        attachments=[],
    )


@pytest.mark.asyncio
async def test_process_happy_path():
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock(return_value=[
        EmailAttachment(filename="resume.pdf", content=b"fakepdf"),
    ])
    outlook.mark_read = AsyncMock()

    lark = MagicMock()
    lark.query_candidate_by_email.return_value = []
    lark.get_jd_config.return_value = {"JD原文": "jd..."}
    lark.upload_resume.return_value = "filetoken"
    lark.create_candidate.return_value = "rec_1"

    llm = MagicMock()
    llm.score_resume.return_value = _make_score()

    parser = MagicMock(return_value="张三 138 1234 5678 身份证 110101199001011234")
    scrubber = MagicMock(return_value="张三 138****5678 身份证 110101****1234")

    stats = await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=parser, scrub=scrubber,
    )

    assert stats["processed"] == 1
    assert stats["skipped_duplicate"] == 0
    assert stats["failed"] == 0
    lark.create_candidate.assert_called_once()
    created_fields = lark.create_candidate.call_args[0][0]
    assert created_fields["状态"] == "待人工初筛"
    assert created_fields["硬门槛通过"] is True
    outlook.mark_read.assert_awaited_once_with("m1")


@pytest.mark.asyncio
async def test_hard_fail_writes_rejected():
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock(return_value=[
        EmailAttachment(filename="r.pdf", content=b"x"),
    ])
    outlook.mark_read = AsyncMock()
    lark = MagicMock()
    lark.query_candidate_by_email.return_value = []
    lark.get_jd_config.return_value = {"JD原文": "jd"}
    lark.upload_resume.return_value = "ft"
    lark.create_candidate.return_value = "rec_2"
    llm = MagicMock()
    llm.score_resume.return_value = _make_score(hard_pass=False)

    await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=MagicMock(return_value="t"),
        scrub=MagicMock(return_value="t"),
    )
    fields = lark.create_candidate.call_args[0][0]
    assert fields["状态"] == "已婉拒"


@pytest.mark.asyncio
async def test_duplicate_email_skipped():
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock()
    outlook.mark_read = AsyncMock()
    lark = MagicMock()
    lark.query_candidate_by_email.return_value = [{"record_id": "existing"}]
    llm = MagicMock()

    stats = await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=MagicMock(), scrub=MagicMock(),
    )
    assert stats["skipped_duplicate"] == 1
    lark.create_candidate.assert_not_called()
    outlook.mark_read.assert_awaited_once()  # 仍标记已读避免反复


@pytest.mark.asyncio
async def test_llm_failure_creates_error_record_and_alerts():
    from app.llm_client import LLMParseError
    outlook = MagicMock()
    outlook.fetch_new_emails = AsyncMock(return_value=[_mock_email()])
    outlook.download_attachments = AsyncMock(return_value=[
        EmailAttachment(filename="r.pdf", content=b"x"),
    ])
    outlook.mark_read = AsyncMock()
    lark = MagicMock()
    lark.query_candidate_by_email.return_value = []
    lark.get_jd_config.return_value = {"JD原文": "jd"}
    lark.upload_resume.return_value = "ft"
    lark.create_candidate.return_value = "rec_err"
    llm = MagicMock()
    llm.score_resume.side_effect = LLMParseError("bad json")

    stats = await process_new_resumes(
        outlook=outlook, lark=lark, llm=llm,
        extract_text=MagicMock(return_value="t"),
        scrub=MagicMock(return_value="t"),
    )
    assert stats["failed"] == 1
    lark.send_alert.assert_called()
    fields = lark.create_candidate.call_args[0][0]
    assert fields["状态"] == "LLM解析失败"
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_flow_resume.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/flow_resume.py`**

```python
from typing import Callable
from loguru import logger
from app.llm_client import LLMClient, LLMParseError
from app.lark_client import LarkClient
from app.outlook_client import OutlookClient, IncomingEmail
from app.resume_parser import extract_text as default_extract
from app.scrubber import scrub_pii as default_scrub
from app.models import LLMResumeScore


STATUS_REVIEW = "待人工初筛"
STATUS_REJECT = "已婉拒"
STATUS_ERROR = "LLM解析失败"


async def process_new_resumes(
    *,
    outlook: OutlookClient,
    lark: LarkClient,
    llm: LLMClient,
    extract_text: Callable[..., str] = None,
    scrub: Callable[[str], str] = None,
) -> dict:
    """流程 A 主入口。"""
    extract_text = extract_text or default_extract
    scrub = scrub or default_scrub

    stats = {"processed": 0, "skipped_duplicate": 0, "failed": 0}
    emails = await outlook.fetch_new_emails()
    if not emails:
        return stats

    jd_config = lark.get_jd_config()
    jd_text = jd_config.get("JD原文", "")

    for email in emails:
        try:
            await _handle_one(
                email=email, outlook=outlook, lark=lark, llm=llm,
                extract_text=extract_text, scrub=scrub, jd_text=jd_text,
                stats=stats,
            )
        except Exception as e:  # noqa: BLE001 — 邮件级隔离
            logger.exception("处理邮件异常 mid={}", email.message_id)
            stats["failed"] += 1
            try:
                lark.send_alert(
                    f"流程A异常 mid={email.message_id} sender={email.sender} err={e}"
                )
            except Exception:
                logger.exception("send_alert 自身失败")
    return stats


async def _handle_one(
    *, email: IncomingEmail, outlook, lark, llm, extract_text, scrub, jd_text, stats,
):
    # 1) 去重
    existing = lark.query_candidate_by_email(email.sender)
    if existing:
        logger.info("重复投递，跳过 sender={} existing={}", email.sender, existing)
        stats["skipped_duplicate"] += 1
        await outlook.mark_read(email.message_id)
        return

    # 2) 下附件
    attachments = await outlook.download_attachments(email.message_id)
    if not attachments:
        logger.warning("邮件无附件 mid={}", email.message_id)
        stats["failed"] += 1
        await outlook.mark_read(email.message_id)
        return

    # 取第一份可解析的附件
    att = attachments[0]

    # 3) 上传原件到飞书云空间
    file_token = lark.upload_resume(att.content, filename=att.filename)

    # 4) 抽文本 + 脱敏
    try:
        raw_text = extract_text(att.content, filename=att.filename)
    except ValueError as e:
        logger.warning("附件格式不支持 mid={} err={}", email.message_id, e)
        lark.create_candidate({
            "邮箱": email.sender,
            "简历附件": [{"file_token": file_token}],
            "投递时间": _to_epoch_ms(email.received_at),
            "状态": STATUS_ERROR,
            "LLM评语": f"附件格式不支持: {e}",
        })
        stats["failed"] += 1
        await outlook.mark_read(email.message_id)
        return

    clean_text = scrub(raw_text)

    # 5) LLM 评分
    try:
        score: LLMResumeScore = llm.score_resume(jd_text=jd_text, resume_text=clean_text)
    except LLMParseError as e:
        logger.warning("LLM 两次失败 mid={}", email.message_id)
        lark.create_candidate({
            "邮箱": email.sender,
            "简历附件": [{"file_token": file_token}],
            "投递时间": _to_epoch_ms(email.received_at),
            "状态": STATUS_ERROR,
            "LLM评语": f"LLM 解析失败: {e}",
        })
        lark.send_alert(f"LLM解析失败 mid={email.message_id} sender={email.sender}")
        stats["failed"] += 1
        await outlook.mark_read(email.message_id)
        return

    # 6) 写入候选人主表
    status = STATUS_REVIEW if score.hard_pass else STATUS_REJECT
    lark.create_candidate({
        "姓名": score.name,
        "学校": score.school,
        "学历": score.degree,
        "专业": score.major,
        "年级/毕业时间": score.grade_or_graduate_date,
        "可实习时长": score.available_duration,
        "手机": score.phone,
        "邮箱": email.sender,
        "简历附件": [{"file_token": file_token}],
        "投递时间": _to_epoch_ms(email.received_at),
        "硬门槛通过": score.hard_pass,
        "AI经验分": score.ai_exp_score,
        "逻辑表达分": score.logic_score,
        "项目深度分": score.project_score,
        "LLM评语": _render_summary(score),
        "状态": status,
    })
    stats["processed"] += 1
    await outlook.mark_read(email.message_id)


def _render_summary(s: LLMResumeScore) -> str:
    return (
        f"{s.summary}\n\n"
        f"[AI经验 {s.ai_exp_score}] {s.ai_exp_reason}\n"
        f"[逻辑表达 {s.logic_score}] {s.logic_reason}\n"
        f"[项目深度 {s.project_score}] {s.project_reason}"
    )


def _to_epoch_ms(dt) -> int | None:
    if dt is None:
        return None
    # msgraph 返回 datetime-aware，统一转毫秒
    return int(dt.timestamp() * 1000)
```

- [ ] **Step 4: 运行测试应通过**

```bash
pytest tests/test_flow_resume.py -v
```

Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add app/flow_resume.py tests/test_flow_resume.py
git commit -m "feat: 流程 A 编排（邮件 → LLM → Base）"
```

---

## Task 11: 流程 C 编排 —— 面试小结生成

**Files:**
- Create: `app/flow_interview.py`
- Create: `tests/test_flow_interview.py`

- [ ] **Step 1: 写失败测试 `tests/test_flow_interview.py`**

```python
from unittest.mock import MagicMock
from app.flow_interview import generate_interview_summary


def test_happy_path():
    lark = MagicMock()
    lark.get_interview.return_value = {
        "候选人": [{"text": "张三", "record_ids": ["rec_cand_1"]}],
        "技术理解分": 4, "产品思维分": 3, "学习能力分": 5, "文化匹配分": 4,
        "关键观察": "主动提问",
    }
    # 候选人主表记录
    lark._http = MagicMock()  # 不重要，被下面 query 覆盖
    lark.get_candidate = MagicMock(return_value={"LLM评语": "简历摘要..."})
    lark.get_jd_config.return_value = {"JD原文": "jd..."}
    llm = MagicMock()
    llm.summarize_interview.return_value = (
        "综合判断：值得推荐\n亮点:\n- 主动\n隐忧:\n- demo\n推荐结论：推荐"
    )
    out = generate_interview_summary(
        interview_record_id="rec_int_1", lark=lark, llm=llm,
    )
    assert "综合判断" in out
    lark.update_interview.assert_called_once()
    update_args = lark.update_interview.call_args[0]
    assert update_args[0] == "rec_int_1"
    assert "LLM面试小结" in update_args[1]


def test_missing_scores_raises():
    import pytest
    lark = MagicMock()
    lark.get_interview.return_value = {
        "候选人": [{"text": "张三", "record_ids": ["rec_cand_1"]}],
        "关键观察": "x",
    }
    with pytest.raises(ValueError, match="分数未填"):
        generate_interview_summary(
            interview_record_id="rec_int_1", lark=lark, llm=MagicMock(),
        )
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_flow_interview.py -v
```

Expected: ImportError。

- [ ] **Step 3: 先给 `LarkClient` 添加 `get_candidate` 方法**

修改 `app/lark_client.py` 在 `update_candidate` 后追加：

```python
    def get_candidate(self, record_id: str) -> dict:
        url = (
            f"{_OPENAPI}/bitable/v1/apps/{self._base_app}"
            f"/tables/{self._table_candidate}/records/{record_id}"
        )
        resp = self._http.get(url, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"get_candidate 失败: {data}")
        return data["data"]["record"]["fields"]
```

- [ ] **Step 4: 实现 `app/flow_interview.py`**

```python
from loguru import logger
from app.llm_client import LLMClient
from app.lark_client import LarkClient


_REQUIRED_SCORES = ["技术理解分", "产品思维分", "学习能力分", "文化匹配分"]


def generate_interview_summary(
    *, interview_record_id: str, lark: LarkClient, llm: LLMClient,
) -> str:
    fields = lark.get_interview(interview_record_id)

    missing = [k for k in _REQUIRED_SCORES if fields.get(k) in (None, "")]
    if missing:
        raise ValueError(f"分数未填: {missing}")

    candidate_link = fields.get("候选人", [])
    candidate_id = None
    if candidate_link and isinstance(candidate_link, list):
        first = candidate_link[0]
        rids = first.get("record_ids") if isinstance(first, dict) else None
        if rids:
            candidate_id = rids[0]

    resume_summary = ""
    if candidate_id:
        cand = lark.get_candidate(candidate_id)
        resume_summary = cand.get("LLM评语", "")

    jd = lark.get_jd_config().get("JD原文", "")

    out = llm.summarize_interview(
        jd_text=jd,
        resume_summary=resume_summary,
        tech=int(fields["技术理解分"]),
        product=int(fields["产品思维分"]),
        learning=int(fields["学习能力分"]),
        culture=int(fields["文化匹配分"]),
        observation=fields.get("关键观察", ""),
    )
    lark.update_interview(interview_record_id, {"LLM面试小结": out})
    logger.info("面试小结已写回 interview_id={}", interview_record_id)
    return out
```

- [ ] **Step 5: 运行测试应通过**

```bash
pytest tests/test_flow_interview.py tests/test_lark_client.py -v
```

Expected: 2 passed (新) + 5 passed (lark 原有)。

- [ ] **Step 6: 提交**

```bash
git add app/flow_interview.py app/lark_client.py tests/test_flow_interview.py
git commit -m "feat: 流程 C 编排（面试打分 → LLM 小结）"
```

---

## Task 12: FastAPI 入口 + 调度器

**Files:**
- Create: `app/webhook_server.py`
- Create: `app/scheduler.py`
- Create: `tests/test_webhook_server.py`

**目的**：单进程跑 FastAPI（暴露 webhook）+ APScheduler（定时跑流程 A）。飞书 Base 自动化把"面试已完成"状态变化通过 webhook 通知到本服务，触发流程 C。

- [ ] **Step 1: 写失败测试 `tests/test_webhook_server.py`**

```python
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


def test_health_endpoint():
    from app.webhook_server import app
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_interview_webhook_triggers_summary():
    with patch("app.webhook_server.generate_interview_summary") as mock_gen, \
         patch("app.webhook_server.LarkClient") as mock_lark_cls, \
         patch("app.webhook_server.LLMClient") as mock_llm_cls:
        mock_gen.return_value = "summary text"
        from app.webhook_server import app
        client = TestClient(app)
        r = client.post(
            "/webhook/interview-complete",
            json={"interview_record_id": "rec_int_1"},
        )
        assert r.status_code == 200
        mock_gen.assert_called_once()
        kwargs = mock_gen.call_args.kwargs
        assert kwargs["interview_record_id"] == "rec_int_1"


def test_interview_webhook_bad_payload():
    from app.webhook_server import app
    client = TestClient(app)
    r = client.post("/webhook/interview-complete", json={})
    assert r.status_code == 422
```

- [ ] **Step 2: 运行测试应失败**

```bash
pytest tests/test_webhook_server.py -v
```

Expected: ImportError。

- [ ] **Step 3: 实现 `app/scheduler.py`**

```python
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from loguru import logger
from app.config import get_settings
from app.flow_resume import process_new_resumes
from app.llm_client import LLMClient
from app.lark_client import LarkClient
from app.outlook_client import OutlookClient


def build_scheduler() -> AsyncIOScheduler:
    s = get_settings()
    sched = AsyncIOScheduler()
    sched.add_job(
        run_flow_resume,
        trigger="interval",
        minutes=s.resume_poll_interval_minutes,
        id="flow_resume",
        next_run_time=None,  # 启动不立即跑，手动/定时触发
        max_instances=1,
        coalesce=True,
    )
    return sched


async def run_flow_resume() -> None:
    outlook = OutlookClient()
    lark = LarkClient()
    llm = LLMClient()
    logger.info("开始执行流程 A")
    try:
        stats = await process_new_resumes(outlook=outlook, lark=lark, llm=llm)
        logger.info("流程 A 完成 stats={}", stats)
    except Exception as e:
        logger.exception("流程 A 整体失败")
        try:
            lark.send_alert(f"流程A整体失败: {e}")
        except Exception:
            logger.exception("告警失败")
```

- [ ] **Step 4: 实现 `app/webhook_server.py`**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from loguru import logger
from pydantic import BaseModel
from app.flow_interview import generate_interview_summary
from app.lark_client import LarkClient
from app.llm_client import LLMClient
from app.scheduler import build_scheduler, run_flow_resume


class InterviewWebhookPayload(BaseModel):
    interview_record_id: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched = build_scheduler()
    sched.start()
    app.state.scheduler = sched
    logger.info("scheduler started")
    yield
    sched.shutdown(wait=False)
    logger.info("scheduler stopped")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/webhook/interview-complete")
async def on_interview_complete(payload: InterviewWebhookPayload):
    try:
        summary = generate_interview_summary(
            interview_record_id=payload.interview_record_id,
            lark=LarkClient(),
            llm=LLMClient(),
        )
        return {"status": "ok", "summary_preview": summary[:100]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("interview webhook 失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/run-flow-resume")
async def trigger_flow_resume():
    """手动触发流程 A（用于调试，生产可移除）。"""
    await run_flow_resume()
    return {"status": "triggered"}
```

- [ ] **Step 5: 运行测试应通过**

```bash
pytest tests/test_webhook_server.py -v
```

Expected: 3 passed。

- [ ] **Step 6: 验证服务可启动**

```bash
uvicorn app.webhook_server:app --port 8080 --reload
# 另起终端
curl http://localhost:8080/health
# 预期: {"status":"ok"}
```

Expected: `{"status":"ok"}`。停掉服务（Ctrl-C）。

- [ ] **Step 7: 提交**

```bash
git add app/scheduler.py app/webhook_server.py tests/test_webhook_server.py
git commit -m "feat: FastAPI 入口 + APScheduler"
```

---

## Task 13: 飞书 Base 建表指引文档

**Files:**
- Create: `docs/base_setup.md`

- [ ] **Step 1: 创建指引文档**

完整写明 4 张表的字段、类型、选项值、公式；以及自动化触发器配置。

```markdown
# 飞书多维表格建表指引

打开飞书创建一个新的多维表格，记下 `app_token`（URL 中 `/base/` 后一段），填到 `.env` 的 `LARK_BASE_APP_TOKEN`。

## 表 1：候选人（`LARK_TABLE_CANDIDATE`）

| 字段名 | 类型 | 选项/公式 |
|---|---|---|
| 姓名 | 文本 | 主字段 |
| 学校 | 文本 | |
| 学历 | 单选 | 本科/硕士/博士 |
| 专业 | 文本 | |
| 年级/毕业时间 | 文本 | |
| 可实习时长 | 单选 | <3月 / 3-6月 / 6月+ |
| 手机 | 电话 | |
| 邮箱 | 邮箱 | |
| 简历附件 | 附件 | |
| 投递时间 | 日期 | |
| JD岗位 | 双向关联→表4 | |
| 硬门槛通过 | 复选框 | |
| AI经验分 | 数字 | 整数 |
| 逻辑表达分 | 数字 | 整数 |
| 项目深度分 | 数字 | 整数 |
| 综合分 | 公式 | `[AI经验分]*0.4 + [项目深度分]*0.3 + [逻辑表达分]*0.2 + IF([硬门槛通过], 1, 0)` |
| LLM评语 | 多行文本 | |
| 状态 | 单选 | 新投递 / LLM评分中 / 待人工初筛 / 已发问卷 / 问卷已回 / 已约面试 / 面试已完成 / 待决策 / 已通过 / 已发Offer / 已婉拒 / 已流失 / LLM解析失败 |
| 预约面试时间 | 日期时间 | V2 使用 |
| 终轮结果 | 单选 | 通过 / 婉拒 / 待定 |
| 备注 | 多行文本 | |

主字段记得改为 `姓名`。

## 表 2：面试记录（`LARK_TABLE_INTERVIEW`）

| 字段名 | 类型 | 选项 |
|---|---|---|
| 候选人 | 双向关联→表1 | |
| 面试时间 | 日期时间 | |
| 面试官 | 人员 | |
| 技术理解分 | 数字 | 1-5 |
| 产品思维分 | 数字 | 1-5 |
| 学习能力分 | 数字 | 1-5 |
| 文化匹配分 | 数字 | 1-5 |
| 关键观察 | 多行文本 | |
| LLM面试小结 | 多行文本 | |
| 推荐结论 | 单选 | 强推 / 推荐 / 待定 / 不推 |

## 表 3：面试时段池（`LARK_TABLE_SLOT`，V2 启用）

MVP 阶段可先建空表。

## 表 4：JD 岗位配置（`LARK_TABLE_JD`）

MVP 只放一行。

| 字段名 | 类型 | 内容 |
|---|---|---|
| 岗位名 | 文本（主字段） | 联想智能体AI产品经理 |
| JD原文 | 多行文本 | 粘贴完整 JD |
| Prompt简历 | 多行文本 | （可选）自定义覆盖默认 prompt |
| Prompt面试 | 多行文本 | （可选）同上 |
| 面试邀请邮件 | 多行文本 | 邮件模板（MVP 手动发用） |
| Offer邮件 | 多行文本 | 邮件模板 |
| 入职指引链接 | URL | https://lenovoleai.feishu.cn/wiki/NIQHwkH09iuYANk2fEGcV1ZUnwe |

记录下每张表的 `table_id`（URL 中 `tbl` 开头段），填到 `.env` 对应字段。

## 自动化规则（飞书 Base → 自动化流程）

### 规则 1：面试完成后触发 LLM 小结

- 触发：表 2 任一字段"技术理解分/产品思维分/学习能力分/文化匹配分"更新
- 条件：四个分数均不为空
- 动作：HTTP 请求
  - Method: POST
  - URL: `https://<你的暴露域名>/webhook/interview-complete`
  - Body:
    ```json
    {"interview_record_id": "{{当前记录ID}}"}
    ```

## 云空间准备

在飞书云空间建一个"简历"文件夹，URL 中 `folder/` 后一段就是 `LARK_RESUME_FOLDER_TOKEN`。

## 告警群

拉一个群（或单聊），加上飞书应用 bot，群 ID（URL 中 `oc_xxx`）填到 `LARK_ALERT_CHAT_ID`。
```

- [ ] **Step 2: 提交**

```bash
git add docs/base_setup.md
git commit -m "docs: 飞书多维表格建表指引"
```

---

## Task 14: README + 运行指南

**Files:**
- Create: `README.md`

- [ ] **Step 1: 创建 README**

```markdown
# 乐享 AI 实习生招聘自动化（MVP）

## 能做什么

- 每 15 分钟自动拉取 `chenbk1@lenovo.com` 未读邮件（标题以"超级智能体实习申请"开头）
- 下载简历附件到飞书云空间
- 用 LLM 做四维度评分，写入飞书多维表格「候选人」表
- 面试后你在「面试记录」表填四项打分，自动触发 LLM 生成面试小结
- 异常通过飞书机器人告警

## 快速开始

### 1. 准备

- Python 3.11+
- 飞书开放平台自建应用（拿到 App ID / Secret）
- Microsoft Azure AD 应用注册（Graph API 权限，参见 spec 2.1）
- Dashscope API Key

### 2. 安装

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# 编辑 .env 填入真实 key
```

### 3. 建飞书表

见 [docs/base_setup.md](docs/base_setup.md)。

### 4. 生成测试 fixture（可选，用于本地跑测试）

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

需要把 8080 端口暴露给飞书 Base 自动化（ngrok、frp 或联想内部反向代理）。

### 7. 手动触发一次流程 A 验证

```bash
curl -X POST http://localhost:8080/admin/run-flow-resume
```

## 目录

- `app/` — 应用代码
- `prompts/` — LLM prompt 模板
- `tests/` — 单测
- `docs/` — spec + 建表指引
- `docs/superpowers/specs/` — 设计文档
- `docs/superpowers/plans/` — 实现计划（本文件）

## 后续规划

- V2: 自动问卷 + 时段预约（见 spec 8.2）
- V3: 日历动态读取 + Offer 流（见 spec 8.3）
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: README 与运行指南"
```

---

## Task 15: 全量测试 + 冒烟验证

**Files:**
- 无新增，运行已有测试

- [ ] **Step 1: 跑全量单测**

```bash
pytest -v
```

Expected: 所有 test 通过，总数约 25-30 个。

- [ ] **Step 2: 启动服务 + 健康检查**

```bash
# 终端 1
uvicorn app.webhook_server:app --port 8080

# 终端 2
curl http://localhost:8080/health
# 预期 {"status":"ok"}

curl -X POST http://localhost:8080/webhook/interview-complete \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期 422 unprocessable entity
```

Expected: 服务启动无 import 错误；health 通；webhook 参数校验生效。

- [ ] **Step 3: 手动冒烟 —— 流程 A（需要配置好真实 `.env`）**

```bash
curl -X POST http://localhost:8080/admin/run-flow-resume
# 观察 logs：若无新邮件返回 stats={'processed':0,...}
```

Expected: 无异常、stats 日志输出。如果能用测试邮箱发一封"超级智能体实习申请-test"且带 PDF 附件的邮件，预期流程走通，飞书 Base 能看到一条新记录。

- [ ] **Step 4: 手动冒烟 —— 流程 C**

在飞书 Base 表 2 手填一条记录的四项打分，保存后自动化触发 webhook。预期：
- LLM 面试小结字段几秒内被填充
- `uvicorn` 日志显示调用轨迹

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: MVP 冒烟验证通过" --allow-empty
```

---

## 交付检查清单

MVP 交付前确认：

- [ ] `.env` 中所有密钥已填（Dashscope、MS Graph、飞书 App/Base）
- [ ] 飞书 4 张表按 `docs/base_setup.md` 建成，字段名大小写完全一致
- [ ] 表 4 已录入至少一条 JD 配置
- [ ] 飞书云空间"简历"文件夹已建，token 填入 `.env`
- [ ] 告警群已建、bot 已加、chat_id 填入 `.env`
- [ ] 飞书 Base 自动化规则 1 指向 webhook URL
- [ ] `pytest -v` 全绿
- [ ] 服务以 `uvicorn` 启动 + ngrok 或等价反向代理暴露 8080
- [ ] Scheduler 在后台按 15 分钟间隔执行可见日志
- [ ] 至少一封真实实习申请邮件走通全流程
