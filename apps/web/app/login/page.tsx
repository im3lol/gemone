import { AuthForm } from "@/components/auth/AuthForm";
import { loginAction } from "@/app/auth-actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white px-4">
      <AuthForm mode="login" action={loginAction} />
    </main>
  );
}
