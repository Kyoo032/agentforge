/** Assembles the per-transaction operation groups over one checked-out client. */
import type { PoolClient } from "pg";
import type { Clock, PortalOps } from "../types";
import { auditOps } from "./audit";
import { authCodesOps, oauthClientsOps } from "./auth-codes";
import { deviceCodesOps } from "./device-codes";
import { devicesOps, sessionsOps } from "./devices";
import { orgsOps, tenantConfigOps, tenantsOps, usersOps } from "./identity";
import { loginOtpsOps } from "./otps";
import { loginPrecheck, refreshTokensOps } from "./tokens";
import { webSessionsOps } from "./web-sessions";

export function createOps(client: PoolClient, clock: Clock): PortalOps {
  return Object.freeze({
    tenants: tenantsOps(client),
    tenantConfig: tenantConfigOps(client),
    orgs: orgsOps(client),
    users: usersOps(client),
    devices: devicesOps(client),
    sessions: sessionsOps(client, clock),
    refreshTokens: refreshTokensOps(client),
    deviceCodes: deviceCodesOps(client, clock),
    loginOtps: loginOtpsOps(client, clock),
    authCodes: authCodesOps(client, clock),
    oauthClients: oauthClientsOps(client),
    webSessions: webSessionsOps(client),
    audit: auditOps(client),
    loginPrecheck: loginPrecheck(client),
  });
}
