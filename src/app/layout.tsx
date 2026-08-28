import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import TabBar from "@/components/TabBar";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import AppGate from "@/components/AppGate";
import HouseholdProvider from "@/components/HouseholdProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tally",
  description: "A dead-simple budget tracker for two.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tally",
  },
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0B3D2E",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ServiceWorkerRegister />
        <AppGate>
          <HouseholdProvider>
            <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
              <main className="flex flex-1 flex-col px-4 pb-4 pt-6">
                {children}
              </main>
              <TabBar />
            </div>
          </HouseholdProvider>
        </AppGate>
      </body>
    </html>
  );
}
