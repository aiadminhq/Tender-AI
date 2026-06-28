# -*- coding: utf-8 -*-
"""Tender AI「DB 大腦」MCP 介面（stdio）。

目的：把既有的檢索大腦（Postgres/pgvector + services）與部分行為回寫，包成 MCP 工具，
讓外部 CLI（Claude Code / Codex / Hermes / opencli 等）接入。CLI 用「自己的雲端快模型」
做推理，繞開慢的本地 Ollama 生成；本服務只負責「查資料、寫行為」，不在此處跑 chat 生成。

啟動（本機，需可連 Postgres）：
    uv run python -m app.mcp_server

CLI 端設定見 MCP_BRIDGE.md。

────────────────────────────────────────────────────────────────────────
⚠️ Layer B 紅線（務必維持）
────────────────────────────────────────────────────────────────────────
工具輸出會被送進「外部模型」（CLI 自帶的雲端 LLM），等同 llm.py「不把 Layer B 行為
明細送外部模型」的約束延伸到這裡：

- 檢索工具一律只回 **Layer A 公開資料** ＋ **去識別化 Layer C**（權重/相似度/聚合傾向）。
- 任何輸出都不得帶入「其他使用者」的具名行為；個人狀態（save/status/star）只回「操作帳號
  自己的」那一份。
- 向量/聚合結果不含人名、email。
- 行為回寫綁定「操作帳號」（環境變數 TENDER_MCP_USER）；是否具名併入團隊共享庫，仍由既有
  consent-aware 流程（whitelist_active && consent_shared）在下游 job 決定，本介面不繞過。

可離線（不需 Ollama）的工具：search_tenders / get_tender / similar_tenders /
criteria_profile。語意類（semantic_search / recommend / search_knowledge /
explain_tender）需要本機 Ollama 做「單筆查詢嵌入」（bge-m3）——這只是一次短嵌入，
非慢速 chat 生成；Ollama 不在線時，這些工具回友善錯誤而非中斷整個 server。
"""
from __future__ import annotations

import os
from typing import Any

from sqlalchemy import select

from app.core.errors import EntityNotFound
from app.db.session import AsyncSessionLocal
from app.models.behavior import User
from app.schemas.tender import TenderQuery
from app.services import behavior, knowledge, query, reasoning, search

try:  # MCP SDK 為選用相依（見 pyproject「mcp[cli]」），缺時給清楚指引
    from mcp.server.fastmcp import FastMCP
except ModuleNotFoundError as e:  # pragma: no cover - 環境未安裝時的引導
    raise SystemExit(
        "缺少 MCP SDK。請先安裝：`uv sync`（已將 mcp[cli] 列入相依）"
        "或 `uv add 'mcp[cli]'`。"
    ) from e


mcp = FastMCP(
    "tender-ai-brain",
    instructions=(
        "Tender AI 的政府標案『DB 大腦』。提供標案檢索、語意/相似案搜尋、推薦理由、"
        "知識庫查詢，以及收藏/狀態/評分/筆記等行為回寫。輸出僅含公開標案資料與去識別化的"
        "學習結果；請以這些工具取得佐證後，用你自己的模型作答，毋須呼叫本地 Ollama 生成。"
    ),
)


# --------------------------------------------------------------------------- #
# 共用：操作帳號解析（環境變數 TENDER_MCP_USER = email 或帳號名）
# --------------------------------------------------------------------------- #
async def _acting_user_id(session) -> int | None:
    """以 TENDER_MCP_USER 解析操作帳號 id；未設或查無 → None（讀取走匿名、寫入落預設使用者）。"""
    ident = os.environ.get("TENDER_MCP_USER", "").strip()
    if not ident:
        return None
    u = (
        await session.execute(
            select(User).where((User.email == ident) | (User.name == ident))
        )
    ).scalar_one_or_none()
    return u.id if u else None


def _err(msg: str) -> dict[str, Any]:
    return {"error": msg}


# =========================================================================== #
# 唯讀檢索工具（Layer A 公開 ＋ 去識別 Layer C）
# =========================================================================== #
@mcp.tool()
async def search_tenders(
    q: str | None = None,
    tier: list[str] | None = None,
    city: list[str] | None = None,
    category: list[str] | None = None,
    budget_min: int | None = None,
    budget_max: int | None = None,
    deadline_days: int | None = None,
    focus: list[str] | None = None,
    avoid: list[str] | None = None,
    sort: str = "feas",
    page: int = 1,
    page_size: int = 30,
) -> dict[str, Any]:
    """關鍵字/條件篩選標案清單（純 DB，不需 Ollama）。

    sort: feas|days|budget|tier。budget 單位為「萬元」。focus=任一命中即列入；
    avoid=任一命中即排除；deadline_days=最新快照剩餘天數上限。回傳含可行度分數（0–100）。
    """
    tq = TenderQuery(
        q=q,
        tier=tier or [],
        city=city or [],
        cat=category or [],
        focus=focus or [],
        avoid=avoid or [],
        budget_min=budget_min,
        budget_max=budget_max,
        deadline=deadline_days,
        sort=sort,  # type: ignore[arg-type]
        page=page,
        page_size=page_size,
    )
    async with AsyncSessionLocal() as session:
        items, total = await query.list_tenders(session, tq)
    return {
        "items": [it.model_dump(mode="json") for it in items],
        "count": total,
        "page": page,
        "page_size": page_size,
    }


@mcp.tool()
async def get_tender(tender_id: int) -> dict[str, Any]:
    """單一標案完整詳情：主檔 + 最新/歷史快照 + 詳情版本（純 DB）。

    含「操作帳號自己的」收藏/狀態/星等（不揭露他人狀態）。
    """
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            detail = await query.get_tender_detail(session, tender_id, uid)
        except EntityNotFound as e:
            return _err(str(e))
    return detail.model_dump(mode="json")


@mcp.tool()
async def similar_tenders(tender_id: int, limit: int = 10) -> dict[str, Any]:
    """以某標案的既有向量找最相似的其他標案（純向量 cosine，不需 Ollama）。"""
    async with AsyncSessionLocal() as session:
        try:
            hits = await search.similar_tenders(session, tender_id, limit=limit)
        except EntityNotFound as e:
            return _err(str(e))
    return {"items": [h.model_dump(mode="json") for h in hits]}


@mcp.tool()
async def semantic_search(text: str, limit: int = 20) -> dict[str, Any]:
    """自然語言語意檢索標案（需本機 Ollama 做查詢嵌入 bge-m3）。"""
    async with AsyncSessionLocal() as session:
        try:
            hits = await search.semantic_search(session, text, limit=limit)
        except Exception as e:  # 多半為 Ollama 不在線/嵌入失敗
            return _err(f"語意檢索需要本機 Ollama 嵌入服務（bge-m3）：{e}")
    return {"items": [h.model_dump(mode="json") for h in hits]}


@mcp.tool()
async def recommend(tender_id: int, limit: int = 5) -> dict[str, Any]:
    """為候選標案找最相似的『已評估案例』，聚合成可解釋的承接傾向（P5，需 Ollama 嵌入）。

    回傳 verdict（feasible_leaning|infeasible_leaning|unknown）、信心、可行/不可行計數、
    白話 headline、以及鄰居標案（公開資料 + 去識別的可行性標籤）。
    """
    async with AsyncSessionLocal() as session:
        try:
            rec = await search.recommend_from_decisions(session, tender_id, limit=limit)
        except EntityNotFound as e:
            return _err(str(e))
        except Exception as e:
            return _err(f"推薦需要本機 Ollama 嵌入服務（bge-m3）：{e}")
    return rec.model_dump(mode="json")


@mcp.tool()
async def search_knowledge(text: str, limit: int = 5) -> dict[str, Any]:
    """檢索公開領域知識庫（採購法規/承標知識等；混合向量＋關鍵字，需 Ollama 嵌入）。"""
    async with AsyncSessionLocal() as session:
        try:
            hits = await knowledge.search_knowledge(session, text, limit=limit)
        except Exception as e:
            return _err(f"知識庫檢索需要本機 Ollama 嵌入服務（bge-m3）：{e}")
    return {"items": [h.model_dump(mode="json") for h in hits]}


@mcp.tool()
async def explain_tender(tender_id: int) -> dict[str, Any]:
    """產生某標案的推薦理由/評分解釋（命中關鍵字、預算/分類、相似決策；需 Ollama 嵌入）。"""
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            out = await reasoning.explain_tender(session, tender_id, uid)
        except EntityNotFound as e:
            return _err(str(e))
        except Exception as e:
            return _err(f"推薦理由需要本機 Ollama 嵌入服務（bge-m3）：{e}")
    return out.model_dump(mode="json")


@mcp.tool()
async def criteria_profile() -> dict[str, Any]:
    """操作帳號的『承標判準輪廓』（去識別的聚合統計：偏好分類/預算帶/機關等，純 DB）。"""
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        profile = await reasoning.build_criteria_profile(session, uid)
    return reasoning.profile_to_out(profile).model_dump(mode="json")


# =========================================================================== #
# 行為回寫工具（綁定操作帳號；是否併入團隊共享庫仍由下游 consent-aware job 決定）
# =========================================================================== #
def _state_dict(st) -> dict[str, Any]:
    """TenderUserState ORM → 中性 dict（不含人名/email）。"""
    return {
        "tender_id": st.tender_id,
        "saved": st.saved,
        "status": st.status,
        "star": st.star,
    }


@mcp.tool()
async def save_tender(tender_id: int, saved: bool = True) -> dict[str, Any]:
    """收藏 / 取消收藏某標案（綁定操作帳號）。"""
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            st = await behavior.set_saved(session, uid, tender_id, saved)
        except EntityNotFound as e:
            return _err(str(e))
        await session.commit()
    return {"ok": True, **_state_dict(st)}


@mcp.tool()
async def set_tender_status(tender_id: int, status: str) -> dict[str, Any]:
    """設定追蹤狀態：觀望 | 備標中 | 已投 | 得標 | 放棄。"""
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            st = await behavior.set_status(session, uid, tender_id, status)
        except EntityNotFound as e:
            return _err(str(e))
        await session.commit()
    return {"ok": True, **_state_dict(st)}


@mcp.tool()
async def rate_tender(tender_id: int, star: int) -> dict[str, Any]:
    """為標案評分（1–5 星）。"""
    if not 1 <= star <= 5:
        return _err("star 需介於 1–5")
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            st = await behavior.set_star(session, uid, tender_id, star)
        except EntityNotFound as e:
            return _err(str(e))
        await session.commit()
    return {"ok": True, **_state_dict(st)}


@mcp.tool()
async def add_tender_note(tender_id: int, note: str) -> dict[str, Any]:
    """為標案新增一則人工筆記。"""
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            row = await behavior.add_note(session, uid, tender_id, note)
        except EntityNotFound as e:
            return _err(str(e))
        await session.commit()
        note_id = row.id
    return {"ok": True, "note_id": note_id, "tender_id": tender_id}


@mcp.tool()
async def log_event(
    event_type: str,
    tender_id: int | None = None,
    payload: dict | None = None,
) -> dict[str, Any]:
    """記一筆互動埋點：view|open_detail|click_link|dwell|apply_filter|search|sort。"""
    async with AsyncSessionLocal() as session:
        uid = await _acting_user_id(session)
        try:
            row = await behavior.add_event(session, uid, event_type, tender_id, payload)
        except EntityNotFound as e:
            return _err(str(e))
        await session.commit()
        event_id = row.id
    return {"ok": True, "event_id": event_id}


def main() -> None:
    """stdio 進入點（CLI 以 `uv run python -m app.mcp_server` 啟動）。"""
    mcp.run()


if __name__ == "__main__":
    main()
