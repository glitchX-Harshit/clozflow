import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY
const localMode    = import.meta.env.VITE_AUTH_MODE === 'local'

if (!localMode && (!supabaseUrl || !supabaseKey)) {
    console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

// Local mode never talks to Supabase; a cloud build without the keys gets `null`
// (createClient would throw at import time and blank the whole app).
export const supabase = !localMode && supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null
