import { AuthForm } from "@/components/auth/AuthForm";
import { signupAction } from "@/app/auth-actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white px-4">
      <AuthForm mode="signup" action={signupAction} referralCode={ref} />
    </main>
  );
}
