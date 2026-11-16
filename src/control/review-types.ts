export interface ReviewStatus {
  experiments?: {id:string;status:string;hypothesis:string;metric:string;progress:string;error:string|null}[];
  installed: boolean;
  paused: boolean;
  status: string;
  nextScheduledAt: number | null;
  retryAt?: number;
  error?: string | null;
  latestReview?: {
    summary: string;
    evidence: string[];
    expectedEffect: string;
    measuredOutcome: string;
    nextMeasure: string;
  };
  startedAt?: string;
  finishedAt?: string;
  usage?: {
    available: boolean;
    ordinaryUsageAllowed?: boolean | null;
    limits?: Record<
      string,
      {
        primary?: { usedPercent: number; resetsAt: number | null };
        secondary?: { usedPercent: number; resetsAt: number | null };
      }
    >;
  };
  backlog?: {
    priority: number;
    title: string;
    effortPoints: number;
    nextStep: string;
  }[];
  deployment?: { commit: string; status: string };
  activeTask?: {
    id: string;
    title: string;
    acceptance: string;
    stage: string;
    attempts: number;
    noProgressStreak: number;
    nextAction: string;
    lastOutcome?: string;
  };
  reviewHistory?: {
    at: string;
    summary: string;
    taskId?: string;
    outcome: string;
    commit?: string;
    activate: boolean;
  }[];
  lastGameplayChange?: { at: string; summary: string; commit?: string };
  cleanupError?: string | null;
  attempt?: number;
}
