/**
 * Unit tests for workflowDef.ts's YAML shape loader/validator — no network,
 * no live server. Covers both shipped Workflow files (loaded for real, off
 * disk) plus load-time validation of malformed shapes (duplicate step names,
 * a loop's `until.step` pointing outside its own `steps`, etc).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigError } from "./config.ts";
import { loadWorkflows, loadWorkflowsFromString, workflowFor } from "./workflowDef.ts";

const WORKFLOWS_DIR = join(import.meta.dir, "..", "workflows");

describe("the shipped plan-build-review.yaml", () => {
  test("loads and validates successfully from disk", () => {
    const workflows = loadWorkflows(join(WORKFLOWS_DIR, "plan-build-review.yaml"));
    expect(workflows.length).toBe(1);
    expect(workflows[0]?.name).toBe("plan-build-review");
  });

  test("has exactly the three agent steps plan -> build -> review, no loop", () => {
    const [workflow] = loadWorkflows(join(WORKFLOWS_DIR, "plan-build-review.yaml"));
    expect(workflow?.steps.map((s) => s.kind)).toEqual(["agent", "agent", "agent"]);
    expect(workflow?.steps.map((s) => s.name)).toEqual(["plan", "build", "review"]);
  });

  test("build step's prompt references plan's summary via interpolation syntax", () => {
    const [workflow] = loadWorkflows(join(WORKFLOWS_DIR, "plan-build-review.yaml"));
    const build = workflow?.steps.find((s) => s.name === "build");
    expect(build?.kind).toBe("agent");
    if (build?.kind === "agent") expect(build.prompt).toContain("{{plan.summary}}");
  });
});

describe("the shipped bounded-build-review.yaml", () => {
  test("loads and validates successfully from disk", () => {
    const workflows = loadWorkflows(join(WORKFLOWS_DIR, "bounded-build-review.yaml"));
    expect(workflows.length).toBe(1);
    expect(workflows[0]?.name).toBe("bounded-build-review");
  });

  test("is build (agent) -> loop { review, build-retry }, until review.approved == true, max_rounds 3", () => {
    const [workflow] = loadWorkflows(join(WORKFLOWS_DIR, "bounded-build-review.yaml"));
    expect(workflow?.steps.map((s) => s.kind)).toEqual(["agent", "loop"]);
    const loop = workflow?.steps[1];
    expect(loop?.kind).toBe("loop");
    if (loop?.kind === "loop") {
      expect(loop.steps.map((s) => s.name)).toEqual(["review", "build-retry"]);
      expect(loop.until).toEqual({ step: "review", field: "approved", equals: true });
      expect(loop.max_rounds).toBe(3);
    }
  });

  test("step names are unique across the whole workflow, including the outer build vs the loop's build-retry", () => {
    const [workflow] = loadWorkflows(join(WORKFLOWS_DIR, "bounded-build-review.yaml"));
    const names: string[] = [];
    for (const step of workflow?.steps ?? []) {
      names.push(step.name);
      if (step.kind === "loop") names.push(...step.steps.map((s) => s.name));
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("loadWorkflowsFromString — validation", () => {
  test("rejects a workflow with duplicate step names, including across a loop boundary", () => {
    const yaml = `
workflows:
  - name: bad
    steps:
      - kind: agent
        name: build
        role: build
        prompt: do it
      - kind: loop
        name: loop1
        max_rounds: 2
        until: {step: review, field: approved, equals: true}
        steps:
          - kind: agent
            name: review
            role: review
            prompt: review it
          - kind: agent
            name: build
            role: build
            prompt: redo it
`;
    expect(() => loadWorkflowsFromString(yaml)).toThrow(ConfigError);
    expect(() => loadWorkflowsFromString(yaml)).toThrow(/duplicate step name/);
  });

  test("rejects a loop whose until.step is not one of its own inner steps", () => {
    const yaml = `
workflows:
  - name: bad
    steps:
      - kind: agent
        name: plan
        role: plan
        prompt: plan it
      - kind: loop
        name: loop1
        max_rounds: 2
        until: {step: plan, field: approved, equals: true}
        steps:
          - kind: agent
            name: review
            role: review
            prompt: review it
`;
    expect(() => loadWorkflowsFromString(yaml)).toThrow(ConfigError);
    expect(() => loadWorkflowsFromString(yaml)).toThrow(/not one of this loop's own inner steps/);
  });

  test("rejects a loop step nested inside another loop's steps (schema-level: LoopInnerStepSchema has no 'loop' kind)", () => {
    const yaml = `
workflows:
  - name: bad
    steps:
      - kind: loop
        name: outer
        max_rounds: 2
        until: {step: review, field: approved, equals: true}
        steps:
          - kind: loop
            name: inner
            max_rounds: 2
            until: {step: review, field: approved, equals: true}
            steps:
              - kind: agent
                name: review
                role: review
                prompt: review it
`;
    expect(() => loadWorkflowsFromString(yaml)).toThrow(ConfigError);
  });

  test("rejects duplicate workflow names in the same file", () => {
    const yaml = `
workflows:
  - name: dup
    steps: [{kind: agent, name: a, role: plan, prompt: x}]
  - name: dup
    steps: [{kind: agent, name: b, role: plan, prompt: y}]
`;
    expect(() => loadWorkflowsFromString(yaml)).toThrow(/duplicate workflow name/);
  });

  test("rejects malformed YAML with a ConfigError, not a bare parse exception", () => {
    expect(() => loadWorkflowsFromString("workflows: [this is not: valid: yaml:")).toThrow(ConfigError);
  });

  test("a code step has no prompt field and is accepted", () => {
    const yaml = `
workflows:
  - name: ok
    steps:
      - kind: code
        name: test
        role: run-tests
`;
    const [workflow] = loadWorkflowsFromString(yaml);
    expect(workflow?.steps[0]).toEqual({ kind: "code", name: "test", role: "run-tests" });
  });
});

describe("workflowFor", () => {
  test("resolves a workflow by name", () => {
    const workflows = loadWorkflowsFromString(`
workflows:
  - name: one
    steps: [{kind: agent, name: a, role: plan, prompt: x}]
`);
    expect(workflowFor(workflows, "one").name).toBe("one");
  });

  test("throws a ConfigError naming what's available for an unknown name", () => {
    const workflows = loadWorkflowsFromString(`
workflows:
  - name: one
    steps: [{kind: agent, name: a, role: plan, prompt: x}]
`);
    expect(() => workflowFor(workflows, "nonexistent")).toThrow(ConfigError);
    expect(() => workflowFor(workflows, "nonexistent")).toThrow(/one/);
  });
});
