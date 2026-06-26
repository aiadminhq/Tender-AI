import { Sheet, Button, Badge, FeasibilityMeter } from "tender-ai-frontend";

// Sheet 是右側滑出抽屜（Esc / 點背景關閉），透過 portal 掛到 body。
// Tender AI 用它做標案詳情側邊欄。Sheet 為全幅 overlay，預覽以 open 常駐、
// 單格呈現（cardMode: single）。
//
// 注意：design-sync 的單格容器 .ds-single 帶 transform，會成為 position:fixed
// 後代的 containing block；Sheet 最外層即 fixed inset-0，若容器無高度，inset:0
// 會被解析成「頂部零高度盒」→ 抽屜貼頂被裁切。故以 min-height:100vh 的 in-flow
// 包裹層撐出全視窗高度，讓 fixed overlay 能正確靠右滿版顯示。

const noop = () => {};

export const TenderDetail = () => (
  <div style={{ minHeight: "100vh" }}>
    <Sheet
      open
      onClose={noop}
      width="sm:max-w-md"
      title="標案詳情"
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost">略過</Button>
          <Button variant="primary">承接此案</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <Badge variant="signal">⭐ 精選案件</Badge>
            <Badge variant="default">營繕工程</Badge>
          </div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            臺北市立大同國小校舍耐震補強統包工程
          </div>
          <div style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>
            臺北市政府教育局 ・ 公開招標
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            fontSize: 13,
          }}
        >
          <div>
            <div style={{ opacity: 0.6 }}>預算金額</div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
              }}
            >
              NT$ 28,500,000
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.6 }}>截止收件</div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
              }}
            >
              2026/07/18
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
            可行度 88
          </div>
          <FeasibilityMeter value={88} showLabel />
        </div>
      </div>
    </Sheet>
  </div>
);
