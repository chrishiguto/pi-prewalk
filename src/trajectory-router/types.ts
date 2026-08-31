export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelState {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
}

export interface TransitionPoint {
  sessionId: string;
  branchLeafId: string | null;
}

export interface TransitionTarget {
  provider: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
}

export interface ThinkingTransition {
  requested: ThinkingLevel;
  effective: ThinkingLevel;
  clamped: boolean;
}

export type TransitionResult =
  | {
      status: "changed";
      previous: ModelState;
      current: ModelState;
      thinking: ThinkingTransition;
      transitionPoint: TransitionPoint;
    }
  | {
      status: "unchanged";
      current: ModelState;
      thinking: ThinkingTransition;
      transitionPoint: TransitionPoint;
    }
  | {
      status: "rejected";
      current: ModelState | null;
      transitionPoint: TransitionPoint | null;
      error: string;
    };

export interface TrajectoryRouter {
  transitionTo(target: TransitionTarget): Promise<TransitionResult>;
}
