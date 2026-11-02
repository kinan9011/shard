import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import type { CatalogTool } from "@/app/catalog";

interface ReorderOptions {
  tools: CatalogTool[];
  onMove: (id: string, targetId: string) => void;
  /** A grid laid out in rows: Alt+←/→ move a tile, Alt+↑/↓ do not (they would not move it vertically). Default: Alt+↑/↓. */
  horizontal?: boolean;
}

/**
 * Drag-and-drop and Alt+arrow reordering for a grid of pinned tiles (`data-pin` on each tile).
 * Shared by the Home edit mode and the Launcher Home.
 */
export function useReorder({ tools, onMove, horizontal = false }: ReorderOptions) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const grid: RefObject<HTMLDivElement> = useRef(null);
  const refocus = useRef<string | null>(null);

  // Moving a tile re-inserts it in the DOM, which drops focus: put it back once the new order is drawn.
  useEffect(() => {
    if (!refocus.current) return;
    grid.current?.querySelector<HTMLElement>(`[data-pin="${CSS.escape(refocus.current)}"]`)?.focus();
    refocus.current = null;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, tool: CatalogTool, index: number) => {
    if (!event.altKey || event.target !== event.currentTarget) return;
    const back = event.key === (horizontal ? "ArrowLeft" : "ArrowUp");
    const forward = event.key === (horizontal ? "ArrowRight" : "ArrowDown");
    if (!back && !forward) return;
    event.preventDefault();
    const neighbour = tools[index + (forward ? 1 : -1)];
    if (!neighbour) return;
    refocus.current = tool.id;
    onMove(tool.id, neighbour.id);
    setAnnouncement(`${tool.name} moved to position ${tools.indexOf(neighbour) + 1} of ${tools.length}`);
  };

  /** Props for one tile: draggable, reorderable from the keyboard. */
  const tileProps = (tool: CatalogTool, index: number) => ({
    draggable: true as const,
    "data-pin": tool.id,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tool.id);
      setDragging(tool.id);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragging) return;
      event.preventDefault();
      if (dragging !== tool.id) onMove(dragging, tool.id);
    },
    onDragEnd: () => setDragging(null),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, tool, index),
  });

  /** Props for the grid: a drop anywhere inside ends the drag. */
  const gridProps = {
    ref: grid,
    onDragOver: (event: DragEvent<HTMLElement>) => dragging && event.preventDefault(),
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(null);
    },
  };

  return { dragging, announcement, tileProps, gridProps };
}
