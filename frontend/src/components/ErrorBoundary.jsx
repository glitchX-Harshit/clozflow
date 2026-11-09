import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          padding: '2.5rem 1.5rem',
          maxWidth: '600px',
          margin: '2rem auto',
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #fee2e2',
          boxShadow: '0 4px 12px rgba(239, 68, 68, 0.08)',
          textAlign: 'center',
          fontFamily: 'inherit'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: '#fef2f2',
            color: '#ef4444',
            marginBottom: '1rem'
          }}>
            <AlertTriangle size={24} />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', margin: '0 0 0.5rem' }}>
            {this.props.title || 'Something went wrong displaying this section'}
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred. You can safely retry without losing your workspace.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#0f172a',
              color: '#ffffff',
              fontSize: '0.82rem',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <RotateCcw size={14} />
            <span>Try Again</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
