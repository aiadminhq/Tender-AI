# -*- coding: utf-8 -*-
"""對話中「長期條件」的確定性擷取（不靠 LLM、可離線/CI 驗證）。

用途：使用者在對話裡講出一個「之後也成立」的篩選傾向（最典型：地區），
就把它辨識出來、正規化成結構化建議，交給上層做「確認後才記」
（confirm-to-remember）。

界線（對齊 CLAUDE.md AI 大腦鐵則）：
- 偵測到 ≠ 寫入。本模組只回傳「建議」；唯有使用者按下確認，前端才會 POST
  一筆具名的 Layer B Event（``type="state_preference"``）。
- 本模組「絕不」自行種任何評分權重。負向偏好只會以「訊號/樣本」累積，
  讓 ``learn_keywords`` 由真實 lift 自然推導（不得手種負分）。

設計取捨：**高精準優先**——false positive 會讓確認 chip 亂跳、侵蝕信任。
第一版只認「地區」（使用者的原始例子「不要新北以外的」），其餘 kind 之後擴充。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# 台灣常見行政區地區名（縣市層級）。台/臺 兩種寫法都收，輸出統一正規化為「台」。
_REGIONS = [
    "台北",
    "新北",
    "桃園",
    "台中",
    "台南",
    "高雄",
    "基隆",
    "新竹",
    "苗栗",
    "彰化",
    "南投",
    "雲林",
    "嘉義",
    "屏東",
    "宜蘭",
    "花蓮",
    "台東",
    "澎湖",
    "金門",
    "連江",
    "馬祖",
]

# 由長到短排序，避免短名先吃掉長名的前綴（此處皆兩字、長度一致，仍保險處理）。
_REGION_ALT = "|".join(sorted(set(_REGIONS), key=len, reverse=True))
_REGION_RE = rf"(?:{_REGION_ALT})"

# 「只要這個地區」語意（含『X 以外不要』『只要 X』）。務必比 exclude 先判，
# 否則「不要新北以外」會被誤判成 exclude 新北（語意相反）。
_ONLY_PATTERNS = [
    re.compile(rf"不(?:要|接|看|想|做|推)\s*({_REGION_RE})\s*以外"),
    re.compile(
        rf"({_REGION_RE})\s*以外(?:的)?\s*(?:都|全)?\s*"
        rf"(?:不要|不接|不看|別|免|跳過|不推)"
    ),
    re.compile(rf"(?:只|僅)\s*(?:要|看|接|做|投|找|關注|考慮)?\s*({_REGION_RE})"),
]

# 「排除這個地區」語意。
_EXCLUDE_PATTERNS = [
    re.compile(
        rf"(?:不要|不接|不看|別接|別推|不推|排除|避開|不想要|不做|跳過)\s*({_REGION_RE})"
    ),
]


def _normalize_region(name: str) -> str:
    """臺→台 統一，去除可能夾雜的空白。"""
    return name.replace("臺", "台").strip()


@dataclass(frozen=True)
class StandingPreference:
    """偵測到的長期條件建議。

    - ``kind``：目前僅 ``"region"``。
    - ``op``：``"only"``（只要這個地區）或 ``"exclude"``（排除這個地區）。
    - ``value``：正規化後的地區名（如「新北」）。
    - ``raw``：命中的原句片段（供審計/除錯，非用於評分）。
    """

    kind: str
    op: str
    value: str
    raw: str


def detect_standing_preference(text: str | None) -> StandingPreference | None:
    """從一句使用者輸入辨識「長期條件」；無則回 None。

    純函式、確定性、不打任何外部服務——可於 CI/離線環境直接驗證。
    """
    if not text:
        return None
    # 臺/台 先統一，讓 regex 與輸出一致。
    norm = text.replace("臺", "台")

    for pat in _ONLY_PATTERNS:
        m = pat.search(norm)
        if m:
            return StandingPreference(
                kind="region",
                op="only",
                value=_normalize_region(m.group(1)),
                raw=m.group(0).strip(),
            )

    for pat in _EXCLUDE_PATTERNS:
        m = pat.search(norm)
        if m:
            return StandingPreference(
                kind="region",
                op="exclude",
                value=_normalize_region(m.group(1)),
                raw=m.group(0).strip(),
            )

    return None
