import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";

export type AlertSettings = {
  emailTime: string; // "07:00", Phoenix time
  emailRecipients: string[]; // empty = the business's managers
  coverDays: number;
  salesWindowDays: number;
  testingOverdueDays: number;
  countMismatchThreshold: number;
};

export async function getSettings(businessId: string): Promise<AlertSettings> {
  const { rows } = await pool.query(
    `SELECT to_char(email_time, 'HH24:MI') AS "emailTime", email_recipients AS "emailRecipients",
            cover_days AS "coverDays", sales_window_days AS "salesWindowDays",
            testing_overdue_days AS "testingOverdueDays", count_mismatch_threshold AS "countMismatchThreshold"
       FROM alert_settings WHERE business_id = $1`,
    [businessId]
  );
  return rows[0] ?? {
    emailTime: "07:00", emailRecipients: [], coverDays: 90, salesWindowDays: 60, testingOverdueDays: 40, countMismatchThreshold: 2,
  };
}

const whole = (label: string, min: number, max: number) =>
  z.number().int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} can be at most ${max}`);

export const settingsInput = z.object({
  // Quarter-hours only: the scheduled job runs every 15 minutes.
  emailTime: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Choose an email time on the quarter hour, e.g. 07:00"),
  emailRecipients: z.array(z.string().trim().toLowerCase().email("One of the email addresses isn't valid")).max(20, "At most 20 recipients"),
  coverDays: whole("Cover target", 7, 365),
  salesWindowDays: whole("Sales window", 7, 365),
  testingOverdueDays: whole("Testing overdue", 1, 365),
  countMismatchThreshold: whole("Count mismatch", 0, 1000),
});

export async function updateSettings(c: PoolClient, businessId: string, s: z.infer<typeof settingsInput>) {
  await c.query(
    `INSERT INTO alert_settings (business_id, email_time, email_recipients, cover_days, sales_window_days,
                                 testing_overdue_days, count_mismatch_threshold)
     VALUES ($1, $2::time, $3, $4, $5, $6, $7)
     ON CONFLICT (business_id) DO UPDATE SET
       email_time = EXCLUDED.email_time, email_recipients = EXCLUDED.email_recipients, cover_days = EXCLUDED.cover_days,
       sales_window_days = EXCLUDED.sales_window_days, testing_overdue_days = EXCLUDED.testing_overdue_days,
       count_mismatch_threshold = EXCLUDED.count_mismatch_threshold`,
    [businessId, s.emailTime, [...new Set(s.emailRecipients)], s.coverDays, s.salesWindowDays, s.testingOverdueDays, s.countMismatchThreshold]
  );
}

/** Who gets the daily email: the chosen recipients, or every manager with an email address. */
export async function emailRecipients(businessId: string): Promise<string[]> {
  const s = await getSettings(businessId);
  if (s.emailRecipients.length) return s.emailRecipients;
  const { rows } = await pool.query(
    `SELECT DISTINCT lower(u.email) AS email FROM business_users bu JOIN "User" u ON u.id = bu.user_id
      WHERE bu.business_id = $1 AND u.email IS NOT NULL ORDER BY 1`,
    [businessId]
  );
  return rows.map((r) => r.email);
}
