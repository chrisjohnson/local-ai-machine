/**
 * Config: loader/validator for `factory.config.yaml`, TS port of upstream
 * SSSF's `sssf.config.yaml` roster concept
 * (`adws/adw_modules/agents.py:load_config`/`validate`).
 *
 * ── Per-project quality-gate config lives in the target project's own repo ─
 * Earlier revisions of this module (M-065) kept per-project quality-gate
 * commands (`test`/`typecheck`/`lint`) centralized here, in a `projects:` map
 * keyed by absolute path inside `factory.config.yaml`. M-070 moved that OUT:
 * each target project now owns and versions its own `<project>/.pi-web-
 * factory.yaml` file (same shape, no path key needed — the file's location
 * IS the key). `factory.config.yaml` itself keeps only what's genuinely
 * pi-web-factory's own config: the agent roster (`defaults` + `agents`). See
 * `projectConfigFor` below for the project-local lookup this replaced.
 *
 * ── The provider/model-id bridge ────────────────────────────────────────
 * Upstream (and this project's own YAML, for human-readable authoring) writes
 * a model role as one combined string: `"local-litellm/big-moe"`. But
 * `piwebClient.ts`'s `setModel(baseUrl, sessionId, provider, modelId)` takes
 * TWO separate string parameters, not a combined string. Splitting that
 * string back apart ad hoc at every call site (M-066's chains, most likely)
 * would be exactly the kind of drift-prone duplication `envelopes.ts`'s
 * "synced triad" comment warns about elsewhere in this codebase — so the
 * split happens ONCE, here, at load time. Every agent entry in a loaded
 * `FactoryConfig` exposes both:
 *   - `model` — the raw `"provider/model-id"` string, for logging/tracing
 *     (matches upstream's own `agent.model` field shape, e.g. the
 *     `agent_start` event payload in `agents.py:97`).
 *   - `modelRef` — `{provider, modelId}`, ready to spread/pass directly into
 *     `setModel(baseUrl, sessionId, modelRef.provider, modelRef.modelId)`
 *     with no further parsing at the call site.
 *
 * ── Known limitation: validated shape, not validated reachability ────────
 * `parseModelRef`/the schema below only check that a model string is
 * WELL-FORMED (`provider/model-id`, both halves non-empty) — never that the
 * modelId actually exists as a live litellm role. Confirming that would mean
 * a network call to litellm's Model Management API at config-load time, which
 * this module deliberately does not make (load/validate has to work offline,
 * in tests, and before any target session exists). This is the same sharp
 * edge upstream SSSF's own README calls out: a stale/renamed model role fails
 * SILENTLY MID-CHAIN (the `POST /sessions/:id/model` call either 4xxs deep
 * inside a run or, worse, litellm accepts the request and the session just
 * behaves oddly), not at startup where it would be cheap to catch. Not
 * hypothetical for this box: a litellm role rename (`coder` -> `medium-moe`,
 * 2026-08-03) has already broken other integrations that assumed a role name
 * was stable. Reachability validation, if ever added, belongs in a separate
 * explicit preflight step (e.g. a `factory doctor` command hitting litellm's
 * `/v1/models`), not folded into this loader.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ── provider/model-id ────────────────────────────────────────────────────

export interface ModelRef {
  provider: string;
  modelId: string;
}

/**
 * Splits a `"provider/model-id"` string into the two-parameter shape
 * `piwebClient.ts`'s `setModel` takes. Requires exactly one `/`, with both
 * halves non-empty — a model-id itself may not contain further `/`
 * characters (none of this box's real roles do; if that ever changes, widen
 * this to split on the FIRST `/` instead of requiring exactly one).
 */
export function parseModelRef(raw: string): ModelRef {
  const parts = raw.split("/");
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new Error(
      `invalid model ${JSON.stringify(raw)}: expected exactly one "/" separating a non-empty ` +
        `provider from a non-empty model-id, e.g. "local-litellm/big-moe"`,
    );
  }
  return { provider: parts[0], modelId: parts[1] };
}

/** Zod refinement: a string that `parseModelRef` accepts. */
const ModelStringSchema = z.string().superRefine((value, ctx) => {
  try {
    parseModelRef(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

// ── Raw YAML shape ───────────────────────────────────────────────────────

const DefaultsSchema = z.object({
  model: ModelStringSchema,
  thinking: ThinkingLevelSchema,
  protected_files: z.array(z.string()).default([]),
});

const AgentEntrySchema = z.object({
  name: z.string().min(1),
  model: ModelStringSchema.optional(),
  thinking: ThinkingLevelSchema.optional(),
  // null/omitted = unrestricted (matches permissions.ts's isWritePermitted:
  // allowedWrites === null means unrestricted); [] = read-only; a populated
  // list restricts to exactly those paths (subject to protected_files).
  writes: z.array(z.string()).nullish(),
});

const RawFactoryConfigSchema = z.object({
  defaults: DefaultsSchema,
  agents: z.array(AgentEntrySchema).min(1),
});

// ── project-local quality-gate config (`<project>/.pi-web-factory.yaml`) ──

/** Filename each target project owns, at its own repo root (M-070). */
export const PROJECT_CONFIG_FILENAME = ".pi-web-factory.yaml";

const ProjectConfigFileSchema = z.object({
  test: z.string().optional(),
  typecheck: z.string().optional(),
  lint: z.string().optional(),
});

// ── Loaded/validated shape (what M-066 consumes) ────────────────────────

export interface AgentConfig {
  name: string;
  /** Raw "provider/model-id" string — logging/tracing, matches upstream's agent.model field. */
  model: string;
  /** Split form, ready for piwebClient.ts's setModel(baseUrl, sessionId, provider, modelId). */
  modelRef: ModelRef;
  thinking: z.infer<typeof ThinkingLevelSchema>;
  /** null = unrestricted, [] = read-only, populated = allowlist. See permissions.ts. */
  writes: string[] | null;
}

export interface ProjectConfig {
  /** Absolute path to the project this config was read from. */
  path: string;
  test?: string;
  typecheck?: string;
  lint?: string;
}

export interface FactoryConfig {
  defaults: {
    model: string;
    modelRef: ModelRef;
    thinking: z.infer<typeof ThinkingLevelSchema>;
    protectedFiles: string[];
  };
  agents: AgentConfig[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ── load ─────────────────────────────────────────────────────────────────

/**
 * Parses YAML text and validates it into a `FactoryConfig`. Unlike upstream's
 * `load_config` (which fills in each agent's missing fields from `defaults`
 * INSIDE the raw dict before Pydantic ever sees it, `agents.py:36-40`), the
 * default-fill here happens AFTER Zod validation of the raw shape, since Zod
 * v4's `.default()` only applies to a key that's `undefined`/absent, and an
 * agent entry legitimately omitting `model`/`thinking` should mean "inherit
 * defaults.*", not "field is missing, reject the config."
 */
export function loadConfigFromString(text: string, sourceLabel = "<config>"): FactoryConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${sourceLabel}: could not parse YAML: ${detail}`);
  }

  const result = RawFactoryConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`${sourceLabel}: invalid config:\n${issues}`);
  }
  const parsed = result.data;

  const defaults = {
    model: parsed.defaults.model,
    modelRef: parseModelRef(parsed.defaults.model),
    thinking: parsed.defaults.thinking,
    protectedFiles: parsed.defaults.protected_files,
  };

  const seenNames = new Set<string>();
  const agents: AgentConfig[] = parsed.agents.map((entry) => {
    if (seenNames.has(entry.name)) {
      throw new ConfigError(`${sourceLabel}: duplicate agent name ${JSON.stringify(entry.name)}`);
    }
    seenNames.add(entry.name);
    const model = entry.model ?? defaults.model;
    return {
      name: entry.name,
      model,
      modelRef: parseModelRef(model),
      thinking: entry.thinking ?? defaults.thinking,
      writes: entry.writes ?? null,
    };
  });

  return { defaults, agents };
}

/** Loads and validates `factory.config.yaml` (or another path) from disk. */
export function loadConfig(path = "factory.config.yaml"): FactoryConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`could not read config file ${JSON.stringify(path)}: ${detail}`);
  }
  return loadConfigFromString(text, path);
}

// ── lookups ──────────────────────────────────────────────────────────────

/** Resolves one agent's config by identity name (e.g. "plan", "build"). Throws — never falls back. */
export function agentConfigFor(config: FactoryConfig, name: string): AgentConfig {
  const agent = config.agents.find((a) => a.name === name);
  if (!agent) {
    const available = config.agents.map((a) => a.name).join(", ") || "(none configured)";
    throw new ConfigError(`agent ${JSON.stringify(name)} is not defined in the config — available: ${available}`);
  }
  return agent;
}

/**
 * Resolves per-project quality-gate config by reading `<absolutePath>/
 * .pi-web-factory.yaml` — a file the TARGET PROJECT owns and versions
 * itself (M-070), not a centralized map inside pi-web-factory's own
 * `factory.config.yaml`. Takes no `FactoryConfig` — project-local lookup
 * doesn't depend on the agent roster at all, and threading an unused
 * parameter through just to preserve a signature shape would be more
 * disruptive than updating the (one) call site.
 *
 * Missing file -> a specific `ConfigError` naming the expected path — same
 * discipline the old centralized lookup had for an unknown project key, just
 * a different failure mode now (file-not-found instead of key-not-in-map),
 * never a silent fallback to some default project's commands (running
 * project A's test command against project B's cwd would be a worse failure
 * mode than refusing to run at all). Malformed file -> a specific
 * `ConfigError` carrying the actual Zod validation detail, same as every
 * other parse failure in this module.
 */
export function projectConfigFor(absolutePath: string): ProjectConfig {
  const configPath = join(absolutePath, PROJECT_CONFIG_FILENAME);

  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      `${configPath} does not exist — every project driven by pi-web-factory must have its own ` +
        `${PROJECT_CONFIG_FILENAME} at its repo root, declaring its test/typecheck/lint commands ` +
        `(${detail})`,
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${configPath}: could not parse YAML: ${detail}`);
  }

  const result = ProjectConfigFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`${configPath}: invalid config:\n${issues}`);
  }

  return { path: absolutePath, ...result.data };
}
