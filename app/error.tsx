"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const sessionExpired = /\s(401|403)\s/.test(error.message);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center">
      <h1 className="text-2xl font-heading font-semibold text-destructive">
        Something went wrong
      </h1>
      <p className="max-w-sm text-muted-foreground">
        {sessionExpired
          ? "Your session may have expired. Please log in again."
          : "We couldn't load the dashboard. This usually clears up on its own — try again in a moment."}
      </p>
      <div className="mt-4 flex gap-2">
        {sessionExpired ? (
          <Button render={<Link href="/login" />}>Log in again</Button>
        ) : (
          <Button onClick={reset}>Try again</Button>
        )}
      </div>
    </div>
  );
}
