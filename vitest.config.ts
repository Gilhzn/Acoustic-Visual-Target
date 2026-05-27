import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/index.ts", "packages/lab/src/cli.ts"],
    },
  },
});
