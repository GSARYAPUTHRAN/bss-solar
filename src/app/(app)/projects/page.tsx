import { requireProfile } from "@/lib/auth";
import { profilesRepository, projectsRepository } from "@/server/data";
import { Page, PageHeader } from "@/components/layout";
import { ProjectsBoard } from "@/components/projects-board";
import { ProjectsTable } from "@/components/projects-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "Project Tracker" };

export default async function ProjectsPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";

  const [projects, coordinators] = await Promise.all([
    projectsRepository.list(),
    isAdmin ? profilesRepository.coordinators() : Promise.resolve([]),
  ]);

  return (
    <Page>
      <PageHeader
        title="Project Tracker"
        description="KSEB / ANERT installation pipeline. Track milestones on the board, or browse every project in the list."
      />
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="mt-4">
          <ProjectsBoard
            projects={projects}
            coordinators={coordinators}
            isAdmin={isAdmin}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
          <ProjectsTable
            projects={projects}
            coordinators={coordinators}
            isAdmin={isAdmin}
          />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
