import { requireDeleter } from "@/lib/auth";
import {
  deletionLogRepository,
  duplicatesRepository,
  profilesRepository,
} from "@/server/data";
import { groupDeletions } from "@/lib/domain/deletion-log";
import { findDuplicateGroups } from "@/lib/domain/duplicate-sales";
import { Page, PageHeader } from "@/components/layout";
import { DuplicateCleanup } from "@/components/work-orders/duplicate-cleanup";
import {
  RECENTLY_DELETED_LIMIT,
  RecentlyDeleted,
} from "@/components/work-orders/recently-deleted";

export const metadata = { title: "Find duplicates" };

/**
 * The duplicate clean-up: sales entered more than once, grouped, with the copy
 * to keep suggested, and the deletion log below. Deleters only (DELETE_ROLES) —
 * everyone else is sent home by the guard; the way in is "Find duplicates" on
 * /work-orders, shown to the same roles.
 */
export default async function DuplicatesPage() {
  await requireDeleter();

  // The sales and the log throw on a failed read, to the error page: an empty
  // list would say "no duplicates" or "nothing deleted". The log is read as
  // whole deletes, so a bulk clean-up is never shown in part. Names only fill in
  // whose incentive was deleted, so a failed directory read just leaves them out.
  const [sales, log, directory] = await Promise.all([
    duplicatesRepository.sales(),
    deletionLogRepository.recent(RECENTLY_DELETED_LIMIT),
    profilesRepository.accounts(),
  ]);

  const groups = findDuplicateGroups(sales);
  const names = new Map(directory.accounts.map((account) => [account.id, account.fullName]));
  const deletions = groupDeletions(log, names).slice(0, RECENTLY_DELETED_LIMIT);

  return (
    <Page>
      <PageHeader
        title="Find duplicates"
        description="Sales that look like the same sale entered more than once: the same KSEB consumer number, or the same customer name on the same order date. Names are matched ignoring capitals, spacing, punctuation, word order and how initials are written — but not spelling, so “Ravee” and “Ravi” are two customers. A live copy with the most recorded work is suggested to keep, and only copies that are plainly the same sale are ticked; review each group, then delete the extra copies."
        backHref="/work-orders"
      />

      <DuplicateCleanup groups={groups} />

      <RecentlyDeleted groups={deletions} />
    </Page>
  );
}
