import { SearchX } from "lucide-react";
import { AppPage } from "@/components/app-ui/AppPage";
import { EmptyState } from "@/components/app-ui/States";
import { ButtonLink } from "@/components/primitives/ButtonLink";

export default function ProductNotFound() {
  return (
    <AppPage width="text">
      <EmptyState
        icon={<SearchX size={20} strokeWidth={1.75} />}
        title="This workspace item is unavailable"
        body="It may have been archived, removed, or belong to a workspace you cannot access."
        actions={<ButtonLink href="/app">Return to overview</ButtonLink>}
      />
    </AppPage>
  );
}
