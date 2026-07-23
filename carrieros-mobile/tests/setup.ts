// tests/setup.ts
// Pure-logic tests (e.g. tests/exceptions.test.ts) import modules that
// transitively import src/lib/supabase.ts, which constructs a real
// SupabaseClient at module load time and throws if the URL/anon key env
// vars are missing. No test in this suite makes a real network call, so a
// placeholder value is enough — this just satisfies createClient()'s own
// validation, matching the pattern carrieros-web/tests/setup.ts uses for
// real env vars (this file needs no real credentials since nothing here
// hits the network).
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-placeholder-anon-key';
