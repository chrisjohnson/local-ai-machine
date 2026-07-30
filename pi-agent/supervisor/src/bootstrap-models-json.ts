// Writes ~/.pi/agent/models.json (scoped to this service's own
// PI_CONFIG_DIR, not the host user's real ~/.pi) declaring litellm as an
// OpenAI-compatible provider serving the `coder` model. Written at every
// startup from env vars so the provider wiring is fully reproducible from
// docker-compose.yml + docker/.env - never a manual one-off edit on the
// box (see M-030 decision log: the manual ~/.pi/agent/models.json used for
// the spike was explicitly flagged as NOT reproducible; this closes that
// gap for the real deployed service).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BootstrapModelsOptions {
  piConfigDir: string;
  providerName: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  contextWindow?: number;
  maxTokens?: number;
}

export function writeModelsJson(options: BootstrapModelsOptions): void {
  const agentDir = join(options.piConfigDir, "agent");
  mkdirSync(agentDir, { recursive: true });

  // contextWindow/maxTokens match the actual live llama.cpp command line
  // for qwen3.6-35b-a3b-mtp confirmed in M-030 (`-c 131072 -n 8192`), not
  // guessed - kept overridable via env in case the served model changes
  // (see scripts/set-role.sh, which can repoint `coder` at any time).
  const config = {
    providers: {
      [options.providerName]: {
        baseUrl: options.baseUrl,
        api: "openai-completions",
        apiKey: options.apiKey,
        compat: {
          supportsDeveloperRole: false,
        },
        models: [
          {
            id: options.modelId,
            name: `Local ${options.modelId} (litellm)`,
            reasoning: false,
            input: ["text"],
            contextWindow: options.contextWindow ?? 131072,
            maxTokens: options.maxTokens ?? 8192,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };

  writeFileSync(join(agentDir, "models.json"), JSON.stringify(config, null, 2));
}
