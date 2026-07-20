<!-- Parent: ../AGENTS.md -->

# prototype/scripts

## Purpose

빌드 후 실행되는 Node 유틸리티 스크립트. `package.json`의 `postbuild` 훅에서 자동 실행된다.

## Key Files

| File | Description |
|------|--------------|
| `check-bundle-size.mjs` | `dist/assets/`의 프로덕션 JS 총량이 상한(1,664,668 bytes, 측정 기준선의 약 115%)을 넘는지, `echarts` 전체 패키지 임포트로 회귀했는지(문자열 시그니처 검사) 확인. `npm run build` 실행 후 `dist/`가 최신이라고 가정하며 스스로 빌드를 호출하지 않는다 |

## For AI Agents

### Working In This Directory

- 이 스크립트는 Node 빌트인(`node:fs`, `node:path`, `node:url`)만 쓴다 — 새 의존성을 추가하지 않는다.
- `CEILING_BYTES` 상한을 올리려면 실제로 필요한 변경(예: 새 시각화 라이브러리 추가)인지 먼저 확인한다. echarts를 `import * as echarts from "echarts"`(전체 패키지)로 바꾸면 이 검사가 실패하도록 설계되어 있다 — 개별 모듈 임포트(`echarts/core` + 필요한 차트/컴포넌트/렌더러)를 유지한다.
- `npm run check-bundle-size`는 `postbuild`에 연결되어 있어 `npm run build`만 실행해도 자동으로 돈다.

## Dependencies

### Internal
- `prototype/dist/`(빌드 산출물, 생성됨) 대상으로 실행된다.

### External
- Node.js 빌트인 모듈만 사용.
