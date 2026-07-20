<!-- Parent: ../../AGENTS.md -->

# prototype/e2e/fixtures

## Purpose

Playwright E2E용 최소 합성 스냅샷을 실제 파이프라인(`clean.py`→`metrics.py`→`build_web_data.py`)에 그대로 돌려 결정적인 E2E 데이터셋을 만드는 독립 스크립트. `tests/test_pipeline.py`의 합성 스냅샷 패턴과 같은 접근이지만, pytest 밖(Playwright `webServer` 기동 이전)에서 실행 가능하도록 별도 스크립트로 분리했다.

## Key Files

| File | Description |
|------|--------------|
| `build_e2e_fixture.py` | 서울 종로구(zscode 11110) 3행 + 부산 중구(26110) 2행의 합성 충전기 데이터를 만들고, 실제 `clean.py`/`metrics.py`/`build_web_data.py`를 호출해 `prototype/e2e/.output/`(gitignore 대상)에 산출물을 생성. 급속/완속 혼재 충전소, 무효 좌표 1건, 운영기관 미진출 1건(중구에 한국전력공사 없음)을 의도적으로 포함 |

## For AI Agents

### Working In This Directory

- 이 스크립트는 집계 로직을 재구현하지 않는다 — 실제 파이프라인 함수를 임포트해서 돌린다. 재구현하면 "회귀 테스트가 실제로 파이프라인을 검증하는가"라는 질문이 항상 참이 되어버려(항진명제) 테스트의 의미가 없어진다는 것이 이 파일의 설계 이유다.
- 참조 데이터(`zscode_map.csv`, `sido_name_map.csv`, `sigungu.topo.json`)는 합성하지 않고 실제 커밋된 `data/ref/` 자산을 그대로 쓴다. 합성 대상은 충전기·인구·EV 원자료뿐이다.
- 기대값(expected values)은 이 스크립트의 docstring이 아니라 `prototype/e2e/tests`의 `EXPECTED` 상수에 둔다 — 테스트가 기대값의 단일 출처를 갖게 하려는 의도다. 픽스처를 바꾸면 그쪽 상수도 함께 갱신한다.
- 출력 경로(`DATA_OUT = e2e/.output/public/data`)는 `vite.e2e.config.ts`의 `publicDir` 규약과 맞물려 있다 — 경로를 바꾸면 그 설정도 함께 바꾼다.

### Testing Requirements

- `python prototype/e2e/fixtures/build_e2e_fixture.py` 실행 후 산출물은 `tests/test_e2e_data_contract.py`(Python, 손계산 값 검증)와 `prototype/e2e/tests/*.spec.ts`(Playwright, 브라우저 렌더 값 검증) 양쪽에서 같은 데이터를 기대한다.
- `npm run pretest:e2e`가 이 스크립트를 자동 실행한다(venv Python 우선, 없으면 `python3` 폴백).

## Dependencies

### Internal
- `src/clean.py`, `src/metrics.py`, `scripts/build_web_data.py`(모두 `sys.path.insert`로 임포트)
- `data/ref/zscode_map.csv`, `sido_name_map.csv`, `sigungu.topo.json`(실제 자산 재사용)
- 소비자: `tests/test_e2e_data_contract.py`, `prototype/e2e/tests/*.spec.ts`
