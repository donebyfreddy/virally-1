import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { Card, CardBody } from "@/components/app-ui/Card";
import { LoadingState } from "@/components/app-ui/States";

export default function ProductLoading() {
  return (
    <AppPage>
      <PageStack>
        <div aria-hidden="true" className="flex flex-col gap-[var(--space-2)]">
          <div className="h-8 w-52 rounded-[var(--radius-control)] bg-[var(--surface-muted)] motion-safe:animate-pulse" />
          <div className="h-4 w-full max-w-[34rem] rounded-[var(--radius-chip)] bg-[var(--surface-muted)] motion-safe:animate-pulse" />
        </div>

        <div className="grid grid-cols-2 gap-[var(--app-panel-gap)] lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} pad="default">
              <LoadingState label="Loading workspace metrics" rows={2} />
            </Card>
          ))}
        </div>

        <Card>
          <CardBody>
            <LoadingState label="Loading workspace data" rows={7} />
          </CardBody>
        </Card>
      </PageStack>
    </AppPage>
  );
}
