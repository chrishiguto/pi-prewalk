import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRouterHarness } from "./support/trajectory-router-harness.ts";

describe("Trajectory Router", () => {
  describe("safe transition boundary", () => {
    test("waits until the current turn is idle before changing models", async () => {
      const harness = createRouterHarness({ idle: false });
      await harness.fire("session_start");
      const before = harness.snapshot();
      let result: Awaited<ReturnType<typeof harness.router.transitionTo>> | undefined;
      const pending = harness.router
        .transitionTo({ provider: "target", model: "beta" })
        .then((value) => { result = value; });

      await Promise.resolve();
      assert.equal(result, undefined);
      assert.deepEqual(harness.snapshot().model, { provider: "source", id: "alpha" });

      await harness.fire("turn_end");
      await pending;
      assert.deepEqual(result, {
        status: "changed",
        previous: { provider: "source", model: "alpha", thinkingLevel: "medium" },
        current: { provider: "target", model: "beta", thinkingLevel: "medium" },
        thinking: { requested: "medium", effective: "medium", clamped: false },
        transitionPoint: { sessionId: "session-1", branchLeafId: "message-3" },
      });
      assert.deepEqual(harness.snapshot().messages, before.messages);
      assert.deepEqual(harness.snapshot().trajectory, before.trajectory);
      assert.deepEqual(harness.snapshot().tools, before.tools);
      assert.equal(harness.snapshot().sessionId, before.sessionId);
    });
  });

  describe("model and thinking selection", () => {
    test("keeps the selected model active for later turns", async () => {
      const harness = createRouterHarness();
      await harness.fire("session_start");
      await harness.router.transitionTo({ provider: "target", model: "beta" });
      await harness.fire("agent_end");

      assert.deepEqual(harness.snapshot().model, { provider: "target", id: "beta" });
    });

    test("applies requested thinking level and reports clamping", async () => {
      const harness = createRouterHarness();
      await harness.fire("session_start");
      const changed = await harness.router.transitionTo({
        provider: "target",
        model: "beta",
        thinkingLevel: "high",
      });
      assert.equal(changed.status, "changed");
      assert.equal(changed.current.thinkingLevel, "high");

      harness.models[1]!.thinkingLevelMap = { high: null };
      const clamped = await harness.router.transitionTo({
        provider: "target",
        model: "beta",
        thinkingLevel: "high",
      });
      assert.equal(clamped.status, "changed");
      if (clamped.status === "changed") {
        assert.equal(clamped.thinking.clamped, true);
        assert.equal(clamped.current.thinkingLevel, "medium");
      }
    });

    test("returns unchanged for the active model and effective thinking", async () => {
      const harness = createRouterHarness();
      await harness.fire("session_start");
      const before = harness.snapshot();
      const result = await harness.router.transitionTo({ provider: "source", model: "alpha" });

      assert.equal(result.status, "unchanged");
      assert.deepEqual(harness.snapshot(), before);
      assert.equal(harness.setModelCalls(), 0);
    });
  });

  describe("transition rejection", () => {
    test("rejects unavailable and unauthenticated targets without state changes", async () => {
      const harness = createRouterHarness();
      await harness.fire("session_start");
      const before = harness.snapshot();

      const unavailable = await harness.router.transitionTo({ provider: "missing", model: "unknown" });
      assert.equal(unavailable.status, "rejected");
      assert.match(unavailable.status === "rejected" ? unavailable.error : "", /unavailable/);

      harness.setAuthenticated(false);
      const unauthenticated = await harness.router.transitionTo({ provider: "target", model: "beta" });
      assert.equal(unauthenticated.status, "rejected");
      assert.match(unauthenticated.status === "rejected" ? unauthenticated.error : "", /not authenticated/);
      assert.deepEqual(harness.snapshot(), before);
      assert.equal(harness.setModelCalls(), 0);
    });

    test("rejects targets that cannot fit the active trajectory", async () => {
      const harness = createRouterHarness();
      await harness.fire("session_start");
      const before = harness.snapshot();
      harness.setContextTokens(200_001);

      const result = await harness.router.transitionTo({ provider: "target", model: "beta" });
      assert.equal(result.status, "rejected");
      assert.match(result.status === "rejected" ? result.error : "", /context window/);
      assert.deepEqual(harness.snapshot(), before);
    });

    test("rejects failed Pi model changes without changing thinking", async () => {
      const harness = createRouterHarness({ setModelResult: false });
      await harness.fire("session_start");
      const before = harness.snapshot();

      const result = await harness.router.transitionTo({
        provider: "target",
        model: "beta",
        thinkingLevel: "low",
      });
      assert.equal(result.status, "rejected");
      assert.deepEqual(harness.snapshot(), before);
    });
  });
});
