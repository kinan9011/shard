import type { Dict } from "../index";
import common from "./ja/common";
import shell from "./ja/shell";
import settings from "./ja/settings";
import plugins from "./ja/plugins";
import toolsA from "./ja/toolsA";
import toolsB from "./ja/toolsB";

const dict: Dict = { ...common, ...shell, ...settings, ...plugins, ...toolsA, ...toolsB };

export default dict;
