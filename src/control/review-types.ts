export interface ReviewStatus {
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
}
