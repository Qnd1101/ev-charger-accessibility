"""한국환경공단 전기자동차 충전소 정보 수집.

getChargerInfo 를 전수 페이징해 원본 스냅샷 Parquet 을 만든다.
getChargerStatus 는 호출하지 않는다 -- getChargerInfo 응답이 이미 stat/statUpdDt 를 포함한다.

usage:
    python src/collect.py            # 오늘 스냅샷이 이미 있으면 skip
    python src/collect.py --force    # 강제 재수집
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ENDPOINT = "https://apis.data.go.kr/B552584/EvCharger/getChargerInfo"
NUM_OF_ROWS = 9999  # API 명세상 최대값

# 일 1,000회 쿼터를 페이징 버그로 태우는 사고를 막는 하드 상한.
# 전수 수집은 약 53회면 끝난다 (521,329 / 9,999).
MAX_CALLS = 80

RETRIES = 3
SLEEP_BETWEEN_CALLS = 0.3

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"


class QuotaGuardError(RuntimeError):
    """MAX_CALLS 상한을 넘어서려 할 때."""


def load_api_key() -> str:
    load_dotenv()
    key = os.environ.get("EV_API_KEY", "").strip()
    if not key or key.startswith("여기에"):
        sys.exit(
            "EV_API_KEY 가 설정되지 않았습니다.\n"
            "  cp .env.example .env  후 .env 에 data.go.kr 인증키를 넣으세요."
        )
    return key


def fetch_page(session: requests.Session, key: str, page_no: int) -> dict:
    params = {
        "serviceKey": key,
        "numOfRows": NUM_OF_ROWS,
        "pageNo": page_no,
        "dataType": "JSON",
    }
    last_error = ""
    for attempt in range(RETRIES):
        try:
            resp = session.get(ENDPOINT, params=params, timeout=60)
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("resultCode") == "00":
                return payload
            # resultMsg 는 API 가 준 문자열이다. 그대로 예외/로그에 실으면
            # 응답 내용이 진단 메시지로 반사된다 -- 코드만 남긴다.
            last_error = f"resultCode={payload.get('resultCode')}"
        except requests.RequestException as exc:
            status = exc.response.status_code if exc.response is not None else None
            last_error = f"HTTP {status} {type(exc).__name__}" if status else type(exc).__name__
        except ValueError as exc:
            last_error = type(exc).__name__
        time.sleep(2**attempt)  # 지수 백오프
    raise RuntimeError(f"page {page_no} 수집 실패 ({RETRIES}회 시도): {last_error}")


def collect(force: bool = False) -> Path:
    today = datetime.now().strftime("%Y%m%d")
    out_path = RAW_DIR / f"chargers_{today}.parquet"

    if out_path.exists() and not force:
        print(f"오늘 스냅샷이 이미 있습니다: {out_path}")
        print("재수집하려면 --force 를 쓰세요. (API 쿼터 낭비 방지)")
        return out_path

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    key = load_api_key()
    calls = 0

    with requests.Session() as session:
        first = fetch_page(session, key, 1)
        calls += 1

        # int() 가 그냥 터지면 API 가 준 값이 ValueError 메시지로 반사된다.
        # from None 으로 체이닝까지 끊는다.
        try:
            total_count = int(first["totalCount"])
        except (KeyError, TypeError, ValueError):
            raise RuntimeError(
                "totalCount 가 없거나 정수가 아닙니다 -- 수집을 중단합니다."
            ) from None

        pages = math.ceil(total_count / NUM_OF_ROWS)
        print(f"totalCount={total_count:,} -> {pages} pages (numOfRows={NUM_OF_ROWS})")

        if pages > MAX_CALLS:
            raise QuotaGuardError(
                f"필요 호출 수 {pages} 가 MAX_CALLS={MAX_CALLS} 를 초과합니다. "
                "API 응답이 예상과 다릅니다 -- 수집을 중단합니다."
            )

        rows = list(first["items"]["item"])
        for page_no in range(2, pages + 1):
            if calls >= MAX_CALLS:
                raise QuotaGuardError(f"MAX_CALLS={MAX_CALLS} 도달 -- 수집을 중단합니다.")
            time.sleep(SLEEP_BETWEEN_CALLS)
            payload = fetch_page(session, key, page_no)
            calls += 1
            rows.extend(payload["items"]["item"])
            print(f"  page {page_no}/{pages} ({len(rows):,} rows)", flush=True)

    df = pd.DataFrame(rows).astype("string")

    # 페이징 중 totalCount 가 바뀌거나 한 페이지가 부분 응답을 주면 조용한 과소집계가 된다.
    # 손상된 스냅샷을 저장하느니 여기서 터뜨린다 -- 하류는 이걸 알 방법이 없다.
    if len(df) != total_count:
        raise RuntimeError(
            f"수집 행 수가 totalCount 와 다릅니다: {len(df):,} != {total_count:,}. "
            "스냅샷을 저장하지 않았습니다. --force 로 다시 시도하세요."
        )

    df.to_parquet(out_path, index=False)

    meta = {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "total_count": total_count,
        "pages": pages,
        "api_calls_used": calls,
        "rows": len(df),
    }
    out_path.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"\n저장: {out_path}")
    print(f"행 수: {len(df):,} (totalCount {total_count:,})")
    print(f"API 호출 횟수: {calls} / 제한 1000")

    return out_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="오늘 스냅샷이 있어도 재수집")
    collect(force=ap.parse_args().force)


if __name__ == "__main__":
    main()
