import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  parseCommandArmInput,
  readStartupArmInput,
  registerStartupFlags,
  type ArmInput,
} from "./config.ts";
import {
  createPolicyState,
  isOwnedControlMessage,
  reducePolicy,
  resolveTransition,
  type PolicyState,
  type TerminalPolicyEffect,
} from "./policy.ts";
import { CHECKLIST_PROMPT, CONTINUE_PROMPT, PLAN_PROMPT } from "./prompts.ts";
import type {
  ThinkingLevel,
  TrajectoryRouter,
  TransitionResult,
  TransitionTarget,
} from "./trajectory-router/index.ts";
import { resolveTarget } from "./target.ts";

const PLAN_MESSAGE_PREFIX = "pi-prewalk-plan:";
const CONTINUE_MESSAGE_PREFIX = "pi-prewalk-continue:";
const CHECKLIST_MESSAGE_TYPE = "pi-prewalk-checklist";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

interface ActiveRun {
  id: string;
  lifecycle: "awaiting-task" | "planning";
  target: TransitionTarget;
  policy: PolicyState;
  ownedControlTypes: string[];
}

interface PrewalkState {
  active?: ActiveRun;
  retiredControlTypes: string[];
}

export function registerPrewalk(pi: ExtensionAPI, router: TrajectoryRouter): void {
  let state: PrewalkState = { retiredControlTypes: [] };
  let modelChoices: string[] = [];
  registerStartupFlags(pi);

  function refreshModelChoices(ctx: ExtensionContext): void {
    modelChoices = ctx.modelRegistry.getAvailable()
      .filter((model: Model<any>) => ctx.modelRegistry.hasConfiguredAuth(model))
      .map((model: Model<any>) => `${model.provider}/${model.id}`)
      .sort();
  }

  function targetLabel(target: TransitionTarget): string {
    const thinking = target.thinkingLevel ? ` (${target.thinkingLevel})` : "";
    return `${target.provider}/${target.model}${thinking}`;
  }

  function updateStatus(ctx: ExtensionContext): void {
    const run = state.active;
    if (!run) {
      ctx.ui.setStatus("prewalk", undefined);
      return;
    }
    const phase = run.lifecycle === "awaiting-task"
      ? "next task"
      : run.policy.phase === "transitioning" ? "switching" : "planning";
    ctx.ui.setStatus("prewalk", `prewalk: ${phase} → ${targetLabel(run.target)}`);
  }

  function completeArguments(prefix: string) {
    const input = prefix.trimStart();
    const separator = input.indexOf(" ");
    if (separator !== -1) {
      const target = input.slice(0, separator);
      const thinkingPrefix = input.slice(separator + 1).trimStart();
      const items = THINKING_LEVELS
        .filter((level) => level.startsWith(thinkingPrefix))
        .map((level) => ({ value: `${target} ${level}`, label: level }));
      return items.length > 0 ? items : null;
    }

    const values = ["status", "disarm", ...modelChoices]
      .filter((value) => value.startsWith(input));
    return values.length > 0
      ? values.map((value) => ({ value, label: value }))
      : null;
  }

  async function arm(input: ArmInput, ctx: ExtensionContext): Promise<void> {
    if (state.active) {
      ctx.ui.notify(`Prewalk is already armed for ${state.active.target.provider}/${state.active.target.model}.`, "warning");
      return;
    }

    const resolution = resolveTarget({
      models: ctx.modelRegistry.getAvailable(),
      hasConfiguredAuth: (model: Model<any>) => ctx.modelRegistry.hasConfiguredAuth(model),
      current: ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : undefined,
      explicit: input,
    });
    if (!resolution.ok) {
      ctx.ui.notify(resolution.error, "error");
      return;
    }
    if (resolution.warning) ctx.ui.notify(resolution.warning.message, "warning");

    const planMessageType = `${PLAN_MESSAGE_PREFIX}${crypto.randomUUID()}`;
    state = {
      ...state,
      active: {
        id: crypto.randomUUID(),
        lifecycle: "awaiting-task",
        target: resolution.target,
        policy: createPolicyState({ todoToolActive: pi.getActiveTools().includes("todo") }),
        ownedControlTypes: [planMessageType],
      },
    };
    updateStatus(ctx);
    ctx.ui.notify(`Prewalk armed for the next task; target=${targetLabel(resolution.target)}.`, "info");
  }

  function disarm(ctx: ExtensionContext): void {
    if (state.active?.policy.phase === "transitioning") {
      ctx.ui.notify("Prewalk cannot disarm after a transition request is pending.", "warning");
      return;
    }
    state = {
      retiredControlTypes: [
        ...state.retiredControlTypes,
        ...(state.active?.ownedControlTypes ?? []),
      ],
    };
    updateStatus(ctx);
    ctx.ui.notify("Prewalk disarmed.", "info");
  }

  pi.registerCommand("prewalk", {
    description: "Plan the next task, then hand off after the first edit/write",
    getArgumentCompletions: completeArguments,
    handler: async (args, ctx) => {
      refreshModelChoices(ctx);
      const command = args.trim();
      if (command === "status") {
        const run = state.active;
        if (!run) {
          ctx.ui.notify("Prewalk is idle.", "info");
          return;
        }
        const phase = run.lifecycle === "awaiting-task"
          ? "awaiting next task"
          : run.policy.phase === "transitioning"
            ? "switching models"
            : `planner working; todo=${run.policy.todoReady ? "ready" : "waiting"}`;
        ctx.ui.notify(`Prewalk ${phase}; target=${targetLabel(run.target)}.`, "info");
        return;
      }
      if (command === "off" || command === "disarm") {
        disarm(ctx);
        return;
      }

      const armInput = command === "arm" ? "" : command.startsWith("arm ") ? command.slice(4) : command;
      const parsed = parseCommandArmInput(armInput);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }
      await arm(parsed.value, ctx);
    },
  });

  pi.on("session_start", async (event, ctx) => {
    refreshModelChoices(ctx);
    if (event.reason !== "startup" && event.reason !== "new") return;
    const parsed = readStartupArmInput(pi);
    if (!parsed) return;
    if (!parsed.ok) {
      ctx.ui.notify(parsed.error, "error");
      return;
    }
    await arm(parsed.value, ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const run = state.active;
    if (!run || run.lifecycle !== "awaiting-task") return;
    state = { ...state, active: { ...run, lifecycle: "planning" } };
    updateStatus(ctx);
    return {
      message: {
        customType: run.ownedControlTypes[0]!,
        content: PLAN_PROMPT,
        display: false,
      },
    };
  });

  function finishRun(run: ActiveRun, effect: TerminalPolicyEffect, ctx: ExtensionContext): void {
    state = {
      retiredControlTypes: [...state.retiredControlTypes, ...run.ownedControlTypes],
    };
    updateStatus(ctx);
    switch (effect.type) {
      case "transition_changed":
        pi.sendMessage(
          { customType: CHECKLIST_MESSAGE_TYPE, content: CHECKLIST_PROMPT, display: false },
          { deliverAs: "steer" },
        );
        ctx.ui.notify(
          `Prewalk continued with ${effect.result.current.provider}/${effect.result.current.model} at ${effect.result.current.thinkingLevel} thinking.`,
          "info",
        );
        return;
      case "transition_rejected":
        ctx.ui.notify(`Prewalk transition rejected: ${effect.result.error}`, "warning");
        return;
      case "transition_unchanged":
        return;
    }
  }

  function completeTransition(
    runId: string,
    pendingPolicy: PolicyState,
    result: TransitionResult,
    ctx: ExtensionContext,
  ): void {
    const run = state.active;
    if (!run || run.id !== runId || run.policy.phase !== "transitioning") return;
    const effect = resolveTransition(pendingPolicy, result);
    if (effect) finishRun(run, effect, ctx);
  }

  pi.on("tool_result", async (event, ctx) => {
    const run = state.active;
    if (!run || run.lifecycle !== "planning" || run.policy.phase !== "armed") return;
    const reduction = reducePolicy(run.policy, {
      type: "tool_completed",
      toolName: event.toolName,
      isError: event.isError,
      details: event.details,
    });
    state = { ...state, active: { ...run, policy: reduction.state } };
    updateStatus(ctx);
    if (!reduction.effects.some((effect) => effect.type === "request_transition")) return;

    void router.transitionTo(run.target).then((result) => {
      completeTransition(run.id, reduction.state, result, ctx);
    });
  });

  pi.on("turn_end", async (event) => {
    const run = state.active;
    if (!run || run.lifecycle !== "planning" || run.policy.phase !== "armed") return;
    const content = (event.message as { content?: unknown }).content;
    const hasToolCall = Array.isArray(content) && content.some((part) => (
      typeof part === "object" && part !== null && (part as { type?: string }).type === "toolCall"
    ));
    const reduction = reducePolicy(run.policy, {
      type: "assistant_completed",
      textOnly: !hasToolCall && event.toolResults.length === 0,
    });
    const continued = reduction.effects.some((effect) => effect.type === "continue");
    const customType = continued ? `${CONTINUE_MESSAGE_PREFIX}${crypto.randomUUID()}` : undefined;
    state = {
      ...state,
      active: {
        ...run,
        policy: reduction.state,
        ownedControlTypes: customType
          ? [...run.ownedControlTypes, customType]
          : run.ownedControlTypes,
      },
    };
    if (customType) {
      pi.sendMessage(
        { customType, content: CONTINUE_PROMPT, display: false },
        { triggerTurn: true, deliverAs: "steer" },
      );
    }
  });

  pi.on("context", async (event) => {
    if (state.retiredControlTypes.length === 0) return;
    return {
      messages: event.messages.filter((message) => {
        const candidate = message as { role?: string; customType?: string };
        return candidate.role !== "custom"
          || !isOwnedControlMessage(candidate.customType, state.retiredControlTypes);
      }),
    };
  });
}

export type { ThinkingLevel, TransitionTarget } from "./trajectory-router/index.ts";
