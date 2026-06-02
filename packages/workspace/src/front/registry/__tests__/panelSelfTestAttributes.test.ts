import { describe, expect, test } from "vitest"
import { panelSelfTestAttributes } from "../PanelRegistry"

describe("panelSelfTestAttributes", () => {
  test("builds deterministic plugin panel markers", () => {
    expect(panelSelfTestAttributes({
      pluginId: "demo",
      panelId: "demo.panel",
      panelInstanceId: "self-test:demo:demo.panel",
      pluginRevision: 7,
    })).toEqual({
      "data-boring-plugin-id": "demo",
      "data-boring-panel-component-id": "demo.panel",
      "data-boring-panel-instance-id": "self-test:demo:demo.panel",
      "data-boring-plugin-revision": "7",
    })
  })

  test("omits optional panel instance and revision markers", () => {
    expect(panelSelfTestAttributes({ pluginId: "static", panelId: "static.panel" })).toEqual({
      "data-boring-plugin-id": "static",
      "data-boring-panel-component-id": "static.panel",
    })
  })
})
