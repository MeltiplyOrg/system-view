/**
 * Single Vite+ configuration for dev, production build, Oxfmt/Oxlint checks,
 * and Vitest. Keeping one file prevents the formatter, linter, and test runner
 * from drifting apart; CI calls the same `vp check` and `vp test` entrypoints.
 */
import { defineConfig } from "vite-plus";

/**
 * Paths excluded from format/lint. Generated output and lockfiles are owned by
 * tooling; AGENTS.md is excluded so the policy text stays verbatim.
 */
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
      // Type-aware rules and full type checking run through the TS7/tsgolint
      // path, so `vp check` is the static-analysis source of truth in CI.
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    // Unit tests cover deterministic geometry and validation. Browser/gesture
    // wiring is exercised by Playwright, so those modules are excluded from
    // this coverage gate instead of being mocked here.
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/scene.ts"],
      reporter: ["text", "lcov"],
      skipFull: false,
      thresholds: {
        // Per-file gates prevent one large, well-covered module from hiding a
        // weak module. Branch allowance reflects defensive validation paths.
        perFile: true,
        lines: 90,
        functions: 95,
        statements: 85,
        branches: 85,
      },
    },
  },
});
