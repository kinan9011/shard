import type { ReactNode } from "react";

export function Heading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h1 className="text-xl font-semibold leading-[1.3] text-foreground">{title}</h1>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** A settings line: title and hint on the left, the control on the right. */
export function Row({ title, hint, children, htmlFor }: { title: string; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  const Title = htmlFor ? "label" : "span";
  return (
    <div className="flex flex-col items-start gap-2 border-t border-border py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Title {...(htmlFor ? { htmlFor } : {})} className="font-medium text-foreground">{title}</Title>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function ActionButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-secondary px-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}
