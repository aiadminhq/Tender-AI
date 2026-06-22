"""Pydantic schemas（API 輸入/輸出邊界）。"""
from app.schemas.behavior import (
    AcceptRequest,
    AnnotationOut,
    EventOut,
    EventRequest,
    NoteRequest,
    RateRequest,
    SavedSearchCreate,
    SavedSearchOut,
    SaveRequest,
    ShareOut,
    ShareRequest,
    StateOut,
)
from app.schemas.tender import (
    SnapshotItem,
    TenderDetail,
    TenderListItem,
    TenderListResponse,
    TenderQuery,
    UserStateOut,
)
from app.schemas.user import (
    ConsentIn,
    ConsentOut,
    MeOut,
    PreferenceProfileOut,
    WhitelistIn,
    WhitelistOut,
)

__all__ = [
    # tender
    "TenderQuery",
    "TenderListItem",
    "TenderListResponse",
    "TenderDetail",
    "SnapshotItem",
    "UserStateOut",
    # behavior
    "SaveRequest",
    "AcceptRequest",
    "RateRequest",
    "NoteRequest",
    "ShareRequest",
    "EventRequest",
    "SavedSearchCreate",
    "StateOut",
    "AnnotationOut",
    "ShareOut",
    "EventOut",
    "SavedSearchOut",
    # user / consent / whitelist / preference
    "MeOut",
    "ConsentIn",
    "ConsentOut",
    "WhitelistIn",
    "WhitelistOut",
    "PreferenceProfileOut",
]
