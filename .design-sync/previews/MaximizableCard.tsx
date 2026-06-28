import { MaximizableCard, FeasibilityMeter, Badge } from "tender-ai-frontend";

// 可放大卡片：平常態為一般卡殼（右上有放大鈕），點擊後切全螢幕 overlay。
// 預覽呈現平常（in-flow）態 —— Tender AI 用它包圖表/長表格，讓使用者按需放大。

export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <MaximizableCard title="標案可行度趨勢">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge variant="signal">⭐ 精選案件</Badge>
          <Badge variant="default">營繕工程</Badge>
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          近 30 日符合條件之標案平均可行度
        </div>
        <FeasibilityMeter value={76} showLabel />
      </div>
    </MaximizableCard>
  </div>
);

export const WithActions = () => (
  <div style={{ maxWidth: 420 }}>
    <MaximizableCard
      title="今日新進標案"
      actions={<Badge variant="muted">12 件</Badge>}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        12
      </div>
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
        符合目前篩選條件
      </div>
    </MaximizableCard>
  </div>
);
