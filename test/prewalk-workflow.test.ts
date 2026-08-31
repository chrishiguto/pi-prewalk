import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHECKLIST_PROMPT, CONTINUE_PROMPT, PLAN_PROMPT } from "../src/prompts.ts";
import { createHarness } from "./support/prewalk-harness.ts";

describe("Prewalk transition workflow", () => {
  test("injects a hidden planning instruction with the next task", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");

    assert.equal(harness.sent.length, 0);
    const [message] = await harness.prompt("Implement the requested change");
    assert.equal(message?.display, false);
    assert.match(message?.content, /5-9/);
    assert.equal(message?.content, PLAN_PROMPT);
    assert.equal((await harness.prompt("another task")).length, 0);
  });

  test("continues with the target model after TODO completion and first successful edit", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    await harness.prompt();

    await harness.tool("todo");
    assert.equal(harness.transitionRequests.length, 0);
    await harness.tool("edit");

    assert.equal(harness.transitionRequests.length, 1);
    assert.deepEqual(harness.transitionRequests[0], { provider: "fast", model: "executor" });
    assert.equal(harness.sent.at(-1)?.message.content, CHECKLIST_PROMPT);
  });

  test("delegates model changes to the trajectory router", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    await harness.prompt();
    await harness.tool("todo");
    await harness.tool("edit");

    assert.equal(harness.transitionRequests.length, 1);
  });
});

describe("Prewalk transition safeguards", () => {
  test("sends only one continuation prompt for consecutive text-only turns", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    await harness.prompt();

    await harness.turn();
    assert.equal(harness.sent.at(-1)?.message.content, CONTINUE_PROMPT);
    await harness.turn();
    assert.equal(harness.sent.filter(({ message }) => message.content === CONTINUE_PROMPT).length, 1);
  });

  test("re-enables one continuation prompt after successful tool progress", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    await harness.prompt();

    await harness.turn();
    await harness.tool("read");
    await harness.turn();
    assert.equal(harness.sent.filter(({ message }) => message.content === CONTINUE_PROMPT).length, 2);
    await harness.turn();
    assert.equal(harness.sent.filter(({ message }) => message.content === CONTINUE_PROMPT).length, 2);
  });

  test("does not transition after shell commands or failed mutations", async () => {
    const harness = createHarness({ activeTools: ["read", "bash", "edit", "write"] });
    await harness.start();
    await harness.command("fast/executor");
    await harness.prompt();

    await harness.tool("bash");
    await harness.tool("edit", true);
    await harness.tool("write", false, { error: "disk full" });
    assert.equal(harness.transitionRequests.length, 0);
    await harness.tool("edit");
    assert.equal(harness.transitionRequests.length, 1);
  });

  test("requires successful TODO completion when TODO is available", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.command("fast/executor");
    await harness.prompt();
    await harness.tool("todo", false, { error: "not saved" });
    await harness.tool("edit");
    assert.equal(harness.transitionRequests.length, 0);
    await harness.tool("todo");
    await harness.tool("write");
    assert.equal(harness.transitionRequests.length, 1);
  });

  test("treats unchanged and rejected router results as terminal one-shot outcomes", async () => {
    const unchanged = createHarness({ router: { result: {
      status: "unchanged",
      current: { provider: "fast", model: "executor", thinkingLevel: "high" },
      thinking: { requested: "high", effective: "high", clamped: false },
      transitionPoint: { sessionId: "session-1", branchLeafId: "entry-4" },
    } } });
    await unchanged.start();
    await unchanged.command("fast/executor");
    await unchanged.prompt();
    await unchanged.tool("todo");
    await unchanged.tool("edit");
    await unchanged.tool("write");
    assert.equal(unchanged.transitionRequests.length, 1);
    await unchanged.command("status");
    assert.match(unchanged.notifications.at(-1)?.message ?? "", /idle/);

    const rejected = createHarness({ router: { result: {
      status: "rejected",
      current: { provider: "frontier", model: "architect", thinkingLevel: "high" },
      transitionPoint: { sessionId: "session-1", branchLeafId: "entry-4" },
      error: "cannot preserve context",
    } } });
    await rejected.start();
    await rejected.command("fast/executor");
    await rejected.prompt();
    await rejected.tool("todo");
    await rejected.tool("edit");
    await rejected.tool("write");
    assert.equal(rejected.transitionRequests.length, 1);
    assert.match(rejected.notifications.at(-1)?.message ?? "", /rejected.*cannot preserve context/i);
  });
});
