import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { Shell } from '@/components/Shell';
import { useAuth } from './hooks/useAuth';

// Feature routes stay out of the initial authentication shell. The catalog
// route also owns a chart and the large table/facet surface, so it is split
// even though it is the first authenticated page.
const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const AskOneLensPage = lazy(() => import('@/pages/AskOneLensPage').then((m) => ({ default: m.AskOneLensPage })));
const ConnectorsPage = lazy(() => import('@/pages/ConnectorsPage').then((m) => ({ default: m.ConnectorsPage })));
const WorkspacesPage = lazy(() => import('@/pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })));
const ObservabilityPage = lazy(() => import('@/pages/ObservabilityPage').then((m) => ({ default: m.ObservabilityPage })));
const LineageExplorerPage = lazy(() => import('@/pages/LineageExplorerPage').then((m) => ({ default: m.LineageExplorerPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>
  );
}

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      {/* ensure all new routes require auth */}
      <Routes>
        <Route
          path="/auth"
          element={
            <AuthGuard requireAuth={false}>
              <AuthPage />
            </AuthGuard>
          }
        />
        <Route
          path="/"
          element={
            <AuthGuard requireAuth={true}>
              <Shell />
            </AuthGuard>
          }
        >
          <Route index element={<Suspense fallback={<PageLoading />}><HomePage /></Suspense>} />
          <Route path="ask" element={<Suspense fallback={<PageLoading />}><AskOneLensPage /></Suspense>} />
          <Route path="connectors" element={<Suspense fallback={<PageLoading />}><ConnectorsPage /></Suspense>} />
          <Route path="workspaces" element={<Suspense fallback={<PageLoading />}><WorkspacesPage /></Suspense>} />
          <Route path="observability" element={<Suspense fallback={<PageLoading />}><ObservabilityPage /></Suspense>} />
          <Route path="lineage" element={<Suspense fallback={<PageLoading />}><LineageExplorerPage /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageLoading />}><SettingsPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
