import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (import.meta.env.VITE_AUTH_MODE !== 'local' && (!supabaseUrl || !supabaseKey)) {
    console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = import.meta.env.VITE_AUTH_MODE === 'local' ? null : createClient(supabaseUrl, supabaseKey)
