// src/lib/api-client.ts
// Mobile's typed client for carrieros-web's /api/v1 (generated runtime, see
// carrieros-web/scripts/gen-api-client.ts). All app data goes through this, not
// through supabase.from()/rpc()/storage: the API is the single data path shared
// with the web app (ADR 0003). supabase.auth stays here in supabase.ts only for
// sign-in and session refresh.
import { fetch as streamFetch } from 'expo/fetch';

import { createApiClient } from '@/lib/generated/api-client';
import { supabase } from '@/lib/supabase';

export const apiClient = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  // React Native's global fetch cannot stream; expo/fetch can (used for the
  // live-update SSE stream).
  streamFetch: streamFetch as unknown as typeof fetch,
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
});
