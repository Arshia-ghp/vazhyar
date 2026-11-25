import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "خطای پیش‌بینی‌نشده‌ای رخ داده است."
    };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Replace this with a privacy-conscious telemetry service in a later phase.
    console.error("Application render failure", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="error-screen" dir="rtl">
          <section className="error-panel">
            <div className="error-icon"><TriangleAlert size={30} /></div>
            <p className="eyebrow">خطای نمایشی</p>
            <h1>برنامه با یک خطای غیرمنتظره روبه‌رو شد</h1>
            <p className="muted">داده‌های ذخیره‌شده در IndexedDB با این خطا پاک نمی‌شوند. صفحه را دوباره بارگذاری کن.</p>
            <details className="error-details">
              <summary>جزئیات فنی</summary>
              <code>{this.state.message}</code>
            </details>
            <button className="button button-primary" onClick={this.handleReload} type="button">
              <RefreshCw size={16} /> بارگذاری دوباره
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
