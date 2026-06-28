import { Separator } from "tender-ai-frontend";

// 1px 分隔線，水平（預設）或垂直。Tender AI 用它分隔卡片區塊與 inline meta。

export const Horizontal = () => (
  <div style={{ maxWidth: 360 }}>
    <div style={{ fontSize: 13, marginBottom: 10 }}>標案基本資訊</div>
    <Separator />
    <div style={{ fontSize: 13, marginTop: 10 }}>可行度與承接建議</div>
  </div>
);

export const Vertical = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      height: 20,
      fontSize: 13,
    }}
  >
    <span>公開招標</span>
    <Separator vertical />
    <span>營繕工程</span>
    <Separator vertical />
    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      NT$ 28,500,000
    </span>
  </div>
);
