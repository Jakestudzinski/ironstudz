import ui from "../_components/ui.module.css";
import styles from "./settings.module.css";
import { requireManager } from "@/lib/inventory/context";
import { getSettings, emailRecipients } from "@/lib/inventory/settings";
import { recentSends } from "@/lib/inventory/daily-email";
import { isOwner } from "@/lib/inventory/owner";
import { listAllBusinesses } from "@/lib/inventory/admin";
import { SettingsForm } from "./SettingsForm";
import { label12 } from "./time-label";
import { TestEmail } from "./TestEmail";
import { ApiKeys } from "../_components/ApiKeys";

export const metadata = { title: "Settings · Inventory" };

const SEND_LABEL = { sent: ["Sent", ui.passed], preview: ["Not sent: email not set up", ui.neutral], failed: ["Failed", ui.failed], sending: ["Sending", ui.in_testing] } as const;

export default async function SettingsPage() {
  const { user, business } = await requireManager();
  const [settings, recipients, sends, owner] = await Promise.all([
    getSettings(business.id), emailRecipients(business.id), recentSends(business.id), isOwner(user.id),
  ]);
  const keys = owner ? (await listAllBusinesses()).find((b) => b.id === business.id)?.keys ?? [] : [];
  const emailReady = !!process.env.RESEND_API_KEY && !!process.env.INVENTORY_EMAIL_FROM;

  return (
    <>
      <div>
        <h1 className={ui.heading}>Settings</h1>
        <p className={ui.sub}>Alerts and the daily email for {business.name}.</p>
      </div>

      <SettingsForm initial={settings} defaultRecipients={settings.emailRecipients.length ? [] : recipients} />

      <section className={ui.panel} aria-labelledby="st-email">
        <div className={ui.panelHead}>
          <h2 id="st-email" className={ui.panelTitle}>Daily email</h2>
          <span className={`${ui.pill} ${emailReady ? ui.passed : ui.watch}`}>{emailReady ? "Sending is set up" : "Not set up yet: preview only"}</span>
        </div>
        <p className={ui.hint}>
          Goes to {recipients.length ? recipients.join(", ") : "nobody yet (add recipients above, or managers with email addresses)"} at{" "}
          {label12(settings.emailTime)} Phoenix time, listing everything on the dashboard that needs attention.
          {!emailReady && " Until the Resend email service is connected, nothing is sent."}
        </p>
        <TestEmail />
        {sends.length > 0 && (
          <ul className={ui.lines} aria-label="Recent daily emails">
            {sends.map((s) => (
              <li key={s.day} className={styles.send}>
                <span>{s.day}</span>
                <span className={`${ui.pill} ${SEND_LABEL[s.status][1]}`}>{SEND_LABEL[s.status][0]}</span>
                <span className={styles.muted}>{s.error ?? (s.recipients.length ? s.recipients.join(", ") : "")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {owner && (
        <section className={ui.panel} aria-labelledby="st-keys">
          <div className={ui.panelHead}>
            <h2 id="st-keys" className={ui.panelTitle}>Website API keys</h2>
            <p className={ui.hint}>A business’s website uses its key to send paid orders and cancellations.</p>
          </div>
          <ApiKeys businessId={business.id} businessName={business.name} keys={keys} />
        </section>
      )}
    </>
  );
}
