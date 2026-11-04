import type { Dict } from "../index";
import common from "./es/common";
import shell from "./es/shell";
import settings from "./es/settings";
import plugins from "./es/plugins";
import toolsA from "./es/toolsA";
import toolsB from "./es/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default dict;
