import io
from pathlib import PurePath
from typing import Optional
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
    if ext == ".docx":
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
