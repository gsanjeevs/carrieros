-- 0020_driver_messages_policy_split.sql
-- 0019 tightened the driver's driver_messages policy to "sender must be me", but that policy is FOR ALL,
-- so it also applied to UPDATE, and marking a DISPATCHER's message read (a legitimate driver action, see
-- POST /loads/{id}/messages/read) failed the check. Split by command:
--   INSERT  the driver may only send as themselves, into their own org, on their own load.
--   SELECT / UPDATE  anything in their own thread, but the UPDATE is limited to read_at by a trigger
--   (RLS is row-level; it cannot say which columns), the same technique as 0018 for loads.
DROP POLICY IF EXISTS "driver_own_thread_messages" ON driver_messages;

CREATE POLICY "driver_thread_messages_select" ON driver_messages FOR SELECT TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
);
CREATE POLICY "driver_thread_messages_insert" ON driver_messages FOR INSERT TO authenticated WITH CHECK (
  carrier_org_id = my_org_id()
  AND sender_id = auth.uid()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
);
CREATE POLICY "driver_thread_messages_update" ON driver_messages FOR UPDATE TO authenticated USING (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
) WITH CHECK (
  carrier_org_id = my_org_id()
  AND load_id IN (SELECT id FROM loads WHERE driver_id = (SELECT id FROM drivers WHERE profile_id = auth.uid()))
);

CREATE OR REPLACE FUNCTION enforce_driver_message_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF my_role() = 'driver' AND (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RAISE EXCEPTION 'drivers may only mark messages read' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER driver_messages_columns BEFORE UPDATE ON driver_messages
  FOR EACH ROW EXECUTE FUNCTION enforce_driver_message_columns();
