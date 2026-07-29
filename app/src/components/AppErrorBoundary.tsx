import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error?: Error;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // The fallback is the reporting surface; avoid emitting raw response data or stacks.
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '32px',
          background: '#f5f5f5',
        }}
      >
        <div style={{ width: 'min(560px, 100%)' }}>
          <h1 style={{ margin: '0 0 12px', fontSize: '24px', lineHeight: 1.3 }}>
            Governance OneLens could not load
          </h1>
          <div
            role="alert"
            style={{ marginBottom: '16px', padding: '12px 14px', border: '1px solid #d13438', background: '#fdf3f4' }}
          >
            {this.state.error.message || 'An unexpected application error occurred.'}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ border: 0, padding: '9px 14px', background: '#0f6cbd', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Reload application
          </button>
        </div>
      </main>
    );
  }
}