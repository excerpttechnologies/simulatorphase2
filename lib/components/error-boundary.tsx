"use client";

import React, { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("EFEM Simulator Error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "#020c18",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#c8eeff",
          fontFamily: "'Exo 2', sans-serif",
        }}>
          <div style={{
            fontSize: 28,
            color: "#ff4444",
            marginBottom: 16,
            textShadow: "0 0 20px rgba(255,68,68,.5)",
          }}>
            ⚠ SIMULATION ERROR
          </div>
          <div style={{
            fontSize: 12,
            color: "rgba(175,210,255,.5)",
            marginBottom: 24,
            maxWidth: 400,
            textAlign: "center",
            lineHeight: 1.6,
          }}>
            {this.state.error?.message || "An unexpected error occurred in the 3D simulation."}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              background: "rgba(0,180,255,.1)",
              border: "1px solid rgba(0,180,255,.3)",
              color: "#00e5ff",
              padding: "10px 24px",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 12,
              letterSpacing: 2,
            }}
          >
            RETRY SIMULATION
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;