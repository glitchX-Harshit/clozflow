import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();
    const location = useLocation();

    if (loading) return <div style={{height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', background: 'var(--bg)', fontWeight: 600 }}>Loading profile...</div>;

    if (!isAuthenticated) {
        return <Navigate to="/auth" state={{ from: location }} replace />;
    }

    return children;
};

export default ProtectedRoute;
