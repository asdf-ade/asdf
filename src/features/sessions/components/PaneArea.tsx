import {
	Check,
	CircleDot,
	GitBranch,
	GitPullRequest,
	Globe,
	type LucideIcon,
	Plus,
	Undo2,
	X,
} from "lucide-react";
import {
	type DragEvent,
	Fragment,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import { cn } from "@/lib/utils";
import type { DropTarget, Side } from "../panes";
import type {
	DiffRow,
	Issue,
	Pane,
	PullRequest,
	RepoSnapshot,
	ReviewState,
	Session,
} from "../types";
import { DiffView, SourceView } from "./CodeView";

/** The dataTransfer type a dragged tab travels as. */
const PANE_MIME = "application/x-asdf-pane";

// Only the tabs whose label is a bare number need saying what they are; a
// terminal's or a file's name already does.
const tabIcon: Partial<Record<Pane["kind"], LucideIcon>> = {
	issue: CircleDot,
	pull: GitPullRequest,
	browser: Globe,
};

function tabLabel(
	pane: Pane,
	sessions: Session[],
	browserTitle: (browserId: number) => string,
): string {
	switch (pane.kind) {
		case "session":
			return sessions.find((item) => item.id === pane.sessionId)?.title ?? "";
		case "file":
			return pane.path.split("/").pop() ?? pane.path;
		case "browser":
			return browserTitle(pane.browserId);
		default:
			return `#${pane.number}`;
	}
}

/**
 * Which edge of the body the pointer is nearest, as a share of the body's
 * size. Every point maps to a side, so the whole half towards an edge is that
 * edge's drop zone — no thin strip to hit.
 */
function sideAt(x: number, y: number, width: number, height: number): Side {
	const dx = x / width - 0.5;
	const dy = y / height - 0.5;
	if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
	return dy < 0 ? "top" : "bottom";
}

/** Whether the pointer is in the left half of the element it is over. */
function nearHalf(event: DragEvent): boolean {
	const rect = event.currentTarget.getBoundingClientRect();
	return event.clientX < rect.left + rect.width / 2;
}

const halfOf: Record<Side, string> = {
	left: "inset-y-0 left-0 w-1/2",
	right: "inset-y-0 right-0 w-1/2",
	top: "inset-x-0 top-0 h-1/2",
	bottom: "inset-x-0 bottom-0 h-1/2",
};

type Props = {
	panes: Pane[];
	sessions: Session[];
	/** What the panel knows about the folder on screen, for file and GitHub
	 *  tabs; they were opened from it. */
	repo: RepoSnapshot | null;
	issues: Issue[];
	pulls: PullRequest[];
	reviewOf: (file: string) => ReviewState;
	onReview: (file: string, state: ReviewState) => void;
	activeId: string;
	/** Which group this is, and whether it is the one new tabs open in. */
	groupId: string;
	focused: boolean;
	onFocusGroup: () => void;
	onFocus: (id: string) => void;
	onClose: (id: string) => void;
	/** `+`: asks what the new tab should be. */
	onNewTab: () => void;
	/** A tab is being dragged somewhere in the window, so show where it can
	 *  land. */
	dragging: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	onDrop: (paneId: string, target: DropTarget) => void;
	/** The shell's buttons at either end of the strip: panel toggles, and the
	 *  window's caption buttons where the OS does not draw its own. */
	leading?: ReactNode;
	trailing?: ReactNode;
	/** Owned by the terminal work. Rendered for the open session tab. */
	renderAgent: (session: Session) => ReactNode;
	/** Owned by the browser work. Rendered for a browser tab; `visible` says
	 *  whether it is the showing one, since a native view must be hidden by
	 *  hand. */
	renderBrowser: (browserId: number, visible: boolean) => ReactNode;
	/** What a browser tab is called: its page title, once it has one. */
	browserTitle: (browserId: number) => string;
};

export function PaneArea({
	panes,
	sessions,
	repo,
	issues,
	pulls,
	reviewOf,
	onReview,
	activeId,
	groupId,
	focused,
	onFocusGroup,
	onFocus,
	onClose,
	onNewTab,
	dragging,
	onDragStart,
	onDragEnd,
	onDrop,
	leading,
	trailing,
	renderAgent,
	renderBrowser,
	browserTitle,
}: Props) {
	const { t } = useTranslation();
	const active = panes.find((pane) => pane.id === activeId) ?? panes[0];
	const sessionId =
		active && active.kind !== "issue" && active.kind !== "pull"
			? active.sessionId
			: undefined;
	const session = sessions.find((item) => item.id === sessionId);
	const [over, setOver] = useState<Side | null>(null);
	// Where in this strip a dropped tab would land, while one is in the air.
	const [at, setAt] = useState<number | null>(null);

	// A drag that ended anywhere leaves no highlight behind, including one that
	// ended over a different group than the one showing it.
	useEffect(() => {
		if (!dragging) {
			setOver(null);
			setAt(null);
		}
	}, [dragging]);

	const accept = (event: DragEvent) => {
		if (!dragging) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
	};
	const dropped = (event: DragEvent, target: DropTarget) => {
		event.preventDefault();
		setOver(null);
		setAt(null);
		const id = event.dataTransfer.getData(PANE_MIME);
		if (id) onDrop(id, target);
	};
	// Where in the body the pointer is decides the side; the highlight follows.
	const sideOf = (event: DragEvent) => {
		const rect = event.currentTarget.getBoundingClientRect();
		return sideAt(
			event.clientX - rect.left,
			event.clientY - rect.top,
			rect.width,
			rect.height,
		);
	};

	// Browser tabs that are not showing keep their native view hidden; the
	// showing one is placed over its body.
	const browsers = panes.filter(
		(pane): pane is Extract<Pane, { kind: "browser" }> =>
			pane.kind === "browser",
	);

	// Nothing open: the one thing to do is start a terminal.
	const empty = (
		<div className="flex flex-1 items-center justify-center">
			<Button
				variant="ghost"
				size="sm"
				onClick={onNewTab}
				className="h-7 gap-1.5 text-muted-foreground text-xs"
			>
				<Plus className="size-3.5" />
				{t("session.newSession")}
			</Button>
		</div>
	);

	return (
		<div
			onPointerDownCapture={onFocusGroup}
			className="flex min-w-0 flex-1 flex-col"
		>
			{/* One strip of tabs, browser-style: a tab is a session, a file, an issue
			    or a pull request, and the + at the end starts another. It stays on
			    screen with no tabs so the + is always reachable. Tabs share the
			    strip the way a browser's do: equal widths up to a cap, shrinking
			    together as more open, never scrolling. Dropping a tab on the strip
			    moves it into this group. */}
			<div
				role="tablist"
				onDragOver={(event) => {
					accept(event);
					// Only the space past the last tab reaches here: a tab stops the
					// event to say where in the order the pointer is.
					if (dragging) setAt(panes.length);
				}}
				onDragLeave={() => setAt(null)}
				onDrop={(event) =>
					dropped(event, { group: groupId, index: at ?? undefined })
				}
				className="drag-region flex h-9 shrink-0 items-stretch overflow-hidden border-b bg-muted/40"
			>
				{leading}
				{panes.map((pane, index) => (
					<Fragment key={pane.id}>
						{at === index && <Caret />}
						<Tab
							pane={pane}
							label={tabLabel(pane, sessions, browserTitle)}
							active={pane.id === active?.id}
							focused={focused}
							onFocus={() => onFocus(pane.id)}
							onClose={() => onClose(pane.id)}
							dragging={dragging}
							onDragStart={onDragStart}
							onDragEnd={onDragEnd}
							onOver={(before) => setAt(before ? index : index + 1)}
							onDropAt={(event, before) =>
								dropped(event, {
									group: groupId,
									index: before ? index : index + 1,
								})
							}
						/>
					</Fragment>
				))}
				{at === panes.length && <Caret />}

				{/* One control, whatever the tab turns out to be: it asks. */}
				<Button
					size="icon"
					variant="ghost"
					aria-label={t("session.newTab.title")}
					title={t("session.newTab.title")}
					onClick={onNewTab}
					className="my-1.5 ml-1 size-6 shrink-0"
				>
					<Plus className="size-3.5" />
				</Button>
				{trailing && <div className="ml-auto flex shrink-0">{trailing}</div>}
			</div>

			<div className="relative flex min-h-0 flex-1 flex-col">
				{!active ? (
					empty
				) : active.kind === "issue" ? (
					<IssueBody
						issue={issues.find((item) => item.number === active.number)}
					/>
				) : active.kind === "pull" ? (
					<PullBody
						pull={pulls.find((item) => item.number === active.number)}
					/>
				) : active.kind === "browser" ? null : !session ? (
					empty
				) : active.kind === "session" ? (
					<SessionBody>{renderAgent(session)}</SessionBody>
				) : (
					<FileBody
						key={active.id}
						dir={active.dir}
						path={active.path}
						repo={repo}
						reviewOf={reviewOf}
						onReview={onReview}
					/>
				)}

				{/* Every browser tab stays mounted so its view keeps its page; only
				    the showing one is placed, the rest are parked off screen. */}
				{browsers.map((pane) => (
					<div
						key={pane.id}
						className={cn(
							"absolute inset-0 flex flex-col",
							pane.id !== active?.id && "hidden",
						)}
					>
						{renderBrowser(pane.browserId, pane.id === active?.id)}
					</div>
				))}

				{/* While a tab is in the air the whole body is a landing zone. The
				    half of it nearest the pointer is the side the new group opens on,
				    and is lit so the drop is never a guess. */}
				{dragging && (
					// A landing zone, not a control: nothing to focus or press.
					<button
						type="button"
						tabIndex={-1}
						aria-hidden="true"
						onDragOver={(event) => {
							accept(event);
							if (dragging) setOver(sideOf(event));
						}}
						onDragLeave={() => setOver(null)}
						onDrop={(event) =>
							dropped(event, { split: groupId, side: sideOf(event) })
						}
						className="absolute inset-0 z-10"
					>
						{over && (
							<span
								className={cn(
									"pointer-events-none absolute bg-ring/20 transition-all",
									halfOf[over],
								)}
							/>
						)}
					</button>
				)}
			</div>
		</div>
	);
}

/** Where a dropped tab would go, drawn in the gap it would take. */
function Caret() {
	return <span className="my-1 w-0.5 shrink-0 rounded-full bg-ring" />;
}

function Tab({
	pane,
	label,
	active,
	focused,
	onFocus,
	onClose,
	dragging,
	onDragStart,
	onDragEnd,
	onOver,
	onDropAt,
}: {
	pane: Pane;
	label: string;
	active: boolean;
	focused: boolean;
	onFocus: () => void;
	onClose: () => void;
	dragging: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	/** True for the near half of the tab, which means "land before this one". */
	onOver: (before: boolean) => void;
	onDropAt: (event: DragEvent, before: boolean) => void;
}) {
	const { t } = useTranslation();
	const Icon = tabIcon[pane.kind];

	return (
		// The active tab is the page's top edge: same fill, and a hairline of
		// it laid over the strip's border so the two read as one surface. A
		// container so the close button can hide once the tab is squeezed.
		<span
			role="tab"
			aria-selected={active}
			tabIndex={active ? 0 : -1}
			draggable
			onDragStart={(event) => {
				event.dataTransfer.setData(PANE_MIME, pane.id);
				event.dataTransfer.effectAllowed = "move";
				onDragStart();
			}}
			onDragEnd={onDragEnd}
			// The half of the tab the pointer is in decides which side of it the
			// dragged one lands on. Kept from the strip, whose own handler speaks
			// for the empty space past the last tab and would say "the end".
			onDragOver={(event) => {
				if (!dragging) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "move";
				onOver(nearHalf(event));
			}}
			onDrop={(event) => {
				event.stopPropagation();
				onDropAt(event, nearHalf(event));
			}}
			className={cn(
				"@container relative flex min-w-8 max-w-52 flex-1 basis-0 items-center gap-1 border-r pr-2 pl-2.5",
				active
					? "bg-background after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
					: "text-muted-foreground hover:bg-background/50 hover:text-foreground",
				// The showing tab of a group that is not the focused one steps back,
				// so the group the next tab opens in is the one that reads bold.
				active && !focused && "text-muted-foreground",
			)}
		>
			<button
				type="button"
				onClick={onFocus}
				className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]"
			>
				{Icon && <Icon className="size-3.5 shrink-0" />}
				<span className="truncate">{label}</span>
			</button>
			{/* Squeezed inactive tabs give the space to their name; the active
			    tab keeps its close button, as the one you are most likely to
			    close. */}
			<Button
				size="icon"
				variant="ghost"
				aria-label={t("session.pane.close")}
				onClick={onClose}
				className={cn("size-5 shrink-0", !active && "hidden @[5rem]:flex")}
			>
				<X className="size-3" />
			</Button>
		</span>
	);
}

function SessionBody({ children }: { children: ReactNode }) {
	// No toolbar: the tab names the session and the status bar carries the
	// branch, so a third row would only repeat them. A one-cell grid, not a
	// block: the terminal positions its children absolutely and needs the
	// slot to give it a height.
	return <div className="grid min-h-0 flex-1 overflow-hidden">{children}</div>;
}

/** Repository-relative name of a file opened from `dir`, or null when the
 *  file is outside the repository (or there is none). */
function inRepo(root: string | null, dir: string, path: string): string | null {
	if (!root) return null;
	const full = `${dir}/${path}`;
	return full.startsWith(`${root}/`) ? full.slice(root.length + 1) : null;
}

function FileBody({
	dir,
	path,
	repo,
	reviewOf,
	onReview,
}: {
	dir: string;
	path: string;
	repo: RepoSnapshot | null;
	reviewOf: (file: string) => ReviewState;
	onReview: (file: string, state: ReviewState) => void;
}) {
	const { t } = useTranslation();
	const [rows, setRows] = useState<DiffRow[] | null>(null);
	const [source, setSource] = useState<string[] | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	const root = repo?.root ?? null;
	const file = inRepo(root, dir, path);
	const changed = file
		? repo?.changes.find((item) => item.path === file)
		: undefined;
	const asDiff = !!changed && changed.kind !== "deleted";
	// A change is read as a diff; anything else as itself. One string names
	// the read, so a new snapshot with the same numbers re-reads nothing.
	const request = JSON.stringify(
		asDiff && root && file
			? { diff: [root, file], at: [changed.added, changed.removed] }
			: { read: [dir, path] },
	);

	useEffect(() => {
		let alive = true;
		setFailure(null);
		const wanted = JSON.parse(request) as {
			diff?: [string, string];
			read?: [string, string];
		};
		void (async () => {
			if (wanted.diff) {
				const result = await ipc.repoDiff(...wanted.diff);
				if (!alive) return;
				if (result.ok) setRows(result.value);
				else setFailure(result.error.message);
			} else if (wanted.read) {
				const result = await ipc.repoRead(...wanted.read);
				if (!alive) return;
				if (result.ok) setSource(result.value);
				else setFailure(result.error.message);
			}
		})();
		return () => {
			alive = false;
		};
	}, [request]);

	return (
		<>
			{changed && file && (
				<div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
					<span className="shrink-0 text-[11px] tabular-nums">
						<span className="text-emerald-600">+{changed.added}</span>{" "}
						<span className="text-destructive">-{changed.removed}</span>
					</span>
					<span className="ml-auto flex shrink-0 gap-1">
						<Button
							size="sm"
							variant="ghost"
							className="h-7 gap-1 text-xs"
							disabled={reviewOf(file) === "reviewed"}
							onClick={() => onReview(file, "reviewed")}
						>
							<Check className="size-3.5" />
							{t("session.changes.approve")}
						</Button>
						{/* Reverting puts the file back as git last saw it. */}
						<Button
							size="sm"
							variant="ghost"
							className="h-7 gap-1 text-xs"
							disabled={changed.kind === "added"}
							onClick={() => onReview(file, "reverted")}
						>
							<Undo2 className="size-3.5" />
							{t("session.changes.revert")}
						</Button>
					</span>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-auto">
				{failure ? (
					<p className="p-6 text-muted-foreground text-sm">{failure}</p>
				) : asDiff ? (
					rows && <DiffView rows={rows} />
				) : (
					source && <SourceView lines={source} />
				)}
			</div>
		</>
	);
}

// An issue or a pull request is a page you open and read, which is why it lands
// in a tab rather than in the narrow column that lists it.
function IssueBody({ issue }: { issue?: Issue }) {
	const { t } = useTranslation();
	if (!issue) return <Missing />;

	return (
		<Article
			number={issue.number}
			title={issue.title}
			meta={
				<>
					<Pill>{t(`github.state.${issue.state}`)}</Pill>
					<span>{issue.author}</span>
					{issue.labels.map((label) => (
						<Pill key={label}>{label}</Pill>
					))}
				</>
			}
			body={issue.body}
		/>
	);
}

function PullBody({ pull }: { pull?: PullRequest }) {
	const { t } = useTranslation();
	if (!pull) return <Missing />;

	return (
		<Article
			number={pull.number}
			title={pull.title}
			meta={
				<>
					<Pill>{t(`github.state.${pull.state}`)}</Pill>
					<span className="flex items-center gap-1">
						<GitBranch className="size-3" />
						<span className="font-mono">{pull.branch}</span>
					</span>
					<Pill>{t(`github.ci.${pull.ci}`)}</Pill>
					{pull.reviewer && <span>{pull.reviewer}</span>}
				</>
			}
			body={pull.body}
		/>
	);
}

function Article({
	number,
	title,
	meta,
	body,
}: {
	number: number;
	title: string;
	meta: ReactNode;
	body: string;
}) {
	return (
		<div className="min-h-0 flex-1 overflow-auto p-6">
			<div className="mx-auto max-w-2xl">
				<h2 className="font-medium text-lg">
					{title}{" "}
					<span className="text-muted-foreground tabular-nums">#{number}</span>
				</h2>
				<div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					{meta}
				</div>
				<p className="mt-4 whitespace-pre-wrap text-sm leading-6">{body}</p>
			</div>
		</div>
	);
}

function Pill({ children }: { children: ReactNode }) {
	return (
		<span className="rounded-full border px-1.5 py-0.5 text-[11px]">
			{children}
		</span>
	);
}

function Missing() {
	const { t } = useTranslation();

	return (
		<p className="p-6 text-muted-foreground text-sm">{t("github.missing")}</p>
	);
}
