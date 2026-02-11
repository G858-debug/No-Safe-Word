"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

export default function StoriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Build breadcrumb segments from the path
  const segments = pathname.replace("/dashboard/stories", "").split("/").filter(Boolean);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          <nav className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">
              Dashboard
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link
              href="/dashboard/stories"
              className={
                segments.length === 0
                  ? "text-foreground"
                  : "hover:text-foreground transition-colors"
              }
            >
              Story Publisher
            </Link>
            {segments.length > 0 && (
              <>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="text-foreground capitalize">
                  {segments[segments.length - 1] === "import"
                    ? "Import"
                    : segments[segments.length - 1]}
                </span>
              </>
            )}
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">Story Publisher</h1>
          <p className="text-muted-foreground">
            Import, generate images, and publish serialized fiction
          </p>
        </header>

        {children}
      </div>
    </div>
  );
}
