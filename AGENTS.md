# 저장소 에이전트 지침

## Purpose

대한민국 공공데이터(한국환경공단 충전소 정보, 한국전력공사 전기차 등록, 행정안전부 주민등록 인구, 국가데이터처 SGIS 경계)를 결합해 전기차 충전 인프라의 지리적 분포와 수요 대비 공급 부족 지역을 보여주는 프로젝트다. Python 데이터 파이프라인(`src/`, `scripts/`)이 원본 수집·정제·지표(M1~M5) 산출을 전담하고, React 단일 페이지 대시보드(`prototype/`)가 Python이 미리 계산한 정적 희소 집계 JSON만 읽어 화면을 그린다. 지표 공식은 `src/metric_specs.py` 한 곳에만 있고 UI는 재구현하지 않는다.

## Key Files

| File | Description |
|------|--------------|
| `README.md` | 설치·실행·API 쿼터·인구 데이터·인천 개편·전남광주 통합·데이터 함정 등 실전 운영 가이드 |
| `CONTEXT.md` | 도메인 용어(충전기/충전소/M1~M5/희소 집계 등)와 프로젝트 경계 정의 |
| `DESIGN.md` | React 대시보드(Split Command) 화면 구조·구현 제약 |
| `requirements.txt` / `requirements.lock` | Python 의존성 입력 파일과 해시 고정 잠금 파일(`uv pip compile`로 생성) |
| `.env.example` | `EV_API_KEY` 등 환경변수 템플릿 (`.env`는 커밋 제외) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `data/` | 원본·정제·참조 데이터 (raw/processed는 생성 산출물이라 대부분 커밋 제외, `data/ref/`만 커밋) |
| `docs/` | 데이터 출처, ADR, 에이전트 운영 규칙, 조사 기록 |
| `prototype/` | React + Vite 대시보드(Split Command), Vitest 단위 테스트, Playwright E2E |
| `scripts/` | 참조데이터·인구 병합·브리지·화면용 JSON 생성 스크립트 |
| `src/` | Python 수집(`collect.py`)·정제(`clean.py`)·지표(`metrics.py`, `metric_specs.py`)·지역코드(`regions.py`) 파이프라인 |
| `tests/` | Python pytest 스위트 (단위 + 통합 + 데이터 계약) |

## For AI Agents

### Working In This Directory

- 사용자 대화와 설명 문서는 한국어로 작성한다.
- `data/processed/`와 API 스냅샷은 생성 산출물이므로 커밋하지 않는다.
- 수집 API 쿼터를 보호하기 위해 기존 스냅샷이 있으면 `collect.py --force`를 실행하지 않는다.
- 지표 정의는 Python 데이터 파이프라인을 유일한 원본으로 유지하고 UI에서 재구현하지 않는다.
- 새 회귀 테스트는 결함을 주입했을 때 실제로 실패하는지 확인한다.

## Agent skills

### Issue tracker

작업과 스펙은 `Qnd1101/ev-charger-accessibility`의 GitHub Issues에서 관리하며 외부 PR은 triage 요청 표면으로 사용하지 않는다. 자세한 내용은 `docs/agents/issue-tracker.md`를 참고한다.

### Triage labels

기본 영문 라벨 `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`를 사용한다. 자세한 내용은 `docs/agents/triage-labels.md`를 참고한다.

### Domain docs

루트 `CONTEXT.md`와 `docs/adr/`를 사용하는 단일 컨텍스트 구조다. 자세한 내용은 `docs/agents/domain.md`를 참고한다.
