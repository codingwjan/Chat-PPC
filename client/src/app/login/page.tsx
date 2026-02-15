import { LoginForm } from "@/components/login-form";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

const authSans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-signup-sans",
  display: "swap",
});

const authMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-signup-mono",
  display: "swap",
});

export default function LoginPage() {
  return (
    <div className={`${authSans.variable} ${authMono.variable}`}>
      <LoginForm />
    </div>
  );
}
