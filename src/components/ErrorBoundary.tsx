import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  scopeLabel?: string;
  /** When false (e.g. a background-mounted modal that is currently closed), never render a full-screen error overlay. */
  active?: boolean;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[Etherloom ErrorBoundary${
        this.props.scopeLabel ? `:${this.props.scopeLabel}` : ""
      }]`,
      error,
      info.componentStack
    );
  }

  public componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Clear any stale background error when transitioning from closed -> open so the child gets a clean mount attempt
    if (!prevProps.active && this.props.active && this.state.error) {
      this.setState({ error: null });
    }
  }

  private handleRecover = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  public render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (this.props.active === false) {
      return null;
    }

    const isScoped = Boolean(this.props.onReset);

    return (
      <div
        className={
          isScoped
            ? "fixed inset-0 z-50 bg-slate-950/75 dark:bg-[#050912]/88 flex items-center justify-center p-4"
            : "h-screen w-screen bg-slate-50 dark:bg-[#0D1321] text-slate-900 dark:text-slate-100 flex items-center justify-center p-6"
        }
      >
        <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#111827] border border-rose-500/40 shadow-2xl p-5 space-y-3.5 text-slate-900 dark:text-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/35 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-[#F43F5E]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                {this.props.scopeLabel
                  ? `${this.props.scopeLabel} encountered a rendering error`
                  : "Etherloom recovered from an interface error"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Your running VMs, packet captures, and active topology remain
                safe in the background.
              </p>
            </div>
          </div>

          <pre className="max-h-36 overflow-auto rounded-lg bg-slate-100 dark:bg-[#090E18] border border-slate-200 dark:border-slate-800 p-2.5 text-[11px] font-mono text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words select-text">
            {this.state.error.message || String(this.state.error)}
          </pre>

          <div className="flex items-center justify-end gap-2 pt-1">
            {!isScoped && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-[#162032] dark:hover:bg-[#1E2B42] text-slate-700 dark:text-slate-200"
              >
                Reload Window
              </button>
            )}
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#06B6D4] hover:bg-[#22D3EE] text-[#090E18]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isScoped ? "Dismiss & Continue" : "Recover Studio"}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
