# -*- coding: utf-8 -*-
"""標案助手 retrieval orchestration。

在既有 SQL / semantic search / similar search 之上，再加一路「知識庫」（SL4：
knowledge_chunks 向量 + 關鍵字混合檢索），把兩類證據組成 grounding prompt 餵本機
Ollama（app.services.llm）串流回答；Ollama 不可用／逾時／空輸出時退回
``_format_answer`` 模板（HTTP 仍 200）。

兩路證據對應願景「小助手能回答整個資料庫與知識庫的提問」：
- 標案路回答「哪些標案、機關、金額、截止」這類事實型問題。
- 知識庫路回答「分級／篩選／可行度怎麼算、資料來源」這類方法／規則型問題。

鐵則：
- 防幻覺——system prompt 要求標案事實只能引用「候選標案清單」、方法規則只能依
  「知識庫片段」，不得虛構清單外標案。
- 證據只含公開欄位（A 層）與公開領域知識；不在此處組裝任何 Layer B 私有資料。
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.schemas.assistant import (
    AssistantChatDeltaOut,
    AssistantChatDoneOut,
    AssistantChatMetaOut,
    AssistantChatRequest,
    AssistantSourceOut,
    AssistantToolContractOut,
)
from app.schemas.tender import TenderQuery
from app.services import llm
from app.services import query as query_svc
from app.services import search as search_svc
from app.services.knowledge import search_knowledge

_TEXT_PART_RE = re.compile(r"^(?:#|id[:\s#]|標案[:\s#])?(\d{1,8})$", re.IGNORECASE)
_QUERY_ID_RE = re.compile(r"(?:#|id[:\s#]|標案[:\s#])(\d{1,8})", re.IGNORECASE)
_SPLIT_RE = re.compile(r"[\s,，、]+")


@dataclass(slots=True)
class AssistantEvidence:
    kind: str
    tender_id: int
    title: str
    source: str
    url: str | None
    score: float | None
    excerpt: str | None


@dataclass(slots=True)
class KnowledgeEvidence:
    """一筆知識庫證據（方法／規則型問題用）；無 tender_id，改帶 doc_id/heading。"""

    doc_id: str
    title: str
    heading: str | None
    content: str
    score: float | None


# 知識庫片段餵 LLM／來源卡時的單段字數上限（避免 grounding prompt 過長）
_KNOWLEDGE_EXCERPT_MAX = 280


def _message_text(message) -> str:
    parts: list[str] = []
    for part in message.content:
        text = (part.text or "").strip()
        if part.type == "text" and text:
            parts.append(text)
    return "\n".join(parts).strip()


def _latest_user_prompt(payload: AssistantChatRequest) -> str:
    for message in reversed(payload.messages):
        if message.role == "user":
            text = _message_text(message)
            if text:
                return text
    return ""


def _extract_requested_tender_id(prompt: str) -> int | None:
    match = _QUERY_ID_RE.search(prompt)
    if match:
        return int(match.group(1))

    cleaned = prompt.strip()
    if cleaned.isdigit() and len(cleaned) <= 8:
        return int(cleaned)

    match = _TEXT_PART_RE.match(cleaned)
    if match:
        return int(match.group(1))

    return None


def _split_query(prompt: str) -> list[str]:
    return [part for part in _SPLIT_RE.split(prompt.strip()) if part]


def _evidence_excerpt(item) -> str:
    """把候選標案壓成一行可讀證據（餵 LLM grounding 與前端來源卡共用）。

    過去只帶 tier/days_left，導致助手無法回答「哪些在台北市」「哪個機關」「預算多少」
    這類問題（LLM 看不到 org/city/category/budget）。此處納入公開可用欄位（A 層），
    缺值欄位略過，不虛構。
    """
    bits: list[str] = []
    org = getattr(item, "org", None)
    if org:
        bits.append(f"機關 {org}")
    city = getattr(item, "city", None)
    if city:
        bits.append(f"地點 {city}")
    category = getattr(item, "category", None)
    if category:
        bits.append(category)
    budget = getattr(item, "budget_wan", None)
    if budget is not None:
        bits.append(f"預算 {budget} 萬")
    tier = getattr(item, "tier", None)
    if tier:
        bits.append(f"tier {tier}")
    days_left = getattr(item, "days_left", None)
    if days_left is not None:
        bits.append(f"剩 {days_left} 天")
    feas = getattr(item, "feasibility_score", None)
    if feas is not None:
        bits.append(f"可行度 {feas}")
    return " · ".join(bits) if bits else "（無摘要欄位）"


def _source_payload(item, *, kind: str, score: float | None = None) -> AssistantEvidence:
    return AssistantEvidence(
        kind=kind,
        tender_id=int(item.id),
        title=item.name,
        source=item.source,
        url=item.link,
        score=score,
        excerpt=_evidence_excerpt(item),
    )


async def _collect_candidates(
    session: AsyncSession, prompt: str
) -> list[AssistantEvidence]:
    candidates: list[AssistantEvidence] = []
    seen: set[int] = set()

    def add(item: AssistantEvidence) -> None:
        if item.tender_id in seen:
            return
        seen.add(item.tender_id)
        candidates.append(item)

    query = TenderQuery(
        q=prompt or None,
        page_size=5,
    )
    tender_items, _ = await query_svc.list_tenders(session, query)
    for item in tender_items:
        add(_source_payload(item, kind="tender"))

    if prompt:
        try:
            semantic_hits = await search_svc.semantic_search(session, prompt, limit=5)
        except Exception:
            semantic_hits = []
        for hit in semantic_hits:
            add(_source_payload(hit, kind="semantic", score=hit.score))

    tender_id = _extract_requested_tender_id(prompt)
    if tender_id is not None:
        try:
            similar_hits = await search_svc.similar_tenders(session, tender_id, limit=5)
        except Exception:
            similar_hits = []
        for hit in similar_hits:
            add(_source_payload(hit, kind="similar", score=hit.score))

    return candidates


def _knowledge_excerpt(content: str) -> str:
    """把知識切塊壓成一行摘要（去換行、截斷），供 grounding 與來源卡共用。"""
    body = " ".join((content or "").split())
    if len(body) > _KNOWLEDGE_EXCERPT_MAX:
        body = body[:_KNOWLEDGE_EXCERPT_MAX].rstrip() + "…"
    return body


async def _collect_knowledge(
    session: AsyncSession, prompt: str
) -> list[KnowledgeEvidence]:
    """知識庫混合檢索（向量 + 關鍵字 RRF）；任何異常都吞掉回空，不阻斷標案路。"""
    if not prompt:
        return []
    try:
        hits = await search_knowledge(session, prompt, limit=4)
    except Exception:  # noqa: BLE001 — 知識路失敗不影響標案路與整體回答
        return []
    return [
        KnowledgeEvidence(
            doc_id=hit.doc_id,
            title=hit.title,
            heading=hit.heading,
            content=hit.content,
            score=hit.score,
        )
        for hit in hits
    ]


def _format_answer(
    prompt: str,
    evidence: list[AssistantEvidence],
    knowledge: list[KnowledgeEvidence] | None = None,
) -> str:
    knowledge = knowledge or []
    intro = [
        "我用標案 SQL／語意檢索與知識庫一起整理這個問題。",
    ]
    if prompt:
        intro.append(f"我讀到的重點是：{prompt}")

    lines = ["\n\n".join(intro)]

    if evidence:
        lines.append("### 相關標案")
        for idx, item in enumerate(evidence[:5], start=1):
            label = []
            label.append(item.source)
            if item.score is not None:
                label.append(f"score={item.score:.3f}")
            if item.excerpt:
                label.append(item.excerpt)
            url = item.url or f"/tenders/{item.tender_id}"
            lines.append(f"{idx}. [{item.title}]({url}) · {' · '.join(label)}")

    if knowledge:
        lines.append("### 依據知識庫")
        for idx, k in enumerate(knowledge[:4], start=1):
            head = k.title + (f"／{k.heading}" if k.heading else "")
            lines.append(f"{idx}. 〔{head}〕{_knowledge_excerpt(k.content)}")

    if not evidence and not knowledge:
        lines.append("目前還沒有足夠證據，會先退回到標案清單與語意檢索的既有範圍。")

    lines.append("### 下一步")
    lines.append(
        "如果你要，我可以再把這個問題收斂成：相似案比較、標案機會排序、或針對單一標案做追蹤摘要。"
    )
    return "\n\n".join(lines)


_GROUNDING_SYSTEM = (
    "你是惠強設計的政府標案承標決策助手。你的回答必須完全根據下方「候選標案清單」"
    "與「知識庫片段」，不得引用兩者以外的內容。\n"
    "規則：\n"
    "1. 涉及「哪些標案、案號、機關、金額、連結、截止日」等事實時，只能引用「候選標案"
    "清單」中的標案；嚴禁虛構不在清單中的標案。\n"
    "2. 涉及「分級／篩選標準、類別優先序、可行度怎麼算、關鍵字規則、資料來源、系統用"
    "什麼標準衡量可中標」等方法／規則問題時，依「知識庫片段」作答，並可標示"
    "「（依知識庫：<文件或區段>）」。\n"
    "3. 需要點出某標案時，用「標案 #<id>」標示（id 取自清單），讓系統對應到正確來源。\n"
    "4. 若兩者都不足以回答，直接說明證據不足，不要編造。\n"
    "5. 一律用繁體中文，條列重點：標案問題聚焦「是否值得投標、可行度、截止急迫性」，"
    "方法問題聚焦「系統用什麼標準衡量」。\n"
    "6. 不要重複貼出完整清單；清單與知識來源會由系統另外以卡片呈現。"
)


def _evidence_block(evidence: list[AssistantEvidence]) -> str:
    if not evidence:
        return "（目前候選標案清單為空。）"
    lines: list[str] = []
    for item in evidence[:8]:
        bits = [f"#{item.tender_id}", item.title, f"來源 {item.source}"]
        if item.score is not None:
            bits.append(f"score={item.score:.3f}")
        if item.excerpt:
            bits.append(item.excerpt)
        lines.append(" | ".join(bits))
    return "\n".join(lines)


def _knowledge_block(knowledge: list[KnowledgeEvidence]) -> str:
    if not knowledge:
        return "（目前無相關知識庫片段。）"
    lines: list[str] = []
    for k in knowledge[:4]:
        head = k.title + (f"／{k.heading}" if k.heading else "")
        lines.append(f"〔{head}〕{_knowledge_excerpt(k.content)}")
    return "\n".join(lines)


def _build_chat_messages(
    payload: AssistantChatRequest,
    prompt: str,
    evidence: list[AssistantEvidence],
    knowledge: list[KnowledgeEvidence],
) -> list[dict[str, str]]:
    """組裝餵給 Ollama 的訊息：grounding system + 既有對話歷史（純文字）。"""
    system = (
        f"{_GROUNDING_SYSTEM}\n\n"
        f"[候選標案清單]\n{_evidence_block(evidence)}\n\n"
        f"[知識庫片段]\n{_knowledge_block(knowledge)}"
    )
    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    for message in payload.messages:
        if message.role == "tool":
            continue
        text = _message_text(message)
        if not text:
            continue
        role = message.role if message.role in ("user", "assistant", "system") else "user"
        messages.append({"role": role, "content": text})
    if not any(m["role"] == "user" for m in messages):
        messages.append(
            {"role": "user", "content": prompt or "請依候選標案清單給我重點。"}
        )
    return messages


def _json_line(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


async def stream_chat_events(
    session: AsyncSession, payload: AssistantChatRequest
) -> AsyncIterator[str]:
    prompt = _latest_user_prompt(payload)
    evidence = await _collect_candidates(session, prompt)
    knowledge = await _collect_knowledge(session, prompt)

    sources: list[AssistantSourceOut] = [
        AssistantSourceOut(
            kind=item.kind,  # type: ignore[arg-type]
            tender_id=item.tender_id,
            title=item.title,
            source=item.source,
            url=item.url,
            score=item.score,
            excerpt=item.excerpt,
        )
        for item in evidence
    ]
    sources.extend(
        AssistantSourceOut(
            kind="knowledge",
            tender_id=None,
            title=k.title,
            source="知識庫",
            url=None,
            score=k.score,
            excerpt=_knowledge_excerpt(k.content),
            doc_id=k.doc_id,
            heading=k.heading,
        )
        for k in knowledge
    )

    meta = AssistantChatMetaOut(
        scope="tender_sql + semantic_search + knowledge_base",
        prompt=prompt,
        sources=sources,
        tool_contract=AssistantToolContractOut(),
    )
    yield _json_line(meta.model_dump())

    used_llm = False
    if settings.assistant_use_llm:
        messages = _build_chat_messages(payload, prompt, evidence, knowledge)
        acc: list[str] = []
        since_flush = 0
        start = time.monotonic()
        try:
            async for chunk in llm.stream_chat(messages):
                acc.append(chunk)
                since_flush += len(chunk)
                # 累積全文（前端 delta 為 replace 語意）；以字數／換行門檻聚合，
                # 避免逐 token 噴出 O(N^2) 的 NDJSON 行。
                if since_flush >= 24 or "\n" in chunk:
                    yield _json_line(
                        AssistantChatDeltaOut(text="".join(acc)).model_dump()
                    )
                    since_flush = 0
                if time.monotonic() - start > settings.chat_deadline:
                    break  # 生成總時長硬上限：收尾、保留已生成內容
            final_text = "".join(acc).strip()
            if final_text:
                # 最後補一筆完整全文，確保前端拿到的是完整結果（idempotent replace）
                yield _json_line(
                    AssistantChatDeltaOut(text="".join(acc)).model_dump()
                )
                used_llm = True
        except llm.LlmError:
            used_llm = False
        except Exception:  # noqa: BLE001 — 生成端任何異常都退回模板，維持 HTTP 200
            used_llm = False

    if not used_llm:
        # Fallback：Ollama 不可用／逾時／空輸出 → 退回既有模板（HTTP 仍 200）。
        # delta 為 replace 語意，故即便前面已串出部分 LLM 文字，這裡會整段覆蓋。
        answer = _format_answer(prompt, evidence, knowledge)
        paragraphs = [chunk.strip() for chunk in answer.split("\n\n") if chunk.strip()]
        running: list[str] = []
        for paragraph in paragraphs:
            running.append(paragraph)
            await asyncio.sleep(0)
            yield _json_line(
                AssistantChatDeltaOut(text="\n\n".join(running)).model_dump()
            )

    yield _json_line(AssistantChatDoneOut().model_dump())
