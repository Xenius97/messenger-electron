const { app, BrowserWindow, Menu, Tray, shell, dialog, Notification, ipcMain, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const APP_TITLE = 'Messenger';
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
    update: {
        width: 450,
        height: 200,
        resizable: false,
        frame: true,
        modal: true,
        title: 'Updating Messenger Desktop',
        show: false,
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
let updateProgressWindow = null;
let tray = null;
let isQuitting = false;
let loadingAnimationInterval = null;
let loadingDotCounter = 0;
let lastMessageCount = 0;

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

function createUpdateProgressWindow() {
    if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
        return;
    }
    
    updateProgressWindow = new BrowserWindow({
        ...WINDOW_CONFIG.update,
        webPreferences: WEB_PREFERENCES,
    });
    
    updateProgressWindow.setMenu(null);
    updateProgressWindow.loadFile('assets/update-progress.html');
    
    updateProgressWindow.once('ready-to-show', () => {
        updateProgressWindow.show();
    });
    
    updateProgressWindow.on('closed', () => {
        updateProgressWindow = null;
    });
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

function setupMessageCountMonitor(webContents) {
    webContents.on('page-title-updated', (event, title) => {
        // console.log('Page title updated:', title);
        const match = title.match(/\((\d+)\)/);
        
        if (match) {
            const messageCount = parseInt(match[1], 10);
            console.log('Message count detected:', messageCount, 'Last count:', lastMessageCount);
            
            if (messageCount > lastMessageCount && lastMessageCount >= 0) {
                const newMessages = messageCount - lastMessageCount;
                console.log('Sending notification for', newMessages, 'new messages');
                
                if (process.platform === 'win32' && tray && !tray.isDestroyed()) {
                    tray.displayBalloon({
                        title: 'Messenger',
                        content: `${newMessages} new message${newMessages > 1 ? 's' : ''} received`,
                        icon: path.join(__dirname, 'assets/app.ico')
                    });
                }
            }
            
            lastMessageCount = messageCount;
            
            if (tray && !tray.isDestroyed()) {
                tray.setToolTip(messageCount > 0 ? `Messenger (${messageCount} unread)` : 'Messenger');
            }
            
            if (process.platform === 'win32') {
                updateTaskbarBadge(messageCount);
            }
        } else if (title === APP_TITLE) {
            lastMessageCount = 0;
            if (tray && !tray.isDestroyed()) {
                tray.setToolTip('Messenger');
            }
            
            if (process.platform === 'win32') {
                updateTaskbarBadge(0);
            }
        }
    });
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
    setupMessageCountMonitor(webContents);
    setupNavigationHandlers(webContents);

    mainWindow.loadURL(MESSENGER_URL);

    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.destroy();
        }
        mainWindow.show();
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            
            if (process.platform === 'win32') {
                mainWindow.setSkipTaskbar(true);
            }
        }
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

function updateTaskbarBadge(count) {
    if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    
    if (count === 0) {
        mainWindow.setOverlayIcon(null, '');
        return;
    }
    
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#FF0000';
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const displayCount = count > 99 ? '99+' : count.toString();
    const fontSize = displayCount.length > 2 ? 32 : 40;
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillText(displayCount, 32, 32);
    
    const image = nativeImage.createFromDataURL(canvas.toDataURL());
    mainWindow.setOverlayIcon(image, `${count} unread messages`);
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
    createTray();
}

function createTray() {
    const trayIconPath = path.join(__dirname, 'assets/app.ico');
    tray = new Tray(trayIconPath);
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Messenger',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.setSkipTaskbar(false);
                    mainWindow.focus();
                    
                    lastMessageCount = 0;
                    if (tray && !tray.isDestroyed()) {
                        tray.setToolTip('Messenger');
                    }
                    
                    if (process.platform === 'win32') {
                        updateTaskbarBadge(0);
                    }
                }
            }
        },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('Messenger');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
                if (process.platform === 'win32') {
                    mainWindow.setSkipTaskbar(true);
                }
            } else {
                mainWindow.show();
                mainWindow.setSkipTaskbar(false);
                mainWindow.focus();
                
                lastMessageCount = 0;
                if (tray && !tray.isDestroyed()) {
                    tray.setToolTip('Messenger');
                }
                
                if (process.platform === 'win32') {
                    updateTaskbarBadge(0);
                }
            }
        }
    });
}

function setupAutoUpdater() {
    
    autoUpdater.autoDownload = false;
    
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 4000);
    
    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (${info.version}) is available!`,
            detail: 'Do you want to download and install the update?',
            buttons: ['Not Now', 'OK']
        }).then((result) => {
            if (result.response === 1) {
                createUpdateProgressWindow();
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('download-progress', (progressObj) => {
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
            updateProgressWindow.webContents.send('download-progress', progressObj);
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
            updateProgressWindow.webContents.send('update-downloaded');
        } else {
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
        }
    });

    autoUpdater.on('error', (error) => {
        console.error('Update error:', error);
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
            updateProgressWindow.close();
        }
    });
    
    ipcMain.on('restart-app', () => {
        autoUpdater.quitAndInstall();
    });
    
    ipcMain.on('close-update-window', () => {
        if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
            updateProgressWindow.close();
        }
    });
}

if (process.platform === 'win32') {
    app.setAppUserModelId('com.messenger.desktop');
}

app.whenReady().then(() => {
    createWindows();
    setupAutoUpdater();
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});