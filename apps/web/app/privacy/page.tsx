import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: "Privacy Policy — GemOne" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 21, 2026">
      <p>
        This policy explains what we collect, why, and your choices. We collect only what we need to
        run the rewards platform, pay you, and prevent fraud.
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li><strong>Account:</strong> email, display name, password (hashed with argon2 — never stored in plain text).</li>
        <li><strong>Activity:</strong> offers completed, points, balance, and withdrawals.</li>
        <li><strong>Anti-fraud signals:</strong> IP address, device fingerprint, and reputation checks at signup and payout.</li>
        <li><strong>Partner postbacks:</strong> conversion identifiers sent by offer networks.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>Provide the service, credit points, and process withdrawals.</li>
        <li>Detect and prevent fraud, multi-accounting, and abuse.</li>
        <li>Comply with legal, tax, and payout-provider requirements.</li>
      </ul>

      <h2>Sharing</h2>
      <p>
        We share data with processors that make GemOne work: offer networks (via anonymized sub-ids),
        payout providers (PayPal, gift-card issuers), fraud-scoring services, and our hosting/cloud
        infrastructure. We do not sell your personal data.
      </p>

      <h2>Retention & security</h2>
      <p>
        We keep data as long as your account is active and as required for legal and financial records.
        Data is encrypted in transit; secrets are stored in a managed secret manager, not in code.
      </p>

      <h2>Your rights (GDPR/CCPA)</h2>
      <p>
        You can request access, correction, export, or deletion of your data. Contact{" "}
        <a href="mailto:privacy@gemone.dev">privacy@gemone.dev</a>. Note that some records must be
        retained for fraud-prevention and legal compliance.
      </p>
    </LegalPage>
  );
}
