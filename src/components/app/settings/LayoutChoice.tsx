import type { ReactNode } from "react";
import { useT } from "@/i18n";
import type { Layout } from "@/utils/theme";

function LayoutCard({ title, badge, description, preview, checked, onSelect }: {
  title: string;
  badge?: string;
  description: string;
  preview: ReactNode;
  checked: boolean;
  onSelect(): void;
}) {
  return (
    <label
      className={`flex flex-1 cursor-pointer flex-col gap-3.5 rounded-xl border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
        checked ? "border-primary/60 bg-primary/[.14]" : "border-border bg-muted"
      }`}
    >
      <input type="radio" name="layout" className="sr-only" checked={checked} onChange={onSelect} />
      {/* A phone has no room for the miniature. */}
      <div className="hidden sm:block">{preview}</div>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-px box-border h-4 w-4 shrink-0 rounded-full ${
            checked ? "border-[5px] border-primary-solid bg-white" : "border border-input"
          }`}
        />
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            {title}
            {badge && (
              <span className={`inline-flex h-5 items-center rounded-[5px] px-[7px] text-2xs font-medium ${
                checked ? "bg-primary/[.14] text-primary" : "bg-muted-foreground/15 text-muted-foreground"
              }`}>
                {badge}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
      </div>
    </label>
  );
}

const bar = (width: string, height: string, tone = "bg-muted-foreground/35") => (
  <span className={`block rounded-[3px] ${tone}`} style={{ width, height }} />
);

function PreviewFrame({ children, column = false }: { children: ReactNode; column?: boolean }) {
  return (
    <div aria-hidden="true" className={`box-border flex h-[150px] gap-2 rounded-lg border border-border bg-background p-2 ${column ? "flex-col" : ""}`}>
      {children}
    </div>
  );
}

function SidebarPreview() {
  return (
    <PreviewFrame>
      <div className="flex w-[30%] flex-col gap-1.5 p-1">
        {bar("70%", "8px", "bg-muted-foreground/55")}
        {["90%", "80%", "85%", "60%", "75%"].map((w) => <span key={w} className="contents">{bar(w, "6px")}</span>)}
      </div>
      <div className="flex flex-1 flex-col gap-2 rounded-md bg-card p-3.5">
        {bar("40%", "8px", "bg-muted-foreground/55")}
        {bar("100%", "14px", "bg-muted")}
        <div className="grid grid-cols-2 gap-1.5">
          {[0, 1, 2, 3].map((i) => <span key={i} className="contents">{bar("100%", "10px")}</span>)}
        </div>
      </div>
    </PreviewFrame>
  );
}

function LauncherPreview() {
  return (
    <PreviewFrame column>
      <div className="flex items-center gap-1.5">
        {bar("14%", "8px", "bg-muted-foreground/55")}
        {bar("12%", "6px")}
        {bar("12%", "6px")}
        <span className="flex-1" />
        {bar("30%", "10px", "bg-muted")}
      </div>
      <div className="flex flex-1 flex-col items-center gap-2.5 rounded-md bg-card p-3.5">
        {bar("60%", "14px", "bg-muted")}
        <div className="grid w-full grid-cols-6 gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="h-[30px] rounded-[5px] bg-muted-foreground/20" />)}
        </div>
        <div className="flex w-full gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className="contents">{bar("22%", "10px")}</span>)}
        </div>
      </div>
    </PreviewFrame>
  );
}

/** The Sidebar / Launcher cards of Settings → Appearance (2b) and of the first-run layout step (2a). */
export function LayoutChoice({ layout, onLayout, className = "max-w-[820px] gap-3 sm:gap-3.5" }: { layout: Layout; onLayout(next: Layout): void; className?: string }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("settings.layout.label")} className={`flex flex-col sm:flex-row ${className}`}>
      <LayoutCard
        checked={layout === "sidebar"}
        onSelect={() => onLayout("sidebar")}
        title={t("settings.layout.sidebar")}
        badge={t("settings.layout.badgeDefault")}
        description={t("settings.layout.sidebarDescription")}
        preview={<SidebarPreview />}
      />
      <LayoutCard
        checked={layout === "launcher"}
        onSelect={() => onLayout("launcher")}
        title={t("settings.layout.launcher")}
        description={t("settings.layout.launcherDescription")}
        preview={<LauncherPreview />}
      />
    </div>
  );
}
