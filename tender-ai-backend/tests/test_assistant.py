# -*- coding: utf-8 -*-
"""POST /api/v1/assistant/chat 串流測試（SL1）：本機 Ollama 生成 + grounding + fallback。

不連 Ollama：以 monkeypatch 替換
  - app.services.llm.stream_chat（生成端，模組屬性存取，可替換）；
  - app.services.search.semantic_search / similar_tenders（檢索端，回空使 sources 決定性）。
對照 SL1 驗收：
  - 串流成功、最終 delta == LLM 完整全文、sources≥1 且皆為種子標案 id；
  - grounding：system prompt 含「候選標案清單」與防幻覺指示、答案引用的 #id ⊆ sources；
  - Ollama 不可用／逾時／空輸出 → 退回模板（HTTP 仍 200）；
  - assistant_use_llm=False → 直接走模板、完全不呼叫 LLM。
"""
from __future__ import annotations

import json
import re

import pytest

CHAT = "/api/v1/assistant/chat"

# 本模組測 Ollama 生成路徑（monkeypatch llm.stream_chat）；產品預設大腦已改 cli/Claude Code，
# 故全模組把大腦釘回 ollama，避免改走 cli 分支真的 spawn 子程序。
pytestmark = pytest.mark.usefixtures("ollama_brain")


def _payload(prompt: str, context: dict | None = None) -> dict:
    body: dict = {
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
    }
    if context is not None:
        body["context"] = context
    return body


def _events(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _by_type(events: list[dict], etype: str) -> list[dict]:
    return [e for e in events if e.get("type") == etype]


@pytest.fixture
def quiet_retrieval(monkeypatch):
    """語意／相似檢索回空：sources 只來自 SQL list_tenders（決定性、不連 Ollama）。"""

    async def _empty_semantic(session, prompt, limit=5):
        return []

    async def _empty_similar(session, tender_id, limit=5):
        return []

    monkeypatch.setattr("app.services.search.semantic_search", _empty_semantic)
    monkeypatch.setattr("app.services.search.similar_tenders", _empty_similar)


async def test_chat_streams_llm_answer_with_sources(
    client, seeded, monkeypatch, quiet_retrieval
):
    high = seeded["high"]
    pieces = ["建議優先評估 ", f"標案 #{high}", "，截止急迫，可行度高。"]
    answer = "".join(pieces)
    captured: dict = {}

    async def fake_stream(messages, **kw):
        captured["messages"] = messages
        for piece in pieces:
            yield piece

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(CHAT, json=_payload("台北"))
    assert resp.status_code == 200
    events = _events(resp.text)

    metas = _by_type(events, "meta")
    deltas = _by_type(events, "delta")
    dones = _by_type(events, "done")
    assert len(metas) == 1 and len(dones) == 1
    assert deltas, "至少要串出一筆 delta"
    # 最終 delta 為 LLM 完整全文（delta 為 replace 語意）
    assert deltas[-1]["text"] == answer

    # sources≥1，且都是種子標案 id（不得有幻覺來源）
    sources = metas[0]["sources"]
    assert len(sources) >= 1
    src_ids = {s["tender_id"] for s in sources}
    assert high in src_ids
    assert src_ids <= set(seeded.values())

    # grounding：system prompt 帶候選清單與防幻覺指示
    sys_msg = captured["messages"][0]
    assert sys_msg["role"] == "system"
    assert "候選標案清單" in sys_msg["content"]
    assert "嚴禁虛構" in sys_msg["content"]
    assert f"#{high}" in sys_msg["content"]
    # 使用者訊息原文有被帶入
    assert any(m["role"] == "user" and "台北" in m["content"] for m in captured["messages"])

    # 防幻覺：答案中引用的 #id 必須都在 sources 內
    cited = {int(x) for x in re.findall(r"#(\d+)", deltas[-1]["text"])}
    assert cited <= src_ids


async def test_grounding_evidence_carries_org_city_budget(
    client, seeded, monkeypatch, quiet_retrieval
):
    """回歸：候選清單證據須帶機關/地點/類別/預算，助手才答得出地點與預算問題。

    舊版 excerpt 只有 tier/days_left，LLM 看不到 org/city/budget，連「台北市的工程
    標案、預算多少」都無法回答。此測試鎖住證據欄位的補強。
    """
    captured: dict = {}

    async def fake_stream(messages, **kw):
        captured["messages"] = messages
        yield "好的。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(CHAT, json=_payload("台北"))
    assert resp.status_code == 200
    events = _events(resp.text)

    # grounding system prompt 內嵌的候選清單須帶 high 標案的機關/地點/類別/預算。
    sys_content = captured["messages"][0]["content"]
    assert "機關 台北市政府" in sys_content
    assert "地點 台北市" in sys_content
    assert "財物" in sys_content
    assert "預算 500 萬" in sys_content

    # meta sources 的 excerpt 亦同步攜帶這些欄位（前端來源卡可呈現）。
    high_src = next(
        s for s in _by_type(events, "meta")[0]["sources"] if s["tender_id"] == seeded["high"]
    )
    assert "台北市政府" in high_src["excerpt"]
    assert "預算 500 萬" in high_src["excerpt"]


async def test_chat_fallback_when_llm_unavailable(
    client, seeded, monkeypatch, quiet_retrieval
):
    from app.services import llm

    async def boom(messages, **kw):
        if False:  # 讓函式成為 async generator
            yield ""
        raise llm.LlmError("ollama down")

    monkeypatch.setattr("app.services.llm.stream_chat", boom)

    resp = await client.post(CHAT, json=_payload("台北"))
    assert resp.status_code == 200  # 退回模板，HTTP 仍 200
    events = _events(resp.text)
    deltas = _by_type(events, "delta")
    assert deltas
    final = deltas[-1]["text"]
    assert ("相關標案" in final) or ("下一步" in final)
    assert _by_type(events, "done")


async def test_chat_fallback_when_llm_empty(
    client, seeded, monkeypatch, quiet_retrieval
):
    async def empty(messages, **kw):
        return
        yield  # pragma: no cover

    monkeypatch.setattr("app.services.llm.stream_chat", empty)

    resp = await client.post(CHAT, json=_payload("台北"))
    assert resp.status_code == 200
    final = _by_type(_events(resp.text), "delta")[-1]["text"]
    assert ("相關標案" in final) or ("下一步" in final)


async def test_chat_template_when_llm_disabled(
    client, seeded, monkeypatch, quiet_retrieval
):
    from app.core.config import settings

    monkeypatch.setattr(settings, "assistant_use_llm", False)
    calls = {"n": 0}

    async def should_not_run(messages, **kw):
        calls["n"] += 1
        yield "x"

    monkeypatch.setattr("app.services.llm.stream_chat", should_not_run)

    resp = await client.post(CHAT, json=_payload("台北"))
    assert resp.status_code == 200
    assert calls["n"] == 0  # 停用旗標時完全不呼叫 LLM
    final = _by_type(_events(resp.text), "delta")[-1]["text"]
    assert ("相關標案" in final) or ("下一步" in final)


async def test_team_question_without_login_does_not_expose_layer_b_or_c(
    client, monkeypatch, quiet_retrieval
):
    """未登入提問 Layer B/C 時只回權限說明，不得把任何團隊資料放進來源。"""
    from app.core.config import settings

    monkeypatch.setattr(settings, "assistant_use_llm", False)
    resp = await client.post(CHAT, json=_payload("請查詢 Layer B 的同事評價"))
    assert resp.status_code == 200
    events = _events(resp.text)
    collaboration = [
        source
        for source in _by_type(events, "meta")[0]["sources"]
        if source["kind"] == "collaboration"
    ]
    assert collaboration
    assert collaboration[0]["source"] == "Layer access"
    assert "需要以已開通的公司白名單帳號登入" in collaboration[0]["excerpt"]
    assert "需要以已開通的公司白名單帳號登入" in _by_type(events, "delta")[-1]["text"]


# ── Phase 3 情境感知接線：context.focus_tender_id 進檢索與 grounding ──────────


async def test_focus_tender_id_pins_current_tender_into_sources(
    client, seeded, monkeypatch, quiet_retrieval
):
    """帶 context.focus_tender_id 時，使用者「正在檢視」的標案須被釘進 sources。

    以 tmu 標案（"北醫醫療設備採購"）為情境標的：純文字提問「工程」不會撈到它，
    但帶上 focus_tender_id 後，它應被釘為證據（含在 meta sources），證明前端傳來的
    當前標案 id 確實接進了對話檢索，而非僅顯示於右欄。
    """
    focus = seeded["tmu"]

    async def fake_stream(messages, **kw):
        yield "好的。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    # baseline：不帶 focus，提問「工程」不會撈到 tmu 標案。
    base = await client.post(CHAT, json=_payload("工程"))
    base_ids = {
        s["tender_id"] for s in _by_type(_events(base.text), "meta")[0]["sources"]
    }
    assert focus not in base_ids, "前置條件：無 focus 時 tmu 不應出現"

    # 帶 focus_tender_id：tmu 標案應被釘進 sources。
    resp = await client.post(
        CHAT, json=_payload("工程", context={"focus_tender_id": focus})
    )
    assert resp.status_code == 200
    sources = _by_type(_events(resp.text), "meta")[0]["sources"]
    focus_ids = {s["tender_id"] for s in sources}
    assert focus in focus_ids, "帶 focus_tender_id 時當前標案須被納入檢索證據"


async def test_focus_tender_id_injects_focus_note_into_system_prompt(
    client, seeded, monkeypatch, quiet_retrieval
):
    """帶 focus_tender_id 時，grounding system prompt 須含「目前檢視情境」提示。

    讓未帶編號的指代（「這案」「它」）預設對到眼前那一案；此測試鎖住 focus_note
    的注入（消弭「視覺感知、對話卻不感知」的斷裂）。
    """
    focus = seeded["mid"]
    captured: dict = {}

    async def fake_stream(messages, **kw):
        captured["messages"] = messages
        yield "好的。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(
        CHAT, json=_payload("這案適合投嗎", context={"focus_tender_id": focus})
    )
    assert resp.status_code == 200
    sys_content = captured["messages"][0]["content"]
    assert "目前檢視情境" in sys_content
    assert f"標案 #{focus}" in sys_content


async def test_focus_tender_id_accepts_alias_and_string(
    client, seeded, monkeypatch, quiet_retrieval
):
    """context 鍵 tender_id（別名）與字串數字皆應被接受（前端 route 值多為字串）。"""
    focus = seeded["tmu"]

    async def fake_stream(messages, **kw):
        yield "好的。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(
        CHAT, json=_payload("工程", context={"tender_id": str(focus)})
    )
    assert resp.status_code == 200
    focus_ids = {
        s["tender_id"] for s in _by_type(_events(resp.text), "meta")[0]["sources"]
    }
    assert focus in focus_ids


async def test_no_focus_tender_id_is_backward_compatible(
    client, seeded, monkeypatch, quiet_retrieval
):
    """缺 context／非正整數 focus 時退回純文字檢索，不注入情境提示（向後相容）。"""
    captured: dict = {}

    async def fake_stream(messages, **kw):
        captured["messages"] = messages
        yield "好的。"

    monkeypatch.setattr("app.services.llm.stream_chat", fake_stream)

    resp = await client.post(
        CHAT, json=_payload("台北", context={"focus_tender_id": "0"})
    )
    assert resp.status_code == 200
    assert "目前檢視情境" not in captured["messages"][0]["content"]
