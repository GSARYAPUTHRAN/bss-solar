import { requireProfile } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { navForRole } from "@/config/navigation";
import { BssLogo } from "@/components/bss-logo";
import { SidebarNav } from "@/components/sidebar-nav";
import { AppHeader } from "@/components/app-header";
import { COMPANY } from "@/lib/constants";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const items = navForRole(profile.role);

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <BssLogo variant="icon" className="h-9 w-9 shrink-0" priority />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold">{COMPANY.name}</p>
            <p className="text-[10px] text-muted-foreground">Operations Console</p>
          </div>
        </div>
        <div className="flex-1 py-4">
          <SidebarNav items={items} />
        </div>
        <div className="border-t p-4 text-[10px] text-muted-foreground">
          {COMPANY.tagline}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader items={items} profile={profile} signOutAction={signOut} />
        <main className="flex-1 bg-muted/30 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
