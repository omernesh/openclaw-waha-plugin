import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    // Exclude React component tests — those use the jsdom config at src/admin/vitest.config.ts
    exclude: ["**/node_modules/**", "**/dist/**", "src/admin/**"],
  },
});
