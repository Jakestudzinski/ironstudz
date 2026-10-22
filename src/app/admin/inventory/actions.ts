"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/inventory/session";
import { setActiveBusiness } from "@/lib/inventory/businesses";

const SwitchSchema = z.object({ businessId: z.string().uuid() });

/** Business switcher. The server re-checks that the user manages the chosen business. */
export async function switchBusiness(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("Please sign in");
  const parsed = SwitchSchema.safeParse({ businessId: formData.get("businessId") });
  if (!parsed.success) throw new Error("Choose a business");
  const ok = await setActiveBusiness(user.id, parsed.data.businessId);
  if (!ok) throw new Error("You don't have access to that business");
  revalidatePath("/admin/inventory", "layout");
}
