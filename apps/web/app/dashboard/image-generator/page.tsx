import { ImageLab } from "./components/ImageLab";
import Link from "next/link";
import { ChevronRight, Wand2 } from "lucide-react";
import { LogoutButton } from "@/app/dashboard-components/LogoutButton";

export default function ImageGeneratorPage() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <header className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link
                href="/dashboard/stories"
                className="hover:text-foreground transition-colors"
              >
                Story Publisher
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground">Image Lab</span>
            </nav>
            <LogoutButton />
          </div>
          <div className="flex items-center gap-2">
            <Wand2 className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Image Lab</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Paste an image, analyze it with AI, and recreate it on CivitAI
          </p>
        </header>
        <ImageLab />
      </div>
    </div>
  );
}
