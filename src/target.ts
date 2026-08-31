import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel, TransitionTarget } from "./trajectory-router/index.ts";

export const DEFAULT_TARGET = {
  provider: "opencode",
  model: "glm-5.2",
} as const;

export interface TargetIdentity {
  provider: string;
  model: string;
}

export interface TargetFallbackWarning {
  code: "default-unavailable" | "default-current";
  preferred: TargetIdentity;
  selected: TargetIdentity;
  message: string;
}

export type TargetResolution =
  | {
      ok: true;
      target: TransitionTarget;
      selection: "explicit" | "default" | "fallback";
      warning?: TargetFallbackWarning;
    }
  | { ok: false; error: string };

export interface ResolveTargetOptions {
  models: readonly Model<any>[];
  hasConfiguredAuth(model: Model<any>): boolean;
  current?: TargetIdentity;
  explicit?: Partial<TransitionTarget>;
}

export function resolveTarget(options: ResolveTargetOptions): TargetResolution {
  const { explicit } = options;
  if (explicit?.provider !== undefined || explicit?.model !== undefined) {
    const resolution = resolveExplicit(options, explicit);
    if (!resolution.ok) return resolution;
    return {
      ok: true,
      selection: "explicit",
      target: withThinking(resolution.model, explicit.thinkingLevel),
    };
  }

  const preferred = findAuthenticated(options, DEFAULT_TARGET.provider, DEFAULT_TARGET.model);
  if (preferred && !isCurrent(preferred, options.current)) {
    return {
      ok: true,
      selection: "default",
      target: withThinking(preferred, explicit?.thinkingLevel),
    };
  }

  const candidates = options.models
    .filter(options.hasConfiguredAuth)
    .filter((candidate) => !isCurrent(candidate, options.current));
  if (candidates.length === 0) {
    return {
      ok: false,
      error: "No authenticated target model other than the current model is available.",
    };
  }

  const knownPriceCandidates = candidates.filter((candidate) => modelPrice(candidate) > 0);
  const selected = [...(knownPriceCandidates.length > 0 ? knownPriceCandidates : candidates)]
    .sort(compareModels)[0]!;
  const selectedIdentity = identity(selected);

  return {
    ok: true,
    selection: "fallback",
    target: withThinking(selected, explicit?.thinkingLevel),
    warning: {
      code: preferred ? "default-current" : "default-unavailable",
      preferred: DEFAULT_TARGET,
      selected: selectedIdentity,
      message: preferred
        ? `Default target ${DEFAULT_TARGET.provider}/${DEFAULT_TARGET.model} is already the current planner model; using ${selectedIdentity.provider}/${selectedIdentity.model}, the cheapest authenticated alternative.`
        : `Default target ${DEFAULT_TARGET.provider}/${DEFAULT_TARGET.model} is unavailable; using ${selectedIdentity.provider}/${selectedIdentity.model}, the cheapest authenticated alternative.`,
    },
  };
}

type ExplicitResolution =
  | { ok: true; model: Model<any> }
  | { ok: false; error: string };

function resolveExplicit(
  options: ResolveTargetOptions,
  explicit: Partial<TransitionTarget>,
): ExplicitResolution {
  if (!explicit.model) {
    return { ok: false, error: "Target must be provider/model or a unique model ID." };
  }

  const matches = explicit.provider
    ? options.models.filter((candidate) => (
        candidate.provider === explicit.provider && candidate.id === explicit.model
      ))
    : options.models.filter((candidate) => candidate.id === explicit.model);
  const label = explicit.provider ? `${explicit.provider}/${explicit.model}` : explicit.model;

  if (matches.length === 0) {
    return { ok: false, error: `Target ${label} is unavailable.` };
  }

  const authenticated = matches.filter(options.hasConfiguredAuth);
  if (authenticated.length === 0) {
    return { ok: false, error: `Target ${label} is unauthenticated.` };
  }
  if (!explicit.provider && authenticated.length > 1) {
    const choices = authenticated
      .map((candidate) => `${candidate.provider}/${candidate.id}`)
      .sort(compareText)
      .join(", ");
    return {
      ok: false,
      error: `Model ID ${explicit.model} is ambiguous; use one of: ${choices}.`,
    };
  }

  const selected = authenticated[0]!;
  if (isCurrent(selected, options.current)) {
    return {
      ok: false,
      error: `Target ${selected.provider}/${selected.id} is already the current planner model.`,
    };
  }
  return { ok: true, model: selected };
}

function findAuthenticated(
  options: ResolveTargetOptions,
  provider: string,
  model: string,
): Model<any> | undefined {
  return options.models.find((candidate) => (
    candidate.provider === provider
    && candidate.id === model
    && options.hasConfiguredAuth(candidate)
  ));
}

function isCurrent(candidate: Model<any>, current?: TargetIdentity): boolean {
  return candidate.provider === current?.provider && candidate.id === current.model;
}

function modelPrice(candidate: Model<any>): number {
  return candidate.cost.input + candidate.cost.output;
}

function compareModels(left: Model<any>, right: Model<any>): number {
  return modelPrice(left) - modelPrice(right)
    || compareText(left.provider, right.provider)
    || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identity(candidate: Model<any>): TargetIdentity {
  return { provider: candidate.provider, model: candidate.id };
}

function withThinking(candidate: Model<any>, thinking?: ThinkingLevel): TransitionTarget {
  return {
    ...identity(candidate),
    ...(thinking ? { thinkingLevel: thinking } : {}),
  };
}
