import { JSDOM } from 'jsdom'
import { createDockview } from 'dockview-core'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
global.requestAnimationFrame = (cb) => setTimeout(cb, 0)

const createContentRenderer = () => ({
  element: document.createElement('div'),
  init() {},
  dispose() {},
})

const createApi = () => {
  const container = document.createElement('div')
  container.style.width = '1400px'
  container.style.height = '900px'
  document.body.appendChild(container)
  const api = createDockview(container, { createComponent: createContentRenderer })
  api.layout(1400, 900, true)
  return api
}

const caseCreationOrder = () => {
  const api = createApi()
  api.addPanel({ id: 'data-catalog', component: 'probe' })
  api.addPanel({
    id: 'filetree',
    component: 'probe',
    position: { direction: 'below', referencePanel: 'data-catalog' },
  })
  api.addPanel({
    id: 'chart-canvas',
    component: 'probe',
    position: { direction: 'right', referencePanel: 'data-catalog' },
  })
  const snapshot = api.toJSON().grid.root
  api.dispose()
  return snapshot
}

const setupTabbedCenterBase = (api) => {
  api.addPanel({ id: 'filetree', component: 'probe' })
  api.addPanel({
    id: 'terminal',
    component: 'probe',
    position: { direction: 'right', referencePanel: 'filetree' },
  })
  api.addPanel({
    id: 'empty-center',
    component: 'probe',
    position: { direction: 'left', referencePanel: 'terminal' },
  })
  api.addPanel({
    id: 'chart-canvas',
    component: 'probe',
    position: { referencePanel: 'empty-center' },
  })
  api.addPanel({
    id: 'data-catalog',
    component: 'probe',
    position: { referencePanel: 'empty-center' },
  })
}

const caseReferenceModes = () => {
  const byGroup = createApi()
  setupTabbedCenterBase(byGroup)
  byGroup.addPanel({
    id: 'shell-group',
    component: 'probe',
    position: {
      direction: 'below',
      referenceGroup: byGroup.getPanel('empty-center').group,
    },
  })
  const groupSnapshot = byGroup.toJSON().grid.root
  byGroup.dispose()

  const byPanel = createApi()
  setupTabbedCenterBase(byPanel)
  byPanel.addPanel({
    id: 'shell-panel',
    component: 'probe',
    position: {
      direction: 'below',
      referencePanel: 'empty-center',
    },
  })
  const panelSnapshot = byPanel.toJSON().grid.root
  byPanel.dispose()

  return { groupSnapshot, panelSnapshot }
}

const result = {
  creationOrder: caseCreationOrder(),
  referenceModes: caseReferenceModes(),
}

process.stdout.write(JSON.stringify(result))
