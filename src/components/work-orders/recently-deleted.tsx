import { History } from "lucide-react";
import { Section } from "@/components/layout";
import type { DeletionGroup } from "@/lib/domain/deletion-log";
import { formatDateTime } from "@/lib/format";

/** How many deletes the section lists, newest first. */
export const RECENTLY_DELETED_LIMIT = 50;

/** Records named per delete before the rest are counted ("+3 more"). */
const HEADLINES_SHOWN = 5;

/**
 * The deletion log on the clean-up page: one entry per delete (a sale with its
 * project and ledger is one), when (India time), who, what, and what went with
 * it. Read-only — there is no restore button; a deleted row is put back from
 * its snapshot with SQL. Server-rendered from `groupDeletions`.
 */
export function RecentlyDeleted({ groups }: { groups: readonly DeletionGroup[] }) {
  const shown = groups.slice(0, RECENTLY_DELETED_LIMIT);

  return (
    <Section
      title="Recently deleted"
      description="Deletes are permanent. The office can ask for a deleted sale to be restored from this log with SQL."
      icon={History}
    >
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been deleted yet.</p>
      ) : (
        <ul className="divide-y" aria-label="Recent deletes">
          {shown.map((group) => (
            <DeletionEntry key={group.tx} group={group} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function DeletionEntry({ group }: { group: DeletionGroup }) {
  const named = group.headline.slice(0, HEADLINES_SHOWN);
  const more = group.headline.length - named.length;

  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <p className="text-xs text-muted-foreground">
        <time dateTime={group.deletedAt}>{formatDateTime(group.deletedAt)}</time>
        {" · "}
        {group.deletedByName ?? "Unknown"}
      </p>
      <ul className="space-y-0.5 text-sm font-medium [overflow-wrap:anywhere]">
        {named.map((label, i) => (
          <li key={i}>{label}</li>
        ))}
        {more > 0 && <li className="font-normal text-muted-foreground">+{more} more</li>}
      </ul>
      {group.alsoRemoved.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also removed: {group.alsoRemoved.map((item) => item.label).join(", ")}
        </p>
      )}
    </li>
  );
}
