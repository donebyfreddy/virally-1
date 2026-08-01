import { Wallet } from "lucide-react";
import type { GenerationModel } from "@/lib/creative/capabilities";
// The rate lives in one place. Recomputing "cents ÷ 25" here would be a second
// definition of the credit that a change to the first would not reach.
import { centsToCredits } from "@/lib/creative/modes";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/app-ui/Card";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { EmptyState } from "@/components/app-ui/States";
import { CAPABILITY_LABELS, generateCopy, type StudioDefinition } from "@/content/generate";
import { ProviderBanner } from "./ProviderBanner";
import { OutputGrid } from "./OutputGrid";
import { StudioShell } from "./StudioShell";
import type { StudioData } from "./data";

/**
 * One studio, rendered.
 *
 * A server component holding the three parts that never change while the user
 * is looking at them — the banner, the cost table and the history — around the
 * one part that does. The four studio routes differ only in their
 * `StudioDefinition` and their data, so they share this rather than four copies
 * of the same layout that drift apart on the first change.
 */
export function StudioScreen({
  studio,
  data,
  canGenerate,
  workspaceName,
}: {
  studio: StudioDefinition;
  data: StudioData;
  canGenerate: boolean;
  workspaceName: string;
}) {
  const priced = [...data.models].sort(
    (a, b) => (a.estimatedCentsPerUnit ?? 0) - (b.estimatedCentsPerUnit ?? 0),
  );

  return (
    <>
      <PageHeader
        title={studio.title}
        description={studio.description}
        meta={[
          workspaceName,
          `${data.balance.available.toLocaleString("en-US")} ${generateCopy.costUnit} available`,
          data.models.length === 1 ? "1 model offered" : `${data.models.length} models offered`,
        ]}
      />

      <ProviderBanner providers={data.providers} />

      <StudioShell
        studio={studio}
        models={data.models}
        available={data.balance.available}
        references={data.references}
        providers={data.providers}
        canGenerate={canGenerate}
        activeRuns={data.activeRuns}
      />

      <Card>
        <CardHeader
          as="h2"
          title={generateCopy.outputsTitle}
          description={`${studio.label} runs in this workspace, newest first.`}
          divided
        />
        <CardBody>
          <OutputGrid
            runs={data.history}
            emptyTitle={studio.emptyTitle}
            emptyBody={studio.emptyBody}
          />
        </CardBody>
        {/* Stated rather than silent. A capped list that looks complete is worse
            than one that says it is capped. */}
        {data.historyTruncated && (
          <CardFooter>
            Showing the {data.history.length} most recent runs. Older ones are in the library.
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader
          as="h2"
          title={generateCopy.costsTitle}
          description={generateCopy.costsHint}
          divided
        />
        {priced.length > 0 ? (
          <CardBody pad="none">
            <DataTable
              caption={`Models available for ${studio.title.toLowerCase()}, cheapest first`}
              columns={costColumns(studio)}
              rows={priced}
              rowKey={(model) => model.id}
            />
          </CardBody>
        ) : (
          <EmptyState
            bare
            icon={<Wallet size={20} strokeWidth={1.75} />}
            title={generateCopy.costsEmptyTitle}
            body={generateCopy.costsEmptyBody}
          />
        )}
      </Card>
    </>
  );
}

function costColumns(studio: StudioDefinition): readonly Column<GenerationModel>[] {
  const unit =
    studio.generationType === "video"
      ? "per clip"
      : studio.generationType === "audio"
        ? "per track"
        : "per image";

  return [
    {
      id: "model",
      header: "Model",
      cell: (model) => <PrimaryCell title={model.name} detail={model.description} />,
    },
    {
      id: "provider",
      header: "Provider",
      hideBelow: "sm",
      cell: (model) => <span className="whitespace-nowrap">{model.providerId}</span>,
    },
    {
      id: "capabilities",
      header: "Capabilities",
      hideBelow: "lg",
      cell: (model) => (
        <span className="block max-w-[18rem] truncate">
          {model.capabilities.map((entry) => CAPABILITY_LABELS[entry]).join(", ")}
        </span>
      ),
    },
    {
      id: "formats",
      header: "Formats",
      hideBelow: "xl",
      cell: (model) =>
        model.supportedAspectRatios.length > 0 ? (
          <span className="app-figure whitespace-nowrap">
            {model.supportedAspectRatios.join(", ")}
          </span>
        ) : (
          <span className="text-[color:var(--text-muted)]">
            <span aria-hidden="true">—</span>
            <span className="sr-only">Unconstrained</span>
          </span>
        ),
    },
    {
      id: "cost",
      header: `Credits ${unit}`,
      numeric: true,
      width: "9rem",
      cell: (model) => (
        // Production Credits, derived from the same rate the reservation uses.
        // The cent basis behind it is our provider cost and never appears here.
        <span className="whitespace-nowrap">
          {Math.max(1, centsToCredits(model.estimatedCentsPerUnit ?? 0)).toLocaleString("en-US")}
        </span>
      ),
    },
  ];
}
