const { app, BrowserWindow } = require("electron");
const path = require("path");

let mainWindow;
let backend;

function createWindow() {

    mainWindow = new BrowserWindow({
        width: 1600,
        height: 950,
        minWidth: 1200,
        minHeight: 700,
        title: "QueryMind",
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadURL("http://localhost:3000/querymind.html");

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {

    console.log("Starting QueryMind backend...");

    try {
        backend = require(path.join(__dirname, "server.js"));
    } catch (err) {
        console.error("Server startup error:", err);
    }

    setTimeout(() => {
        createWindow();
    }, 1500);

});

app.on("window-all-closed", () => {

    if (backend?.server) {
        backend.server.close();
    }

    app.quit();
});

app.on("before-quit", () => {

    if (backend?.server) {
        backend.server.close();
    }

});
