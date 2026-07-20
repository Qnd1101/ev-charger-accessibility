<!-- Parent: ../../AGENTS.md -->

# prototype/src/test

## Purpose

Vitest 전역 테스트 셋업. `vitest.config.ts`의 `setupFiles`가 참조한다.

## Key Files

| File | Description |
|------|--------------|
| `setup.ts` | jsdom 환경에서 필요한 전역 셋업(예: `@testing-library/jest-dom` matcher 등록) |

## For AI Agents

### Working In This Directory

- 여기는 테스트 전역 셋업 전용이다. 개별 컴포넌트 테스트는 `prototype/src/*.test.tsx`에 있다(같은 디렉터리, 인접 파일 패턴).
- 새 전역 matcher나 mock이 여러 테스트 파일에서 반복되면 여기에 추가하는 것을 고려한다.

## Dependencies

### External
- `@testing-library/jest-dom`, `jsdom` (`prototype/package.json` devDependencies)
