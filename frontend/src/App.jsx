import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Integrations from './components/Integrations';
import ObjectionHandling from './components/ObjectionHandling';
import ResponseSuggestion from './components/ResponseSuggestion';
import UseCases from './components/UseCases';
import Pricing from './components/Pricing';
import Footer from './components/Footer';
import CrowdSection from './components/CrowdSection';
import CrowdCanvasSection from './components/CrowdCanvasSection';
import ThreeBackground from './components/ThreeBackground';
import SmoothScroll from './components/SmoothScroll';

import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import CallBriefing from './pages/CallBriefing';
import LiveCall from './pages/LiveCall';
import PostCallSummary from './pages/PostCallSummary';
function LandingPage() {
    const navigate = useNavigate();

    return (
        <main style={{ position: 'relative' }}>
            <ThreeBackground />
            <div style={{ position: 'relative', zIndex: 1 }}>
                <Navbar
                    onGetStarted={() => navigate('/dashboard')}
                onSignup={() => navigate('/auth', { state: { view: 'signup' } })}
                onLogin={() => navigate('/auth', { state: { view: 'login' } })}
            />
            <Hero onGetStarted={() => navigate('/dashboard')} />
            <HowItWorks />
            <Features />
            <Integrations />
            <ObjectionHandling />
            <ResponseSuggestion />
            <UseCases />
            <Pricing />
            <CrowdSection />
            <CrowdCanvasSection />
            <Footer />
            </div>
        </main>
    );
}

function App() {
    return (
        <AuthProvider>
            <SmoothScroll />
            <BrowserRouter>
                <div className="app-root">
                    <Routes>
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/auth" element={<AuthPage />} />
                        <Route path="/dashboard" element={
                            <ProtectedRoute><Dashboard /></ProtectedRoute>
                        } />
                        <Route path="/call-brief" element={
                            <ProtectedRoute><CallBriefing /></ProtectedRoute>
                        } />
                        <Route path="/live-call" element={
                            <ProtectedRoute><LiveCall /></ProtectedRoute>
                        } />
                        <Route path="/summary" element={
                            <ProtectedRoute><PostCallSummary /></ProtectedRoute>
                        } />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
