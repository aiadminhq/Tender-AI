#!/usr/bin/env python3
"""Mistral OCR runner（mistralai 1.x 相容）。

bundled 的 ocr-contract-scan 技能腳本用的是舊 0.x import 路徑
(`mistralai.client.sdk`)，在 1.x 已不存在。此 runner 用正確的 1.x
top-level import，其餘流程相同：base64 內嵌影像 → ocr.process → 逐頁 markdown。

金鑰只從 .env 讀（MISTRAL_API_KEY），絕不寫入輸出/日誌。
雲端上傳提醒：Mistral OCR 是雲端 API，會上傳影像；敏感件請改本地 Tesseract。

用法：python run_ocr.py <影像> [輸出目錄=ocr_results_mistral]
"""
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path

from mistralai import Mistral, ImageURLChunk


def load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> None:
    src = Path(sys.argv[1])
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "ocr_results_mistral")
    out_dir.mkdir(parents=True, exist_ok=True)

    load_dotenv()
    api_key = os.environ.get("MISTRAL_API_KEY")
    if not api_key:
        raise SystemExit("MISTRAL_API_KEY not set (.env)")

    mime = mimetypes.guess_type(src.name)[0] or "image/png"
    encoded = base64.b64encode(src.read_bytes()).decode("ascii")
    document = ImageURLChunk(image_url=f"data:{mime};base64,{encoded}")

    client = Mistral(api_key=api_key, timeout_ms=180000)
    response = client.ocr.process(document=document, model="mistral-ocr-latest")

    payload = json.loads(response.model_dump_json())
    pages = payload.get("pages", [])
    markdown = "\n\n".join(p.get("markdown", "") for p in pages)

    stem = src.stem
    md_path = out_dir / f"{stem}.mistral.md"
    json_path = out_dir / f"{stem}.mistral.json"
    md_path.write_text(markdown, encoding="utf-8")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"pages: {len(pages)}")
    print(f"chars: {len(markdown)}")
    print(f"md:   {md_path}")
    print(f"json: {json_path}")


if __name__ == "__main__":
    main()
