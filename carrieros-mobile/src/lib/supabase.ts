// src/lib/supabase.ts
// Same Supabase project as carrieros-web — same schema, same auth, same RLS.
// Session persists in AsyncStorage (not cookies — this is a native client,
// not a browser). API routes that need this session read it from an
// `Authorization: Bearer <token>` header (see carrieros-web/lib/api-auth.ts).
import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// Expo Router's web target renders once on the server (Node, no `window`)
// before hydrating in the browser. AsyncStorage's web backend touches
// `window.localStorage` on import, which crashes the whole SSR pass with
// "window is not defined" — this only matters for `expo start --web`
// (native iOS/Android never hits this path), but a no-op fallback during
// SSR is cheap insurance and the standard fix for this exact issue.
const isServer = typeof window === 'undefined'
const storage = isServer
  ? {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    }
  : AsyncStorage

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // required for React Native — no browser URL
  },
})
