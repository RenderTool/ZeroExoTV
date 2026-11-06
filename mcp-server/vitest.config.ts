import { defineConfig } from "vitest/config";

// mcp-server 独立于前端 workspace 的测试配置，避免继承根 vitest 配置的 include 规则
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
