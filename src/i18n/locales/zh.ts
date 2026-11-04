import type { Dict } from "../index";
import common from "./zh/common";
import shell from "./zh/shell";
import settings from "./zh/settings";
import plugins from "./zh/plugins";
import toolsA from "./zh/toolsA";
import toolsB from "./zh/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default dict;
