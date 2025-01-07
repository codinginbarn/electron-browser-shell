import { session as electronSession } from 'electron'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { BrowserActionAPI } from './api/browser-action'
import { TabsAPI } from './api/tabs'
import { WindowsAPI } from './api/windows'
import { WebNavigationAPI } from './api/web-navigation'
import { ExtensionStore } from './store'
import { ContextMenusAPI } from './api/context-menus'
import { RuntimeAPI } from './api/runtime'
import { CookiesAPI } from './api/cookies'
import { NotificationsAPI } from './api/notifications'
import { ChromeExtensionImpl } from './impl'
import { CommandsAPI } from './api/commands'
import { ExtensionContext } from './context'
import { ExtensionRouter } from './router'
import { checkLicense, License } from './license'
import { readLoadedExtensionManifest } from './manifest'

export interface ChromeExtensionOptions extends ChromeExtensionImpl {
  /**
   * License used to distribute electron-chrome-extensions.
   *
   * See LICENSE.md for more details.
   */
  license: License

  session?: Electron.Session

  /**
   * Path to electron-chrome-extensions module files. Might be needed if
   * JavaScript bundlers like Webpack are used in your build process.
   */
  modulePath?: string
}

const sessionMap = new WeakMap<Electron.Session, ElectronChromeExtensions>()

/**
 * Provides an implementation of various Chrome extension APIs to a session.
 */
export class ElectronChromeExtensions extends EventEmitter {
  /** Retrieve an instance of this class associated with the given session. */
  static fromSession(session: Electron.Session) {
    return sessionMap.get(session)
  }

  private ctx: ExtensionContext
  private modulePath: string

  private api: {
    browserAction: BrowserActionAPI
    contextMenus: ContextMenusAPI
    commands: CommandsAPI
    cookies: CookiesAPI
    notifications: NotificationsAPI
    runtime: RuntimeAPI
    tabs: TabsAPI
    webNavigation: WebNavigationAPI
    windows: WindowsAPI
  }

  constructor(opts: ChromeExtensionOptions) {
    super()

    const { license, session = electronSession.defaultSession, modulePath, ...impl } = opts || {}

    checkLicense(license)

    if (sessionMap.has(session)) {
      throw new Error(`Extensions instance already exists for the given session`)
    }

    sessionMap.set(session, this)

    const router = new ExtensionRouter(session)
    const store = new ExtensionStore(impl)

    this.ctx = {
      emit: this.emit.bind(this),
      router,
      session,
      store,
    }

    this.modulePath = modulePath || path.join(__dirname, '../..')

    this.api = {
      browserAction: new BrowserActionAPI(this.ctx),
      contextMenus: new ContextMenusAPI(this.ctx),
      commands: new CommandsAPI(this.ctx),
      cookies: new CookiesAPI(this.ctx),
      notifications: new NotificationsAPI(this.ctx),
      runtime: new RuntimeAPI(this.ctx),
      tabs: new TabsAPI(this.ctx),
      webNavigation: new WebNavigationAPI(this.ctx),
      windows: new WindowsAPI(this.ctx),
    }

    this.listenForExtensions()
    this.prependPreload()
  }

  private listenForExtensions() {
    this.ctx.session.addListener('extension-loaded', (_event, extension) => {
      readLoadedExtensionManifest(this.ctx, extension)
    })
  }

  private async prependPreload() {
    const { session } = this.ctx

    const preloadPath = path.join(this.modulePath, 'dist/preload.js')

    if ('registerPreloadScript' in session) {
      // TODO(mv3): remove 'any'
      ;(session as any).registerPreloadScript({
        id: 'crx-mv2-preload',
        type: 'frame',
        filePath: preloadPath,
      })
      ;(session as any).registerPreloadScript({
        id: 'crx-mv3-preload',
        type: 'service-worker',
        filePath: preloadPath,
      })
    } else {
      session.setPreloads([...session.getPreloads(), preloadPath])
    }

    let preloadExists = false
    try {
      const stat = await fs.stat(preloadPath)
      preloadExists = stat.isFile()
    } catch {}

    if (!preloadExists) {
      console.error(
        `Unable to access electron-chrome-extensions preload file (${preloadPath}). Consider configuring the 'modulePath' constructor option.`,
      )
    }
  }

  /** Add webContents to be tracked as a tab. */
  addTab(tab: Electron.WebContents, window: Electron.BrowserWindow) {
    this.ctx.store.addTab(tab, window)
  }

  /** Notify extension system that the active tab has changed. */
  selectTab(tab: Electron.WebContents) {
    if (this.ctx.store.tabs.has(tab)) {
      this.api.tabs.onActivated(tab.id)
    }
  }

  /**
   * Add webContents to be tracked as an extension host which will receive
   * extension events when a chrome-extension:// resource is loaded.
   *
   * This is usually reserved for extension background pages and popups, but
   * can also be used in other special cases.
   *
   * @deprecated Extension hosts are now tracked lazily when they send
   * extension IPCs to the main process.
   */
  addExtensionHost(host: Electron.WebContents) {
    console.warn('ElectronChromeExtensions.addExtensionHost() is deprecated')
  }

  /**
   * Get collection of menu items managed by the `chrome.contextMenus` API.
   * @see https://developer.chrome.com/extensions/contextMenus
   */
  getContextMenuItems(webContents: Electron.WebContents, params: Electron.ContextMenuParams) {
    return this.api.contextMenus.buildMenuItemsForParams(webContents, params)
  }

  /**
   * Gets map of special pages to extension override URLs.
   *
   * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides
   */
  getURLOverrides(): Record<string, string> {
    return this.ctx.store.urlOverrides
  }

  /**
   * Add extensions to be visible as an extension action button.
   *
   * @deprecated Not needed in Electron >=12.
   */
  addExtension(extension: Electron.Extension) {
    console.warn('ElectronChromeExtensions.addExtension() is deprecated')
    this.api.browserAction.processExtension(extension)
  }

  /**
   * Remove extensions from the list of visible extension action buttons.
   *
   * @deprecated Not needed in Electron >=12.
   */
  removeExtension(extension: Electron.Extension) {
    console.warn('ElectronChromeExtensions.removeExtension() is deprecated')
    this.api.browserAction.removeActions(extension.id)
  }
}
