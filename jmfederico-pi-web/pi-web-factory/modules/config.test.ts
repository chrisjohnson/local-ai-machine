import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  agentConfigFor,
  ConfigError,
  loadConfig,
  loadConfigFromString,
  parseModelRef,
  PROJECT_CONFIG_FILENAME,
  projectConfigFor,
} from "./config.ts";

const REAL_CONFIG_PATH = join(import.meta.dir, "..", "factory.config.yaml");

// ── parseModelRef ────────────────────────────────────────────────────────

describe("parseModelRef", () => {
  test("splits a well-formed provider/model-id string", () => {
    expect(parseModelRef("local-litellm/big-moe")).toEqual({ provider: "local-litellm", modelId: "big-moe" });
  });

  test("rejects a string with no slash", () => {
    expect(() => parseModelRef("big-moe")).toThrow(/"\/"/);
  });

  test("rejects a string with more than one slash", () => {
    expect(() => parseModelRef("local-litellm/nested/big-moe")).toThrow();
  });

  test("rejects an empty provider half", () => {
    expect(() => parseModelRef("/big-moe")).toThrow();
  });

  test("rejects an empty model-id half", () => {
    expect(() => parseModelRef("local-litellm/")).toThrow();
  });
});

// ── the real shipped factory.config.yaml ────────────────────────────────

describe("the shipped factory.config.yaml", () => {
  test("loads and validates successfully from disk", () => {
    const config = loadConfig(REAL_CONFIG_PATH);
    expect(config.agents.length).toBeGreaterThan(0);
  });

  test("covers all five envelope identities (plan, build, review, scout, document)", () => {
    const config = loadConfig(REAL_CONFIG_PATH);
    const names = config.agents.map((a) => a.name).sort();
    expect(names).toEqual(["build", "document", "plan", "review", "scout"]);
  });

  test("every agent's model splits into a usable {provider, modelId} ModelRef", () => {
    const config = loadConfig(REAL_CONFIG_PATH);
    for (const agent of config.agents) {
      expect(agent.modelRef.provider.length).toBeGreaterThan(0);
      expect(agent.modelRef.modelId.length).toBeGreaterThan(0);
      expect(`${agent.modelRef.provider}/${agent.modelRef.modelId}`).toBe(agent.model);
    }
  });

  test("declares protected_files covering this project's own machinery", () => {
    const config = loadConfig(REAL_CONFIG_PATH);
    expect(config.defaults.protectedFiles).toContain("modules/");
    expect(config.defaults.protectedFiles).toContain("factory.config.yaml");
  });

  test("raw YAML text also parses standalone (sanity check on the fixture itself)", () => {
    const text = readFileSync(REAL_CONFIG_PATH, "utf8");
    const config = loadConfigFromString(text, "factory.config.yaml");
    expect(config.agents.length).toBe(5);
  });
});

// ── synthetic valid config ──────────────────────────────────────────────

const MINIMAL_VALID_YAML = `
defaults:
  model: local-litellm/medium-moe
  thinking: medium
  protected_files:
    - modules/
agents:
  - name: plan
    model: local-litellm/big-moe
    thinking: high
    writes:
      - specs/
  - name: build
    thinking: low
`;

describe("a synthetic valid config", () => {
  test("loads successfully", () => {
    const config = loadConfigFromString(MINIMAL_VALID_YAML);
    expect(config.agents).toHaveLength(2);
  });

  test("an agent that omits model/thinking inherits defaults", () => {
    const config = loadConfigFromString(MINIMAL_VALID_YAML);
    const build = agentConfigFor(config, "build");
    expect(build.model).toBe("local-litellm/medium-moe");
    expect(build.modelRef).toEqual({ provider: "local-litellm", modelId: "medium-moe" });
    // thinking WAS specified on this entry -> not inherited
    expect(build.thinking).toBe("low");
  });

  test("an agent with no writes: key is unrestricted (null), not empty", () => {
    const config = loadConfigFromString(MINIMAL_VALID_YAML);
    const build = agentConfigFor(config, "build");
    expect(build.writes).toBeNull();
  });

  test("an agent with writes: [] means read-only, distinct from null", () => {
    const yaml = MINIMAL_VALID_YAML.replace("thinking: low", "thinking: low\n    writes: []");
    const config = loadConfigFromString(yaml);
    expect(agentConfigFor(config, "build").writes).toEqual([]);
  });
});

// ── malformed provider/model-id rejected at load time ───────────────────

describe("malformed provider/model-id is rejected at load time", () => {
  test("defaults.model missing the slash", () => {
    const yaml = MINIMAL_VALID_YAML.replace("model: local-litellm/medium-moe", "model: medium-moe");
    expect(() => loadConfigFromString(yaml)).toThrow(ConfigError);
    expect(() => loadConfigFromString(yaml)).toThrow(/"\/"/);
  });

  test("an agent's model has an empty provider half", () => {
    const yaml = MINIMAL_VALID_YAML.replace("model: local-litellm/big-moe", "model: /big-moe");
    expect(() => loadConfigFromString(yaml)).toThrow(ConfigError);
  });

  test("an agent's model has an empty model-id half", () => {
    const yaml = MINIMAL_VALID_YAML.replace("model: local-litellm/big-moe", "model: local-litellm/");
    expect(() => loadConfigFromString(yaml)).toThrow(ConfigError);
  });

  test("error message is specific, not generic", () => {
    const yaml = MINIMAL_VALID_YAML.replace("model: local-litellm/medium-moe", "model: medium-moe");
    try {
      loadConfigFromString(yaml, "test-fixture.yaml");
      throw new Error("expected loadConfigFromString to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain("test-fixture.yaml");
      expect(message).toContain("defaults.model");
    }
  });
});

describe("other malformed shapes are rejected", () => {
  test("not valid YAML at all", () => {
    expect(() => loadConfigFromString("{ this: is not: valid: yaml", "bad.yaml")).toThrow(ConfigError);
  });

  test("missing agents list entirely", () => {
    const yaml = `
defaults:
  model: local-litellm/medium-moe
  thinking: medium
`;
    expect(() => loadConfigFromString(yaml)).toThrow(ConfigError);
  });

  test("empty agents list", () => {
    const yaml = `
defaults:
  model: local-litellm/medium-moe
  thinking: medium
agents: []
`;
    expect(() => loadConfigFromString(yaml)).toThrow(ConfigError);
  });

  test("duplicate agent names", () => {
    const yaml = `
defaults:
  model: local-litellm/medium-moe
  thinking: medium
agents:
  - name: plan
    model: local-litellm/big-moe
  - name: plan
    model: local-litellm/medium-moe
`;
    expect(() => loadConfigFromString(yaml)).toThrow(/duplicate agent name/);
  });

  test("invalid thinking level", () => {
    const yaml = MINIMAL_VALID_YAML.replace("thinking: medium", "thinking: ludicrous");
    expect(() => loadConfigFromString(yaml)).toThrow(ConfigError);
  });
});

// ── projectConfigFor: project-local .pi-web-factory.yaml ────────────────
//
// M-070: per-project quality-gate config moved out of factory.config.yaml's
// centralized `projects:` map into a file the target project owns itself,
// at <project>/.pi-web-factory.yaml. These tests use a real temp dir with a
// real file on disk, matching this project's established real-filesystem
// testing style (see gates.test.ts).

describe("projectConfigFor reading a project-local .pi-web-factory.yaml", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-web-factory-config-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("loads a valid project-local file from disk", () => {
    writeFileSync(
      join(dir, PROJECT_CONFIG_FILENAME),
      "test: npm test\ntypecheck: npx tsc --noEmit\nlint: npm run lint\n",
    );

    const project = projectConfigFor(dir);
    expect(project.path).toBe(dir);
    expect(project.test).toBe("npm test");
    expect(project.typecheck).toBe("npx tsc --noEmit");
    expect(project.lint).toBe("npm run lint");
  });

  test("a field can be legitimately omitted (e.g. no lint command configured)", () => {
    writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), "test: go test ./...\ntypecheck: go vet ./...\n");

    const project = projectConfigFor(dir);
    expect(project.test).toBe("go test ./...");
    expect(project.typecheck).toBe("go vet ./...");
    expect(project.lint).toBeUndefined();
  });

  test("missing file throws a specific ConfigError naming the expected path", () => {
    try {
      projectConfigFor(dir);
      throw new Error("expected projectConfigFor to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain(join(dir, PROJECT_CONFIG_FILENAME));
      expect(message).toContain("does not exist");
    }
  });

  test("malformed YAML throws a specific ConfigError with the parse detail", () => {
    writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), "{ this: is not: valid: yaml");

    try {
      projectConfigFor(dir);
      throw new Error("expected projectConfigFor to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain(join(dir, PROJECT_CONFIG_FILENAME));
      expect(message).toContain("could not parse YAML");
    }
  });

  test("a field with the wrong type throws with the actual Zod validation detail", () => {
    writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), "test:\n  - not-a-string\n");

    try {
      projectConfigFor(dir);
      throw new Error("expected projectConfigFor to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain(join(dir, PROJECT_CONFIG_FILENAME));
      expect(message).toContain("test");
    }
  });
});

// ── agentConfigFor unknown name ──────────────────────────────────────────

describe("agentConfigFor with an unknown agent name", () => {
  test("throws a clear error rather than returning undefined", () => {
    const config = loadConfigFromString(MINIMAL_VALID_YAML);
    expect(() => agentConfigFor(config, "nonexistent-agent")).toThrow(ConfigError);
  });
});
