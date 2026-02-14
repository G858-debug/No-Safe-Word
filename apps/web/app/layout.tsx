import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import AuthProvider from "@/components/AuthProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://nosafeword.co.za"),
  title: {
    default: "No Safe Word — South African Erotic Fiction",
    template: "%s | No Safe Word",
  },
  description:
    "Immersive erotic fiction by Nontsikelelo. Beautiful stories for adults, crafted with care.",
  openGraph: {
    type: "website",
    locale: "en_ZA",
    url: "https://nosafeword.co.za",
    siteName: "No Safe Word",
    title: "No Safe Word — South African Erotic Fiction",
    description:
      "Immersive erotic fiction by Nontsikelelo. Beautiful stories for adults, crafted with care.",
  },
  twitter: {
    card: "summary_large_image",
    title: "No Safe Word",
    description:
      "Immersive erotic fiction by Nontsikelelo. Beautiful stories for adults, crafted with care.",
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "facebook-domain-verification": "2f6mdrr7phdx2kjmngqn5a623qt6fw",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="min-h-screen font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
