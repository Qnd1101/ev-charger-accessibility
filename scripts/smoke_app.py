"""대시보드 스모크 테스트.

Streamlit 은 정적 셸을 HTTP 200 으로 먼저 주고 스크립트 본문은 웹소켓 연결 후에 실행한다.
즉 app.py 에 AttributeError 가 있어도 HTTP 200 은 나온다 -- HTTP 체크만으로는 렌더를 증명 못한다.
그래서 스크립트 본문을 직접 실행해 예외 없이 완주하는지 본다.

usage:
    python scripts/smoke_app.py
"""

from __future__ import annotations

import contextlib
import os
import runpy
import sys
import time
from pathlib import Path

# bare 실행 시 Streamlit 은 "streamlit run 을 쓰세요" 경고를 띄우는데, 그 과정에서
# inspect.stack() 이 lstat 을 11,000번 호출해 4.7초를 태운다. `streamlit run` 에서는
# 실행되지 않는 경로다. 끄지 않으면 렌더 시간이 아니라 이 경고를 재게 된다.
os.environ.setdefault("STREAMLIT_GLOBAL_SHOW_WARNING_ON_DIRECT_EXECUTION", "false")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))


RENDER_BUDGET_S = 5.0


def main() -> None:
    app = ROOT / "src" / "app.py"

    # 라이브러리 import(streamlit/pandas/pydeck 합계 ~7s)는 서버 부팅 시 1회 드는 비용이고
    # 렌더마다 드는 비용이 아니다. 렌더 예산에 포함시키면 엉뚱한 걸 재게 된다.
    t = time.perf_counter()
    import pandas  # noqa: F401
    import pydeck  # noqa: F401
    import streamlit  # noqa: F401
    from streamlit import delta_generator

    warm = time.perf_counter() - t
    print(f"라이브러리 import (부팅 1회): {warm:.2f}s")

    # bare 모드 경고 경로를 무력화한다 (위 주석 참조).
    delta_generator._maybe_print_use_warning = lambda *a, **k: None

    start = time.perf_counter()
    # st.stop() 은 SystemExit 를 던진다 -- 정상 흐름이다 (데이터 없음 안내 등).
    with contextlib.suppress(SystemExit):
        runpy.run_path(str(app), run_name="__main__")
    elapsed = time.perf_counter() - start

    print(f"app.py 본문 실행: 예외 없음 ({elapsed:.2f}s)")
    if elapsed > RENDER_BUDGET_S:
        print(f"FAIL: 렌더 경로 {elapsed:.1f}s > 예산 {RENDER_BUDGET_S}s")
        sys.exit(1)
    print("SMOKE PASS")


if __name__ == "__main__":
    main()
