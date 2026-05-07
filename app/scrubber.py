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
