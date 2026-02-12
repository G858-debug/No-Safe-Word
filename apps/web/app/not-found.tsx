import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <p className="text-6xl font-bold text-amber-900/40">404</p>
        <h1
          className="mt-4 text-2xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Page not found
        </h1>
        <p className="mt-3 text-sm text-warm-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-8 rounded-lg bg-amber-700 px-6 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-600"
        >
          Go home
        </Link>
      </main>
      <Footer />
    </div>
  );
}
