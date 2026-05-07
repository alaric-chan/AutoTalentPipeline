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
