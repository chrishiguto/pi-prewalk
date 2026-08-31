import type { TransitionResult } from "./trajectory-router/index.ts";

type ChangedResult = Extract<TransitionResult, { status: "changed" }>;
type UnchangedResult = Extract<TransitionResult, { status: "unchanged" }>;
type RejectedResult = Extract<TransitionResult, { status: "rejected" }>;

export interface PolicyState {
  readonly phase: "armed" | "transitioning";
  readonly todoReady: boolean;
  readonly continuationReady: boolean;
}

export type PolicyEvent =
  | { type: "assistant_completed"; textOnly: boolean }
  | { type: "tool_completed"; toolName: string; isError: boolean; details?: unknown };

export type PolicyEffect =
  | { type: "continue" }
  | { type: "request_transition" };

export type TerminalPolicyEffect =
  | { type: "transition_changed"; result: ChangedResult }
  | { type: "transition_unchanged"; result: UnchangedResult }
  | { type: "transition_rejected"; result: RejectedResult };

export interface PolicyReduction {
  readonly state: PolicyState;
  readonly effects: readonly PolicyEffect[];
}

export function createPolicyState(options: { todoToolActive: boolean }): PolicyState {
  return {
    phase: "armed",
    todoReady: !options.todoToolActive,
    continuationReady: true,
  };
}

export function reducePolicy(state: PolicyState, event: PolicyEvent): PolicyReduction {
  if (state.phase !== "armed") return unchanged(state);

  if (event.type === "assistant_completed") {
    if (!event.textOnly || !state.continuationReady) return unchanged(state);
    return {
      state: { ...state, continuationReady: false },
      effects: [{ type: "continue" }],
    };
  }

  if (!isSuccessfulToolResult(event)) return unchanged(state);

  const progressed = { ...state, continuationReady: true };
  if (event.toolName === "todo") {
    return { state: { ...progressed, todoReady: true }, effects: [] };
  }
  if (!state.todoReady || (event.toolName !== "edit" && event.toolName !== "write")) {
    return { state: progressed, effects: [] };
  }

  return {
    state: { ...progressed, phase: "transitioning" },
    effects: [{ type: "request_transition" }],
  };
}

export function resolveTransition(
  state: PolicyState,
  result: TransitionResult,
): TerminalPolicyEffect | undefined {
  if (state.phase !== "transitioning") return undefined;
  switch (result.status) {
    case "changed":
      return { type: "transition_changed", result };
    case "unchanged":
      return { type: "transition_unchanged", result };
    case "rejected":
      return { type: "transition_rejected", result };
  }
}

export function isSuccessfulToolResult(event: {
  readonly isError: boolean;
  readonly details?: unknown;
}): boolean {
  if (event.isError) return false;
  if (typeof event.details !== "object" || event.details === null) return true;
  return !("error" in event.details && event.details.error !== undefined);
}

export function isOwnedControlMessage(
  customType: string | undefined,
  ownedTypes: readonly string[],
): boolean {
  return customType !== undefined && ownedTypes.includes(customType);
}

function unchanged(state: PolicyState): PolicyReduction {
  return { state, effects: [] };
}
