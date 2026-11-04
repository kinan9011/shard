import type { Dict } from "../index";
import common from "./he/common";
import shell from "./he/shell";
import settings from "./he/settings";
import plugins from "./he/plugins";
import toolsA from "./he/toolsA";
import toolsB from "./he/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default dict;
