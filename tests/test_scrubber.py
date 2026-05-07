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
