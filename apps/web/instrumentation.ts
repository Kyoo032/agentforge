export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { hydrateWrapKeyFromKeychain } = await import("@agentforge/db/vault-key");
  await hydrateWrapKeyFromKeychain();
}
