const { EventEmitter } = require('events')
const { WebContentsView } = require('electron')

const toolbarHeight = 62

class Tab {
  constructor(parentWindow) {
    this.view = new WebContentsView()
    this.id = this.view.webContents.id
    this.window = parentWindow
    this.webContents = this.view.webContents
    this.window.contentView.addChildView(this.view)

    this.invalidateLayout = this.invalidateLayout.bind(this);
  }

  destroy() {
    if (this.destroyed) return

    this.destroyed = true

    this.hide()

    this.window.contentView.removeChildView(this.view)
    this.window = undefined

    if (!this.webContents.isDestroyed()) {
      if (this.webContents.isDevToolsOpened()) {
        this.webContents.closeDevTools()
      }

      // TODO: why is this no longer called?
      this.webContents.emit('destroyed')

      this.webContents.destroy()
    }

    this.webContents = undefined
    this.view = undefined
  }

  loadURL(url) {
    return this.view.webContents.loadURL(url)
  }

  show() {
    this.invalidateLayout();
    this.startResizeListener();
    this.view.setVisible(true);
  }

  hide() {
    this.stopResizeListener();
    this.view.setVisible(false);
  }

  reload() {
    this.view.webContents.reload()
  }

  invalidateLayout() {
    const [width, height] = this.window.getSize();
    const padding = 4;
    this.view.setBounds({
      x: padding,
      y: toolbarHeight + padding,
      width: width - (padding * 2),
      height: height - toolbarHeight - (padding * 2)
    });
    this.view.setBorderRadius(8);
  }

  // Replacement for BrowserView.setAutoResize. This could probably be better...
  startResizeListener() {
    this.window.on('resize', this.invalidateLayout);
  }
  stopResizeListener() {
    this.window.off('resize', this.invalidateLayout);
  }
}

class Tabs extends EventEmitter {
  tabList = []
  selected = null

  constructor(browserWindow) {
    super()
    this.window = browserWindow
  }

  destroy() {
    this.tabList.forEach((tab) => tab.destroy())
    this.tabList = []

    this.selected = undefined

    if (this.window) {
      this.window.destroy()
      this.window = undefined
    }
  }

  get(tabId) {
    return this.tabList.find((tab) => tab.id === tabId)
  }

  create() {
    const tab = new Tab(this.window)
    this.tabList.push(tab)
    if (!this.selected) this.selected = tab
    tab.show() // must be attached to window
    this.emit('tab-created', tab)
    this.select(tab.id)
    return tab
  }

  remove(tabId) {
    const tabIndex = this.tabList.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) {
      throw new Error(`Tabs.remove: unable to find tab.id = ${tabId}`)
    }
    const tab = this.tabList[tabIndex]
    this.tabList.splice(tabIndex, 1)
    tab.destroy()
    if (this.selected === tab) {
      this.selected = undefined
      const nextTab = this.tabList[tabIndex] || this.tabList[tabIndex - 1]
      if (nextTab) this.select(nextTab.id)
    }
    this.emit('tab-destroyed', tab)
    if (this.tabList.length === 0) {
      this.destroy()
    }
  }

  select(tabId) {
    const tab = this.get(tabId)
    if (!tab) return
    if (this.selected) this.selected.hide()
    tab.show()
    this.selected = tab
    this.emit('tab-selected', tab)
  }
}

exports.Tabs = Tabs
