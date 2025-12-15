const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const APP_TITLE = 'Messenger Desktop';
const MESSENGER_URL = 'https://www.messenger.com';
const LOADING_ANIMATION_INTERVAL = 400;
const LOADING_DOT_COUNT = 4;

const WINDOW_CONFIG = {
    main: {
        width: 1400,
        height: 800,
        show: false,
        resizable: true,
        autoHideMenuBar: true,
        title: APP_TITLE,
        icon: path.join(__dirname, 'assets/app.ico'),
    },
    splash: {
        width: 250,
        height: 250,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
    },
    external: {
        width: 1000,
        height: 800,
        autoHideMenuBar: true,
        title: APP_TITLE,
        icon: path.join(__dirname, 'assets/app.ico'),
    },
};

const WEB_PREFERENCES = {
    contextIsolation: true,
    nodeIntegration: false,
    partition: 'persist:messenger',
};

let mainWindow = null;
let splashWindow = null;
let loadingAnimationInterval = null;
let loadingDotCounter = 0;

const dataFolderName = process.env.PORTABLE_EXECUTABLE_DIR ? 'MessengerDesktopData' : 'MessengerDesktop';
app.setPath('userData', path.join(app.getPath('appData'), dataFolderName));

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });
}

function isMessengerUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname.endsWith('messenger.com');
    } catch (error) {
        return false;
    }
}

function isFacebookUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname.endsWith('facebook.com');
    } catch (error) {
        return false;
    }
}

function startLoadingAnimation() {
    if (loadingAnimationInterval) return;
    
    loadingDotCounter = 0;
    loadingAnimationInterval = setInterval(() => {
        loadingDotCounter = (loadingDotCounter + 1) % LOADING_DOT_COUNT;
        const dots = '.'.repeat(loadingDotCounter);
        mainWindow.setTitle(`${APP_TITLE} - Loading${dots}`);
    }, LOADING_ANIMATION_INTERVAL);
}

function stopLoadingAnimation() {
    if (loadingAnimationInterval) {
        clearInterval(loadingAnimationInterval);
        loadingAnimationInterval = null;
    }
    mainWindow.setTitle(APP_TITLE);
}

function redirectToMainWindow(url, windowToClose) {
    if (windowToClose && !windowToClose.isDestroyed()) {
        windowToClose.destroy();
    }
    
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    mainWindow.loadURL(url);
    mainWindow.focus();
}

function setupPermissionHandler(session) {
    session.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(permission === 'notifications');
    });
}

function createSplashWindow() {
    splashWindow = new BrowserWindow(WINDOW_CONFIG.splash);
    splashWindow.loadFile('assets/splash.html');
}

function setupContextMenu(webContents) {
    webContents.on('context-menu', () => {
        const menu = Menu.buildFromTemplate([
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
            { type: 'separator' },
            { role: 'reload' },
        ]);
        menu.popup();
    });
}

function setupLoadingIndicators(webContents) {
    webContents.on('did-start-loading', () => {
        startLoadingAnimation();
        mainWindow.setProgressBar(2);
    });

    webContents.on('did-stop-loading', () => {
        stopLoadingAnimation();
        mainWindow.setProgressBar(-1);
    });

    webContents.on('did-navigate-in-page', startLoadingAnimation);
    webContents.on('did-frame-finish-load', stopLoadingAnimation);
}

function setupNavigationHandlers(webContents) {
    webContents.setWindowOpenHandler(({ url }) => {
        if (isMessengerUrl(url)) {
            return { action: 'allow' };
        }
        if (isFacebookUrl(url)) {
            createExternalWindow(url);
            return { action: 'deny' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    webContents.on('will-navigate', (event, url) => {
        if (!isMessengerUrl(url)) {
            event.preventDefault();
            if (isFacebookUrl(url)) {
                createExternalWindow(url);
            } else {
                shell.openExternal(url);
            }
        }
    });
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        ...WINDOW_CONFIG.main,
        webPreferences: WEB_PREFERENCES,
    });

    const webContents = mainWindow.webContents;

    setupPermissionHandler(webContents.session);
    setupContextMenu(webContents);
    setupLoadingIndicators(webContents);
    setupNavigationHandlers(webContents);

    mainWindow.loadURL(MESSENGER_URL);

    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.destroy();
        }
        mainWindow.show();
    });
}

function setupExternalWindowNavigationHandlers(webContents, window) {
    const handleNavigation = (event, url) => {
        if (isMessengerUrl(url)) {
            event.preventDefault();
            redirectToMainWindow(url, window);
        } else if (!isFacebookUrl(url)) {
            event.preventDefault();
            shell.openExternal(url);
            if (!window.isDestroyed()) {
                window.close();
            }
        }
    };

    webContents.on('will-navigate', handleNavigation);
    webContents.on('did-redirect-navigation', handleNavigation);

    webContents.on('did-navigate', (event, url) => {
        if (isMessengerUrl(url)) {
            redirectToMainWindow(url, window);
        } else if (!isFacebookUrl(url)) {
            shell.openExternal(url);
            if (!window.isDestroyed()) {
                window.close();
            }
        }
    });
}

function setupExternalWindowDownloadHandler(session, window) {
    session.on('will-download', (event, item) => {
        item.once('done', () => {
            if (!window.isDestroyed()) {
                window.close();
            }
        });
    });
}

function createExternalWindow(url) {
    const externalWindow = new BrowserWindow({
        ...WINDOW_CONFIG.external,
        webPreferences: WEB_PREFERENCES,
    });

    const webContents = externalWindow.webContents;

    setupPermissionHandler(webContents.session);
    setupExternalWindowNavigationHandlers(webContents, externalWindow);
    setupExternalWindowDownloadHandler(webContents.session, externalWindow);

    externalWindow.loadURL(url);
}

function createWindows() {
    createSplashWindow();
    createMainWindow();
}

function setupAutoUpdater() {
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 2000);
    
    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (${info.version}) is available!`,
            detail: 'The update will be downloaded in the background.',
            buttons: ['OK']
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded successfully!',
            detail: 'The application will be updated when you close it.',
            buttons: ['OK', 'Restart Now']
        }).then((result) => {
            if (result.response === 1) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on('error', (error) => {
        console.error('Update error:', error);
    });
}

app.whenReady().then(() => {
    createWindows();
    setupAutoUpdater();
});
app.on('window-all-closed', () => app.quit()); 