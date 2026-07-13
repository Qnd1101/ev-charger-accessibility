import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * E2E 전용 빌드 설정. 실 개발자의 `public/data`(로컬에서 재생성한 진짜 집계일 수 있다)를
 * 건드리지 않기 위해 publicDir 을 합성 픽스처 산출물(e2e/.output/public)로 바꾼다.
 * 빌드 산출물도 `dist/`(전역 gitignore, 로컬 프리뷰용)가 아니라 e2e 전용 경로에 낸다.
 */
export default defineConfig({
  root: ".",
  plugins: [react()],
  publicDir: "e2e/.output/public",
  build: { outDir: "e2e/.output/dist", emptyOutDir: true },
});
