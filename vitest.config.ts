import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // Several app-level tests lazy-load tools and exceed 5s when the whole suite runs in parallel
    testTimeout: 30000,
    setupFiles: ["./tests/setup.ts"],
    // plugins/*/tests are the tests of the ported plugins (W27). Each plugin also runs them alone with `npm test`.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}", "plugins/*/tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
