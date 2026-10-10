import { requireWorkOrderRole } from "@/lib/auth";
import { profilesRepository, projectsRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader } from "@/components/layout";
import { ProjectsBoard } from "@/components/projects-board";
import { ProjectsTable } from "@/components/projects-table";
import { ProjectsTabs } from "@/components/projects-tabs";
import {
  CoordinatorIncentiveSummary,
  OfficeIncentiveTile,
} from "@/components/projects/incentive-summary";
import { PROJECT_LIST_FILTER_KEYS } from "@/lib/domain/project-list";
import { isOfficeRole } from "@/lib/domain/role";

export const metadata = { title: "Project Tracker" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireWorkOrderRole();
  const isOffice = isOfficeRole(profile.role);
  const sp = await searchParams;
  const view = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "list" ? "list" : "board";

  const params = parsePageParams(sp, {
    filterKeys: PROJECT_LIST_FILTER_KEYS,
    defaultSort: "created_at",
    defaultDir: "desc",
  });
  // A coordinator's totals are their own (RLS scopes the RPC regardless); the
  // office sees everyone's, or the coordinator the list is filtered to.
  const incentiveScope = isOffice ? (params.filters.coordinator ?? null) : profile.id;

  // Only the active tab's data is fetched: switching tabs is a navigation
  // (`?view=`), which renders the page again for the other one.
  const [boardProjects, listPage, coordinators, incentives] = await Promise.all([
    view === "board" ? projectsRepository.board() : Promise.resolve(null),
    view === "list" ? projectsRepository.page(params) : Promise.resolve(null),
    isOffice ? profilesRepository.coordinators() : Promise.resolve([]),
    projectsRepository.incentiveSummary(incentiveScope),
  ]);

  return (
    <Page>
      <PageHeader
        title="Project Tracker"
        description="KSEB / ANERT installation pipeline. Track milestones on the board, or browse every project in the list."
      />

      {incentives &&
        (isOffice ? (
          <OfficeIncentiveTile
            summary={incentives}
            coordinatorId={incentiveScope}
            coordinatorName={coordinators.find((c) => c.id === incentiveScope)?.full_name}
          />
        ) : (
          <CoordinatorIncentiveSummary summary={incentives} />
        ))}

      <ProjectsTabs
        view={view}
        board={
          boardProjects && (
            <ProjectsBoard
              projects={boardProjects}
              coordinators={coordinators}
              isAdmin={isOffice}
            />
          )
        }
        list={
          listPage && (
            <ProjectsTable
              projects={listPage.rows}
              coordinators={coordinators}
              isAdmin={isOffice}
              server={{
                total: listPage.total,
                page: listPage.page,
                pageSize: listPage.pageSize,
              }}
            />
          )
        }
      />
    </Page>
  );
}
