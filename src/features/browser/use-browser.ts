import { type RefObject, useEffect, useState } from "react";
import {
	BROWSER_STATE_EVENT,
	type BrowserEndpoint,
	type BrowserInfo,
} from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { platform } from "@/ipc/platform";

/**
 * Keeps a main-process browser view over `host`, and follows its page.
 *
 * The view is native and knows nothing of the DOM, so this is what tells it
 * where the pane is: every time the host moves or resizes, its rectangle goes
 * to the main process. Hiding is the same message with no size, which is what
 * happens when the tab is not the one showing.
 */
export function useBrowser(
	browserId: number,
	host: RefObject<HTMLDivElement | null>,
	visible: boolean,
) {
	const [info, setInfo] = useState<BrowserInfo | null>(null);
	const [endpoint, setEndpoint] = useState<BrowserEndpoint | null>(null);

	useEffect(() => {
		void ipc.browserEndpoint().then((result) => {
			if (result.ok) setEndpoint(result.value);
		});
	}, []);

	useEffect(() => {
		const off = platform.listen<BrowserInfo>(BROWSER_STATE_EVENT, (event) => {
			if (event.payload.id === browserId) setInfo(event.payload);
		});
		return () => {
			void off.then((unlisten) => unlisten());
		};
	}, [browserId]);

	useEffect(() => {
		const element = host.current;
		if (!element || !visible) {
			void ipc.browserPlace(browserId, { x: 0, y: 0, width: 0, height: 0 });
			return;
		}
		const place = () => {
			const rect = element.getBoundingClientRect();
			void ipc.browserPlace(browserId, {
				x: rect.left,
				y: rect.top,
				width: rect.width,
				height: rect.height,
			});
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(element);
		// A sidebar toggling or a split resizing moves the host without resizing
		// it, which a ResizeObserver does not see.
		window.addEventListener("resize", place);
		const poll = setInterval(place, 250);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", place);
			clearInterval(poll);
		};
	}, [browserId, host, visible]);

	return { info, setInfo, endpoint };
}
