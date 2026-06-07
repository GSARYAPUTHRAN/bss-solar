import { PageSkeleton } from "@/components/layout/page-skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <PageSkeleton />
      </div>
    </div>
  );
}
