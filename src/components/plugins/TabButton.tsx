import { cn } from "@/lib/utils";

interface TabButtonProps<Id extends string> {
  id: Id;
  /** The prefix of the tab's DOM id, `${idPrefix}-${id}`. */
  idPrefix: string;
  /** The id of the panel this tab controls. */
  controls: string;
  selected: boolean;
  onSelect: (id: Id) => void;
  children: React.ReactNode;
}

/** A tab of the Plugins page and of the plugin detail pane: the selected one is bold with an underline. */
export function TabButton<Id extends string>({ id, idPrefix, controls, selected, onSelect, children }: TabButtonProps<Id>) {
  return (
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-${id}`}
      aria-selected={selected}
      aria-controls={controls}
      onClick={() => onSelect(id)}
      className={cn(
        "relative flex h-full items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors",
        selected ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {selected && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-sm bg-primary-solid" />}
    </button>
  );
}
