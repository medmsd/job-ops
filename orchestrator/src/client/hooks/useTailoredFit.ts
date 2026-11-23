import * as api from "@client/api";
import type { TailoredFitState } from "@shared/types.js";
import { useQuery } from "@tanstack/react-query";

const NOT_CHECKED: TailoredFitState = {
  result: null,
  isStale: false,
  reason: "not_checked",
};

/**
 * Reads the stored derived tailored fit for a job. This is a deterministic GET:
 * it never computes a score and never calls the AI.
 */
export function useTailoredFit(jobId: string) {
  const {
    data: state = NOT_CHECKED,
    isLoading,
    refetch,
  } = useQuery<TailoredFitState>({
    queryKey: ["tailored-fit", jobId],
    queryFn: () => api.getTailoredFit(jobId),
    enabled: Boolean(jobId),
  });

  return { state, isLoading, refetch };
}
