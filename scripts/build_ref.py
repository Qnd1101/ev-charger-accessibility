"""참조데이터 생성: zscode_map.csv, sido_name_map.csv

zscode/zcode 코드표는 한국환경공단 OpenAPI 활용가이드(.docx)의 공통코드 절에만 존재한다.
docx 경로는 인자로 받는다 -- 소스에 외부 절대경로를 박지 않기 위함.

usage:
    python scripts/build_ref.py --docx /path/to/활용가이드.docx
"""

from __future__ import annotations

import argparse
import csv
import re
import zipfile
from pathlib import Path

REF_DIR = Path(__file__).resolve().parent.parent / "data" / "ref"

# 한전 CSV 헤더의 축약 시도명 -> 행정구역 zcode.
# 한전은 "강원"/"전북"을 쓰고 행정구역 정식명은 "강원특별자치도"/"전북특별자치도"라 직접 매칭되지 않는다.
KEPCO_TO_ZCODE = {
    "서울": "11",
    "부산": "26",
    "대구": "27",
    "인천": "28",
    "광주": "29",
    "대전": "30",
    "울산": "31",
    "세종": "36",
    "경기": "41",
    "충북": "43",
    "충남": "44",
    "전남": "46",
    "경북": "47",
    "경남": "48",
    "제주": "50",
    "강원": "51",
    "전북": "52",
}


def _docx_text(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    xml = xml.replace("</w:p>", "\n").replace("</w:tc>", "\t")
    text = re.sub(r"<[^>]+>", "", xml)
    return re.sub(r"\n{2,}", "\n", text)


def _parse_codes(segment: str, width: int) -> list[tuple[str, str]]:
    pairs = re.findall(rf"(\d{{{width}}})\n\t([^\n\t]+)\n\t", segment)
    return [(code, name.strip()) for code, name in pairs]


def build(docx_path: Path) -> tuple[int, int]:
    text = _docx_text(docx_path)

    # 공통코드 절은 문서 끝부분에 있다. 목차의 같은 문구와 겹치지 않도록 rfind 사용.
    zcode_start = text.rfind("zcode(지역구분 코드)")
    zscode_start = text.rfind("지역구분상세")
    zscode_end = text.rfind("충전소 구분 코드")
    if min(zcode_start, zscode_start, zscode_end) < 0:
        raise RuntimeError("활용가이드에서 공통코드 절을 찾지 못했습니다")

    sido_by_zcode = dict(_parse_codes(text[zcode_start:zscode_start], width=2))
    sigungu_pairs = _parse_codes(text[zscode_start:zscode_end], width=5)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    with (REF_DIR / "zscode_map.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["zscode", "zcode", "sido", "sigungu"])
        for zscode, sigungu in sigungu_pairs:
            zcode = zscode[:2]
            w.writerow([zscode, zcode, sido_by_zcode[zcode], sigungu])

    with (REF_DIR / "sido_name_map.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["kepco_name", "zcode", "sido_full"])
        for kepco_name, zcode in KEPCO_TO_ZCODE.items():
            w.writerow([kepco_name, zcode, sido_by_zcode[zcode]])

    return len(sigungu_pairs), len(KEPCO_TO_ZCODE)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx", required=True, type=Path, help="OpenAPI 활용가이드 docx 경로")
    args = ap.parse_args()

    n_zscode, n_sido = build(args.docx)
    print(f"zscode_map.csv: {n_zscode} rows")
    print(f"sido_name_map.csv: {n_sido} rows")


if __name__ == "__main__":
    main()
