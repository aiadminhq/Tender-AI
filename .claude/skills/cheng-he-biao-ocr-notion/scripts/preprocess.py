#!/usr/bin/env python3
"""呈核表照片前處理：去陰影 / 勻光 / 增對比，輸出近黑白掃描檔。

實測結論（見 SKILL.md）：中文密集手寫/印刷欄位，**灰階版 (_gray.png) 的
OCR 準確率高於純黑白版 (_bw.png)** — adaptive threshold 會斷筆或糊筆。
因此下游 OCR 預設吃 `_gray.png`；`_bw.png` 僅供人眼對照 / 存證。

Pipeline:
  1. 每通道背景勻光估計 (dilate -> median blur)。
  2. 去陰影：255 - absdiff(plane, background) 後 min-max 正規化。
  3. 灰階 + CLAHE 局部對比 → _gray.png（OCR 主來源）。
  4. adaptive threshold 二值化 → _bw.png（對照/存證）。

用法：python preprocess.py <輸入影像> <輸出前綴>
"""
import sys

import cv2
import numpy as np

src = sys.argv[1]
out_prefix = sys.argv[2]

img = cv2.imread(src, cv2.IMREAD_COLOR)
if img is None:
    raise SystemExit(f"cannot read {src}")
h, w = img.shape[:2]
print(f"input {w}x{h}")

# --- 1 & 2: 每通道去陰影 / 勻光 -------------------------------------------
planes = cv2.split(img)
norm_planes = []
for p in planes:
    dilated = cv2.dilate(p, np.ones((7, 7), np.uint8))
    bg = cv2.medianBlur(dilated, 21)          # 勻光 + 陰影圖
    diff = 255 - cv2.absdiff(p, bg)           # 攤平：紙面 -> 白
    norm = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8UC1)
    norm_planes.append(norm)
shadow_free = cv2.merge(norm_planes)
cv2.imwrite(f"{out_prefix}_shadowfree.png", shadow_free)

# --- 3: 灰階 + 局部對比 (CLAHE) → OCR 主來源 -----------------------------
gray = cv2.cvtColor(shadow_free, cv2.COLOR_BGR2GRAY)
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
gray_eq = clahe.apply(gray)
gray_eq = cv2.normalize(gray_eq, None, 0, 255, cv2.NORM_MINMAX)
cv2.imwrite(f"{out_prefix}_gray.png", gray_eq)

# --- 4: adaptive threshold → 純黑白（對照用） ----------------------------
bw = cv2.adaptiveThreshold(
    gray_eq, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv2.THRESH_BINARY, blockSize=35, C=15,
)
bw = cv2.medianBlur(bw, 3)
cv2.imwrite(f"{out_prefix}_bw.png", bw)

dark_ratio = float((bw < 128).mean())
print(f"bw dark pixel ratio: {dark_ratio:.4f}")
print(f"OCR 主來源建議用：{out_prefix}_gray.png")
print("done")
