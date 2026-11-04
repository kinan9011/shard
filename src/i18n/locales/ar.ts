import type { Dict } from "../index";
import common from "./ar/common";
import shell from "./ar/shell";
import settings from "./ar/settings";
import plugins from "./ar/plugins";
import toolsA from "./ar/toolsA";
import toolsB from "./ar/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default dict;
