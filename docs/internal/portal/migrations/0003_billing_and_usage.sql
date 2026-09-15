-- 0003_billing_and_usage.sql
-- Money and evidence: wallet_ledger (append-only), usage (monthly range partitions, immutable),
-- audit_log (append-only).

BEGIN;

----------------------------------------------------------------------
-- Append-only guard
----------------------------------------------------------------------
-- why: a trigger, not just missing grants. Grants can be handed out by mistake during an
-- incident; the trigger makes the invariant hold for every role including the table owner.
CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION
    'table %.% is append-only; % is not allowed',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$fn$;

COMMENT ON FUNCTION reject_mutation() IS
  'BEFORE UPDATE/DELETE trigger for append-only tables (usage, wallet_ledger, audit_log).';

----------------------------------------------------------------------
-- wallet_ledger
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                  bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id               uuid NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  kind                 text NOT NULL,
  amount_micros        bigint NOT NULL,
  balance_after_micros bigint NOT NULL,
  currency             text NOT NULL DEFAULT 'USD',
  ref_type             text NOT NULL DEFAULT 'none',
  ref_id               uuid,
  ref_external         text,
  idempotency_key      text NOT NULL,
  note                 text,
  created_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_ledger_kind_chk CHECK (kind IN ('topup','charge','refund','adjustment')),
  CONSTRAINT wallet_ledger_ref_type_chk CHECK (ref_type IN ('none','usage','payment','invoice','manual')),
  CONSTRAINT wallet_ledger_currency_chk CHECK (currency IN ('USD','IDR')),
  -- why: sign is part of the contract, not a convention. charge always debits, topup always credits.
  CONSTRAINT wallet_ledger_sign_chk CHECK (
    (kind = 'topup'      AND amount_micros > 0) OR
    (kind = 'refund'     AND amount_micros > 0) OR
    (kind = 'charge'     AND amount_micros < 0) OR
    (kind = 'adjustment' AND amount_micros <> 0)
  ),
  CONSTRAINT wallet_ledger_ref_chk CHECK (
    (ref_type IN ('none','manual')) OR (ref_id IS NOT NULL OR ref_external IS NOT NULL)
  )
);

-- why: idempotency is scoped to the org, so a partner replaying a webhook cannot collide with
-- another org's key and cannot double-credit its own.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_ledger_org_idem
  ON wallet_ledger (org_id, idempotency_key);
-- why: balance = the newest row per org. (org_id, seq DESC) makes it a single index fetch.
CREATE INDEX IF NOT EXISTS ix_wallet_ledger_org_seq ON wallet_ledger (org_id, seq DESC);
CREATE INDEX IF NOT EXISTS ix_wallet_ledger_org_created ON wallet_ledger (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_wallet_ledger_ref ON wallet_ledger (ref_type, ref_id)
  WHERE ref_id IS NOT NULL;

COMMENT ON TABLE wallet_ledger IS
  'Append-only prepaid wallet. Balance of an org = balance_after_micros of its highest seq row.
   Never UPDATE: corrections are a new adjustment/refund row.';
COMMENT ON COLUMN wallet_ledger.seq IS
  'Monotonic per-table identity; the ordering key for "latest balance". Appends are serialized
   per org by a FOR UPDATE lock on the orgs row, so seq order == commit order within an org.';
COMMENT ON COLUMN wallet_ledger.amount_micros IS 'Signed micro-USD (1e-6 USD). Negative = debit.';
COMMENT ON COLUMN wallet_ledger.balance_after_micros IS
  'Running balance after this entry. Denormalized on purpose so the gateway never SUMs the table.';
COMMENT ON COLUMN wallet_ledger.idempotency_key IS
  'Caller-supplied, unique per org. append_wallet_entry() returns the existing row on replay.';

DROP TRIGGER IF EXISTS trg_wallet_ledger_append_only ON wallet_ledger;
CREATE TRIGGER trg_wallet_ledger_append_only
  BEFORE UPDATE OR DELETE ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

----------------------------------------------------------------------
-- usage (declarative range partitioning by month)
----------------------------------------------------------------------
-- why partition from day one: this is the only table that grows without bound, retention is
-- expressed in months, and a monthly DETACH is the only way to drop old data without a
-- multi-hour DELETE. The PK must contain the partition key, hence (id, created_at).
CREATE TABLE IF NOT EXISTS usage (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id           uuid REFERENCES orgs(id) ON DELETE RESTRICT,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id        uuid REFERENCES devices(id) ON DELETE SET NULL,
  session_id       uuid REFERENCES sessions(id) ON DELETE SET NULL,
  api_key_id       uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  request_id       text NOT NULL,
  model            text NOT NULL,
  provider         text,
  route            text NOT NULL DEFAULT '/v1/chat/completions',
  prompt_tokens    integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cost_micros      bigint NOT NULL DEFAULT 0,
  latency_ms       integer,
  status           text NOT NULL DEFAULT 'ok',
  error_code       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_pkey PRIMARY KEY (id, created_at),
  CONSTRAINT usage_tokens_chk CHECK (prompt_tokens >= 0 AND completion_tokens >= 0),
  CONSTRAINT usage_cost_chk CHECK (cost_micros >= 0),
  CONSTRAINT usage_status_chk CHECK (status IN ('ok','error','filtered','cancelled')),
  -- why: an org-less row is only legal on the BYO-key path, where a tenant-owned api_key pays.
  CONSTRAINT usage_attribution_chk CHECK (org_id IS NOT NULL OR api_key_id IS NOT NULL)
) PARTITION BY RANGE (created_at);

-- why the partition key is in the unique index: Postgres requires it. request_id is generated
-- per request so the triple is still a true idempotency guard for the insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_tenant_request
  ON usage (tenant_id, request_id, created_at);
CREATE INDEX IF NOT EXISTS ix_usage_org_created ON usage (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_user_created ON usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_api_key_created ON usage (api_key_id, created_at DESC)
  WHERE api_key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_usage_tenant_created ON usage (tenant_id, created_at DESC);

COMMENT ON TABLE usage IS
  'Immutable per-request metering row written by the gateway. Partitioned by month on created_at.';
COMMENT ON COLUMN usage.cost_micros IS 'Billed cost in micro-USD; mirrored as a charge in wallet_ledger.';
COMMENT ON COLUMN usage.api_key_id IS
  'Set on the BYO-key path (api_keys.kind = tenant) where org_id and user_id are NULL.';
COMMENT ON COLUMN usage.request_id IS 'Gateway request id; also echoed to the client for support.';

-- why row-level BEFORE triggers on a partitioned parent: PG13+ propagates them to every existing
-- and future partition, so new months inherit immutability with no extra step.
DROP TRIGGER IF EXISTS trg_usage_append_only ON usage;
CREATE TRIGGER trg_usage_append_only
  BEFORE UPDATE OR DELETE ON usage
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Partition maintenance -------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_usage_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name text := format('usage_y%sm%s', to_char(v_from, 'YYYY'), to_char(v_from, 'MM'));
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    RETURN v_name;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF usage FOR VALUES FROM (%L) TO (%L)',
    v_name, v_from, v_to);
  EXECUTE format('COMMENT ON TABLE %I IS %L', v_name,
    format('usage rows for %s (created by create_usage_partition)', to_char(v_from, 'YYYY-MM')));
  RETURN v_name;
END
$fn$;

COMMENT ON FUNCTION create_usage_partition(date) IS
  'Create the monthly usage partition covering p_month if absent; returns the partition name.';

CREATE OR REPLACE FUNCTION ensure_usage_partitions(p_months_ahead integer DEFAULT 3)
RETURNS SETOF text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE i integer;
BEGIN
  FOR i IN 0 .. GREATEST(p_months_ahead, 0) LOOP
    RETURN NEXT create_usage_partition((date_trunc('month', now()) + make_interval(months => i))::date);
  END LOOP;
END
$fn$;

COMMENT ON FUNCTION ensure_usage_partitions(integer) IS
  'Idempotently create this month plus p_months_ahead future usage partitions. Run nightly.';

-- First three months plus a catch-all.
SELECT create_usage_partition(date '2026-09-01');
SELECT create_usage_partition(date '2026-10-01');
SELECT create_usage_partition(date '2026-11-01');

-- why a default partition: a row with a clock-skewed created_at must never fail the insert and
-- lose the metering record. It should stay empty; alert if it is not.
-- Caveat: while rows sit in the default partition, ATTACH of a covering range takes an ACCESS
-- EXCLUSIVE lock and scans it -- so drain it before the monthly maintenance window.
CREATE TABLE IF NOT EXISTS usage_default PARTITION OF usage DEFAULT;
COMMENT ON TABLE usage_default IS
  'Catch-all for out-of-range created_at. Expected to be empty; monitored.';

----------------------------------------------------------------------
-- audit_log
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id            uuid REFERENCES orgs(id) ON DELETE SET NULL,
  actor_kind        text NOT NULL,
  actor_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_api_key_id  uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  actor_label       text,
  action            text NOT NULL,
  target_kind       text,
  target_id         uuid,
  reason_code       text,
  before            jsonb,
  after             jsonb,
  request_id        text,
  ip                inet,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_actor_kind_chk CHECK (actor_kind IN ('user','api_key','system','support')),
  CONSTRAINT audit_log_actor_shape_chk CHECK (
    (actor_kind = 'user'    AND actor_user_id IS NOT NULL) OR
    (actor_kind = 'api_key' AND actor_api_key_id IS NOT NULL) OR
    (actor_kind IN ('system','support'))
  ),
  CONSTRAINT audit_log_before_obj_chk CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
  CONSTRAINT audit_log_after_obj_chk CHECK (after IS NULL OR jsonb_typeof(after) = 'object'),
  CONSTRAINT audit_log_payload_chk CHECK (before IS NOT NULL OR after IS NOT NULL OR action IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_audit_log_tenant_created ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_org_created ON audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_target ON audit_log (target_kind, target_id)
  WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit_log (tenant_id, action, created_at DESC);

COMMENT ON TABLE audit_log IS
  'Append-only administrative and security trail. Every login-flow denial writes a row with the
   reason_code; every seat, plan, key and revocation change writes before/after.';
COMMENT ON COLUMN audit_log.before IS 'Row state before the change; NULL on create.';
COMMENT ON COLUMN audit_log.after IS 'Row state after the change; NULL on delete.';
COMMENT ON COLUMN audit_log.reason_code IS
  'One of the login reason codes when the entry records a denied auth attempt.';

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

COMMIT;
