import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Cookie Policy — GemOne" };

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="July 21, 2026">
      <p>
        GemOne uses a minimal set of cookies. We do not use advertising or cross-site tracking cookies.
      </p>

      <h2>Essential cookies</h2>
      <ul>
        <li><strong>Session:</strong> httpOnly cookies that keep you signed in (access &amp; refresh tokens).</li>
        <li><strong>Security:</strong> used to protect against CSRF and abuse.</li>
      </ul>
      <p>These are required for the platform to function and cannot be turned off.</p>

      <h2>Analytics</h2>
      <p>
        If enabled, we use privacy-respecting, aggregate analytics to understand product usage. These
        never identify you individually.
      </p>

      <h2>Managing cookies</h2>
      <p>
        You can clear cookies in your browser at any time, but doing so will sign you out. For more on
        the data we hold, see our <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalPage>
  );
}
