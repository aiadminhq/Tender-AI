// 標註工具共用型別（單一事實來源）。

export const ANNOTATION_TYPES = [
  "visual",
  "interaction",
  "copy",
  "layout",
  "other",
] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const ANNOTATION_SEVERITIES = [
  "suggest",
  "important",
  "blocker",
] as const;
export type AnnotationSeverity = (typeof ANNOTATION_SEVERITIES)[number];

export interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: string;
  route: string;
  selector: string;
  componentGuess: string;
  textSnapshot: string;
  rect: AnnotationRect;
  type: AnnotationType;
  severity: AnnotationSeverity;
  comment: string;
  createdAt: string; // ISO 8601
}

export const DESIGN_FEEDBACK_TARGETS = [
  "local",
  "backend",
  "claude",
  "codex",
  "hermes",
  "opencode",
  "antigravity",
  "gemini",
] as const;
export type DesignFeedbackTarget = (typeof DESIGN_FEEDBACK_TARGETS)[number];
