import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createPolicyState,
  isOwnedControlMessage,
  reducePolicy,
  resolveTransition,
  type PolicyEvent,
  type PolicyState,
} from "../src/policy.ts";

function apply(state: PolicyState, event: PolicyEvent): PolicyState {
  return reducePolicy(state, event).state;
}

describe("Transition readiness policy", () => {
  describe("continuation prompts", () => {
    test("allows one continuation after a text-only assistant turn", () => {
      const initial = createPolicyState({ todoToolActive: true });

      const first = reducePolicy(initial, { type: "assistant_completed", textOnly: true });
      const second = reducePolicy(first.state, { type: "assistant_completed", textOnly: true });

      assert.deepEqual(first.effects, [{ type: "continue" }]);
      assert.deepEqual(second.effects, []);
    });

    test("re-arms continuation after successful tool progress", () => {
      let state = createPolicyState({ todoToolActive: true });
      state = apply(state, { type: "assistant_completed", textOnly: true });
      state = apply(state, { type: "tool_completed", toolName: "read", isError: false });

      const rearmed = reducePolicy(state, { type: "assistant_completed", textOnly: true });
      const exhausted = reducePolicy(rearmed.state, { type: "assistant_completed", textOnly: true });

      assert.deepEqual(rearmed.effects, [{ type: "continue" }]);
      assert.deepEqual(exhausted.effects, []);
    });
  });

  describe("TODO gate", () => {
    test("opens only after a successful TODO result", () => {
      let state = createPolicyState({ todoToolActive: true });

      let reduction = reducePolicy(state, { type: "tool_completed", toolName: "edit", isError: false });
      assert.deepEqual(reduction.effects, []);
      state = reduction.state;

      reduction = reducePolicy(state, {
        type: "tool_completed",
        toolName: "todo",
        isError: false,
        details: { error: "not persisted" },
      });
      assert.equal(reduction.state.todoReady, false);
      assert.deepEqual(reduction.effects, []);
      state = reduction.state;

      reduction = reducePolicy(state, { type: "tool_completed", toolName: "todo", isError: false });
      assert.equal(reduction.state.todoReady, true);
      assert.deepEqual(reduction.effects, []);

      reduction = reducePolicy(reduction.state, { type: "tool_completed", toolName: "write", isError: false });
      assert.deepEqual(reduction.effects, [{ type: "request_transition" }]);
    });

    test("starts open when TODO is unavailable", () => {
      const state = createPolicyState({ todoToolActive: false });

      const reduction = reducePolicy(state, { type: "tool_completed", toolName: "edit", isError: false });

      assert.deepEqual(reduction.effects, [{ type: "request_transition" }]);
      assert.equal(reduction.state.phase, "transitioning");
    });
  });

  describe("mutation gate", () => {
    test("requests transition after successful exact edit or write results", () => {
      const excluded: PolicyEvent[] = [
        { type: "tool_completed", toolName: "bash", isError: false },
        { type: "tool_completed", toolName: "shell", isError: false },
        { type: "tool_completed", toolName: "Edit", isError: false },
        { type: "tool_completed", toolName: "write_file", isError: false },
        { type: "tool_completed", toolName: "edit", isError: true },
        { type: "tool_completed", toolName: "write", isError: false, details: { error: "disk full" } },
      ];

      for (const event of excluded) {
        const reduction = reducePolicy(createPolicyState({ todoToolActive: false }), event);
        assert.deepEqual(reduction.effects, [], JSON.stringify(event));
        assert.equal(reduction.state.phase, "armed", JSON.stringify(event));
      }

      for (const toolName of ["edit", "write"]) {
        const reduction = reducePolicy(createPolicyState({ todoToolActive: false }), {
          type: "tool_completed",
          toolName,
          isError: false,
        });
        assert.deepEqual(reduction.effects, [{ type: "request_transition" }]);
      }
    });
  });

  describe("transition lifecycle", () => {
    test("latches after the first transition request", () => {
      let state = createPolicyState({ todoToolActive: false });
      const first = reducePolicy(state, { type: "tool_completed", toolName: "edit", isError: false });
      state = first.state;

      const second = reducePolicy(state, { type: "tool_completed", toolName: "write", isError: false });
      const text = reducePolicy(second.state, { type: "assistant_completed", textOnly: true });

      assert.deepEqual(first.effects, [{ type: "request_transition" }]);
      assert.deepEqual(second.effects, []);
      assert.deepEqual(text.effects, []);
    });

    test("maps changed and unchanged router results to terminal effects", () => {
      const transitioning = apply(createPolicyState({ todoToolActive: false }), {
        type: "tool_completed",
        toolName: "edit",
        isError: false,
      });
      const current = { provider: "fast", model: "executor", thinkingLevel: "medium" as const };
      const thinking = { requested: "medium" as const, effective: "medium" as const, clamped: false };
      const transitionPoint = { sessionId: "session-1", branchLeafId: "entry-4" };

      const changed = resolveTransition(transitioning, {
        status: "changed",
        previous: { provider: "frontier", model: "architect", thinkingLevel: "high" },
        current,
        thinking,
        transitionPoint,
      });
      const unchanged = resolveTransition(transitioning, {
        status: "unchanged",
        current,
        thinking,
        transitionPoint,
      });

      assert.equal(changed?.type, "transition_changed");
      assert.equal(unchanged?.type, "transition_unchanged");
    });

    test("maps rejected router results to terminal effects", () => {
      const transitioning = apply(createPolicyState({ todoToolActive: false }), {
        type: "tool_completed",
        toolName: "write",
        isError: false,
      });
      const rejected = resolveTransition(transitioning, {
        status: "rejected",
        current: { provider: "frontier", model: "architect", thinkingLevel: "high" },
        transitionPoint: { sessionId: "session-1", branchLeafId: "entry-4" },
        error: "target unavailable",
      });

      assert.equal(rejected?.type, "transition_rejected");
      assert.equal(rejected?.result.error, "target unavailable");
    });

    test("ignores router results when no transition is pending", () => {
      const state = createPolicyState({ todoToolActive: false });
      const effect = resolveTransition(state, {
        status: "unchanged",
        current: { provider: "frontier", model: "architect", thinkingLevel: "high" },
        thinking: { requested: "high", effective: "high", clamped: false },
        transitionPoint: { sessionId: "session-1", branchLeafId: "entry-4" },
      });

      assert.equal(effect, undefined);
    });
  });

  describe("control message ownership", () => {
    test("recognizes only exact owned custom message types", () => {
      const owned = ["pi-prewalk-plan:arm-1", "pi-prewalk-continue:arm-1"];

      assert.equal(isOwnedControlMessage("pi-prewalk-plan:arm-1", owned), true);
      assert.equal(isOwnedControlMessage("pi-prewalk-continue:arm-1", owned), true);
      assert.equal(isOwnedControlMessage("pi-prewalk-checklist", owned), false);
      assert.equal(isOwnedControlMessage("pi-prewalk-plan:arm-2", owned), false);
      assert.equal(isOwnedControlMessage(undefined, owned), false);
    });
  });
});
