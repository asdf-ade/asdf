import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	Notification,
	nativeTheme,
	powerSaveBlocker,
	shell,
} from "electron";
import {
	BROWSER_STATE_EVENT,
	CLONE_PROGRESS_EVENT,
	NOTIFICATION_ACTIVATE_EVENT,
	type SearchOptions,
	TERMINAL_ACTIVITY_EVENT,
	TERMINAL_EXIT_EVENT,
	TERMINAL_OUTPUT_EVENT,
	WINDOW_CLOSE_REQUESTED_EVENT,
} from "@/ipc/bindings";
import { Activity } from "./activity";
import { Browsers } from "./browser";
import { clone } from "./git";
import * as repo from "./repo";
import { ok } from "./result";
import { search } from "./search";
import { readSystemTerminal } from "./system-terminal";
import { Registry } from "./terminal";
import { createUpdater } from "./updater";
import { open as openWorkspace } from "./workspace";

const directory = path.dirname(fileURLToPath(import.meta.url));

const terminals = new Registry();

/** How long a shell must be quiet before its work counts as finished. */
const QUIET_MS = 1000;

/** How long after a start or a resize a shell's output is not counted as work:
 *  long enough for the prompt or the repaint, short enough that a command typed
 *  straight away still shows. */
const SETTLE_MS = 500;

/** Whether the person asked the machine to stay awake while agents work. */
let keepAwake = false;
/** The id of the block being held, or null while the machine may sleep. */
let sleepBlock: number | null = null;

const activity = new Activity(QUIET_MS, (id, busy) => {
	main?.webContents.send(TERMINAL_ACTIVITY_EVENT, { id, busy });
	holdSleep();
});

/**
 * Starts or stops the sleep block. Held only while both are true — the setting
 * is on and something is working — so the machine sleeps as it normally would
 * the moment the last agent stops.
 */
function holdSleep(): void {
	const wanted = keepAwake && activity.working > 0;
	if (wanted && sleepBlock === null) {
		sleepBlock = powerSaveBlocker.start("prevent-app-suspension");
	} else if (!wanted && sleepBlock !== null) {
		powerSaveBlocker.stop(sleepBlock);
		sleepBlock = null;
	}
}

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

// Windows shows a notification only for an app it can name, and it takes that
// name from the Start Menu shortcut electron-builder writes with this id.
// Development has no shortcut, so the executable stands in: without either,
// every toast is dropped in silence and the feature looks broken rather than
// blocked. Must be set before the first notification.
if (process.platform === "win32")
	app.setAppUserModelId(
		app.isPackaged ? "io.github.asdf-ade.asdf" : process.execPath,
	);

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

	// The panes live in the renderer and the views they show live here, so a
	// renderer that reloads leaves every view it opened with no owner: nothing
	// left to place it, hide it or close it, and it stays over the window at
	// whatever bounds it last had. The reload is the end of those panes.
	window.webContents.on("did-start-loading", () => browsers.closeAll());

	// A window that has gone blank looks the same from outside whatever caused
	// it: a renderer that died, one that hung, or a page that tried to load and
	// could not — which in development is the dev server having gone away. Each
	// says so here, because none of them says anything on its own.
	//
	// A dead renderer also leaves the window behind it: a white rectangle with
	// no way back but quitting. That one is recoverable, so it is recovered.
	//
	// Once, though: a renderer that dies as soon as it loads would spin here
	// forever, and a window that keeps blinking is worse than one that is
	// plainly broken. A second death inside ten seconds is left alone.
	let recovered = 0;
	window.webContents.on("render-process-gone", (_event, details) => {
		console.error(
			`renderer gone: ${details.reason} (exit code ${details.exitCode})`,
		);
		if (Date.now() - recovered < 10_000) return;
		recovered = Date.now();
		// Whatever it opened is unreachable now: the ids were in its memory, so
		// nothing can place a view or write to a shell again. They go with it.
		terminals.closeAll();
		browsers.closeAll();
		window.webContents.reload();
	});
	window.on("unresponsive", () => console.error("renderer is not responding"));
	window.webContents.on(
		"did-fail-load",
		(_event, code, description, url, isMainFrame) => {
			if (isMainFrame)
				console.error(`load failed: ${description} (${code}) ${url}`);
		},
	);

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

// What the machine's own terminal looks like. Read once and kept: it shells
// out to read a plist, and a profile does not change under a running app often
// enough to pay for that on every pane that opens.
let systemTerminal: ReturnType<typeof readSystemTerminal> | undefined;
ipcMain.handle("terminal://system", () => {
	if (systemTerminal === undefined) systemTerminal = readSystemTerminal();
	return ok(systemTerminal);
});

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
ipcMain.handle(
	"repo://search",
	(
		_event,
		{
			cwd,
			query,
			options,
		}: { cwd: string; query: string; options: SearchOptions },
	) => search(cwd, query, options),
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
	) => {
		const opened = terminals.open(cwd, cols, rows, {
			onOutput: (id, chunk) => {
				activity.saw(id);
				main?.webContents.send(TERMINAL_OUTPUT_EVENT, { id, chunk });
			},
			onExit: (id) => {
				activity.forget(id);
				holdSleep();
				main?.webContents.send(TERMINAL_EXIT_EVENT, id);
			},
		});
		// A shell greets you as it starts. That is not work.
		if (opened.ok) activity.mute(opened.value, SETTLE_MS);
		return opened;
	},
);

ipcMain.handle(
	"write_terminal",
	(_event, { id, data }: { id: number; data: string }) =>
		terminals.write(id, data),
);

ipcMain.handle(
	"resize_terminal",
	(_event, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
		// A resize makes the shell repaint, and a session coming on screen is
		// sized exactly then — so switching sessions would spin the sidebar for
		// the session you just left behind and the one you just arrived at.
		activity.mute(id, SETTLE_MS);
		return terminals.resize(id, cols, rows);
	},
);

ipcMain.handle("close_terminal", (_event, { id }: { id: number }) => {
	activity.forget(id);
	holdSleep();
	return terminals.close(id);
});

/**
 * The notification a finished session raises when nobody was watching it. The
 * renderer decides when that is — it is the side that knows which session is on
 * screen — and writes the words, since the strings are its to translate.
 */
ipcMain.handle(
	"notify",
	(
		_event,
		{
			title,
			body,
			sessionId,
		}: { title: string; body: string; sessionId: string },
	) => {
		if (!Notification.isSupported()) return ok(null);
		// Not silent: the sound is the half of a notification that reaches
		// someone who is looking at something else, which is who this is for.
		// The OS chooses which sound, the same one its own notifications use.
		const note = new Notification({ title, body, silent: false });
		note.on("click", () => {
			const window = main;
			if (!window) return;
			if (window.isMinimized()) window.restore();
			window.show();
			window.focus();
			window.webContents.send(NOTIFICATION_ACTIVATE_EVENT, sessionId);
		});
		note.show();
		return ok(null);
	},
);

ipcMain.handle(
	"power://keep-awake",
	(_event, { enabled }: { enabled: boolean }) => {
		keepAwake = enabled;
		holdSleep();
		return ok(null);
	},
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
		keepAwake = false;
		holdSleep();
		terminals.closeAll();
		browsers.closeAll();
	});
}
