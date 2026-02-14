import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Portal — No Safe Word",
  description:
    "Secure authentication and member access for No Safe Word.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
