import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Navbar from './components/Navbar';
import Hero from './components/Hero';
const HowItWorks = React.lazy(() => import('./components/HowItWorks'));
const Integrations = React.lazy(() => import('./components/Integrations'));
const ObjectionHandling = React.lazy(() => import('./components/ObjectionHandling'));
const ResponseSuggestion = React.lazy(() => import('./components/ResponseSuggestion'));
const UseCases = React.lazy(() => import('./components/UseCases'));
const PricingPage = React.lazy(() => import('./pages/PricingPage'));
const Footer = React.lazy(() => import('./components/Footer'));
const CrowdSection = React.lazy(() => import('./components/CrowdSection'));
import SmoothScroll from './components/SmoothScroll';
import LiveCopilotPopup from './components/LiveCopilotPopup';
import WebPreload from './components/WebPreload';

const CrowdCanvasSection = React.lazy(() => import('./components/CrowdCanvasSection'));
const ThreeBackground = React.lazy(() => import('./components/ThreeBackground'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const CallBriefing = React.lazy(() => import('./pages/CallBriefing'));
const LiveCall = React.lazy(() => import('./pages/LiveCall'));
const PostCallSummary = React.lazy(() => import('./pages/PostCallSummary'));
const OutreachStudioPage = React.lazy(() => import('./pages/OutreachStudioPage'));
const RelayPublic = React.lazy(() => import('./pages/RelayPublic'));
const HowItWorksPage = React.lazy(() => import('./pages/HowItWorksPage'));

// ── Admin Intelligence Module ──
const AdminProtectedRoute = React.lazy(() => import('./admin/components/AdminProtectedRoute'));
const AdminLayout = React.lazy(() => import('./admin/components/AdminLayout'));
const AdminOverview = React.lazy(() => import('./admin/pages/AdminOverview'));
const AdminUsers = React.lazy(() => import('./admin/pages/AdminUsers'));
const AdminUserDetail = React.lazy(() => import('./admin/pages/AdminUserDetail'));
const AdminSubscriptions = React.lazy(() => import('./admin/pages/AdminSubscriptions'));
const AdminOrders = React.lazy(() => import('./admin/pages/AdminOrders'));
const AdminPayments = React.lazy(() => import('./admin/pages/AdminPayments'));
const AdminRevenue = React.lazy(() => import('./admin/pages/AdminRevenue'));
const AdminUsage = React.lazy(() => import('./admin/pages/AdminUsage'));
const AdminPearl = React.lazy(() => import('./admin/pages/AdminPearl'));
const AdminRetention = React.lazy(() => import('./admin/pages/AdminRetention'));
const AdminAuditLogs = React.lazy(() => import('./admin/pages/AdminAuditLogs'));
const AdminSettings = React.lazy(() => import('./admin/pages/AdminSettings'));

function LandingPage() {
    const navigate = useNavigate();
    return (
        <main className="landing-main" style={{ position: 'relative', width: '100%', overflowX: 'clip' }}>
            {/* ── Web Preloader (Reload / Entrance Curtain Animation) ── */}
            <WebPreload />

            {/* ── 1ST SECTION: Hero & 3D Orb Viewport ── */}
            <div className="hero-viewport-wrap" style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
                <Suspense fallback={null}>
                    <ThreeBackground />
                </Suspense>
                <Navbar
                    onGetStarted={() => navigate('/dashboard')}
                    onSignup={() => navigate('/auth', { state: { view: 'signup' } })}
                    onLogin={() => navigate('/auth', { state: { view: 'login' } })}
                />
                <Hero onGetStarted={() => navigate('/dashboard')} />
            </div>

            {/* ── SUBSEQUENT SECTIONS: Slides cleanly ABOVE the 1st section & orb ── */}
            <div 
                className="subsequent-sections-wrap" 
                style={{ 
                    position: 'relative', 
                    zIndex: 10, 
                    backgroundColor: 'var(--bg, #f4f6f8)',
                    boxShadow: '0 -24px 60px rgba(15, 23, 42, 0.04)'
                }}
            >
                <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
                    <HowItWorks />
                    <Integrations />
                    <ObjectionHandling />
                    <ResponseSuggestion />
                    <UseCases />
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
            <BrowserRouter>
                <SmoothScroll />
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
                        {/* Public Relay page — NO auth required (buyer-facing) */}
                        <Route path="/relay/:slug" element={<Suspense fallback={null}><RelayPublic /></Suspense>} />
                        <Route path="/how-it-works" element={<Suspense fallback={null}><HowItWorksPage /></Suspense>} />
                        <Route path="/pricing" element={<Suspense fallback={null}><PricingPage /></Suspense>} />

                        {/* Admin Intelligence Protected Portal */}
                        <Route path="/admin" element={
                            <Suspense fallback={null}>
                                <AdminProtectedRoute>
                                    <AdminLayout />
                                </AdminProtectedRoute>
                            </Suspense>
                        }>
                            <Route index element={<Suspense fallback={null}><AdminOverview /></Suspense>} />
                            <Route path="users" element={<Suspense fallback={null}><AdminUsers /></Suspense>} />
                            <Route path="users/:id" element={<Suspense fallback={null}><AdminUserDetail /></Suspense>} />
                            <Route path="subscriptions" element={<Suspense fallback={null}><AdminSubscriptions /></Suspense>} />
                            <Route path="orders" element={<Suspense fallback={null}><AdminOrders /></Suspense>} />
                            <Route path="payments" element={<Suspense fallback={null}><AdminPayments /></Suspense>} />
                            <Route path="revenue" element={<Suspense fallback={null}><AdminRevenue /></Suspense>} />
                            <Route path="usage" element={<Suspense fallback={null}><AdminUsage /></Suspense>} />
                            <Route path="pearl" element={<Suspense fallback={null}><AdminPearl /></Suspense>} />
                            <Route path="retention" element={<Suspense fallback={null}><AdminRetention /></Suspense>} />
                            <Route path="audit-logs" element={<Suspense fallback={null}><AdminAuditLogs /></Suspense>} />
                            <Route path="settings" element={<Suspense fallback={null}><AdminSettings /></Suspense>} />
                        </Route>

                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
