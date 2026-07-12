"""행정구역 코드 체계의 단일 출처.

통합 지역이 또 생기면(2027?) 여기만 고치면 된다. 이 상수들이 clean.py 와
scripts/build_bridge.py 에 따로 박혀 있으면 한쪽만 고치고 넘어가기 쉽다.
"""

from __future__ import annotations

# 2026년 신설 전남광주통합특별시. 참조 데이터(한전 EV, 주민등록)가 아직 분리 체계라
# 조인을 성립시키려면 레거시 코드로 되돌려야 한다. clean.canonicalize_region 참조.
MERGED_ZCODE = "12"
LEGACY_ZCODES = ["29", "46"]  # 광주광역시, 전라남도

# 세종특별자치시: 시군구가 없는 유일한 광역단체.
# 주민등록에는 시도 행 하나로만 나오는데 충전소 API 는 zscode=36110 을 준다.
SEJONG_CODE10 = "3600000000"
SEJONG_ZSCODE = "36110"

NATIONWIDE_CODE10 = "1000000000"  # 주민등록 "전국" 합계행

# 대한민국 본토 + 제주 경계. 이 밖의 좌표는 지도에 찍을 수 없다.
LAT_MIN, LAT_MAX = 33.0, 38.7
LNG_MIN, LNG_MAX = 124.5, 131.9
