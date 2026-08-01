export type GlobalSearchResultKind =
  | "campaign"
  | "content"
  | "asset"
  | "account"
  | "scheduled_post"
  | "team_member";

/** A deliberately small, serialisable result returned to the command palette. */
export type GlobalSearchResult = {
  id: string;
  kind: GlobalSearchResultKind;
  label: string;
  hint: string;
  href: string;
  group: string;
};
