import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PREWALK_FLAG_NAMES,
  parseArmInput,
  parseCommandArmInput,
  readStartupArmInput,
  registerStartupFlags,
} from "../src/config.ts";

describe("Prewalk arm input parsing", () => {
  test("parses provider/model targets with optional thinking levels", () => {
    assert.deepEqual(parseArmInput(" opencode/glm-5.2 ", "high"), {
      ok: true,
      value: { provider: "opencode", model: "glm-5.2", thinkingLevel: "high" },
    });
    assert.deepEqual(parseArmInput("openrouter/vendor/model", undefined), {
      ok: true,
      value: { provider: "openrouter", model: "vendor/model" },
    });
    assert.deepEqual(parseCommandArmInput("openai/gpt-5.2 xhigh"), {
      ok: true,
      value: { provider: "openai", model: "gpt-5.2", thinkingLevel: "xhigh" },
    });
  });

  test("accepts bare model IDs and rejects malformed targets, unknown thinking levels, and extra arguments", () => {
    assert.deepEqual(parseArmInput("glm-5.2", undefined), {
      ok: true,
      value: { model: "glm-5.2" },
    });
    assert.deepEqual(parseArmInput("/glm-5.2", undefined), {
      ok: false,
      error: "Target must be provider/model or a unique model ID.",
    });
    assert.deepEqual(parseArmInput("opencode/glm-5.2", "extreme"), {
      ok: false,
      error: "Thinking must be one of: off, minimal, low, medium, high, xhigh, max.",
    });
    assert.deepEqual(parseCommandArmInput("openai/gpt-5.2 high extra"), {
      ok: false,
      error: "Usage: /prewalk [provider/model|model] [thinking].",
    });
  });

  test("allows thinking without an explicit target", () => {
    assert.deepEqual(parseArmInput(undefined, "medium"), {
      ok: true,
      value: { thinkingLevel: "medium" },
    });
    assert.deepEqual(parseCommandArmInput(""), { ok: true, value: {} });
    assert.deepEqual(parseCommandArmInput("medium"), {
      ok: true,
      value: { thinkingLevel: "medium" },
    });
  });
});

describe("Prewalk startup flags", () => {
  test("registers startup arming flags", () => {
    const registrations: Array<{ name: string; options: unknown }> = [];
    registerStartupFlags({
      registerFlag(name, options) {
        registrations.push({ name, options });
      },
    });

    assert.deepEqual(registrations.map(({ name }) => name), [
      PREWALK_FLAG_NAMES.arm,
      PREWALK_FLAG_NAMES.target,
      PREWALK_FLAG_NAMES.thinking,
    ]);
  });

  test("ignores target and thinking flags unless startup arming is enabled", () => {
    const disabled = readStartupArmInput({
      getFlag: (name) => name === PREWALK_FLAG_NAMES.target ? "opencode/glm-5.2" : undefined,
    });

    assert.equal(disabled, undefined);
  });

  test("reads startup target and thinking when arming is enabled", () => {
    const values: Record<string, boolean | string> = {
      [PREWALK_FLAG_NAMES.arm]: true,
      [PREWALK_FLAG_NAMES.target]: "opencode/glm-5.2",
      [PREWALK_FLAG_NAMES.thinking]: "low",
    };

    assert.deepEqual(readStartupArmInput({ getFlag: (name) => values[name] }), {
      ok: true,
      value: { provider: "opencode", model: "glm-5.2", thinkingLevel: "low" },
    });
  });
});
