import type { Dict } from "../index";
import common from "./fr/common";
import shell from "./fr/shell";
import settings from "./fr/settings";
import plugins from "./fr/plugins";
import toolsA from "./fr/toolsA";
import toolsB from "./fr/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };
export default dict;
