import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHECKLIST_PROMPT, PLAN_PROMPT } from "../src/prompts.ts";
import { createHarness } from "./support/prewalk-harness.ts";

describe("Prewalk context pruning", () => {
  test("removes retired hidden control messages without pruning conversation content", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    const [planMessage] = await harness.prompt();
    const planType = planMessage?.customType;
    await harness.tool("todo");
    await harness.tool("write");

    const messages = [
      { role: "custom", customType: planType, content: PLAN_PROMPT },
      { role: "user", content: "task" },
      { role: "assistant", content: "plan" },
      { role: "toolResult", toolName: "todo", content: "done" },
      { role: "custom", customType: "pi-prewalk-checklist", content: CHECKLIST_PROMPT },
    ];
    assert.deepEqual(await harness.filter(messages), messages.slice(1));
  });

  test("removes only exact retired plan and continuation message types", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    const [planMessage] = await harness.prompt();
    const planType = planMessage?.customType;
    await harness.turn();
    const continueType = harness.sent.at(-1)?.message.customType;
    await harness.tool("todo");
    await harness.tool("edit");

    const kept = [
      { role: "custom", customType: "pi-prewalk-plan:some-other-arm", content: "keep" },
      { role: "assistant", content: "plan" },
      { role: "custom", customType: "pi-prewalk-checklist", content: "verify" },
    ];
    assert.deepEqual(await harness.filter([
      { role: "custom", customType: planType, content: "remove" },
      { role: "custom", customType: continueType, content: "remove" },
      ...kept,
    ]), kept);
  });
});
