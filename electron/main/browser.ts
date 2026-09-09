import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app, type BrowserWindow, WebContentsView } from "electron";
import type { BrowserEndpoint, BrowserInfo } from "@/ipc/bindings";
import { fail, type IpcResult, ok } from "./result";

/**
 * Every browser view the panes hold, addressed by the id the renderer keeps.
 *
 * A view is native: it sits over the renderer's DOM at whatever bounds the
 * pane last reported, so the person can click and type into it directly. An
 * agent reaches the same page over CDP — Chromium's remote debugging port is
 * on, and each view is a target there — which is what lets agent-browser
 * drive what the person is looking at.
 */
export class Browsers {
	private readonly views = new Map<number, WebContentsView>();
	/** The agent-browser session pinned to each view, once bound. */
	private readonly sessions = new Map<number, string>();
	/** Whether each view's own pane wants it on screen, ignoring `cover`. */
	private readonly shown = new Map<number, boolean>();
	/** Set while a drag needs the pointer to reach the DOM under these views. */
	private covered = false;
	private nextId = 0;
	private endpoint: BrowserEndpoint | null = null;

	constructor(
		private readonly window: () => BrowserWindow | null,
		private readonly onState: (info: BrowserInfo) => void,
	) {}

	/**
	 * Where CDP answers. Chromium chose the port (`remote-debugging-port=0`) and
	 * wrote it to `DevToolsActivePort` in the profile directory; read once.
	 *
	 * The port is what to hand out, not the `ws://.../devtools/browser/<id>`
	 * URL beside it in that file. Both reach the same browser and both work,
	 * but agent-browser takes minutes over the WebSocket form and about a
	 * second over the port: measured on Windows against this app, one call was
	 * 131s and the next 314s over the socket, against 1s either way over the
	 * port. That is past the timeout `agent` gives a call, so every binding was
	 * being killed rather than failing — and an unbound session drives whatever
	 * tab is active, which is this app's own window.
	 */
	async describe(): Promise<BrowserEndpoint> {
		if (this.endpoint) return this.endpoint;
		let cdp: string | null = null;
		try {
			const file = path.join(app.getPath("userData"), "DevToolsActivePort");
			const [port] = readFileSync(file, "utf8")
				.split(/\r?\n/)
				.map((line) => line.trim());
			if (/^\d+$/.test(port)) cdp = port;
		} catch {
			// No file: the switch was not honoured. The pane will say so.
		}
		const agentBrowser = await new Promise<boolean>((resolve) => {
			execFile(
				"agent-browser",
				["--version"],
				{ shell: process.platform === "win32", timeout: 5000 },
				(error) => resolve(!error),
			);
		});
		this.endpoint = { cdp, agentBrowser };
		return this.endpoint;
	}

	async open(url: string): Promise<IpcResult<BrowserInfo>> {
		const host = this.window();
		if (!host) return fail({ kind: "io", message: "no window" });
		const id = this.nextId++;
		const view = new WebContentsView({
			webPreferences: { sandbox: true, contextIsolation: true },
		});
		this.views.set(id, view);
		host.contentView.addChildView(view);
		// Off screen until the pane says where it is; a view at 0,0 would cover
		// the tab strip for a frame.
		view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

		const report = () => this.onState(this.info(id, view));
		const contents = view.webContents;
		contents.on("did-navigate", report);
		contents.on("did-navigate-in-page", report);
		contents.on("page-title-updated", report);
		contents.on("did-start-loading", report);
		contents.on("did-stop-loading", report);
		// A page that opens a window gets a navigation instead; one pane, one page.
		contents.setWindowOpenHandler(({ url: target }) => {
			void contents.loadURL(target);
			return { action: "deny" };
		});

		try {
			await contents.loadURL(url);
		} catch {
			// A failed first load still leaves a usable pane; the URL bar shows
			// where it was going and the state event says it stopped loading.
		}
		const info = this.info(id, view);
		this.onState(info);
		// Binding takes a few round trips through agent-browser; the pane shows
		// the page meanwhile and learns the session name when it lands.
		void this.bind(id, view).then(() => this.onState(this.info(id, view)));
		return ok(info);
	}

	/**
	 * Points an agent-browser session at this view's tab, so an agent using that
	 * session drives this pane and nothing else. Without it agent-browser acts
	 * on whichever tab Chromium calls active — which is the app's own window
	 * as often as not, and an agent would navigate the app away from itself.
	 *
	 * The view is found among the targets by a title stamped on it, then the
	 * session is switched to it, which the session remembers.
	 *
	 * ponytail: a `--pin-tab` flag would make the binding strict, so a closed
	 * tab fails loudly instead of falling through to a neighbour. It landed
	 * after 0.27, the version this was written against, and asking for it there
	 * is an "Unknown command". Add it once the floor moves.
	 */
	private async bind(id: number, view: WebContentsView): Promise<void> {
		const { cdp, agentBrowser } = await this.describe();
		if (!cdp || !agentBrowser) return;
		const marker = `asdf-browser-${id}`;
		const session = marker;
		try {
			await view.webContents.executeJavaScript(
				`document.title = ${JSON.stringify(marker)}`,
			);
			const raw = await agent([
				"--cdp",
				cdp,
				"--session",
				session,
				"tab",
				"list",
				"--json",
			]);
			const listed = JSON.parse(raw) as {
				data?: { tabs?: { tabId: string; title: string }[] };
			};
			const tab = listed.data?.tabs?.find((item) => item.title === marker);
			if (!tab) {
				console.warn(`browser ${id}: no tab titled ${marker} to bind to`);
				return;
			}
			await agent([
				"--cdp",
				cdp,
				"--session",
				session,
				"tab",
				tab.tabId,
				"--json",
			]);
			this.sessions.set(id, session);
		} catch (thrown) {
			// Left unbound: the pane falls back to telling the agent how to find
			// the tab itself. Say why, since nothing else will.
			console.warn(`browser ${id}: binding failed:`, thrown);
		} finally {
			// The marker did its job; the page's own title takes over on the next
			// navigation, and until then the tab is named by its URL.
			await view.webContents
				.executeJavaScript("document.title = ''")
				.catch(() => undefined);
		}
	}

	/** Moves the view to where the pane is, in window coordinates. */
	place(
		id: number,
		bounds: { x: number; y: number; width: number; height: number },
	): IpcResult<null> {
		const view = this.views.get(id);
		if (!view) return fail(noSuchBrowser(id));
		const width = Math.max(0, Math.round(bounds.width));
		const height = Math.max(0, Math.round(bounds.height));
		view.setBounds({
			x: Math.round(bounds.x),
			y: Math.round(bounds.y),
			width,
			height,
		});
		// A pane whose tab is not the one showing reports no size at all, which is
		// how it asks to be put away. Remembered, so uncovering can tell the two
		// apart.
		this.shown.set(id, width > 0 && height > 0);
		view.setVisible(!this.covered && width > 0 && height > 0);
		return ok(null);
	}

	/**
	 * Hides every view while the renderer needs the pointer — a tab being
	 * dragged, whose drop zones are DOM underneath these.
	 *
	 * Uncovering restores what each view was doing, not blanket visibility: a
	 * pane parked behind another tab asked to be hidden and is still asking.
	 */
	cover(hidden: boolean): void {
		this.covered = hidden;
		for (const [id, view] of this.views)
			view.setVisible(!hidden && (this.shown.get(id) ?? false));
	}

	navigate(id: number, url: string): IpcResult<null> {
		const view = this.views.get(id);
		if (!view) return fail(noSuchBrowser(id));
		void view.webContents.loadURL(url).catch(() => undefined);
		return ok(null);
	}

	go(id: number, where: "back" | "forward" | "reload"): IpcResult<null> {
		const view = this.views.get(id);
		if (!view) return fail(noSuchBrowser(id));
		const nav = view.webContents.navigationHistory;
		if (where === "back" && nav.canGoBack()) nav.goBack();
		else if (where === "forward" && nav.canGoForward()) nav.goForward();
		else if (where === "reload") view.webContents.reload();
		return ok(null);
	}

	close(id: number): IpcResult<null> {
		const view = this.views.get(id);
		if (view) {
			this.views.delete(id);
			this.shown.delete(id);
			this.window()?.contentView.removeChildView(view);
			view.webContents.close();
		}
		// The session's daemon is left to its own idle timeout rather than told
		// to close: over CDP, `close` can mean the whole browser — this app.
		// ponytail: one daemon lingers per closed pane for up to an hour.
		this.sessions.delete(id);
		return ok(null);
	}

	/** Ends every view, so quitting leaves no page behind. */
	closeAll(): void {
		for (const id of [...this.views.keys()]) this.close(id);
	}

	private info(id: number, view: WebContentsView): BrowserInfo {
		const contents = view.webContents;
		return {
			id,
			url: contents.getURL(),
			title: contents.getTitle(),
			canGoBack: contents.navigationHistory.canGoBack(),
			canGoForward: contents.navigationHistory.canGoForward(),
			loading: contents.isLoading(),
			session: this.sessions.get(id) ?? null,
		};
	}
}

/**
 * Runs agent-browser once and returns what it printed.
 *
 * Settled on the process exiting, not on its output closing: the first call
 * starts a daemon that inherits the pipes and keeps them open, so waiting for
 * end-of-stream would wait for the daemon instead.
 */
function agent(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("agent-browser", args, {
			shell: process.platform === "win32",
			windowsHide: true,
			timeout: 30000,
		});
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			// A tick for the last chunk to land before the pipe is abandoned.
			setTimeout(() => {
				if (code === 0) resolve(stdout);
				// No code and a signal means the timeout above killed it, which
				// once read as "exited null" and sent us looking for a fault in
				// agent-browser that was ours.
				else if (code === null)
					reject(new Error(`agent-browser timed out after 30s (${signal})`));
				else reject(new Error(`agent-browser exited ${code}: ${stdout}`));
			}, 50);
		});
	});
}

function noSuchBrowser(id: number) {
	return { kind: "io" as const, message: `no browser ${id}` };
}
