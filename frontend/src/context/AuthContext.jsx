import { createContext, useState, useEffect, useContext, useCallback } from 'react';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

const API = 'http://localhost:8000';

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    // Fetch the full profile (called on mount and after updates)
    const fetchProfile = useCallback(async (token) => {
        try {
            const res = await fetch(`${API}/api/user/me`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
                setIsAuthenticated(true);
                return userData;
            } else {
                localStorage.removeItem('token');
                setIsAuthenticated(false);
            }
        } catch (e) {
            console.error('Profile fetch failed', e);
        }
        return null;
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            fetchProfile(token).finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [fetchProfile]);

    const login = async (token, basicUserData) => {
        localStorage.setItem('token', token);
        // Immediately fetch full profile so all fields are available
        const fullProfile = await fetchProfile(token);
        if (!fullProfile) {
            // Fallback to basic data if profile fetch fails
            setUser(basicUserData);
            setIsAuthenticated(true);
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
        setIsAuthenticated(false);
    };

    // Call this after a successful PATCH /api/user/update to sync state globally
    const updateUser = (updatedFields) => {
        setUser(prev => ({ ...prev, ...updatedFields }));
    };

    // Re-fetch full profile from server (use after avatar upload)
    const refreshProfile = async () => {
        const token = localStorage.getItem('token');
        if (token) await fetchProfile(token);
    };

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated,
            loading,
            login,
            logout,
            updateUser,
            refreshProfile,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
