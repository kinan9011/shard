import { useState } from "react";
import type { PaneDoc } from "./diff-merge/DiffPanes";
import type { Mode } from "./diff-merge/ModeSwitch";
import { FolderView } from "./diff-merge/folder/FolderView";
import { TextDiffView } from "./diff-merge/TextDiffView";

/**
 * Root of the Diff & Merge tool. Both screens stay mounted, so switching modes keeps their state.
 */
export function DiffMerge() {
  const [mode, setMode] = useState<Mode>("text");
  const [docs, setDocs] = useState<[PaneDoc, PaneDoc]>();
  return (
    <>
      <div hidden={mode !== "text"} className={mode === "text" ? "h-full" : "hidden"}>
        <TextDiffView initial={docs} onModeChange={setMode} />
      </div>
      <div hidden={mode !== "folders"} className={mode === "folders" ? "h-full" : "hidden"}>
        <FolderView
          onOpenInText={(pair) => {
            setDocs(pair);
            setMode("text");
          }}
          onModeChange={setMode}
        />
      </div>
    </>
  );
}
