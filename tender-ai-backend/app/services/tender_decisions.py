# -*- coding: utf-8 -*-
"""本人「標案評分決策」彙整服務（決策回顧 / 評分管理，唯讀、離線）。

對應需求 P4「真資料端點」：把本人在各頁（戰情總覽／標案清單／速覽配對）按過的
星星（收藏）、打勾（承接）、叉叉（淘汰）行為，由 DB 重建為一份「決策清單」，
供前端「決策回顧」頁水合（hydrate）後重新檢視自己存留／淘汰的標案。

三種處置（disposition）對齊前端 ``dispositionOf``，由 Layer B 行為訊號推導：
- ``skipped``（叉叉／淘汰）：``_abandoned_tender_ids``（速覽 pass 事件 ∪ 狀態＝放棄）。
- ``accepted``（打勾／承接）：``tender_user_state.status`` ∈ {觀望, 備標中, 已投, 得標}。
- ``starred``（星星／收藏）：``tender_user_state.saved`` 為真，或 ``star`` 有值。

優先序與前端一致：``skipped`` > ``accepted`` > ``starred``（同一案有多個訊號時取較強者）。
淘汰理由（``reason``）優先取速覽 pass 事件的 ``payload.reason``，否則退而取最近一筆
評估（``evaluations.rationale``）；``by`` 為登入帳號名（具名貢獻者，Layer B 白名單內共享）。

紅線（negative-keywords-human-only）：本服務**只讀**，不寫任何權重／狀態／事件。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.behavior import Evaluation, Event, TenderUserState, User
from app.models.tender import Tender
from app.services import query as query_svc
from app.services.abandoned_keywords import _abandoned_tender_ids

# 承接（打勾）狀態集合：與前端 dispositionOf 的 accepted 對齊
_ACCEPTED_STATUS = {"觀望", "備標中", "已投", "得標"}


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


async def user_tender_decisions(
    session: AsyncSession,
    user_id: int,
    *,
    limit: int = 200,
) -> dict:
    """彙整本人的標案處置清單（唯讀）。

    回傳 ``decisions`` 依「決策時間」降序（最近的在前），每筆含處置、標案標題／機關／
    tier／截止日，淘汰案另附 ``reason``／``by``／``at``。``counts`` 為各處置件數。
    """
    skipped_ids = await _abandoned_tender_ids(session, user_id)

    tus_rows = (
        await session.execute(
            select(TenderUserState).where(TenderUserState.user_id == user_id)
        )
    ).scalars().all()

    # 每案處置（套用優先序 skipped > accepted > starred）＋決策時間來源
    disp: dict[int, str] = {tid: "skipped" for tid in skipped_ids}
    at_map: dict[int, datetime] = {}
    for tus in tus_rows:
        tid = tus.tender_id
        if tid in disp:  # 已是 skipped（較強訊號），僅補時間候選
            at_map.setdefault(tid, tus.updated_at)
            continue
        if tus.status in _ACCEPTED_STATUS:
            disp[tid] = "accepted"
            at_map[tid] = tus.updated_at
        elif tus.saved or tus.star is not None:
            disp[tid] = "starred"
            at_map[tid] = tus.updated_at

    if not disp:
        return {
            "user_id": user_id,
            "counts": {"accepted": 0, "starred": 0, "skipped": 0},
            "decisions": [],
        }

    tender_ids = list(disp.keys())

    # 標案資訊 ＋ 最新快照 tier（Tender 無 tier 欄，tier 在 DailyTender 快照）
    snap = query_svc._latest_snapshot_subq()
    info_rows = await session.execute(
        select(
            Tender.id,
            Tender.name,
            Tender.org,
            Tender.deadline_iso,
            snap.c.tier,
        )
        .outerjoin(snap, snap.c.tender_id == Tender.id)
        .where(Tender.id.in_(tender_ids))
    )
    tinfo: dict[int, dict] = {
        tid: {"name": name, "org": org, "deadline_iso": dl, "tier": tier}
        for (tid, name, org, dl, tier) in info_rows
    }

    # 淘汰理由①：速覽 pass 事件 payload.reason（取最近一筆，順帶當決策時間）
    pass_reason: dict[int, tuple[str | None, datetime]] = {}
    if skipped_ids:
        pe = await session.execute(
            select(Event.tender_id, Event.payload, Event.ts)
            .where(
                Event.user_id == user_id,
                Event.tender_id.in_(skipped_ids),
                Event.type == "view",
                Event.payload["scope"].astext == "swipe",
                Event.payload["action"].astext == "pass",
            )
            .order_by(Event.ts.desc())
        )
        for tid, payload, ts in pe:
            if tid is not None and tid not in pass_reason:  # desc → 首見即最新
                reason = (payload or {}).get("reason")
                pass_reason[tid] = (reason, ts)

    # 淘汰理由②（fallback）：最近一筆有理由的評估
    eval_reason: dict[int, str] = {}
    if skipped_ids:
        ev = await session.execute(
            select(Evaluation.tender_id, Evaluation.rationale)
            .where(
                Evaluation.user_id == user_id,
                Evaluation.tender_id.in_(skipped_ids),
                Evaluation.rationale.isnot(None),
            )
            .order_by(Evaluation.created_at.desc())
        )
        for tid, rationale in ev:
            if tid is not None and tid not in eval_reason and rationale:
                eval_reason[tid] = rationale

    user = await session.get(User, user_id)
    user_name = user.name if user else None

    decisions: list[dict] = []
    for tid, d in disp.items():
        info = tinfo.get(tid)
        if not info:  # 標案已不存在（被刪）→ 略過，避免回出孤兒列
            continue
        item: dict = {
            "tender_id": tid,
            "disposition": d,
            "title": info["name"],
            "org": info["org"],
            "tier": info["tier"],
            "deadline_iso": _iso(info["deadline_iso"]),
            "reason": None,
            "by": None,
            "at": None,
        }
        if d == "skipped":
            reason: str | None = None
            at: datetime | None = None
            if tid in pass_reason:
                reason, at = pass_reason[tid]
            if not reason and tid in eval_reason:
                reason = eval_reason[tid]
            if at is None:
                at = at_map.get(tid)
            item["reason"] = reason
            item["by"] = user_name  # 具名：誰淘汰的（白名單內共享）
            item["at"] = _iso(at)
        else:
            item["at"] = _iso(at_map.get(tid))
        decisions.append(item)

    # 最近的決策在前；at 為 ISO 字串可直接字典序比較，None 殿後
    decisions.sort(key=lambda x: (x["at"] is not None, x["at"] or ""), reverse=True)
    decisions = decisions[:limit]

    counts = {"accepted": 0, "starred": 0, "skipped": 0}
    for x in decisions:
        counts[x["disposition"]] = counts.get(x["disposition"], 0) + 1

    return {"user_id": user_id, "counts": counts, "decisions": decisions}
