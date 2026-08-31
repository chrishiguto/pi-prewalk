import assert from "node:assert/strict";
import { describe, test } from "node:test";
import piPrewalk from "../../extensions/prewalk/index.ts";
import { createIntegrationHarness } from "../support/integration-harness.ts";

describe("Prewalk extension integration", () => {
  test("gives startup flags and interactive arming the same handoff behavior", async () => {
    const startup = createIntegrationHarness([piPrewalk]);
    startup.flags.set("prewalk", true);
    startup.flags.set("prewalk-target", "fast/executor");
    startup.flags.set("prewalk-thinking", "low");
    await startup.start();

    const interactive = createIntegrationHarness([piPrewalk]);
    await interactive.start();
    await interactive.command("fast/executor low");

    const [startupPlan] = await startup.prompt("sample task");
    const [interactivePlan] = await interactive.prompt("sample task");
    assert.equal(startupPlan?.content, interactivePlan?.content);

    for (const harness of [startup, interactive]) {
      await harness.tool("todo");
      await harness.tool("edit");
      assert.deepEqual(harness.currentModel(), { provider: "fast", model: "executor" });
      assert.equal(harness.thinking(), "low");
    }
  });

  test("preserves the active trajectory while handing off to the target model", async () => {
    const harness = createIntegrationHarness([piPrewalk], { idle: false });
    const before = harness.continuity();
    await harness.start();
    await harness.command("fast/executor low");
    assert.equal(harness.sent.length, 0);
    const [planMessage] = await harness.prompt("sample task");
    const planType = planMessage?.customType;
    await harness.tool("todo");
    assert.deepEqual(harness.currentModel(), { provider: "frontier", model: "architect" });
    await harness.tool("edit");
    assert.deepEqual(harness.currentModel(), { provider: "frontier", model: "architect" });
    harness.setIdle(true);
    await harness.settle();

    assert.deepEqual(harness.currentModel(), { provider: "fast", model: "executor" });
    assert.equal(harness.thinking(), "low");
    assert.deepEqual(harness.continuity(), before);
    assert.deepEqual(harness.activeTools(), ["read", "bash", "edit", "write", "todo"]);
    assert.equal(harness.sessionMutations(), 0);
    assert.equal(harness.sent.at(-1)?.message.customType, "pi-prewalk-checklist");
    assert.equal(harness.statuses.has("prewalk"), false);

    const kept = [
      { role: "user", content: "sample task" },
      { role: "assistant", content: "bounded plan" },
      { role: "toolResult", toolName: "todo", content: "saved" },
      { role: "custom", customType: "pi-prewalk-checklist", content: "verify" },
    ];
    assert.deepEqual(await harness.filter([
      { role: "custom", customType: planType, content: "hidden control" },
      ...kept,
    ]), kept);
  });
});
