import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import { DEFAULT_TARGET, resolveTarget } from "../src/target.ts";

function model(provider: string, id: string, input: number, output: number): Model<any> {
  return {
    provider,
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  } as Model<any>;
}

describe("Prewalk target resolution", () => {
  test("selects an authenticated explicit target by exact provider and model", () => {
    const models = [model("openai", "gpt-5.2", 2, 8)];
    const common = { models, hasConfiguredAuth: () => true };

    assert.deepEqual(resolveTarget({
      ...common,
      explicit: { provider: "openai", model: "gpt-5.2", thinkingLevel: "high" },
    }), {
      ok: true,
      selection: "explicit",
      target: { provider: "openai", model: "gpt-5.2", thinkingLevel: "high" },
    });
  });

  test("resolves unique bare IDs and rejects ambiguous IDs", () => {
    const unique = model("openai", "gpt-5.2", 2, 8);
    assert.deepEqual(resolveTarget({
      models: [unique],
      hasConfiguredAuth: () => true,
      explicit: { model: "gpt-5.2", thinkingLevel: "low" },
    }), {
      ok: true,
      selection: "explicit",
      target: { provider: "openai", model: "gpt-5.2", thinkingLevel: "low" },
    });

    assert.deepEqual(resolveTarget({
      models: [unique, model("gateway", "gpt-5.2", 1, 4)],
      hasConfiguredAuth: () => true,
      explicit: { model: "gpt-5.2" },
    }), {
      ok: false,
      error: "Model ID gpt-5.2 is ambiguous; use one of: gateway/gpt-5.2, openai/gpt-5.2.",
    });
  });

  test("distinguishes unavailable, unauthenticated, and current targets", () => {
    const selected = model("openai", "gpt-5.2", 2, 8);
    assert.deepEqual(resolveTarget({
      models: [selected],
      hasConfiguredAuth: () => true,
      explicit: { provider: "OpenAI", model: "gpt-5.2" },
    }), {
      ok: false,
      error: "Target OpenAI/gpt-5.2 is unavailable.",
    });
    assert.deepEqual(resolveTarget({
      models: [selected],
      hasConfiguredAuth: () => false,
      explicit: { provider: "openai", model: "gpt-5.2" },
    }), {
      ok: false,
      error: "Target openai/gpt-5.2 is unauthenticated.",
    });
    assert.deepEqual(resolveTarget({
      models: [selected],
      hasConfiguredAuth: () => true,
      current: { provider: "openai", model: "gpt-5.2" },
      explicit: { provider: "openai", model: "gpt-5.2" },
    }), {
      ok: false,
      error: "Target openai/gpt-5.2 is already the current planner model.",
    });
  });

  test("prefers the configured default target and propagates thinking level", () => {
    const models = [
      model("cheap", "worker", 0.1, 0.2),
      model(DEFAULT_TARGET.provider, DEFAULT_TARGET.model, 1, 2),
    ];
    assert.deepEqual(resolveTarget({
      models,
      hasConfiguredAuth: () => true,
      explicit: { thinkingLevel: "medium" },
    }), {
      ok: true,
      selection: "default",
      target: { ...DEFAULT_TARGET, thinkingLevel: "medium" },
    });
  });

  test("falls back when the default target is already the planner", () => {
    const current = model(DEFAULT_TARGET.provider, DEFAULT_TARGET.model, 1, 2);
    const fallback = model("fast", "executor", 0.1, 0.2);
    assert.deepEqual(resolveTarget({
      models: [current, fallback],
      hasConfiguredAuth: () => true,
      current: { provider: current.provider, model: current.id },
    }), {
      ok: true,
      selection: "fallback",
      target: { provider: "fast", model: "executor" },
      warning: {
        code: "default-current",
        preferred: DEFAULT_TARGET,
        selected: { provider: "fast", model: "executor" },
        message: "Default target opencode/glm-5.2 is already the current planner model; using fast/executor, the cheapest authenticated alternative.",
      },
    });
  });

  test("falls back to the cheapest authenticated non-current model", () => {
    const models = [
      model("zero", "unknown-price", 0, 0),
      model("same", "current", 0.01, 0.01),
      model("zeta", "worker", 0.1, 0.2),
      model("alpha", "worker", 0.1, 0.2),
      model("cheaper", "no-auth", 0.01, 0.01),
    ];
    const result = resolveTarget({
      models,
      hasConfiguredAuth: (candidate) => candidate.provider !== "cheaper",
      current: { provider: "same", model: "current" },
      explicit: { thinkingLevel: "low" },
    });

    assert.deepEqual(result, {
      ok: true,
      selection: "fallback",
      target: { provider: "alpha", model: "worker", thinkingLevel: "low" },
      warning: {
        code: "default-unavailable",
        preferred: DEFAULT_TARGET,
        selected: { provider: "alpha", model: "worker" },
        message: "Default target opencode/glm-5.2 is unavailable; using alpha/worker, the cheapest authenticated alternative.",
      },
    });
  });

  test("uses zero-priced models only when no known-price authenticated candidate exists", () => {
    const zeroModels = [
      model("zeta", "free", 0, 0),
      model("alpha", "free", 0, 0),
    ];
    const result = resolveTarget({ models: zeroModels, hasConfiguredAuth: () => true });

    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.target, { provider: "alpha", model: "free" });
  });

  test("reports failure when no authenticated non-current target exists", () => {
    const current = model("only", "current", 1, 1);
    assert.deepEqual(resolveTarget({
      models: [current],
      hasConfiguredAuth: () => true,
      current: { provider: current.provider, model: current.id },
    }), {
      ok: false,
      error: "No authenticated target model other than the current model is available.",
    });
  });
});
