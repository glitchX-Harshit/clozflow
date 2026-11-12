import LocalAuthProvider from './LocalAuthProvider';
import SupabaseAuthProvider from './SupabaseAuthProvider';

const LOCAL_MODE = import.meta.env.VITE_AUTH_MODE === 'local';

/** `VITE_AUTH_MODE=local` → backend email/password accounts; anything else → Supabase (ClozFlow Cloud). */
export function AuthProvider({ children }) {
    return LOCAL_MODE
        ? <LocalAuthProvider>{children}</LocalAuthProvider>
        : <SupabaseAuthProvider>{children}</SupabaseAuthProvider>;
}

export default AuthProvider;
