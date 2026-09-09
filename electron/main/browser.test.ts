import { beforeEach, describe, expect, it, vi } from "vitest";

/** One fake WebContentsView, recording what the registry does to it. */
type Fake = {
	bounds: { x: number; y: number; width: number; height: number };
	visible: boolean;
	closed: boolean;
};

const views: Fake[] = [];

vi.mock("electron", () => {
	class WebContentsView {
		bounds = { x: 0, y: 0, width: 0, height: 0 };
		visible = false;
		closed = false;
		webContents = {
			on: () => {},
			setWindowOpenHandler: () => {},
			loadURL: () => Promise.resolve(),
			getURL: () => "about:blank",
			getTitle: () => "",
			isLoading: () => false,
			navigationHistory: { canGoBack: () => false, canGoForward: () => false },
			executeJavaScript: () => Promise.resolve(),
			close: () => {
				this.closed = true;
			},
		};
		setBounds(next: Fake["bounds"]) {
			this.bounds = next;
		}
		setVisible(next: boolean) {
			this.visible = next;
		}
		constructor() {
			views.push(this as unknown as Fake);
		}
	}
	return {
		WebContentsView,
		app: {
			// No DevToolsActivePort to read, so the registry finds no CDP endpoint
			// and never tries to bind an agent session.
			getPath: () => "/definitely/not/a/profile/directory",
		},
	};
});

vi.mock("node:child_process", () => ({
	execFile: (_cmd: string, _args: string[], _opts: unknown, done: unknown) => {
		(done as (error: Error) => void)(new Error("not installed"));
	},
	spawn: () => {
		throw new Error("not installed");
	},
}));

const { Browsers } = await import("./browser");

const window = () =>
	({
		contentView: { addChildView: () => {}, removeChildView: () => {} },
	}) as never;

const rect = (width: number, height: number) => ({
	x: 10,
	y: 20,
	width,
	height,
});

beforeEach(() => {
	views.length = 0;
});

async function twoBrowsers() {
	const browsers = new Browsers(window, () => {});
	const first = await browsers.open("about:blank");
	const second = await browsers.open("about:blank");
	if (!first.ok || !second.ok) throw new Error("open failed");
	return { browsers, first: first.value.id, second: second.value.id };
}

describe("Browsers", () => {
	it("shows a view once its pane says where it is", async () => {
		const { browsers, first } = await twoBrowsers();
		expect(views[0].visible).toBe(false);

		browsers.place(first, rect(400, 300));
		expect(views[0].visible).toBe(true);
		expect(views[0].bounds).toEqual({ x: 10, y: 20, width: 400, height: 300 });
	});

	it("puts a view away when its pane reports no size", async () => {
		const { browsers, first } = await twoBrowsers();
		browsers.place(first, rect(400, 300));
		browsers.place(first, rect(0, 0));
		expect(views[0].visible).toBe(false);
	});

	/**
	 * The pane re-reports its rectangle every quarter second, to catch moves a
	 * ResizeObserver does not see. That must not undo a cover: it did, and the
	 * drag it was covering for lost its drop zones a tenth of a second in — the
	 * highlight appeared and then the native view was back over it.
	 */
	it("stays hidden while covered, however often the pane reports in", async () => {
		const { browsers, first } = await twoBrowsers();
		browsers.place(first, rect(400, 300));

		browsers.cover(true);
		expect(views[0].visible).toBe(false);

		browsers.place(first, rect(400, 300));
		expect(views[0].visible).toBe(false);
	});

	it("uncovers only the views their own panes wanted shown", async () => {
		const { browsers, first, second } = await twoBrowsers();
		// One pane is showing; the other sits behind a tab and asked to be hidden.
		browsers.place(first, rect(400, 300));
		browsers.place(second, rect(0, 0));

		browsers.cover(true);
		browsers.cover(false);

		expect(views[0].visible).toBe(true);
		expect(views[1].visible).toBe(false);
	});

	it("closing a view ends its page and forgets it", async () => {
		const { browsers, first } = await twoBrowsers();
		browsers.place(first, rect(400, 300));
		browsers.close(first);

		expect(views[0].closed).toBe(true);
		// Gone from the registry: nothing can place it or uncover it afterwards.
		expect(browsers.place(first, rect(400, 300))).toMatchObject({ ok: false });
	});
});
