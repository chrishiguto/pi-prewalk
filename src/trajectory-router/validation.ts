import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TransitionTarget } from "./types.ts";

export type TransitionPreflight =
  | { accepted: true; target: Model<Api> }
  | { accepted: false; error: string };

export function preflightTransition(
  context: ExtensionContext,
  requested: TransitionTarget,
  requireCapacity: boolean,
): TransitionPreflight {
  const target = context.modelRegistry.find(requested.provider, requested.model);
  if (!target) {
    return { accepted: false, error: `Model ${requested.provider}/${requested.model} is unavailable` };
  }
  if (!context.modelRegistry.hasConfiguredAuth(target)) {
    return { accepted: false, error: `Model ${requested.provider}/${requested.model} is not authenticated` };
  }
  if (!requireCapacity) return { accepted: true, target };

  const usage = context.getContextUsage();
  if (!usage || usage.tokens === null) {
    return {
      accepted: false,
      error: "Current trajectory size is unknown; target context capacity cannot be verified",
    };
  }
  if (usage.tokens > target.contextWindow) {
    return {
      accepted: false,
      error: `Model ${requested.provider}/${requested.model} has a ${target.contextWindow}-token context window, but the current trajectory uses ${usage.tokens} tokens`,
    };
  }
  return { accepted: true, target };
}
