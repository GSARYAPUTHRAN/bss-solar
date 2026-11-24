"use client";

import {
  BarChart3,
  LayoutDashboard,
  ClipboardList,
  KanbanSquare,
  Wrench,
  Users,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/config/navigation";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  reports: BarChart3,
  "work-orders": ClipboardList,
  projects: KanbanSquare,
  tickets: Wrench,
  team: Users,
  onboarding: UploadCloud,
};
