import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { prepareTargetThinking } from "./thinking.ts";
import type {
  ModelState,
  TrajectoryRouter,
  TransitionPoint,
  TransitionResult,
  TransitionTarget,
} from "./types.ts";
import { preflightTransition } from "./validation.ts";

interface PendingTransition {
  target: TransitionTarget;
  resolve(result: TransitionResult): void;
}

function modelState(pi: ExtensionAPI, context: ExtensionContext): ModelState {
  if (!context.model) throw new Error("Pi has no active model");
  return {
    provider: context.model.provider,
    model: context.model.id,
    thinkingLevel: pi.getThinkingLevel(),
  };
}

function currentModelState(
  pi: ExtensionAPI,
  context: ExtensionContext | undefined,
): ModelState | null {
  return context?.model ? modelState(pi, context) : null;
}

function transitionPoint(context: ExtensionContext): TransitionPoint {
  return {
    sessionId: context.sessionManager.getSessionId(),
    branchLeafId: context.sessionManager.getLeafId(),
  };
}

export function createTrajectoryRouter(pi: ExtensionAPI): TrajectoryRouter {
  const pending: PendingTransition[] = [];
  let latestContext: ExtensionContext | undefined;
  let draining: Promise<void> | undefined;
  let atTurnBoundary = false;

  async function apply(transition: PendingTransition): Promise<void> {
    const context = latestContext;
    if (!context) {
      transition.resolve({
        status: "rejected",
        current: null,
        transitionPoint: null,
        error: "Trajectory Router is not ready for transitions",
      });
      return;
    }

    const point = transitionPoint(context);
    const previous = currentModelState(pi, context);
    if (!previous) {
      transition.resolve({
        status: "rejected",
        current: null,
        transitionPoint: point,
        error: "Pi has no active model",
      });
      return;
    }

    const sameModel = previous.provider === transition.target.provider
      && previous.model === transition.target.model;
    const preflight = preflightTransition(context, transition.target, !sameModel);
    if (!preflight.accepted) {
      transition.resolve({
        status: "rejected",
        current: previous,
        transitionPoint: point,
        error: preflight.error,
      });
      return;
    }

    const applyThinking = prepareTargetThinking(pi, transition.target.thinkingLevel);
    if (sameModel) {
      const thinking = applyThinking();
      const current = modelState(pi, context);
      transition.resolve(current.thinkingLevel === previous.thinkingLevel
        ? { status: "unchanged", current, thinking, transitionPoint: point }
        : { status: "changed", previous, current, thinking, transitionPoint: point });
      return;
    }

    try {
      if (!await pi.setModel(preflight.target)) {
        transition.resolve({
          status: "rejected",
          current: previous,
          transitionPoint: point,
          error: `Pi could not select model ${transition.target.provider}/${transition.target.model}`,
        });
        return;
      }
      const thinking = applyThinking();
      transition.resolve({
        status: "changed",
        previous,
        current: modelState(pi, context),
        thinking,
        transitionPoint: point,
      });
    } catch (error) {
      transition.resolve({
        status: "rejected",
        current: currentModelState(pi, context) ?? previous,
        transitionPoint: point,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function drain(): Promise<void> {
    if (draining) return draining;
    draining = Promise.resolve()
      .then(async () => {
        while (pending.length > 0) {
          await apply(pending.shift()!);
        }
      })
      .finally(() => {
        draining = undefined;
        if (pending.length > 0) void drain();
      });
    return draining;
  }

  function transitionTo(target: TransitionTarget): Promise<TransitionResult> {
    return new Promise((resolve) => {
      pending.push({ target, resolve });
      if (!latestContext || latestContext.isIdle() || atTurnBoundary) void drain();
    });
  }

  pi.on("session_start", (_event, context) => {
    latestContext = context;
    atTurnBoundary = context.isIdle();
  });
  pi.on("turn_start", (_event, context) => {
    latestContext = context;
    atTurnBoundary = false;
  });
  pi.on("turn_end", async (_event, context) => {
    latestContext = context;
    atTurnBoundary = true;
    await drain();
  });
  pi.on("agent_end", async (_event, context) => {
    latestContext = context;
    atTurnBoundary = true;
    await drain();
  });
  pi.on("agent_settled", async (_event, context) => {
    latestContext = context;
    atTurnBoundary = true;
    await drain();
  });

  return { transitionTo };
}

export type {
  ModelState,
  ThinkingLevel,
  ThinkingTransition,
  TrajectoryRouter,
  TransitionPoint,
  TransitionResult,
  TransitionTarget,
} from "./types.ts";
