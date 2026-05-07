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
    try:
        return template.format(**kwargs)
    except KeyError as e:
        raise KeyError(f"missing placeholder in prompt {name!r}: {e}") from e
