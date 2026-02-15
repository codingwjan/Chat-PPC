import { SignupWizard } from "@/components/signup-wizard";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

const signupSans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-signup-sans",
  display: "swap",
});

const signupMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-signup-mono",
  display: "swap",
});

export default function SignupPage() {
  return (
    <div className={`${signupSans.variable} ${signupMono.variable}`}>
      <SignupWizard />
    </div>
  );
}
