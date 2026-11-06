const fs = require("fs");
const p = "src/features/canvas-nodes/storyboard/workbench-sheet.tsx";
let c = fs.readFileSync(p, "utf8");

// Find the hook call in JSX and extract it to a top-level variable
// The hook call is at: videoStageProps={useWorkbenchVideoStageProps({...})}
// We need to find the exact text

const oldJsxCall = "videoStageProps={useWorkbenchVideoStageProps({\n                  currentShot,\n                  activeMediaStorageKey: activeMedia?.storageKey,\n                  timelinePlaying,\n                  playhead,\n                  activeClipStartSec,\n                  autoPlayKey,\n                  onInsertAt,\n                  onLinkStoryboard: linkStoryboard,\n                  onGenerate: runVideoGenerate,\n                  onStop: runVideoStop,\n                  theme,\n                  isDark,\n                  t: t as (...args: any[]) => string,\n                })}";

const newJsxCall = "videoStageProps={videoStageProps}";

// Find where to insert the top-level hook call
// Insert after the last useMemo/useCallback before the JSX return
// The hook call should be before the return statement
// Let me find the last useMemo/useCallback before the "return (" that starts the JSX

// Add the hook call before the return
const returnMarker = "  return (\n    <div";
const hookCall = "  const videoStageProps = useWorkbenchVideoStageProps({\n    currentShot,\n    activeMediaStorageKey: activeMedia?.storageKey,\n    timelinePlaying,\n    playhead,\n    activeClipStartSec,\n    autoPlayKey,\n    onInsertAt,\n    onLinkStoryboard: linkStoryboard,\n    onGenerate: runVideoGenerate,\n    onStop: runVideoStop,\n    theme,\n    isDark,\n    t: t as (...args: any[]) => string,\n  });\n\n" + returnMarker;

c = c.replace(oldJsxCall, newJsxCall);
c = c.replace(returnMarker, hookCall);

fs.writeFileSync(p, c, "utf8");
console.log("OK");
