import { revalidatePath } from "next/cache";

/** Bust the app layout so the left rail picks up published product surfaces. */
export function revalidateAppShell() {
  revalidatePath("/", "layout");
}
