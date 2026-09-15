-- 0005_functions.sql
-- Functions the login flow and the gateway call. All SECURITY INVOKER: they run as portal_app
-- and are therefore subject to RLS, so the caller MUST have issued
--   SET LOCAL app.tenant_id = '<tid>'
-- earlier in the same transaction. A missing GUC makes app_tenant_id() NULL and every lookup
-- returns nothing, which surfaces as a denial rather than as a cross-tenant read.

BEGIN;

----------------------------------------------------------------------
-- count_active_users
----------------------------------------------------------------------
-- in : p_org_id uuid
-- out: integer -- number of seats currently consumed by the org
-- isolation: READ COMMITTED is sufficient. For the login-time check the caller must already
--            hold the org advisory lock (see login_precheck), which is what makes it atomic.
-- definition: "active user" = users.status = 'active' AND at least one session with
--             revoked_at IS NULL and last_seen_at within 30 days.
-- plan: ix_users_org_active (partial) feeds the outer scan; ix_sessions_user_live (partial,
--       user_id, last_seen_at DESC) turns the EXISTS into a one-tuple index probe per user.
CREATE OR REPLACE FUNCTION count_active_users(p_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT count(*)::integer
  FROM users u
  WHERE u.org_id = p_org_id
    AND u.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM sessions s
      WHERE s.user_id = u.id
        AND s.revoked_at IS NULL
        AND s.last_seen_at > now() - interval '30 days'
    );
$fn$;

COMMENT ON FUNCTION count_active_users(uuid) IS
  'Seats consumed by an org: active users with a live session seen in the last 30 days.';

----------------------------------------------------------------------
-- login_precheck
----------------------------------------------------------------------
-- in : p_user_id uuid, p_device_id uuid, p_session_id uuid (NULL on first login)
-- out: text -- 'ok' or one of tenant_inactive | org_inactive | org_past_due | user_inactive |
--             device_revoked | session_revoked | seat_cap_reached
-- isolation: READ COMMITTED. MUST be called inside the same transaction that inserts the new
--            session; it takes pg_advisory_xact_lock on the org so the seat count and the
--            session insert cannot interleave with another concurrent login.
-- order: outermost scope first (tenant -> org -> user -> device -> session -> seat).
--        why: a suspended tenant or org must not leak per-user state, and seat_cap_reached is
--        last so an admin sees the specific fixable cause before the generic capacity one.
-- note: the seat check runs only when p_session_id IS NULL, i.e. on a brand-new session. A
--       refresh cannot grow the active set: the refresh TTL is 30 days sliding, so any session
--       still able to refresh was already inside the 30-day window and already counted.
CREATE OR REPLACE FUNCTION login_precheck(
  p_user_id    uuid,
  p_device_id  uuid,
  p_session_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE  -- why: it takes an advisory lock on the new-session path, so it is not STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tenant_status text;
  v_org_id        uuid;
  v_org_status    text;
  v_seat_cap      integer;
  v_user_status   text;
  v_device_ok     boolean;
  v_session_ok    boolean;
  v_seats         integer;
BEGIN
  SELECT t.status, o.id, o.status, o.seat_cap, u.status
    INTO v_tenant_status, v_org_id, v_org_status, v_seat_cap, v_user_status
  FROM users u
  JOIN orgs o    ON o.id = u.org_id
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.id = p_user_id;

  -- why user_inactive and not a distinct 'not_found': an unknown or RLS-invisible user id must
  -- be indistinguishable from a disabled one, otherwise the endpoint is a user-enumeration oracle.
  IF NOT FOUND THEN
    RETURN 'user_inactive';
  END IF;

  IF v_tenant_status <> 'active' THEN
    RETURN 'tenant_inactive';
  END IF;

  IF v_org_status = 'suspended' THEN
    RETURN 'org_inactive';
  ELSIF v_org_status = 'past_due' THEN
    RETURN 'org_past_due';
  END IF;

  IF v_user_status <> 'active' THEN
    RETURN 'user_inactive';
  END IF;

  SELECT (d.status = 'active' AND d.revoked_at IS NULL AND d.user_id = p_user_id)
    INTO v_device_ok
  FROM devices d
  WHERE d.id = p_device_id;

  IF NOT FOUND OR NOT v_device_ok THEN
    RETURN 'device_revoked';
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT (s.revoked_at IS NULL
            AND s.absolute_expires_at > now()
            AND s.user_id = p_user_id
            AND s.device_id = p_device_id)
      INTO v_session_ok
    FROM sessions s
    WHERE s.id = p_session_id;

    IF NOT FOUND OR NOT v_session_ok THEN
      RETURN 'session_revoked';
    END IF;
  ELSE
    -- New session: serialize the seat check per org.
    -- why an advisory xact lock rather than a counter column: the "active user" predicate is
    -- time-based (30-day window), so a stored counter would drift and need a reconciler. The
    -- lock is held for microseconds and only on the new-session path.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text, 0));

    v_seats := count_active_users(v_org_id);

    -- An already-counted user re-logging in on a second device must not be blocked, so only
    -- charge a seat when this user is not already inside the active set.
    IF NOT EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.user_id = p_user_id
        AND s.revoked_at IS NULL
        AND s.last_seen_at > now() - interval '30 days'
    ) THEN
      v_seats := v_seats + 1;
    END IF;

    IF v_seats > v_seat_cap THEN
      RETURN 'seat_cap_reached';
    END IF;
  END IF;

  RETURN 'ok';
END
$fn$;

COMMENT ON FUNCTION login_precheck(uuid, uuid, uuid) IS
  'Returns ok or the first failing reason code for a login/refresh. Call inside the transaction
   that creates the session; it takes the org advisory lock on the new-session path.';

----------------------------------------------------------------------
-- revoke_session_chain (helper)
----------------------------------------------------------------------
-- in : p_session_id uuid, p_reason text, p_detail jsonb, p_ip inet, p_user_agent text
-- out: void. Revokes every live refresh token under the session, revokes the session, and
--      writes one audit_log row.
-- isolation: READ COMMITTED; called from inside rotate_refresh_token's transaction.
CREATE OR REPLACE FUNCTION revoke_session_chain(
  p_session_id uuid,
  p_reason     text,
  p_detail     jsonb DEFAULT NULL,
  p_ip         inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE refresh_tokens rt
     SET revoked_at = now(), revoked_reason = p_reason
   WHERE rt.session_id = p_session_id
     AND rt.revoked_at IS NULL;

  UPDATE sessions s
     SET revoked_at = COALESCE(s.revoked_at, now()),
         revoked_reason = COALESCE(s.revoked_reason, p_reason)
   WHERE s.id = p_session_id;

  INSERT INTO audit_log (tenant_id, org_id, actor_kind, action, target_kind, target_id,
                         reason_code, after, ip, user_agent)
  SELECT s.tenant_id, s.org_id, 'system', 'session.revoked', 'session', s.id,
         p_reason, p_detail, p_ip, p_user_agent
  FROM sessions s WHERE s.id = p_session_id;
END
$fn$;

COMMENT ON FUNCTION revoke_session_chain(uuid, text, jsonb, inet, text) IS
  'Revoke a session and its whole refresh-token chain, with one audit_log entry.';

----------------------------------------------------------------------
-- rotate_refresh_token
----------------------------------------------------------------------
-- in : p_token_hash     bytea  -- sha256 of the presented refresh token
--      p_new_token_hash bytea  -- sha256 of the successor the caller just generated
--      p_device_id      uuid   -- the device the client claims to be; must match the session
--      p_ttl            interval (default 30 days, the sliding window)
--      p_ip inet, p_user_agent text (optional session telemetry)
-- out: one row (reason_code, session_id, tenant_id, org_id, user_id, device_id,
--               new_token_id, generation, expires_at)
--      reason_code is 'ok' or refresh_reused | refresh_expired | any login_precheck code.
--      On anything but 'ok' every other column is NULL and nothing was written except the
--      revocations that reuse detection performs.
-- isolation: READ COMMITTED. The SELECT ... FOR UPDATE on the presented token row is what
--            serializes two racing refreshes: the loser sees used_at set and is treated as reuse.
--            Do NOT run this under SERIALIZABLE -- honest double-submits would abort instead of
--            producing the deliberate refresh_reused answer.
-- note: the raw token never reaches the database. The caller generates 32 random bytes, keeps
--       the base64url form for the keychain, and passes only the sha256 here.
CREATE OR REPLACE FUNCTION rotate_refresh_token(
  p_token_hash     bytea,
  p_new_token_hash bytea,
  p_device_id      uuid DEFAULT NULL,
  p_ttl            interval DEFAULT interval '30 days',
  p_ip             inet DEFAULT NULL,
  p_user_agent     text DEFAULT NULL
)
RETURNS TABLE (
  reason_code  text,
  session_id   uuid,
  tenant_id    uuid,
  org_id       uuid,
  user_id      uuid,
  device_id    uuid,
  new_token_id uuid,
  generation   integer,
  expires_at   timestamptz
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
-- why: the RETURNS TABLE output names (session_id, tenant_id, generation, expires_at) are also
-- column names. use_column makes any bare occurrence resolve to the column, which is what every
-- UPDATE/INSERT here wants; the variables are all referenced qualified (r_tok.x) or v_-prefixed.
#variable_conflict use_column
DECLARE
  r_tok     refresh_tokens%ROWTYPE;
  r_sess    sessions%ROWTYPE;
  v_reason  text;
  v_new_id  uuid;
  v_expires timestamptz;
BEGIN
  SELECT * INTO r_tok
  FROM refresh_tokens rt
  WHERE rt.token_hash = p_token_hash
  FOR UPDATE;

  -- why refresh_expired for an unknown hash: an unknown token and an aged-out token must look
  -- identical, otherwise the endpoint confirms whether a stolen string was ever valid.
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'refresh_expired'::text, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  -- Reuse: a token that was already spent (or explicitly revoked) is presented again.
  -- Kill the whole chain and the session; the legitimate holder is forced to log in again.
  IF r_tok.used_at IS NOT NULL OR r_tok.revoked_at IS NOT NULL THEN
    PERFORM revoke_session_chain(
      r_tok.session_id, 'refresh_reused',
      jsonb_build_object('generation', r_tok.generation, 'token_id', r_tok.id, 'cause', 'replay'),
      p_ip, p_user_agent);

    RETURN QUERY SELECT 'refresh_reused'::text, r_tok.session_id, r_tok.tenant_id,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::integer,
                        NULL::timestamptz;
    RETURN;
  END IF;

  IF r_tok.expires_at <= now() THEN
    RETURN QUERY SELECT 'refresh_expired'::text, r_tok.session_id, r_tok.tenant_id,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::integer,
                        NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO r_sess FROM sessions s WHERE s.id = r_tok.session_id FOR UPDATE;

  IF NOT FOUND OR r_sess.absolute_expires_at <= now() THEN
    RETURN QUERY SELECT 'refresh_expired'::text, r_tok.session_id, r_tok.tenant_id,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::integer,
                        NULL::timestamptz;
    RETURN;
  END IF;

  -- Device binding: the client must present the same device the session was issued to.
  -- why refresh_reused and a full chain revocation rather than a softer code: a valid refresh
  -- token arriving with the wrong device id means the token left the device it was bound to,
  -- which is the same threat model as replay. Anyone who can trip this already holds the token.
  IF p_device_id IS NOT NULL AND p_device_id <> r_sess.device_id THEN
    PERFORM revoke_session_chain(
      r_sess.id, 'refresh_reused',
      jsonb_build_object('cause', 'device_mismatch',
                         'claimed_device_id', p_device_id,
                         'session_device_id', r_sess.device_id),
      p_ip, p_user_agent);

    RETURN QUERY SELECT 'refresh_reused'::text, r_sess.id, r_sess.tenant_id,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::integer,
                        NULL::timestamptz;
    RETURN;
  END IF;

  v_reason := login_precheck(r_sess.user_id, r_sess.device_id, r_sess.id);
  IF v_reason <> 'ok' THEN
    RETURN QUERY SELECT v_reason, r_sess.id, r_sess.tenant_id, r_sess.org_id,
                        r_sess.user_id, r_sess.device_id, NULL::uuid, NULL::integer,
                        NULL::timestamptz;
    RETURN;
  END IF;

  -- why LEAST: the sliding 30-day TTL may never outlive the session's absolute 90-day ceiling.
  v_expires := LEAST(now() + p_ttl, r_sess.absolute_expires_at);

  INSERT INTO refresh_tokens (tenant_id, session_id, token_hash, generation, expires_at)
  VALUES (r_sess.tenant_id, r_sess.id, p_new_token_hash, r_tok.generation + 1, v_expires)
  RETURNING id INTO v_new_id;

  UPDATE refresh_tokens
     SET used_at = now(), replaced_by = v_new_id
   WHERE refresh_tokens.id = r_tok.id;

  UPDATE sessions
     SET last_seen_at = now(),
         last_ip = COALESCE(p_ip, last_ip),
         last_user_agent = COALESCE(p_user_agent, last_user_agent)
   WHERE sessions.id = r_sess.id;

  UPDATE devices SET last_seen_at = now() WHERE devices.id = r_sess.device_id;

  RETURN QUERY SELECT 'ok'::text, r_sess.id, r_sess.tenant_id, r_sess.org_id,
                      r_sess.user_id, r_sess.device_id, v_new_id, r_tok.generation + 1, v_expires;
END
$fn$;

COMMENT ON FUNCTION rotate_refresh_token(bytea, bytea, uuid, interval, inet, text) IS
  'Spend a refresh token and issue its successor. Detects reuse and device mismatch, revoking the
   whole chain plus the session. Returns a reason code; the raw token never enters the database.';

----------------------------------------------------------------------
-- append_wallet_entry
----------------------------------------------------------------------
-- in : p_org_id uuid, p_kind text, p_amount_micros bigint (signed), p_idempotency_key text,
--      p_ref_type text, p_ref_id uuid, p_ref_external text, p_note text, p_created_by uuid
-- out: one row (entry_id uuid, balance_after_micros bigint, deduped boolean)
-- isolation: READ COMMITTED. Concurrency rule: take a row lock on the orgs row first
--            (SELECT ... FOR UPDATE). That single lock serializes every append for that org, so
--            "read latest balance, add amount, insert" is atomic without SERIALIZABLE and without
--            a lock table. Orgs are the natural lock object because the wallet belongs to one.
--            Lock ordering: orgs -> wallet_ledger, everywhere, to keep deadlocks impossible.
-- replay : if (org_id, idempotency_key) already exists, nothing is written and the existing row
--          is returned with deduped = true.
CREATE OR REPLACE FUNCTION append_wallet_entry(
  p_org_id          uuid,
  p_kind            text,
  p_amount_micros   bigint,
  p_idempotency_key text,
  p_ref_type        text DEFAULT 'none',
  p_ref_id          uuid DEFAULT NULL,
  p_ref_external    text DEFAULT NULL,
  p_note            text DEFAULT NULL,
  p_created_by      uuid DEFAULT NULL
)
RETURNS TABLE (entry_id uuid, balance_after_micros bigint, deduped boolean)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
-- why: balance_after_micros is both an output name and a column name; see rotate_refresh_token.
#variable_conflict use_column
DECLARE
  v_tenant_id uuid;
  v_currency  text;
  v_prev      bigint;
  v_new       bigint;
  v_id        uuid;
BEGIN
  SELECT o.tenant_id, o.currency INTO v_tenant_id, v_currency
  FROM orgs o
  WHERE o.id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org % not found in the current tenant scope', p_org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT wl.id, wl.balance_after_micros INTO v_id, v_new
  FROM wallet_ledger wl
  WHERE wl.org_id = p_org_id AND wl.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN QUERY SELECT v_id, v_new, true;
    RETURN;
  END IF;

  SELECT wl.balance_after_micros INTO v_prev
  FROM wallet_ledger wl
  WHERE wl.org_id = p_org_id
  ORDER BY wl.seq DESC
  LIMIT 1;

  v_new := COALESCE(v_prev, 0) + p_amount_micros;

  -- why a negative balance is allowed: the gateway meters after the fact, so a burst can land a
  -- charge that overdraws by a few cents. Refusing it here would lose the metering record.
  -- The soft floor (block new requests below zero) is enforced in the gateway, not in the ledger.
  INSERT INTO wallet_ledger (tenant_id, org_id, kind, amount_micros, balance_after_micros,
                             currency, ref_type, ref_id, ref_external, idempotency_key, note,
                             created_by_user_id)
  VALUES (v_tenant_id, p_org_id, p_kind, p_amount_micros, v_new,
          v_currency, p_ref_type, p_ref_id, p_ref_external, p_idempotency_key, p_note,
          p_created_by)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_new, false;
END
$fn$;

COMMENT ON FUNCTION append_wallet_entry(uuid, text, bigint, text, text, uuid, text, text, uuid) IS
  'Append one wallet entry under an orgs row lock, computing balance_after_micros. Idempotent
   per (org_id, idempotency_key).';

----------------------------------------------------------------------
-- wallet_balance
----------------------------------------------------------------------
-- in : p_org_id uuid / out: bigint micro-USD (0 when the org has no entries yet)
-- isolation: READ COMMITTED; a single index fetch on ix_wallet_ledger_org_seq.
CREATE OR REPLACE FUNCTION wallet_balance(p_org_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT wl.balance_after_micros
       FROM wallet_ledger wl
      WHERE wl.org_id = p_org_id
      ORDER BY wl.seq DESC
      LIMIT 1), 0);
$fn$;

COMMENT ON FUNCTION wallet_balance(uuid) IS 'Current prepaid balance of an org, in micro-USD.';

----------------------------------------------------------------------
-- expire_device_codes (maintenance)
----------------------------------------------------------------------
-- in : none / out: integer rows moved to status = 'expired'
-- isolation: READ COMMITTED. Run every minute; rows older than 24 h are then hard-deleted.
CREATE OR REPLACE FUNCTION expire_device_codes()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count integer;
BEGIN
  UPDATE device_codes
     SET status = 'expired'
   WHERE status = 'pending'
     AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM device_codes
   WHERE status IN ('expired','denied','redeemed')
     AND created_at < now() - interval '24 hours';

  RETURN v_count;
END
$fn$;

COMMENT ON FUNCTION expire_device_codes() IS
  'Mark lapsed device codes expired and prune terminal rows older than 24 h.';

----------------------------------------------------------------------
-- prune_login_otps (maintenance)
----------------------------------------------------------------------
-- in : none / out: integer rows deleted
-- isolation: READ COMMITTED. Run hourly.
-- why 24 h and not "as soon as it expires or is consumed": the 3-sends-per-15-minutes limit is
-- counted from the rows themselves (ix_login_otps_tenant_email), so deleting a consumed row
-- immediately would hand the sender a fresh budget. 24 h keeps the send window intact with room to
-- spare and still leaves nothing password-equivalent lying around for long.
CREATE OR REPLACE FUNCTION prune_login_otps()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count integer;
BEGIN
  DELETE FROM login_otps
   WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

COMMENT ON FUNCTION prune_login_otps() IS
  'Delete login OTPs older than 24 h. Keeps the 15-minute send-rate window countable.';

GRANT EXECUTE ON FUNCTION
  count_active_users(uuid),
  login_precheck(uuid, uuid, uuid),
  rotate_refresh_token(bytea, bytea, uuid, interval, inet, text),
  revoke_session_chain(uuid, text, jsonb, inet, text),
  append_wallet_entry(uuid, text, bigint, text, text, uuid, text, text, uuid),
  wallet_balance(uuid),
  expire_device_codes(),
  prune_login_otps()
  TO portal_app;

GRANT EXECUTE ON FUNCTION count_active_users(uuid), wallet_balance(uuid) TO tenant_readonly;

COMMIT;
