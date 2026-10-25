import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  CoordinatorDirectory,
  matchingName,
  type CoordinatorMatch,
} from "@/lib/domain/coordinator-match";
import { cn } from "@/lib/utils";

/** Rows named per entry before the rest are counted. */
const ROWS_SHOWN = 12;

/** "row 5", "rows 5 and 8", "rows 2, 3, 4 … and 20 more". */
export function describeRows(rows: readonly number[]): string {
  if (rows.length === 1) return `row ${rows[0]}`;
  if (rows.length <= ROWS_SHOWN) {
    return `rows ${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`;
  }
  return `rows ${rows.slice(0, ROWS_SHOWN).join(", ")} and ${rows.length - ROWS_SHOWN} more`;
}

/** One entry's sentence, in words that read the same to a screen reader. */
function Entry({ match }: { match: CoordinatorMatch }) {
  const blank = match.written === "";
  const written = blank ? "(blank)" : `“${match.written}”`;

  if (match.account) {
    const unnamed = matchingName(match.account).nameIsEmail;
    return (
      <>
        <span className="font-medium">{written}</span>
        <span aria-hidden> → </span>
        <span className="sr-only"> is </span>
        <span>{CoordinatorDirectory.label(match.account)}</span>
        {blank && <span> (default coordinator)</span>}
        {unnamed && (
          <span className="block text-xs text-muted-foreground">
            This account has no name, only its e-mail, and the Team page cannot rename it.
            New accounts get a name through Team → Add member; for this one, ask whoever
            manages the database to set it.
          </span>
        )}
      </>
    );
  }

  const problem = match.problem ?? "is not an account";
  return blank ? (
    <>
      <span className="font-medium">{written}</span>
      <span aria-hidden> → </span>
      <span className="sr-only"> has </span>
      <span>no default chosen — these rows fail</span>
    </>
  ) : (
    <>
      <span className="font-medium">{written}</span> <span>{problem}</span>
    </>
  );
}

/**
 * The "Coordinator matches" panel of Check file and of the results: each
 * distinct thing the sheet wrote in its coordinator column, who it became (or
 * why it did not become anyone), and on which rows. Entries that are not
 * accounts come first — they are why rows fail. Nothing here is a guess: a
 * close spelling is only ever offered, in the problem's own words.
 */
export function CoordinatorMatches({ matches }: { matches: readonly CoordinatorMatch[] }) {
  if (matches.length === 0) return null;
  const problems = matches.filter((m) => m.account === null).length;

  return (
    <section aria-labelledby="coordinator-matches-title" className="space-y-2">
      <h3 id="coordinator-matches-title" className="text-sm font-semibold">
        Coordinator matches
        {problems > 0 && (
          <span className="ml-2 font-normal text-destructive">
            · {problems} need{problems === 1 ? "s" : ""} fixing
          </span>
        )}
      </h3>
      <p className="text-xs text-muted-foreground">
        Who each name in the coordinator column became. A full name, a first name that only
        one coordinator has, or an e-mail is accepted; a name that is only close is never
        assumed.
      </p>
      <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
        {matches.map((m) => {
          const bad = m.account === null;
          return (
            <li
              key={m.written === "" ? "(blank)" : m.written.toLowerCase()}
              className={cn("flex items-start gap-2.5 px-3 py-2.5 text-sm", bad && "bg-destructive/5")}
            >
              {bad ? (
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <CheckCircle2
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                />
              )}
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p>
                  {bad && <span className="sr-only">Needs fixing: </span>}
                  <Entry match={m} />
                </p>
                <p className="text-xs text-muted-foreground">{describeRows(m.rows)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
