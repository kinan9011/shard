import type { Dict } from "../index";
import common from "./de/common";
import shell from "./de/shell";
import settings from "./de/settings";
import plugins from "./de/plugins";
import toolsA from "./de/toolsA";
import toolsB from "./de/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default dict;
