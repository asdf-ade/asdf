import { ArrowLeft, ArrowRight, Copy, RotateCw } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import { useBrowser } from "../use-browser";

type Props = {
	browserId: number;
	/** Whether this pane's tab is the one showing in its group. */
	visible: boolean;
	/** The page's title, for the tab; the strip cannot read a native view. */
	onTitle: (title: string) => void;
};

/** A page with no title yet is named by where it is. */
function hostOf(url: string | undefined): string {
	if (!url || url === "about:blank") return "";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** Turns what a person types into something a browser will load. */
function toUrl(typed: string): string {
	const text = typed.trim();
	if (/^[a-z]+:\/\//i.test(text)) return text;
	if (/^localhost(:\d+)?(\/|$)/.test(text) || /^\d+\.\d+\.\d+\.\d+/.test(text))
		return `http://${text}`;
	return `https://${text}`;
}

export function BrowserPane({ browserId, visible, onTitle }: Props) {
	const { t } = useTranslation();
	const host = useRef<HTMLDivElement | null>(null);
	const { info, endpoint } = useBrowser(browserId, host, visible);
	const [typed, setTyped] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const title = info?.title || hostOf(info?.url);
	useEffect(() => {
		onTitle(title);
	}, [title, onTitle]);

	const address = typed ?? info?.url ?? "";
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (typed !== null) void ipc.browserNavigate(browserId, toUrl(typed));
		setTyped(null);
	};

	// The one line an agent needs to reach this page. The app has already
	// pinned an agent-browser session to this pane's tab, so naming the
	// session is all it takes; without `--session` agent-browser acts on
	// whichever tab is active, which can be the app's own window.
	const hint = info?.session
		? `agent-browser --session ${info.session} snapshot`
		: endpoint?.cdp
			? `agent-browser --cdp ${endpoint.cdp} tab list --json`
			: null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<form
				onSubmit={submit}
				className="flex h-8 shrink-0 items-center gap-1 border-b px-1"
			>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					aria-label={t("browser.back")}
					disabled={!info?.canGoBack}
					onClick={() => void ipc.browserGo(browserId, "back")}
					className="size-6"
				>
					<ArrowLeft className="size-3.5" />
				</Button>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					aria-label={t("browser.forward")}
					disabled={!info?.canGoForward}
					onClick={() => void ipc.browserGo(browserId, "forward")}
					className="size-6"
				>
					<ArrowRight className="size-3.5" />
				</Button>
				<Button
					type="button"
					size="icon"
					variant="ghost"
					aria-label={t("browser.reload")}
					onClick={() => void ipc.browserGo(browserId, "reload")}
					className="size-6"
				>
					<RotateCw
						className={info?.loading ? "size-3.5 animate-spin" : "size-3.5"}
					/>
				</Button>
				<input
					value={address}
					onChange={(event) => setTyped(event.target.value)}
					onBlur={() => setTyped(null)}
					onFocus={(event) => event.target.select()}
					placeholder={t("browser.address")}
					spellCheck={false}
					className="h-6 min-w-0 flex-1 rounded-md bg-muted px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
				/>
			</form>

			{/* The native view is placed over this element by the main process; it
			    draws nothing itself. What it shows while empty is what a person sees
			    before the page paints. */}
			<div ref={host} className="min-h-0 flex-1 bg-background" />

			{/* How the agent gets in. One line to copy, or what to install first. */}
			<div className="flex h-7 shrink-0 items-center gap-2 border-t px-2 text-[11px] text-muted-foreground">
				{endpoint && !endpoint.agentBrowser ? (
					<span className="truncate">{t("browser.missing")}</span>
				) : hint ? (
					<>
						<span className="shrink-0">{t("browser.connect")}</span>
						<code className="min-w-0 flex-1 truncate font-mono">{hint}</code>
						<Button
							type="button"
							size="icon"
							variant="ghost"
							aria-label={t("browser.copy")}
							onClick={() => {
								void navigator.clipboard.writeText(hint);
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							}}
							className="size-5 shrink-0"
						>
							<Copy className="size-3" />
						</Button>
						{copied && <span className="shrink-0">{t("browser.copied")}</span>}
					</>
				) : (
					<span className="truncate">{t("browser.noCdp")}</span>
				)}
			</div>
		</div>
	);
}
