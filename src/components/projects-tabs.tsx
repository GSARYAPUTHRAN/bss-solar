"use client";

import { type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Board/List tabs whose active tab lives in the URL (`?view=list`), so that
 * filtering/paginating the server-driven list (which re-renders the RSC) does
 * not reset the user back to the board.
 */
export function ProjectsTabs({
  view,
  board,
  list,
}: {
  view: string;
  board: ReactNode;
  list: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setView(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next === "board") {
      params.delete("view");
      // Leaving the list clears its list-only params.
      for (const k of ["q", "sort", "dir", "page", "size", "status", "stage", "coordinator"]) {
        params.delete(k);
      }
    } else {
      params.set("view", next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <Tabs value={view === "list" ? "list" : "board"} onValueChange={setView}>
      <TabsList>
        <TabsTrigger value="board">Board</TabsTrigger>
        <TabsTrigger value="list">List</TabsTrigger>
      </TabsList>
      <TabsContent value="board" className="mt-4">
        {board}
      </TabsContent>
      <TabsContent value="list" className="mt-4">
        {list}
      </TabsContent>
    </Tabs>
  );
}
