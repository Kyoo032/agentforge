import { redirect } from "next/navigation";
import { firstVisibleHref } from "@agentforge/core";
import { agentService, getTenant } from "@/lib/tenant";

export default async function HomePage() {
  const tenant = await getTenant();
  const visibleModes = await agentService.listVisibleProductModes(tenant);
  redirect(firstVisibleHref(visibleModes));
}
