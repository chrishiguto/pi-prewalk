import type { ThinkingLevel, TransitionTarget } from "./trajectory-router/index.ts";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_ERROR = `Thinking must be one of: ${THINKING_LEVELS.join(", ")}.`;

export const PREWALK_FLAG_NAMES = {
  arm: "prewalk",
  target: "prewalk-target",
  thinking: "prewalk-thinking",
} as const;

export type ArmInput = Partial<TransitionTarget>;
export type ParseArmInputResult =
  | { ok: true; value: ArmInput }
  | { ok: false; error: string };

interface FlagRegistrar {
  registerFlag(name: string, options: {
    description: string;
    type: "boolean" | "string";
  }): void;
}

interface FlagReader {
  getFlag(name: string): boolean | string | undefined;
}

export function registerStartupFlags(pi: FlagRegistrar): void {
  pi.registerFlag(PREWALK_FLAG_NAMES.arm, {
    description: "Arm Prewalk when the session starts",
    type: "boolean",
  });
  pi.registerFlag(PREWALK_FLAG_NAMES.target, {
    description: "Prewalk target as provider/model or a unique model ID",
    type: "string",
  });
  pi.registerFlag(PREWALK_FLAG_NAMES.thinking, {
    description: "Optional target thinking level",
    type: "string",
  });
}

export function readStartupArmInput(pi: FlagReader): ParseArmInputResult | undefined {
  if (pi.getFlag(PREWALK_FLAG_NAMES.arm) !== true) return undefined;

  const target = pi.getFlag(PREWALK_FLAG_NAMES.target);
  const thinking = pi.getFlag(PREWALK_FLAG_NAMES.thinking);
  return parseArmInput(
    typeof target === "string" ? target : undefined,
    typeof thinking === "string" ? thinking : undefined,
  );
}

export function parseCommandArmInput(args: string): ParseArmInputResult {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 2) {
    return { ok: false, error: "Usage: /prewalk [provider/model|model] [thinking]." };
  }
  if (parts.length === 1 && parseThinking(parts[0])) {
    return parseArmInput(undefined, parts[0]);
  }
  return parseArmInput(parts[0], parts[1]);
}

export function parseArmInput(
  targetText?: string,
  thinkingText?: string,
): ParseArmInputResult {
  const thinking = parseThinking(thinkingText);
  if (thinkingText !== undefined && thinking === undefined) {
    return { ok: false, error: THINKING_ERROR };
  }

  const rawTarget = targetText?.trim();
  if (!rawTarget) return { ok: true, value: thinking ? { thinkingLevel: thinking } : {} };

  if (/\s/.test(rawTarget)) {
    return { ok: false, error: "Target must be provider/model or a unique model ID." };
  }

  const slash = rawTarget.indexOf("/");
  if (slash === 0 || slash === rawTarget.length - 1) {
    return { ok: false, error: "Target must be provider/model or a unique model ID." };
  }

  const value: ArmInput = slash === -1
    ? { model: rawTarget }
    : {
        provider: rawTarget.slice(0, slash),
        model: rawTarget.slice(slash + 1),
      };
  if (thinking) value.thinkingLevel = thinking;
  return { ok: true, value };
}

function parseThinking(value?: string): ThinkingLevel | undefined {
  const normalized = value?.trim();
  return THINKING_LEVELS.find((level) => level === normalized);
}
