# -*- coding: utf-8 -*-
"""preference_capture.detect_standing_preference 的確定性單元測試。

純函式、離線——不依賴 DB/LLM/PCC。涵蓋使用者原始例子「不要新北以外的」、
台/臺 正規化、only vs exclude 不可混淆、以及不該誤判的中性句。
"""
from __future__ import annotations

import pytest

from app.services.preference_capture import detect_standing_preference


@pytest.mark.parametrize(
    "text,value",
    [
        ("不要新北以外的", "新北"),
        ("不要新北以外的標案", "新北"),
        ("新北以外的都不要", "新北"),
        ("新北以外不接", "新北"),
        ("只要新北", "新北"),
        ("只看台北", "台北"),
        ("僅考慮高雄", "高雄"),
        ("只接桃園的案子", "桃園"),
    ],
)
def test_only_region(text: str, value: str) -> None:
    pref = detect_standing_preference(text)
    assert pref is not None
    assert pref.kind == "region"
    assert pref.op == "only"
    assert pref.value == value


@pytest.mark.parametrize(
    "text,value",
    [
        ("不要桃園", "桃園"),
        ("不接台中的案", "台中"),
        ("排除高雄", "高雄"),
        ("避開花蓮", "花蓮"),
        ("別推屏東", "屏東"),
    ],
)
def test_exclude_region(text: str, value: str) -> None:
    pref = detect_standing_preference(text)
    assert pref is not None
    assert pref.kind == "region"
    assert pref.op == "exclude"
    assert pref.value == value


def test_taiwan_char_normalized() -> None:
    """臺北 應正規化為 台北。"""
    pref = detect_standing_preference("只要臺北")
    assert pref is not None
    assert pref.value == "台北"


def test_only_takes_priority_over_exclude() -> None:
    """『不要新北以外』語意是『只要新北』，不可誤判為排除新北。"""
    pref = detect_standing_preference("不要新北以外的")
    assert pref is not None
    assert pref.op == "only"
    assert pref.value == "新北"


@pytest.mark.parametrize(
    "text",
    [
        "",
        None,
        "今天有哪些高潛力標案？",
        "幫我找與空調汰換相似的案",
        "這案值得投嗎？",
        "標案分級的標準是什麼？",
    ],
)
def test_neutral_returns_none(text: str | None) -> None:
    assert detect_standing_preference(text) is None
