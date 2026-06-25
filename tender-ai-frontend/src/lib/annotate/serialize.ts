// annotations → 結構化 Markdown（純函式，可單測）。
// 產物給 Claude Code CLI 讀：依頁面分組，每筆含 selector／元件猜測／類型／嚴重度／建議內容。

import type { Annotation, AnnotationSeverity, AnnotationType } from "./types";

const TYPE_LABEL: Record<AnnotationType, string> = {
  visual: "視覺",
  interaction: "互動",
  copy: "文案",
  layout: "版面",
  other: "其他",
};

const SEVERITY_LABEL: Record<AnnotationSeverity, string> = {
  suggest: "建議",
  important: "重要",
  blocker: "阻擋",
};

const SEVERITY_MARK: Record<AnnotationSeverity, string> = {
  suggest: "·",
  important: "!",
  blocker: "‼",
};

export function typeLabel(t: AnnotationType): string {
  return TYPE_LABEL[t] ?? t;
}

export function severityLabel(s: AnnotationSeverity): string {
  return SEVERITY_LABEL[s] ?? s;
}

export function severityMark(s: AnnotationSeverity): string {
  return SEVERITY_MARK[s] ?? "·";
}

function formatOne(a: Annotation, index: number): string {
  const lines = [
    `${index}. **${SEVERITY_MARK[a.severity]} ${typeLabel(a.type)}** — ${
      a.comment.trim() || "（未填寫建議）"
    }`,
    `   - 元件：\`${a.componentGuess || "未知"}\``,
    `   - 選擇器：\`${a.selector}\``,
  ];
  if (a.textSnapshot) lines.push(`   - 原文：「${a.textSnapshot}」`);
  lines.push(
    `   - 嚴重度：${severityLabel(a.severity)} ｜ 時間：${a.createdAt}`,
  );
  return lines.join("\n");
}

/**
 * 把一批標註序列化成 Markdown。依 route 分組，組內依建立時間排序。
 * @param annotations 標註清單
 * @param stamp 產生時間（ISO 字串，由呼叫端提供，方便測試固定值）
 */
export function serializeAnnotations(
  annotations: Annotation[],
  stamp: string,
): string {
  if (annotations.length === 0) {
    return `## 設計回饋（${stamp}）\n\n（無標註）\n`;
  }

  const byRoute = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const list = byRoute.get(a.route) ?? [];
    list.push(a);
    byRoute.set(a.route, list);
  }

  const blocks: string[] = [
    `## 設計回饋（${stamp}）`,
    `共 ${annotations.length} 則，跨 ${byRoute.size} 個頁面。`,
  ];

  for (const [route, list] of byRoute) {
    list.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    blocks.push(`\n### 頁面：\`${route}\``);
    blocks.push(list.map((a, i) => formatOne(a, i + 1)).join("\n\n"));
  }

  return `${blocks.join("\n")}\n`;
}
