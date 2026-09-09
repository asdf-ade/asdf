import { PanelLeft, PanelRight, Settings } from "lucide-react";
import {
	Fragment,
	type PointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

import { BrowserPane } from "@/features/browser/components/BrowserPane";
import { PaneArea } from "@/features/sessions/components/PaneArea";
import { SessionSidebar } from "@/features/sessions/components/SessionSidebar";
import { SidePanel } from "@/features/sessions/components/SidePanel";
import type { Layout } from "@/features/sessions/panes";
import type { Session } from "@/features/sessions/types";
import { useRepo } from "@/features/sessions/use-repo";
import { useSessions } from "@/features/sessions/use-sessions";
import { TerminalPane } from "@/features/terminal/components/TerminalPane";
import { useTerminalCwd } from "@/features/terminal/use-terminal-cwd";
import { UpdateChip } from "@/features/updater/components/UpdateChip";
import { UpdateDialog } from "@/features/updater/components/UpdateDialog";
import { useUpdater } from "@/features/updater/use-updater";
import { ipc } from "@/ipc/client";
import { platform } from "@/ipc/platform";
import { cn } from "@/lib/utils";
import { NewTabDialog, type TabKind } from "./NewTabDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { SettingsDialog, type Theme } from "./SettingsDialog";
import { useResizable } from "./use-resizable";

/**
 * The caption glyphs, drawn the way Windows draws its own: ten pixels, one
 * pixel of stroke, and the straight ones snapped to the pixel grid. An icon
 * font scaled down to this size lands on half pixels and blurs.
 */
const GLYPH = {
	minimize: (
		<path d="M0.5 5.5h9" stroke="currentColor" shapeRendering="crispEdges" />
	),
	maximize: (
		<rect
			x="0.5"
			y="0.5"
			width="9"
			height="9"
			fill="none"
			stroke="currentColor"
			shapeRendering="crispEdges"
		/>
	),
	close: <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" />,
} as const;

function WindowGlyph({ kind }: { kind: keyof typeof GLYPH }) {
	return (
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
			{GLYPH[kind]}
		</svg>
	);
}

/**
 * The caption buttons, drawn by us so minimise and maximise can hover grey
 * while close hovers red — the OS overlay only lets close change colour.
 * macOS keeps its traffic lights and never renders these.
 */
function WindowControls() {
	const { t } = useTranslation();
	return (
		<div className="flex self-stretch">
			<button
				type="button"
				aria-label={t("window.minimize")}
				onClick={platform.window.minimize}
				className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<WindowGlyph kind="minimize" />
			</button>
			<button
				type="button"
				aria-label={t("window.maximize")}
				onClick={platform.window.maximize}
				className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<WindowGlyph kind="maximize" />
			</button>
			<button
				type="button"
				aria-label={t("window.close")}
				onClick={platform.window.close}
				className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-red-600 hover:text-white"
			>
				<WindowGlyph kind="close" />
			</button>
		</div>
	);
}

/**
 * The layout tree on screen: a row lays its children side by side, a column
 * stacks them, a leaf is one group of tabs. A hairline sits between siblings.
 */
function LayoutView({
	layout,
	render,
}: {
	layout: Layout;
	render: (groupId: string) => ReactNode;
}) {
	if (layout.kind === "leaf") return <>{render(layout.group)}</>;
	const row = layout.direction === "row";
	return (
		<div className={cn("flex min-h-0 min-w-0 flex-1", !row && "flex-col")}>
			{layout.children.map((child, index) => (
				<Fragment
					key={
						child.kind === "leaf" ? child.group : `${index}:${child.direction}`
					}
				>
					{index > 0 && (
						<div className={cn("shrink-0 bg-border", row ? "w-px" : "h-px")} />
					)}
					<LayoutView layout={child} render={render} />
				</Fragment>
			))}
		</div>
	);
}

/** The hairline between two columns, and the grab zone either side of it. */
function ResizeHandle({
	onPointerDown,
}: {
	onPointerDown: (event: PointerEvent) => void;
}) {
	return (
		<div
			onPointerDown={onPointerDown}
			className="relative z-10 w-px shrink-0 cursor-col-resize bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:-right-1 hover:bg-ring"
		/>
	);
}

function PanelToggle({
	icon: Icon,
	label,
	onClick,
	className,
}: {
	icon: typeof PanelLeft;
	label: string;
	onClick: () => void;
	className?: string;
}) {
	return (
		<Button
			size="icon"
			variant="ghost"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={cn(
				"mx-1 my-1.5 size-6 shrink-0 text-muted-foreground",
				className,
			)}
		>
			<Icon className="size-3.5" />
		</Button>
	);
}

export function App() {
	const { t } = useTranslation();
	const updater = useUpdater();
	const sessions = useSessions();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [theme, setTheme] = useState<Theme>("system");
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [dragging, setDragging] = useState(false);
	// Which pty sits behind each terminal tab, so the panel can ask the OS
	// where that shell is. The tab on screen decides what the panel shows.
	const [ptys, setPtys] = useState<Record<string, number>>({});
	const bindPty = useCallback(
		(sessionId: string, id: number | null) =>
			setPtys((previous) => {
				if (id === null) {
					const { [sessionId]: _gone, ...rest } = previous;
					return rest;
				}
				return { ...previous, [sessionId]: id };
			}),
		[],
	);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [panelOpen, setPanelOpen] = useState(true);
	// Which group asked "+", so the answer opens there and not wherever focus
	// drifted while the dialog was up. Null when nothing is asking.
	const [newTabIn, setNewTabIn] = useState<string | null>(null);
	// What each browser tab is called, reported by the pane as its page
	// changes; the strip has no other way to know a native view's title.
	const [browserTitles, setBrowserTitles] = useState<Record<number, string>>(
		{},
	);
	// A page that has not said what it is yet is called what it is.
	const browserTitle = (browserId: number) =>
		browserTitles[browserId] || t("browser.title");

	// A browser pane is a native view laid over the window, so it draws above
	// every dialog and takes the pointer that was meant for one. The same is
	// true of a tab in the air, whose drop zones are DOM underneath. Both are
	// answered by putting the views away until the thing on top is done with.
	const overlay =
		dragging ||
		workspaceOpen ||
		settingsOpen ||
		updater.open ||
		newTabIn !== null;
	useEffect(() => {
		void ipc.browserCover(overlay);
	}, [overlay]);

	// The view is made first, so the tab it opens in never points at nothing.
	// It starts blank; the person or the agent decides where it goes.
	const openBrowser = useCallback(
		async (projectId: string) => {
			const opened = await ipc.browserOpen("about:blank");
			if (opened.ok) sessions.openBrowser(projectId, opened.value.id);
		},
		[sessions.openBrowser],
	);
	const [sidebarWidth, resizeSidebar] = useResizable(
		"sidebar",
		224,
		160,
		420,
		1,
	);
	const [panelWidth, resizePanel] = useResizable("panel", 256, 200, 520, -1);

	useEffect(() => {
		const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = theme === "dark" || (theme === "system" && !!media?.matches);
			document.documentElement.classList.toggle("dark", dark);
		};
		apply();
		// "System" has to keep following the OS after mount, not just read it once.
		media?.addEventListener("change", apply);
		return () => media?.removeEventListener("change", apply);
	}, [theme]);

	// Where a workspace's terminals start. Null for one that is only a name,
	// which leaves the shell to open wherever it would have.
	const folderOf = (projectId: string) =>
		sessions.projects.find((project) => project.id === projectId)?.path ?? null;

	const active = sessions.activeSession;
	const shellCwd = useTerminalCwd(active ? (ptys[active.id] ?? null) : null);
	// The shell's own answer wins, so the panel follows a `cd`. Where there is
	// no answer it falls back to the folder the workspace opens in — which on
	// Windows is every terminal, since a process there does not hand out its
	// working directory the way /proc and lsof do.
	const cwd = shellCwd ?? (active ? folderOf(active.projectId) : null);
	const repo = useRepo(cwd);

	// Where the caption buttons go. Only the platforms whose OS draws none:
	// on macOS the traffic lights are the window's own, on the left.
	const panelHoldsControls = !platform.isMac && panelOpen;

	// Sessions are numbered within their workspace, the way a shell numbers its
	// own windows, so a name is never asked for. Written here rather than kept
	// on the session, so switching language renames them.
	const sessionTitle = (session: Session) =>
		t("session.terminalTitle", { n: session.ordinal });

	// A workspace opens empty and its "+" fills it. With no workspace yet, "+"
	// makes one first.
	const newWorkspace = () => setWorkspaceOpen(true);

	// What "+" resolves to once the dialog answers. A terminal is a session, so
	// asking for one opens another window of the same workspace rather than a
	// second terminal in this one.
	const openTab = (kind: TabKind) => {
		const projectId = sessions.activeProjectId;
		if (!projectId) return;
		if (newTabIn) sessions.focusGroup(newTabIn);
		if (kind === "terminal") {
			sessions.createSession(projectId);
			return;
		}
		void openBrowser(projectId);
	};

	const versionLabel =
		updater.state.status === "checking"
			? t("update.footer.checking")
			: updater.state.status === "upToDate"
				? `v${__APP_VERSION__} · ${t("update.footer.upToDate")}`
				: `v${__APP_VERSION__}`;

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<div className="flex min-h-0 flex-1">
				{/* Settings sits at the foot of the sidebar, out of the way of the work. */}
				{sidebarOpen && (
					<div
						style={{ width: sidebarWidth }}
						className="flex shrink-0 flex-col bg-muted/30"
					>
						{/* Top row of the window. On macOS the traffic lights sit in its
						    left end, so the name starts past them. */}
						<div
							className={cn(
								"drag-region flex h-9 shrink-0 items-center px-3",
								platform.isMac && "pl-[88px]",
							)}
						>
							<span className="font-medium text-xs">{t("app.title")}</span>
						</div>

						<SessionSidebar
							projects={sessions.projects}
							sessions={sessions.sessions}
							browsers={sessions.browsers}
							sessionTitle={sessionTitle}
							browserTitle={browserTitle}
							activeProjectId={sessions.activeProjectId}
							activeSessionId={sessions.activeSessionId}
							activePaneId={sessions.activeId}
							onSelectProject={sessions.selectProject}
							onOpenSession={sessions.openSession}
							onOpenBrowser={sessions.openBrowser}
							onNewWorkspace={newWorkspace}
							onRemoveWorkspace={sessions.removeWorkspace}
						/>

						<div className="shrink-0 p-1.5">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setSettingsOpen(true)}
								className="h-7 w-full justify-start gap-2 px-2 text-muted-foreground text-xs"
							>
								<Settings className="size-3.5" />
								{t("settings.title")}
							</Button>
						</div>
					</div>
				)}
				{sidebarOpen && <ResizeHandle onPointerDown={resizeSidebar} />}

				{/* One PaneArea per leaf of the layout tree. The panel toggles and
				    caption buttons belong to the window, so only the first and last
				    strips on screen carry them. */}
				<div className="flex min-w-0 flex-1">
					<LayoutView
						layout={sessions.layout}
						render={(groupId) => {
							const group = sessions.paneGroups.find((g) => g.id === groupId);
							if (!group) return null;
							const order = sessions.groupOrder;
							const first = order[0] === group.id;
							const last = order[order.length - 1] === group.id;
							return (
								<PaneArea
									panes={group.panes}
									sessions={sessions.sessions}
									repo={repo.snapshot}
									issues={repo.issues}
									pulls={repo.pulls}
									reviewOf={repo.reviewOf}
									onReview={(file, state) => void repo.review(file, state)}
									activeId={group.activeId}
									groupId={group.id}
									focused={group.id === sessions.activeGroupId}
									onFocusGroup={() => sessions.focusGroup(group.id)}
									onFocus={sessions.focusPane}
									onClose={sessions.closePane}
									onNewTab={() => {
										if (!sessions.activeProject) return newWorkspace();
										setNewTabIn(group.id);
									}}
									dragging={dragging}
									onDragStart={() => setDragging(true)}
									onDragEnd={() => setDragging(false)}
									onDrop={(paneId, target) => {
										setDragging(false);
										sessions.movePane(paneId, target);
									}}
									renderAgent={(session) => (
										<TerminalPane
											cwd={folderOf(session.projectId)}
											onSession={(id) => bindPty(session.id, id)}
										/>
									)}
									renderBrowser={(browserId, visible) => (
										<BrowserPane
											browserId={browserId}
											visible={visible}
											onTitle={(title) =>
												setBrowserTitles((previous) =>
													previous[browserId] === title
														? previous
														: { ...previous, [browserId]: title },
												)
											}
										/>
									)}
									sessionTitle={sessionTitle}
									browserTitle={browserTitle}
									// With the sidebar closed the strip is the window's left edge,
									// and on macOS the traffic lights sit there.
									leading={
										first && (
											<div
												className={cn(
													"flex shrink-0",
													!sidebarOpen &&
														(platform.isMac ? "pl-[88px]" : "pl-1.5"),
												)}
											>
												<PanelToggle
													icon={PanelLeft}
													label={t("window.toggleSidebar")}
													onClick={() => setSidebarOpen((open) => !open)}
												/>
											</div>
										)
									}
									trailing={
										last && (
											<>
												<PanelToggle
													icon={PanelRight}
													label={t("window.togglePanel")}
													onClick={() => setPanelOpen((open) => !open)}
													// Closed, the strip is the window's right edge: keep the
													// button off it, unless the caption buttons sit there anyway.
													className={cn(
														!panelOpen &&
															(platform.isMac || panelHoldsControls) &&
															"mr-2.5",
													)}
												/>
												{/* The caption buttons live above the panel when there is
												    one. With it closed this strip is the window's top
												    right corner, so they come back here. */}
												{!platform.isMac && !panelHoldsControls && (
													<WindowControls />
												)}
											</>
										)
									}
								/>
							);
						}}
					/>
				</div>

				{panelOpen && <ResizeHandle onPointerDown={resizePanel} />}
				{panelOpen && (
					<div
						style={{ width: panelWidth }}
						className="flex shrink-0 flex-col bg-muted/30"
					>
						{/* Where the OS draws no caption buttons of its own, the window's
						    top right corner belongs to ours, and the panel starts a row
						    below them. macOS keeps its traffic lights on the left and the
						    panel at the top, so this row is not there at all. */}
						{panelHoldsControls && (
							<div className="drag-region flex h-9 shrink-0 items-center justify-end border-b">
								<WindowControls />
							</div>
						)}
						<SidePanel
							cwd={cwd}
							repo={repo.snapshot}
							error={repo.error}
							issues={repo.issues}
							pulls={repo.pulls}
							github={repo.github}
							reviewOf={repo.reviewOf}
							onRefreshGithub={() => void repo.refreshGithub()}
							onCommit={repo.commit}
							onOpenFile={(dir, path) =>
								active && sessions.openFile(active.id, dir, path)
							}
							onOpenIssue={sessions.openIssue}
							onOpenPull={sessions.openPull}
						/>
					</div>
				)}
			</div>

			<footer className="flex h-6 shrink-0 items-center gap-3 border-t bg-muted/30 px-3 text-[10px] text-muted-foreground">
				{active && (
					<>
						<span className="truncate">{sessions.activeProject?.name}</span>
						{repo.snapshot?.branch && (
							<span className="truncate font-mono">{repo.snapshot.branch}</span>
						)}
						{repo.snapshot?.root && (
							<span className="tabular-nums">
								{t("session.changed", { n: repo.snapshot.changes.length })}
							</span>
						)}
					</>
				)}
				<span className="ml-auto tabular-nums">
					{t("session.pane.open", { n: sessions.panes.length })}
				</span>
				<UpdateChip
					state={updater.state}
					onOpen={() => updater.setOpen(true)}
				/>
				{/* The version doubles as the manual update check: pressing it is
				    the question "is there a newer one?" */}
				<button
					type="button"
					title={t("update.footer.check")}
					onClick={() => void updater.runCheck(true)}
					disabled={updater.state.status === "checking"}
					className="tabular-nums transition-colors hover:text-foreground disabled:hover:text-muted-foreground"
				>
					{versionLabel}
				</button>
			</footer>

			<NewWorkspaceDialog
				open={workspaceOpen}
				onOpenChange={setWorkspaceOpen}
				onCreate={(name, path) => sessions.createWorkspace(name, path)}
			/>

			<NewTabDialog
				open={newTabIn !== null}
				onOpenChange={(open) => !open && setNewTabIn(null)}
				onPick={openTab}
			/>

			<SettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				theme={theme}
				onTheme={setTheme}
			/>

			<UpdateDialog
				state={updater.state}
				open={updater.open}
				onOpenChange={updater.setOpen}
				onDownload={updater.download}
				onInstallNow={updater.installNow}
				onInstallOnQuit={updater.installOnQuit}
				onRetry={() => void updater.runCheck(true)}
			/>
		</div>
	);
}
