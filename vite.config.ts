import { defineConfig } from "vite-plus";

const ignored = [
  ".agents/**",
  "dist/**",
  "coverage/**",
  "test-results/**",
  "playwright-report/**",
  "skills-lock.json",
  "bun.lock",
  "AGENTS.md",
];

export default defineConfig({
  fmt: {
    ignorePatterns: ignored,
    printWidth: 80,
    tabWidth: 2,
    singleQuote: false,
    semi: true,
  },
  lint: {
    ignorePatterns: ignored,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/scene.ts"],
      reporter: ["text", "lcov"],
      skipFull: false,
      thresholds: {
        perFile: true,
        lines: 90,
        functions: 95,
        statements: 85,
        branches: 85,
      },
    },
  },
});
