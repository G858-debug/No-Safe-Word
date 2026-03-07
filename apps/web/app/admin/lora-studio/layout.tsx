"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Layers,
  ImagePlus,
  CheckSquare,
  RefreshCw,
  Cpu,
  ChevronRight,
  BookOpen,
} from "lucide-react";

const TOP_NAV = [
  { label: "Sessions", href: "/admin/lora-studio", exact: true },
];

function SessionNav({ sessionId }: { sessionId: string }) {
  const pathname = usePathname();
  const base = `/admin/lora-studio/${sessionId}`;

  const links = [
    { label: "Overview", href: base, icon: Layers, exact: true },
    { label: "Generate", href: `${base}/generate`, icon: ImagePlus },
    { label: "Approve Anime", href: `${base}/approve-anime`, icon: CheckSquare },
    { label: "Convert", href: `${base}/convert`, icon: RefreshCw },
    { label: "Approve Converted", href: `${base}/approve-converted`, icon: CheckSquare },
    { label: "Train", href: `${base}/train`, icon: Cpu },
  ];

  return (
    <nav className="mt-4 space-y-0.5">
      <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        Session
      </p>
      {links.map(({ label, href, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-amber-900/30 text-amber-200"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function ActiveDot() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    fetch("/api/admin/lora-studio/active-sessions")
      .then((r) => r.json())
      .then((d) => setActive(!!d.hasActive))
      .catch(() => {});
  }, []);

  if (!active) return null;
  return <span className="ml-auto h-2 w-2 rounded-full bg-amber-400" />;
}

export default function LoraStudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams<{ sessionId?: string }>();
  const sessionId = params?.sessionId;

  return (
    <div className="dark flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 px-2 py-6">
        <div className="mb-6 px-3">
          <Link
            href="/dashboard/stories"
            className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <BookOpen className="h-3 w-3" />
            Story Publisher
          </Link>
          <h2 className="mt-3 text-sm font-semibold text-zinc-100">LoRA Studio</h2>
        </div>

        {/* Top-level nav */}
        <nav className="space-y-0.5">
          {TOP_NAV.map(({ label, href, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-amber-900/30 text-amber-200"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                <Layers className="h-3.5 w-3.5 shrink-0" />
                {label}
                <ActiveDot />
              </Link>
            );
          })}
        </nav>

        {/* Session-level nav when inside a session */}
        {sessionId && <SessionNav sessionId={sessionId} />}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}