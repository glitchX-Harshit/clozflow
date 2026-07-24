import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Navbar from './components/Navbar';
import Hero from './components/Hero';
const Features = React.lazy(() => import('./components/Features'));
const HowItWorks = React.lazy(() => import('./components/HowItWorks'));
const Integrations = React.lazy(() => import('./components/Integrations'));
const ObjectionHandling = React.lazy(() => import('./components/ObjectionHandling'));
const ResponseSuggestion = React.lazy(() => import('./components/ResponseSuggestion'));
const UseCases = React.lazy(() => import('./components/UseCases'));
const Pricing = React.lazy(() => import('./components/Pricing'));
const Footer = React.lazy(() => import('./components/Footer'));
const CrowdSection = React.lazy(() => import('./components/CrowdSection'));
import SmoothScroll from './components/SmoothScroll';
import LiveCopilotPopup from './components/LiveCopilotPopup';

const CrowdCanvasSection = React.lazy(() => import('./components/CrowdCanvasSection'));
const ThreeBackground = React.lazy(() => import('./components/ThreeBackground'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const CallBriefing = React.lazy(() => import('./pages/CallBriefing'));
const LiveCall = React.lazy(() => import('./pages/LiveCall'));
const PostCallSummary = React.lazy(() => import('./pages/PostCallSummary'));
const OutreachStudioPage = React.lazy(() => import('./pages/OutreachStudioPage'));

function LandingPage() {
    const navigate = useNavigate();
    return (
        <main style={{ position: 'relative' }}>
            <Suspense fallback={null}>
                <ThreeBackground />
            </Suspense>
            <div style={{ position: 'relative', zIndex: 1 }}>
                <Navbar
                    onGetStarted={() => navigate('/dashboard')}
                    onSignup={() => navigate('/auth', { state: { view: 'signup' } })}
                    onLogin={() => navigate('/auth', { state: { view: 'login' } })}
                />
                <Hero onGetStarted={() => navigate('/dashboard')} />
                <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
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
                </Suspense>
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
                    <LiveCopilotPopup />
                    <Routes>
                        <Route path="/"              element={<LandingPage />} />
                        {/* Auth pages — includes /auth/callback for OAuth redirect */}
                        <Route path="/auth"          element={<Suspense fallback={null}><AuthPage /></Suspense>} />
                        <Route path="/auth/callback" element={<Suspense fallback={null}><AuthPage /></Suspense>} />
                        {/* Protected routes */}
                        <Route path="/dashboard" element={
                            <ProtectedRoute><Suspense fallback={null}><Dashboard /></Suspense></ProtectedRoute>
                        } />
                        <Route path="/call-brief" element={
                            <ProtectedRoute><Suspense fallback={null}><CallBriefing /></Suspense></ProtectedRoute>
                        } />
                        <Route path="/live-call" element={
                            <ProtectedRoute><Suspense fallback={null}><LiveCall /></Suspense></ProtectedRoute>
                        } />
                        <Route path="/summary" element={
                            <ProtectedRoute><Suspense fallback={null}><PostCallSummary /></Suspense></ProtectedRoute>
                        } />
                        <Route path="/outreach-studio" element={
                            <ProtectedRoute><Suspense fallback={null}><OutreachStudioPage /></Suspense></ProtectedRoute>
                        } />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
