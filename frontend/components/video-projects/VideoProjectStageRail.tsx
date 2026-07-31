import {
  Check,
  Circle,
  CircleDot,
} from "lucide-react";

import {
  VIDEO_PROJECT_STATUSES,
  type VideoProjectStatus,
} from "@/types/videoProject";

interface VideoProjectStageRailProps {
  currentStatus: VideoProjectStatus;
}

function formatStage(status: VideoProjectStatus): string {
  if (status === "voice") {
    return "Voice / Audio";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function VideoProjectStageRail({
  currentStatus,
}: VideoProjectStageRailProps) {
  const currentIndex =
    VIDEO_PROJECT_STATUSES.indexOf(currentStatus);

  return (
    <ol
      aria-label="Video project stages"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
    >
      {VIDEO_PROJECT_STATUSES.map((status, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const stateLabel = isCompleted
          ? "Completed"
          : isCurrent
            ? "Current"
            : "Upcoming";

        return (
          <li
            key={status}
            aria-current={isCurrent ? "step" : undefined}
            className={`rounded-2xl border px-4 py-4 transition ${
              isCompleted
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : isCurrent
                  ? "border-indigo-300 bg-indigo-50 text-indigo-900 shadow-md shadow-indigo-950/10 ring-1 ring-indigo-200"
                  : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                  isCompleted
                    ? "bg-emerald-600 text-white"
                    : isCurrent
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : isCurrent ? (
                  <CircleDot
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">
                {stateLabel}
              </span>
            </div>

            <p className="mt-3 text-sm font-bold">
              {formatStage(status)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
