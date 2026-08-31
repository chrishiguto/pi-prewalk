import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel, ThinkingTransition } from "./types.ts";

export function prepareTargetThinking(
  pi: ExtensionAPI,
  requested?: ThinkingLevel,
): () => ThinkingTransition {
  const desired = requested ?? pi.getThinkingLevel();

  return () => {
    pi.setThinkingLevel(desired);
    const effective = pi.getThinkingLevel();
    return {
      requested: desired,
      effective,
      clamped: effective !== desired,
    };
  };
}
