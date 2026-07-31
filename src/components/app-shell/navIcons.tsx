import {
  AtSign,
  BarChart3,
  CalendarDays,
  CreditCard,
  FlaskConical,
  FolderOpen,
  Gauge,
  LayoutGrid,
  Settings,
  Users,
  Video,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NavId } from "@/content/app-navigation";

/**
 * Navigation icons.
 *
 * Typed as an exhaustive `Record<NavId, …>`, so a new nav destination cannot
 * ship without an icon — the alternative, a lookup returning `undefined`, is a
 * missing glyph nobody notices until it is in production.
 *
 * Each icon names the OPERATION rather than the data type: Create is a wand
 * because it transforms a brief, Campaigns is a grid because it is a set of
 * parallel runs, Experiments is a flask because it is a hypothesis under test.
 *
 * No two entries share a glyph. Accounts (authorised social handles) and Team
 * (people in the workspace) are the pair most easily collapsed into one
 * "users" icon, which would make two unrelated rail items indistinguishable —
 * so Accounts takes the handle glyph.
 */
export const navIcons: Record<NavId, LucideIcon> = {
  overview: Gauge,
  create: Wand2,
  campaigns: LayoutGrid,
  content: Video,
  calendar: CalendarDays,
  accounts: AtSign,
  analytics: BarChart3,
  library: FolderOpen,
  experiments: FlaskConical,
  team: Users,
  usage: CreditCard,
  settings: Settings,
};

/**
 * Icon geometry.
 *
 * 16px in the rail, `strokeWidth` 1.5 rather than lucide's default 2: at this
 * size a 2px stroke reads as heavier than the 15px label beside it, which makes
 * the icon shout over the text it is labelling.
 */
export const NAV_ICON_SIZE = 16;
export const NAV_ICON_STROKE = 1.5;
