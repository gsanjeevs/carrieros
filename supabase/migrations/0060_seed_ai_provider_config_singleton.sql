-- The admin API and LLM provider resolver expect the configured singleton.
-- Restore it on existing databases where local/admin cleanup removed the row.
INSERT INTO public.ai_provider_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
