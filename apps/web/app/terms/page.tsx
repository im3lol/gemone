import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Terms of Service — GemOne" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 21, 2026">
      <p>
        Welcome to GemOne. By creating an account or using our platform you agree to these Terms.
        If you do not agree, please do not use GemOne.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old (or the age of majority in your jurisdiction) and able to
        form a binding contract. One account per person; multiple or fraudulent accounts may be
        suspended and forfeit any balance.
      </p>

      <h2>2. Earning points</h2>
      <p>
        Points are credited when a partner network confirms a completed offer via postback. Points
        have no cash value until redeemed, and are provisional until the network settles. We may
        reverse points for chargebacks, reversed conversions, or detected fraud.
      </p>

      <h2>3. Withdrawals</h2>
      <ul>
        <li>A verified email is required before your first withdrawal.</li>
        <li>Minimum withdrawal amounts and manual review apply, especially to first or large payouts.</li>
        <li>We may delay, deny, or claw back payouts linked to fraud, abuse, or reversed conversions.</li>
      </ul>

      <h2>4. Prohibited conduct</h2>
      <p>
        No bots, VPN/proxy abuse, incentivized self-clicks, multi-accounting, or manipulation of
        offers. Violations may result in suspension and forfeiture of points.
      </p>

      <h2>5. Availability & changes</h2>
      <p>
        The service is provided &ldquo;as is.&rdquo; We may modify, suspend, or discontinue features, and may
        pause withdrawals during suspected incidents to protect users and the platform.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, GemOne is not liable for indirect or consequential
        damages. Our total liability is limited to the value of your redeemable balance.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about these Terms? Contact <a href="mailto:support@gemone.dev">support@gemone.dev</a>.
      </p>
    </LegalPage>
  );
}
