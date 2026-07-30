import { requireProfile } from "@/lib/auth";
import { profilesRepository, projectsRepository } from "@/server/data";
import { parsePageParams } from "@/lib/pagination";
import { Page, PageHeader } from "@/components/layout";
import { ProjectsBoard } from "@/components/projects-board";
import { ProjectsTable } from "@/components/projects-table";
import { ProjectsTabs } from "@/components/projects-tabs";
import { isOfficeRole } from "@/lib/domain/role";

export const metadata = { title: "Project Tracker" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfile();
  const isAdmin = isOfficeRole(profile.role);
  const sp = await searchParams;
  const view = (Array.isArray(sp.view) ? sp.view[0] : sp.view) ?? "board";

  const params = parsePageParams(sp, {
    filterKeys: ["status", "stage", "coordinator"],
    defaultSort: "created_at",
    defaultDir: "desc",
  });

  // Board = all active projects (bounded); list = server-paginated flat rows.
  const [boardProjects, listPage, coordinators] = await Promise.all([
    projectsRepository.list(),
    projectsRepository.page(params),
    isAdmin ? profilesRepository.coordinators() : Promise.resolve([]),
  ]);

  return (
    <Page>
      <PageHeader
        title="Project Tracker"
        description="KSEB / ANERT installation pipeline. Track milestones on the board, or browse every project in the list."
      />
      <ProjectsTabs
        view={view}
        board={
          <ProjectsBoard
            projects={boardProjects}
            coordinators={coordinators}
            isAdmin={isAdmin}
          />
        }
        list={
          <ProjectsTable
            projects={listPage.rows}
            coordinators={coordinators}
            isAdmin={isAdmin}
            server={{
              total: listPage.total,
              page: listPage.page,
              pageSize: listPage.pageSize,
            }}
          />
        }
      />
    </Page>
  );
}
