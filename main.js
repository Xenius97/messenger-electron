const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;
let splash;
let loadingInterval = null;
let dots = 0;

const dataFolderName = process.env.PORTABLE_EXECUTABLE_DIR
    ? 'MessengerDesktopData'
    : 'MessengerDesktop';

app.setPath(
    'userData',
    path.join(app.getPath('appData'), dataFolderName)
);

function isMessengerUrl(url) {
    try {
        const u = new URL(url);
        return u.hostname.endsWith('messenger.com');
    } catch {
        return false;
    }
}

function startLoadingAnimation() {
    if (loadingInterval) return;
    dots = 0;
    loadingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        mainWindow.setTitle(
            `Messenger Desktop - Loading${'.'.repeat(dots)}`
        );
    }, 400);
}

function stopLoadingAnimation() {
    if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
    }
    mainWindow.setTitle('Messenger Desktop');
}

function handoffToMain(url, win) {
    if (win && !win.isDestroyed()) win.destroy();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(url);
    mainWindow.focus();
}

function createExternalWindow(url) {
    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        autoHideMenuBar: true,
        title: 'Messenger Desktop',
        icon: path.join(__dirname, 'build/app.ico'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:messenger'
        }
    });

    const wc = win.webContents;

    wc.on('will-navigate', (e, target) => {
        if (isMessengerUrl(target)) {
            e.preventDefault();
            handoffToMain(target, win);
        }
    });

    wc.on('did-redirect-navigation', (e, target) => {
        if (isMessengerUrl(target)) {
            e.preventDefault();
            handoffToMain(target, win);
        }
    });

    wc.on('did-navigate', (e, target) => {
        if (isMessengerUrl(target)) {
            handoffToMain(target, win);
        }
    });

    win.loadURL(url);
}

function createWindow() {
    splash = new BrowserWindow({
        width: 400,
        height: 250,
        frame: false,
        transparent: true,
        alwaysOnTop: true
    });

    splash.loadFile('splash.html');

    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        show: false,
        resizable: true,
        autoHideMenuBar: true,
        title: 'Messenger Desktop',
        icon: path.join(__dirname, 'build/app.ico'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:messenger'
        }
    });

    const wc = mainWindow.webContents;

    wc.on('did-start-loading', () => {
        startLoadingAnimation();
        mainWindow.setProgressBar(2);
    });

    wc.on('did-stop-loading', () => {
        stopLoadingAnimation();
        mainWindow.setProgressBar(-1);
    });

    wc.on('did-navigate-in-page', startLoadingAnimation);
    wc.on('did-frame-finish-load', stopLoadingAnimation);

    wc.setWindowOpenHandler(({ url }) => {
        if (isMessengerUrl(url)) {
            return { action: 'allow' };
        }
        createExternalWindow(url);
        return { action: 'deny' };
    });

    wc.on('will-navigate', (e, url) => {
        if (!isMessengerUrl(url)) {
            e.preventDefault();
            createExternalWindow(url);
        }
    });

    mainWindow.loadURL('https://www.messenger.com');

    mainWindow.once('ready-to-show', () => {
        splash.destroy();
        mainWindow.show();
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());