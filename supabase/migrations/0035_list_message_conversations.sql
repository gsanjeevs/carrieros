-- 0035_list_message_conversations.sql
-- API-completeness pass (2026-09-24): a dispatcher-facing aggregate message
-- inbox never existed before, legacy or v1 - every prior messages capability
-- (listMessages, markLoadMessagesRead) is scoped to one load's thread. This
-- is "latest message per load, newest first, with an unread count" - a
-- DISTINCT ON / LATERAL join PostgREST cannot express directly, so it's a
-- small read-only SQL function instead.
--
-- Deliberately NOT SECURITY DEFINER: it should run with the CALLER's own
-- privileges so driver_messages RLS (owner_solo_dispatcher_messages_all /
-- driver_thread_messages_select) keeps deciding which rows are visible,
-- exactly like every other read in this codebase. The unread count excludes
-- the caller's own messages, mirroring markLoadMessagesRead's same rule.
CREATE OR REPLACE FUNCTION list_message_conversations()
RETURNS TABLE(
  load_id BIGINT,
  load_number TEXT,
  last_message_body TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.id,
    l.load_number,
    latest.body,
    latest.sent_at,
    (
      SELECT count(*) FROM driver_messages dm2
      WHERE dm2.load_id = l.id AND dm2.read_at IS NULL AND dm2.sender_id <> auth.uid()
    )
  FROM loads l
  JOIN LATERAL (
    SELECT dm.body, dm.sent_at
    FROM driver_messages dm
    WHERE dm.load_id = l.id
    ORDER BY dm.sent_at DESC
    LIMIT 1
  ) latest ON true
  ORDER BY latest.sent_at DESC;
$$;
