import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    // e2e/ 는 Playwright 전용 스위트다(별도 test-runner, playwright.config.ts).
    // Vitest 기본 glob 이 이것도 주워 "test.describe() 를 여기서 부를 수 없다"로 깨진다.
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
