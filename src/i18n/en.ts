import common from "./source/common";
import plugins from "./source/plugins";
import settings from "./source/settings";
import shell from "./source/shell";
import toolsA from "./source/toolsA";
import toolsB from "./source/toolsB";

/** The source of truth for every UI string. The other languages translate these keys. */
const en = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default en;
