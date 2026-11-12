import { createContext, useContext } from 'react';

/**
 * Auth state shared by both providers (see AuthProvider.jsx):
 *   user, isAuthenticated, loading, profileStatus ('idle' | 'loading' | 'ready' | 'error'),
 *   sessionNotice (why the user was signed out), restoreError / retryRestore (local mode),
 *   loginWithEmail, signupWithEmail, login, loginWithGoogle, loginWithGithub, loginWithOAuth,
 *   logout, updateUser, refreshProfile, clearSessionNotice.
 */
export const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);
