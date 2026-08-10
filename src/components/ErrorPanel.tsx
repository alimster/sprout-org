import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Turns an unknown thrown value into something safe to show a person. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error && error.message) {
    // Postgres/PostgREST permission errors are not useful to a reader.
    if (/permission denied|row-level security|JWT|violates/i.test(error.message)) {
      return "You don't have access to that.";
    }
    return error.message;
  }
  return fallback;
}

/**
 * Shown wherever a fetch fails, so a failed request never renders as an empty
 * state that looks like "there is no data".
 */
export function ErrorPanel({
  title = "We couldn't load this",
  message,
  onRetry,
  retrying,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="panel flex flex-col items-center gap-2 border-destructive/30 bg-destructive/5 p-8 text-center"
    >
      <AlertTriangle className="size-6 text-destructive" />
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {message ?? "The request didn't come back. Check your connection and try again."}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={retrying}>
          <RotateCcw className="size-4" />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}

/** Compact inline variant for panels and dialog sections. */
export function InlineError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <AlertTriangle className="size-4 shrink-0" />
      {message ?? "Couldn't load this."}
      {onRetry && (
        <button type="button" onClick={onRetry} className="underline underline-offset-2">
          Retry
        </button>
      )}
    </p>
  );
}
