"use client";

import { useEffect } from "react";
import { AppPage } from "@/components/app-ui/AppPage";
import { ErrorState } from "@/components/app-ui/States";
import { Button } from "@/components/primitives/Button";

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppPage width="text">
      <ErrorState
        title="This workspace view could not be loaded"
        body="The latest data did not arrive, so Virally has kept the previous workspace state untouched."
        reassurance="No content, schedule, account connection, or production credit was changed."
        actions={<Button onClick={reset}>Try again</Button>}
      />
    </AppPage>
  );
}
