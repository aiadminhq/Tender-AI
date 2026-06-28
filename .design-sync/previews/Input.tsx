import { Input } from "tender-ai-frontend";

// Tender AI 的單行輸入框：標案關鍵字搜尋、預算門檻、篩選條件等。
// 高度 36px、13px 字級，focus 時 ring 高亮。一格一故事。

export const Default = () => (
  <div style={{ maxWidth: 320 }}>
    <Input placeholder="搜尋標案關鍵字…" />
  </div>
);

export const WithLabel = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 320 }}
  >
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>關鍵字</span>
      <Input placeholder="例：耐震補強" defaultValue="耐震補強" />
    </label>
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>預算下限（NT$）</span>
      <Input placeholder="0" defaultValue="10,000,000" />
    </label>
  </div>
);

export const Disabled = () => (
  <div style={{ maxWidth: 320 }}>
    <Input placeholder="唯讀欄位" defaultValue="臺北市政府教育局" disabled />
  </div>
);
