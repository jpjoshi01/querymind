const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let mainWindow;
let serverProcess;

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

    serverProcess = spawn("node", ["server.js"], {
        cwd: __dirname,
        shell: true
    });

    serverProcess.stdout.on("data", data => {
        console.log(data.toString());
    });

    serverProcess.stderr.on("data", data => {
        console.error(data.toString());
    });

    serverProcess.on("error", err => {
        console.error("Server startup error:", err);
    });

    setTimeout(() => {
        createWindow();
    }, 4000);

});

app.on("window-all-closed", () => {

    if (serverProcess) {
        serverProcess.kill();
    }

    app.quit();
});

app.on("before-quit", () => {

    if (serverProcess) {
        serverProcess.kill();
    }

});