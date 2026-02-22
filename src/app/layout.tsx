/**
 * Purpose: Defines the root HTML layout wrapper for the Next.js app.
 * Inputs: `children` React nodes rendered inside `<body>`.
 * Outputs: Root page layout markup for all routes.
 */
import type { ReactNode } from "react";

export const metadata = {
  title: "Panel of Experts",
  description: "Panel of Experts MVP"
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  /**
   * Purpose: Renders the global HTML/body wrapper shared by all pages.
   * Inputs: `children` content tree.
   * Outputs: Root layout JSX.
   */
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
