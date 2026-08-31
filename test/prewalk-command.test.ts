import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createHarness, fakeModel } from "./support/prewalk-harness.ts";

describe("Prewalk command surface", () => {
  describe("arming", () => {
    test("arms from startup flags with an explicit target and thinking level", async () => {
      const harness = createHarness();
      harness.flags.set("prewalk", true);
      harness.flags.set("prewalk-target", "fast/executor");
      harness.flags.set("prewalk-thinking", "low");
      await harness.start();

      assert.equal(harness.sent.length, 0);
      assert.equal((await harness.prompt()).length, 1);
      await harness.tool("todo");
      await harness.tool("write");
      assert.deepEqual(harness.transitionRequests[0], {
        provider: "fast",
        model: "executor",
        thinkingLevel: "low",
      });
      assert.match(harness.notifications.at(-1)?.message ?? "", /low thinking/);
    });

    test("selects opencode/glm-5.2 as the default target when authenticated", async () => {
      const harness = createHarness({
        models: [fakeModel("frontier", "architect"), fakeModel("opencode", "glm-5.2")],
      });
      await harness.start();
      await harness.command("");
      await harness.prompt();
      await harness.tool("todo");
      await harness.tool("edit");

      assert.deepEqual(harness.transitionRequests[0], { provider: "opencode", model: "glm-5.2" });
    });

    test("warns and selects a deterministic fallback when the default target is unavailable", async () => {
      const harness = createHarness();
      await harness.start();
      await harness.command("");

      assert.match(harness.notifications[0]?.message ?? "", /Default target/);
      await harness.prompt();
      await harness.tool("todo");
      await harness.tool("edit");
      assert.deepEqual(harness.transitionRequests[0], { provider: "fast", model: "executor" });
    });

    test("does not re-arm an already active Prewalk run", async () => {
      const harness = createHarness();
      await harness.start();
      await harness.command("fast/executor high");
      await harness.command("fast/executor low");

      assert.equal(harness.sent.length, 0);
      assert.match(harness.notifications.at(-1)?.message ?? "", /already armed.*fast\/executor/i);
    });
  });

  describe("status and disarm", () => {
    test("reports the active target, thinking level, and TODO readiness", async () => {
      const harness = createHarness();
      await harness.start();
      await harness.command("fast/executor high");
      await harness.command("status");

      assert.match(harness.notifications.at(-1)?.message ?? "", /awaiting next task.*fast\/executor.*high/i);
      assert.match(harness.statuses.get("prewalk") ?? "", /next task.*fast\/executor.*high/i);
    });

    test("disarms before a transition has been requested", async () => {
      const harness = createHarness();
      await harness.start();
      await harness.command("fast/executor high");
      await harness.command("disarm");
      await harness.tool("todo");
      await harness.tool("write");

      assert.equal(harness.transitionRequests.length, 0);
      assert.equal((await harness.prompt()).length, 0);
      assert.equal(harness.statuses.has("prewalk"), false);
    });
  });

  describe("model selection", () => {
    test("accepts unique bare model IDs and completes canonical targets", async () => {
      const harness = createHarness();
      await harness.start();

      assert.deepEqual(harness.complete("fast"), [
        { value: "fast/executor", label: "fast/executor" },
      ]);
      assert.deepEqual(harness.complete("fast/executor m"), [
        { value: "fast/executor minimal", label: "minimal" },
        { value: "fast/executor medium", label: "medium" },
        { value: "fast/executor max", label: "max" },
      ]);

      await harness.command("executor medium");
      await harness.prompt();
      await harness.tool("todo");
      await harness.tool("edit");
      assert.deepEqual(harness.transitionRequests[0], {
        provider: "fast",
        model: "executor",
        thinkingLevel: "medium",
      });
    });
  });

  describe("validation", () => {
    test("rejects malformed, unavailable, and unauthenticated explicit targets", async () => {
      const harness = createHarness({ unauthenticated: ["fast/executor"] });
      await harness.start();

      await harness.command("/executor");
      assert.match(harness.notifications.at(-1)?.message ?? "", /provider\/model/);
      await harness.command("missing/model");
      assert.match(harness.notifications.at(-1)?.message ?? "", /unavailable/);
      await harness.command("fast/executor");
      assert.match(harness.notifications.at(-1)?.message ?? "", /unauthenticated/);
      assert.equal(harness.sent.length, 0);
    });
  });
});
