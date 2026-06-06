"use client";

import {
  LayoutDashboard,
  ClipboardList,
  KanbanSquare,
  Wrench,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "./nav-config";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  "work-orders": ClipboardList,
  projects: KanbanSquare,
  tickets: Wrench,
  team: Users,
};
