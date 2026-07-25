import { definePlugin as definePlugin2 } from "@hachej/boring-workspace/plugin";

var COMPILED_PLUGIN_ID = "compiled-factory";
function createCompiledPlugin(options = {}) {
  return definePlugin2({
    id: COMPILED_PLUGIN_ID,
    label: "Compiled factory",
    panels: options.panels ?? []
  });
}
var compiledPlugin = createCompiledPlugin();
var front_default = compiledPlugin;
export {
  createCompiledPlugin,
  front_default as default
};
