const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;
let splash;
let loadingInterval = null;
let dots = 0;

if (process.env.PORTABLE_EXECUTABLE_DIR) {
    const portableDataPath = path.join(
        app.getPath('appData'),
        'MessengerDesktopData'
    );

    app.setPath('userData', portableDataPath);
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
        width: 1200,
        height: 800,
        show: false,
        resizable: true,
        autoHideMenuBar: true,
        title: 'Messenger Desktop',
        icon: path.join(__dirname, 'build/app.ico'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
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

    mainWindow.loadURL('https://www.messenger.com');

    mainWindow.once('ready-to-show', () => {
        splash.destroy();
        mainWindow.show();
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());