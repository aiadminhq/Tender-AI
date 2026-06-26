import { Dialog, Button, Badge, FeasibilityMeter } from "tender-ai-frontend";

// Dialog 是置中彈窗（Esc / 點背景關閉）。Tender AI 用它做「承接確認問卷」等
// 需要使用者明確決策的流程。Dialog 為全幅 overlay，預覽以 open 常駐、單格呈現
// （cardMode: single）。
//
// 注意：design-sync 的單格容器 .ds-single 帶 transform，會成為 position:fixed
// 後代的 containing block；Dialog 最外層即 fixed inset-0，若容器無高度，inset:0
// 會被解析成「頂部零高度盒」→ 彈窗貼頂被裁切。故以 min-height:100vh 的 in-flow
// 包裹層撐出全視窗高度，讓 fixed overlay 能正確置中。

const noop = () => {};

export const AcceptQuestionnaire = () => (
  <div style={{ minHeight: "100vh" }}>
    <Dialog
      open
      onClose={noop}
      width="sm:max-w-md"
      title="承接確認"
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost">略過</Button>
          <Button variant="primary">確認承接</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>
            標案
          </div>
          <div style={{ fontWeight: 600 }}>
            臺北市立大同國小校舍耐震補強統包工程
          </div>
          <div style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>
            臺北市政府教育局 ・ 預算 NT$ 28,500,000
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
            可行度 88
          </div>
          <FeasibilityMeter value={88} />
        </div>
        <div>
          <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
            為何承接？（可複選）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Badge variant="success">耐震補強實績</Badge>
            <Badge variant="default">預算合理</Badge>
            <Badge variant="outline">地點便利</Badge>
          </div>
        </div>
      </div>
    </Dialog>
  </div>
);
