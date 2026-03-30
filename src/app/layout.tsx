import type { ReactNode } from "react";
import "./globals.css";
export const metadata = {
    title: "Panel of Experts",
    description: "Panel of Experts MVP"
};
type RootLayoutProps = {
    children: ReactNode;
};
export default function RootLayout({ children }: RootLayoutProps) {
    return (<html lang="en">
      <body>{children}</body>
    </html>);
}
