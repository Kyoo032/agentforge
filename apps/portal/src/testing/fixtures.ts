/** The rows almost every test needs: one tenant, one org, one active user, one device. */
import { randomUUID } from "node:crypto";
import type { Device, Org, PortalStore, Tenant, User } from "../store/types";

export interface Fixture {
  readonly tenant: Tenant;
  readonly org: Org;
  readonly user: User;
}

export interface FixtureOptions {
  readonly slug?: string;
  readonly seatCap?: number;
  readonly email?: string;
}

export async function seedFixture(store: PortalStore, options: FixtureOptions = {}): Promise<Fixture> {
  const tenantId = randomUUID();
  const slug = options.slug ?? `t${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  return store.tx(tenantId, async (ops) => {
    const tenant = await ops.tenants.create({ id: tenantId, slug, name: slug });
    await ops.tenantConfig.upsert({ tenantId: tenant.id, featureFlags: { allow_byo_key: true } });
    const org = await ops.orgs.create({
      tenantId: tenant.id,
      name: "Kyo",
      slug: "kyo",
      seatCap: options.seatCap ?? 20,
    });
    const user = await ops.users.create({
      tenantId: tenant.id,
      orgId: org.id,
      email: options.email ?? `owner@${slug}.test`,
      status: "active",
      role: "owner",
    });
    return { tenant, org, user };
  });
}

/** A second (or third) active user in the same org — what a seat-cap test needs. */
export async function addUser(store: PortalStore, fixture: Fixture, email: string): Promise<User> {
  return store.tx(fixture.tenant.id, (ops) =>
    ops.users.create({
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      email,
      status: "active",
    }),
  );
}

export async function addDevice(
  store: PortalStore,
  fixture: Fixture,
  user: User,
  installId: string = randomUUID(),
): Promise<Device> {
  return store.tx(fixture.tenant.id, async (ops) => {
    const result = await ops.devices.upsert({
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: user.id,
      installId,
      platform: "windows",
      label: "Windows device",
    });
    if (!result.ok) {
      throw new Error(`device ${installId} is revoked`);
    }
    return result.device;
  });
}
