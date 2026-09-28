-- 0054_language_expansion.sql
-- Expands supported languages from 4 (en, es, pa, ur) to 24, chosen for US
-- trucking/carrier workforce relevance. Adds 20 rows to the `languages`
-- reference table (display_order continuing at 5, after the existing 4 rows
-- at 1-4) and widens the two CHECK constraints that restrict stored values
-- to the old 4-code set: carrier_details.default_language and
-- profiles.preferred_language. Constraint names below are the actual
-- Postgres-auto-generated names, confirmed against the running dev DB via
-- `\d carrier_details` / `\d profiles` (no hand-picked guesses):
--   carrier_details_default_language_check
--   profiles_preferred_language_check
-- Migration numbers 0052-0053 are already used by the unmerged
-- feature/dat-loadboard branch, so this one starts at 0054 to avoid a
-- collision when both merge (see CURRENT_WORK.md).

INSERT INTO languages (code, label, native_name, flag_emoji, display_order) VALUES
  ('ru','Russian','Русский','🇷🇺',5),
  ('uk','Ukrainian','Українська','🇺🇦',6),
  ('mn','Mongolian','Монгол','🇲🇳',7),
  ('ar','Arabic','العربية','🇸🇦',8),
  ('so','Somali','Soomaali','🇸🇴',9),
  ('ht','Haitian Creole','Kreyòl Ayisyen','🇭🇹',10),
  ('pt','Portuguese','Português','🇧🇷',11),
  ('vi','Vietnamese','Tiếng Việt','🇻🇳',12),
  ('zh','Chinese (Simplified)','简体中文','🇨🇳',13),
  ('ko','Korean','한국어','🇰🇷',14),
  ('tl','Tagalog','Tagalog','🇵🇭',15),
  ('fr','French','Français','🇫🇷',16),
  ('pl','Polish','Polski','🇵🇱',17),
  ('ro','Romanian','Română','🇷🇴',18),
  ('de','German','Deutsch','🇩🇪',19),
  ('hi','Hindi','हिन्दी','🇮🇳',20),
  ('gu','Gujarati','ગુજરાતી','🇮🇳',21),
  ('am','Amharic','አማርኛ','🇪🇹',22),
  ('fa','Persian/Farsi','فارسی','🇮🇷',23),
  ('ne','Nepali','नेपाली','🇳🇵',24);

ALTER TABLE carrier_details DROP CONSTRAINT carrier_details_default_language_check;
ALTER TABLE carrier_details ADD CONSTRAINT carrier_details_default_language_check
  CHECK (default_language IN (
    'en','es','pa','ur','ru','uk','mn','ar','so','ht','pt','vi','zh','ko','tl','fr','pl','ro','de','hi','gu','am','fa','ne'
  ));

ALTER TABLE profiles DROP CONSTRAINT profiles_preferred_language_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_preferred_language_check
  CHECK (preferred_language IN (
    'en','es','pa','ur','ru','uk','mn','ar','so','ht','pt','vi','zh','ko','tl','fr','pl','ro','de','hi','gu','am','fa','ne'
  ));
