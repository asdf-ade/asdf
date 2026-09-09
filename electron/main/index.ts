import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeTheme,
	shell,
} from "electron";
import {
	BROWSER_STATE_EVENT,
	CLONE_PROGRESS_EVENT,
	TERMINAL_EXIT_EVENT,
	TERMINAL_OUTPUT_EVENT,
	WINDOW_CLOSE_REQUESTED_EVENT,
} from "@/ipc/bindings";
import { Browsers } from "./browser";
import { clone } from "./git";
import * as repo from "./repo";
import { ok } from "./result";
import { Registry } from "./terminal";
import { createUpdater } from "./updater";
import { open as openWorkspace } from "./workspace";

const directory = path.dirname(fileURLToPath(import.meta.url));

const terminals = new Registry();

// Every WebContents becomes a CDP target on this port, including the browser
// panes — that is how agent-browser drives what the person sees. Port 0 lets
// Chromium pick a free one and write it to DevToolsActivePort; `Browsers` reads
// it back. It also exposes the app's own window on localhost, which is the
// trade a local developer tool makes; see architecture.md.
app.commandLine.appendSwitch("remote-debugging-port", "0");

// The app draws its own chrome and has no use for a menu bar. macOS keeps its
// default one, where the application menu is also what binds copy, paste and
// quit to their shortcuts.
if (process.platform !== "darwin") Menu.setApplicationMenu(null);

let main: BrowserWindow | null = null;
/** Set once the renderer has agreed the window may go. */
let closing = false;

// What Chromium paints where the renderer has not yet: the strip a resize
// exposes, the frame before first paint. Left at the default it is white, which
// flashes in a dark window. Mirrors --background in src/index.css.
const background = () =>
	nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		title: "asdf",
		backgroundColor: background(),
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		show: false,
		// No title bar: the renderer's top row reaches the window edge and draws
		// its own caption buttons, so their hover states can differ — the OS
		// overlay only lets close turn red. macOS keeps its traffic lights, centred
		// in the 36px top row every column shares.
		titleBarStyle: "hidden",
		trafficLightPosition: { x: 12, y: 12 },
		webPreferences: {
			preload: path.join(directory, "../preload/index.mjs"),
			sandbox: false,
		},
	});

	// Showing only once the first frame is painted avoids the white flash a
	// freshly created BrowserWindow shows while the renderer boots.
	window.once("ready-to-show", () => window.show());
	nativeTheme.on("updated", () => window.setBackgroundColor(background()));

	// Links to the outside world belong in the user's browser, not in a webview
	// with no address bar.
	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	window.on("close", (event) => {
		if (closing) return;
		event.preventDefault();
		window.webContents.send(WINDOW_CLOSE_REQUESTED_EVENT);
		// The renderer acknowledges as soon as its on-quit work is done. The timer
		// is only here so a wedged renderer cannot trap the window open.
		setTimeout(() => {
			if (!closing) {
				closing = true;
				window.close();
			}
		}, 5000);
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		void window.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void window.loadFile(path.join(directory, "../renderer/index.html"));
	}

	return window;
}

const updater = createUpdater(() => main);
const browsers = new Browsers(
	() => main,
	(info) => main?.webContents.send(BROWSER_STATE_EVENT, info),
);

ipcMain.handle("browser://endpoint", () => browsers.describe().then(ok));
ipcMain.handle("browser://open", (_event, { url }: { url: string }) =>
	browsers.open(url),
);
ipcMain.handle(
	"browser://place",
	(
		_event,
		{
			id,
			bounds,
		}: {
			id: number;
			bounds: { x: number; y: number; width: number; height: number };
		},
	) => browsers.place(id, bounds),
);
ipcMain.handle(
	"browser://navigate",
	(_event, { id, url }: { id: number; url: string }) =>
		browsers.navigate(id, url),
);
ipcMain.handle(
	"browser://go",
	(
		_event,
		{ id, where }: { id: number; where: "back" | "forward" | "reload" },
	) => browsers.go(id, where),
);
ipcMain.handle("browser://close", (_event, { id }: { id: number }) =>
	browsers.close(id),
);
ipcMain.handle("browser://cover", (_event, { hidden }: { hidden: boolean }) => {
	browsers.cover(hidden);
	return ok(null);
});

ipcMain.handle("open_workspace", (_event, { path: raw }: { path: string }) =>
	openWorkspace(raw),
);

// The side panel follows the shell: where it is now, and what git and gh say
// about that place.
ipcMain.handle("terminal://cwd", async (_event, { id }: { id: number }) => {
	const pid = terminals.pid(id);
	return ok(pid === null ? null : await repo.cwdOf(pid));
});
ipcMain.handle("repo://snapshot", (_event, { cwd }: { cwd: string }) =>
	repo.snapshot(cwd),
);
ipcMain.handle(
	"repo://diff",
	(_event, { root, file }: { root: string; file: string }) =>
		repo.diff(root, file),
);
ipcMain.handle(
	"repo://read",
	(_event, { dir, file }: { dir: string; file: string }) =>
		repo.read(dir, file),
);
ipcMain.handle(
	"repo://revert",
	(_event, { root, file }: { root: string; file: string }) =>
		repo.revert(root, file),
);
ipcMain.handle(
	"repo://commit",
	(_event, { root, message }: { root: string; message: string }) =>
		repo.commit(root, message),
);
ipcMain.handle("repo://issues", (_event, { cwd }: { cwd: string }) =>
	repo.issues(cwd),
);
ipcMain.handle("repo://pulls", (_event, { cwd }: { cwd: string }) =>
	repo.pulls(cwd),
);

ipcMain.handle(
	"open_terminal",
	(
		_event,
		{ cwd, cols, rows }: { cwd: string | null; cols: number; rows: number },
	) =>
		terminals.open(cwd, cols, rows, {
			onOutput: (id, chunk) =>
				main?.webContents.send(TERMINAL_OUTPUT_EVENT, { id, chunk }),
			onExit: (id) => main?.webContents.send(TERMINAL_EXIT_EVENT, id),
		}),
);

ipcMain.handle(
	"write_terminal",
	(_event, { id, data }: { id: number; data: string }) =>
		terminals.write(id, data),
);

ipcMain.handle(
	"resize_terminal",
	(_event, { id, cols, rows }: { id: number; cols: number; rows: number }) =>
		terminals.resize(id, cols, rows),
);

ipcMain.handle("close_terminal", (_event, { id }: { id: number }) =>
	terminals.close(id),
);

// The folder a workspace opens in. The OS dialog is the whole picker: it
// browses, and its own "New folder" button is how a workspace gets a fresh
// one, so there is nothing to build here for that.
ipcMain.handle("pick_folder", async () => {
	const window = main;
	if (!window) return ok(null);
	const picked = await dialog.showOpenDialog(window, {
		properties: ["openDirectory", "createDirectory"],
	});
	return ok(picked.canceled ? null : (picked.filePaths[0] ?? null));
});

ipcMain.handle(
	"clone_repo",
	(_event, { url, parent }: { url: string; parent: string }) =>
		clone(url, parent, (line) =>
			main?.webContents.send(CLONE_PROGRESS_EVENT, line),
		),
);

ipcMain.handle("updater://check", () => updater.check());
ipcMain.handle("updater://download", () => updater.download());
ipcMain.handle("updater://install", () => updater.install());

ipcMain.handle("app://relaunch", () => {
	// `quitAndInstall` already quits and starts the new build. Relaunching on top
	// of it races the installer for the same files, and the caller cannot tell
	// the two paths apart — it installs, then asks for a restart either way.
	if (updater.installing) return ok(null);
	app.relaunch();
	closing = true;
	app.quit();
	return ok(null);
});

ipcMain.handle("shell://open-external", (_event, { url }: { url: string }) => {
	void shell.openExternal(url);
	return ok(null);
});

ipcMain.handle("window://minimize", () => {
	main?.minimize();
	return ok(null);
});

ipcMain.handle("window://maximize", () => {
	if (main?.isMaximized()) main.unmaximize();
	else main?.maximize();
	return ok(null);
});

// Goes through the same close path as the OS button, so the renderer's on-quit
// work still runs.
ipcMain.handle("window://close", () => {
	main?.close();
	return ok(null);
});

ipcMain.handle("window://close-ack", () => {
	closing = true;
	main?.close();
	return ok(null);
});

// A second instance would fight the first over the same pty sessions, so hand
// the argument to the window that already exists instead.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!main) return;
		if (main.isMinimized()) main.restore();
		main.focus();
	});

	void app.whenReady().then(() => {
		main = createWindow();

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) main = createWindow();
		});
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	// Killing the shells here is what keeps a quit from leaving one behind; the
	// browser views go with them.
	app.on("before-quit", () => {
		closing = true;
		terminals.closeAll();
		browsers.closeAll();
	});
}
