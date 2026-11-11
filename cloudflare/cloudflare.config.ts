import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "stanford-lambdas-lineage",
    compatibilityDate: "2026-10-18",
    entrypoint,
    domains: ["stanfordlambdas.org"],
  },
});
