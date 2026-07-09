"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light/dark toggle. Renders both icons and lets CSS (the `.dark` class that
 * next-themes sets before paint) pick which is visible, so there is no
 * hydration flash and no post-mount state juggling.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light / dark theme"
      title="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden h-5 w-5 dark:block" />
      <Moon className="h-5 w-5 dark:hidden" />
    </Button>
  );
}
