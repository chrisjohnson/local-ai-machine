// Writes <PI_CODING_AGENT_DIR>/models.json (scoped to this service's own
// config dir, not the host user's real ~/.pi/agent) declaring litellm as
// an OpenAI-compatible provider serving the `coder` model. Written at
// every startup from env vars so the provider wiring is fully
// reproducible from docker-compose.yml + docker/.env - never a manual
// one-off edit on the box (see M-030 decision log: the manual
// ~/.pi/agent/models.json used for the spike was explicitly flagged as
// NOT reproducible; this closes that gap for the real deployed service).
//
// PI_CODING_AGENT_DIR is pi's own env var (confirmed in
// docs/environment-variables.md) that overrides its config dir directly -
// it already points AT the "agent" directory (default `~/.pi/agent`), not
// its parent `~/.pi`. Do not add an extra "agent" path segment here (a
// real bug hit and fixed during M-031: pi looks for
// <PI_CODING_AGENT_DIR>/models.json, and writing to
// <PI_CODING_AGENT_DIR>/agent/models.json silently produced "Unknown
// provider" errors instead of a "file not found" - it's a config lookup,
// not a hard failure, so the mistake didn't surface until the first real
// spawn attempt).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BootstrapModelsOptions {
  piCodingAgentDir: string;
  providerName: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  contextWindow?: number;
  maxTokens?: number;
}

export function writeModelsJson(options: BootstrapModelsOptions): void {
  const agentDir = options.piCodingAgentDir;
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
