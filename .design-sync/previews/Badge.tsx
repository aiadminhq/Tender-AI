import { Badge } from "tender-ai-frontend";

// 標案狀態與分類標籤 —— Tender AI 用 Badge 標示承接結論、案件分類與時效。
// 一格一故事，內容用真實政府標案語境（繁中為預設）。

export const Variants = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 420 }}>
    <Badge variant="default">營繕工程</Badge>
    <Badge variant="signal">⭐ 精選案件</Badge>
    <Badge variant="success">可承接</Badge>
    <Badge variant="danger">不可行</Badge>
    <Badge variant="outline">財物採購</Badge>
    <Badge variant="muted">已截止</Badge>
  </div>
);

export const Conclusion = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Badge variant="success">可承接</Badge>
      <span style={{ fontSize: 13, opacity: 0.7 }}>校舍耐震補強統包工程</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Badge variant="signal">⭐ 精選案件</Badge>
      <span style={{ fontSize: 13, opacity: 0.7 }}>市立圖書館空調汰換</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Badge variant="danger">不可行</Badge>
      <span style={{ fontSize: 13, opacity: 0.7 }}>偏遠道路路面整修</span>
    </div>
  </div>
);

export const Categories = () => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 420 }}>
    <Badge variant="default">營繕工程</Badge>
    <Badge variant="outline">財物採購</Badge>
    <Badge variant="outline">勞務委託</Badge>
    <Badge variant="muted">資訊服務</Badge>
  </div>
);
