import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AgeGate from "@/components/AgeGate";

export const metadata: Metadata = {
  title: "My Account",
};

const accountNav = [
  { href: "/account", label: "Profile" },
  { href: "/account/purchases", label: "Purchases" },
  { href: "/account/subscription", label: "Subscription" },
];

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
        {/* Account nav */}
        <nav className="mb-8 flex gap-1 overflow-x-auto rounded-lg border border-amber-900/20 bg-[#111111] p-1">
          {accountNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex-shrink-0 rounded-md px-4 py-2 text-sm text-warm-300 transition-colors hover:bg-amber-900/20 hover:text-amber-300"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </main>
      <Footer />
      <AgeGate />
    </div>
  );
}
