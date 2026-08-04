/**
 * Config: loader/validator for `factory.config.yaml`, TS port of upstream
 * SSSF's `sssf.config.yaml` roster concept
 * (`adws/adw_modules/agents.py:load_config`/`validate`), extended with what a
 * *shared, multi-project* factory needs that a per-repo one didn't:
 * `projects:`, a map of per-project quality-gate commands (design doc §4).
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

const ProjectEntrySchema = z.object({
  test: z.string().optional(),
  typecheck: z.string().optional(),
  lint: z.string().optional(),
});

const RawFactoryConfigSchema = z.object({
  defaults: DefaultsSchema,
  agents: z.array(AgentEntrySchema).min(1),
  projects: z.record(z.string(), ProjectEntrySchema).default({}),
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
  /** Absolute path this entry was keyed under in factory.config.yaml. */
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
  /** Keyed by the same absolute path as the source YAML. Use projectConfigFor, not direct indexing. */
  projects: Record<string, ProjectConfig>;
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

  const projects: Record<string, ProjectConfig> = {};
  for (const [path, entry] of Object.entries(parsed.projects)) {
    projects[path] = { path, ...entry };
  }

  return { defaults, agents, projects };
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
 * Resolves per-project quality-gate config for an absolute project path.
 * Unknown path -> a specific, actionable error naming what WAS configured —
 * never a silent fallback to some default project's commands, since running
 * project A's test command against project B's cwd would be a worse failure
 * mode than refusing to run at all.
 */
export function projectConfigFor(config: FactoryConfig, absolutePath: string): ProjectConfig {
  const project = config.projects[absolutePath];
  if (!project) {
    const known = Object.keys(config.projects);
    const knownList = known.length > 0 ? known.join(", ") : "(none configured)";
    throw new ConfigError(
      `project ${JSON.stringify(absolutePath)} is not in factory.config.yaml's projects: map — ` +
        `known projects: ${knownList}`,
    );
  }
  return project;
}
