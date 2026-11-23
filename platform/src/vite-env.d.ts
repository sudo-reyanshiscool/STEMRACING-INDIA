/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_DB_SCHEMA?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** '1' offers the demo sign-in in a build that also has a backend. */
  readonly VITE_DEMO_LOGIN?: string;
}
