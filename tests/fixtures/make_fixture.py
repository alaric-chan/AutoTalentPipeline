"""一次性脚本：生成测试用的合成简历 PDF 与 DOCX。"""
from pathlib import Path

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
    from docx import Document
    doc = Document()
    for line in CONTENT.split("\n"):
        doc.add_paragraph(line)
    out = HERE / "sample_resume.docx"
    doc.save(out)
    print(f"wrote {out}")


def make_pdf():
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
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
