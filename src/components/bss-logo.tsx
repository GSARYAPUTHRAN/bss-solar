import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoVariant = "full" | "icon";

const ASSETS: Record<LogoVariant, { src: string; width: number; height: number }> = {
  full: { src: "/brand/bss-logo.png", width: 300, height: 175 },
  icon: { src: "/brand/bss-icon.png", width: 150, height: 150 },
};

/**
 * Official BSS Solar branding from https://bsssolar.com/
 */
export function BssLogo({
  variant = "full",
  className,
  priority,
}: {
  variant?: LogoVariant;
  className?: string;
  priority?: boolean;
}) {
  const asset = ASSETS[variant];
  return (
    <Image
      src={asset.src}
      alt="BSS Solar"
      width={asset.width}
      height={asset.height}
      priority={priority}
      className={cn("h-auto w-auto object-contain", className)}
    />
  );
}
