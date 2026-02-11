import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const APP_NAME = "Chat-PPC";
const APP_DESCRIPTION =
  "Real-time community chat with polls, threaded conversations, and AI-assisted replies.";

function resolveMetadataBase() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (!raw) {
    return undefined;
  }

  const normalized = raw.startsWith("http") ? raw : `https://${raw}`;

  try {
    return new URL(normalized);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: [
    "chat",
    "community",
    "real-time messaging",
    "polls",
    "AI chat",
    "Chat-PPC",
  ],
  applicationName: APP_NAME,
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  themeColor: "#0f172a",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { url: "/favicon.ico" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    url: "/",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: [
      {
        url: "/social-image.png",
        width: 1200,
        height: 630,
        alt: `${APP_NAME} social preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/social-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
