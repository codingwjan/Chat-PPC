import Link from "next/link";

export default function ImpressumPage() {
  return (
    <div className="impressum">
      <div>
        <h1>Impressum</h1>
        <p>
          <strong>Coffeesystems</strong>
          <br />
          Email: carrelscarrels_prudent_0q@icloud.com
        </p>
        <p>Responsible for the content: Jan Pink & Lukas Dienst</p>
        <p>
          The content of our website has been created with the greatest care. However, we cannot
          guarantee the accuracy, completeness or timeliness of the content.
        </p>
        <p>
          Our website contains links to external websites of third parties, on whose contents we
          have no influence. Therefore, we cannot assume any liability for these external
          contents.
        </p>
        <p>
          Copyright laws of the Federal Republic of Germany apply. Any duplication, processing,
          distribution or any form of utilization beyond the scope of copyright law shall require
          prior written consent.
        </p>
        <Link className="impressumBack" href="/chat">
          Back to chat
        </Link>
      </div>
    </div>
  );
}
