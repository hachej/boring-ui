var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

var COMPILED_PLUGIN_ID;
var init_shared = __esm({
  "src/shared/index.ts"() {
    "use strict";
    COMPILED_PLUGIN_ID = "compiled-direct";
  }
});

import { definePlugin } from "@hachej/boring-workspace/plugin";
init_shared();
var compiledPlugin = definePlugin({
  id: COMPILED_PLUGIN_ID,
  panels: []
});
var front_default = compiledPlugin;
export {
  front_default as default,
  compiledPlugin
};
