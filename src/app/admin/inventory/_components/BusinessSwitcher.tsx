"use client";

import { useTransition } from "react";
import { switchBusiness } from "../actions";
import styles from "../layout.module.css";

type Props = { businesses: { id: string; name: string }[]; activeId: string };

export function BusinessSwitcher({ businesses, activeId }: Props) {
  const [pending, startTransition] = useTransition();

  if (businesses.length === 1) {
    return <span className={styles.businessName}>{businesses[0].name}</span>;
  }

  return (
    <form
      action={switchBusiness}
      className={styles.switcher}
      onChange={(e) => {
        const form = e.currentTarget;
        startTransition(() => form.requestSubmit());
      }}
    >
      <label htmlFor="inv-business" className={styles.switcherLabel}>Business</label>
      <select id="inv-business" name="businessId" defaultValue={activeId} disabled={pending} className={styles.switcherSelect}>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <noscript><button type="submit" className={styles.switcherButton}>Switch</button></noscript>
    </form>
  );
}
