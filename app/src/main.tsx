import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AuthProvider } from '@/hooks/AuthContext';
import { bootstrapAuth } from '@/services/bootstrap';

import './main.css';

const authService = bootstrapAuth();

createRoot(document.getElementById('root')!).render(
  <FluentProvider theme={webLightTheme} style={{ height: '100vh' }}>
    <AppErrorBoundary>
      <AuthProvider authService={authService}>
        <App />
      </AuthProvider>
    </AppErrorBoundary>
  </FluentProvider>
);
