import {
	Bell,
	ChevronDown,
	ChevronRight,
	Circle,
	FolderOpen,
	GitBranch,
	Globe,
	LoaderCircle,
	type LucideIcon,
	MoreHorizontal,
	Plus,
	TerminalSquare,
	Unlink,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Project, Session } from "../types";
import type { SessionStatus } from "../use-session-status";

type Props = {
	projects: Project[];
	sessions: Session[];
	/** The browser tabs of each workspace, listed beside its terminals. */
	browsers: Record<string, { id: string; browserId: number }[]>;
	/** What a session is called, numbered within its workspace. */
	sessionTitle: (session: Session) => string;
	/** What each session's shell is doing, drawn in place of its icon. */
	status: Record<string, SessionStatus>;
	/** What a browser is called: its page title, once it has one. */
	browserTitle: (browserId: number) => string;
	/** The workspace whose window is on screen. Switching swaps the tab set. */
	activeProjectId: string;
	/** The terminal on screen, lit in the list. */
	activeSessionId?: string;
	/** The tab on screen, so a browser row can be lit the same way. */
	activePaneId?: string;
	onSelectProject: (projectId: string) => void;
	onOpenSession: (sessionId: string) => void;
	onOpenBrowser: (projectId: string, browserId: number) => void;
	/** What is typed into the header's input, and null when it is not open.
	 *  Held by the shell so the empty window's buttons can open it too. */
	naming: string | null;
	onNaming: (value: string | null) => void;
	/** The name typed into the header's input. The workspace opens with its
	 *  first terminal already in it. */
	onCreateWorkspace: (name: string) => void;
	/** The OS picker, then the folder becomes this workspace's. */
	onChooseFolder: (projectId: string) => void;
	onClearFolder: (projectId: string) => void;
	onCloneInto: (projectId: string) => void;
	onRemoveWorkspace: (projectId: string) => void;
};

// Workspace → what is open in it, each workspace folding. Rows, not boxes: the
// fold and the indent separate the levels, so no borders are needed to do it
// again. Terminals first, then browsers: a browser is opened from a terminal's
// work more often than the other way round.
export function SessionSidebar({
	projects,
	sessions,
	browsers,
	sessionTitle,
	status,
	browserTitle,
	activeProjectId,
	activeSessionId,
	activePaneId,
	onSelectProject,
	onOpenSession,
	onOpenBrowser,
	naming,
	onNaming,
	onCreateWorkspace,
	onChooseFolder,
	onClearFolder,
	onCloneInto,
	onRemoveWorkspace,
}: Props) {
	const { t } = useTranslation();
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const field = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (naming !== null) field.current?.focus();
	}, [naming]);

	const toggle = (id: string) =>
		setFolded((previous) => {
			const next = new Set(previous);
			if (!next.delete(id)) next.add(id);
			return next;
		});

	const commit = () => {
		const name = (naming ?? "").trim();
		onNaming(null);
		// An empty name is not a workspace called nothing; it is someone who
		// changed their mind, which is what Escape does too.
		if (name) onCreateWorkspace(name);
	};

	return (
		<nav
			aria-label={t("session.sidebarLabel")}
			className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2"
		>
			{/* What the list is, and the one thing to do to it. The "+" sits at the
			    far end so the heading reads as a heading and not as a button. */}
			<div className="flex items-center gap-1 pr-0.5 pl-2">
				<span className="flex-1 truncate font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
					{t("session.workspaces")}
				</span>
				<Button
					size="icon"
					variant="ghost"
					aria-label={t("session.newWorkspace")}
					title={t("session.newWorkspace")}
					onClick={() => onNaming("")}
					className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
				>
					<Plus className="size-3.5" />
				</Button>
			</div>

			{naming !== null && (
				<div className="px-0.5 pt-1">
					<Input
						ref={field}
						value={naming}
						aria-label={t("session.newWorkspace")}
						placeholder={t("session.workspace.namePlaceholder")}
						onChange={(event) => onNaming(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") commit();
							if (event.key === "Escape") onNaming(null);
						}}
						// Clicking away is the same answer as Escape: the row was in the
						// way of whatever was clicked, and keeping it would be a modal
						// that never said it was one.
						onBlur={() => onNaming(null)}
						className="h-7 bg-background/70 text-xs"
					/>
				</div>
			)}

			<ul className="mt-1 space-y-0.5">
				{projects.map((project) => {
					const own = sessions.filter(
						(session) => session.projectId === project.id,
					);
					const pages = browsers[project.id] ?? [];
					const open = !folded.has(project.id);
					const active = project.id === activeProjectId;
					// When one of its rows is on screen, that row is the selected
					// thing; the workspace only stands out while folded or empty.
					const showing =
						active &&
						(own.some((session) => session.id === activeSessionId) ||
							pages.some((page) => page.id === activePaneId));
					return (
						<li key={project.id}>
							<div
								className={cn(
									"group flex items-center rounded-md",
									active && (!open || !showing)
										? "bg-accent"
										: "hover:bg-accent/60",
								)}
							>
								<button
									type="button"
									aria-expanded={open}
									aria-label={project.name}
									onClick={() => toggle(project.id)}
									className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
								>
									{open ? (
										<ChevronDown className="size-3.5" />
									) : (
										<ChevronRight className="size-3.5" />
									)}
								</button>
								<button
									type="button"
									aria-current={active ? "true" : undefined}
									onClick={() => onSelectProject(project.id)}
									// The folder is what tells two workspaces of the same name
									// apart, and it is too long for the row, so it is the
									// tooltip rather than a second line.
									title={project.path ?? undefined}
									className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left"
								>
									<span className="min-w-0 flex-1 truncate font-medium text-xs">
										{project.name}
									</span>
									{!open && own.length + pages.length > 0 && (
										<span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
											{own.length + pages.length}
										</span>
									)}
								</button>

								{/* The folder and the end of the workspace live here rather
								    than in the dialog that used to make it: they are things
								    done to a workspace that exists, and making one is only
								    typing its name. */}
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												size="icon"
												variant="ghost"
												aria-label={t("session.workspace.menu")}
												title={t("session.workspace.menu")}
												className="mr-1 size-5 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
											>
												<MoreHorizontal className="size-3" />
											</Button>
										}
									/>
									<DropdownMenuContent align="end" className="w-52">
										<DropdownMenuItem
											onClick={() => onChooseFolder(project.id)}
										>
											<FolderOpen className="size-3.5" />
											{t("session.workspace.chooseFolder")}
										</DropdownMenuItem>
										<DropdownMenuItem onClick={() => onCloneInto(project.id)}>
											<GitBranch className="size-3.5" />
											{t("session.workspace.cloneRepo")}
										</DropdownMenuItem>
										{project.path && (
											<DropdownMenuItem
												onClick={() => onClearFolder(project.id)}
											>
												<Unlink className="size-3.5" />
												{t("session.workspace.clearFolder")}
											</DropdownMenuItem>
										)}
										<DropdownMenuSeparator />
										<DropdownMenuItem
											variant="destructive"
											onClick={() => onRemoveWorkspace(project.id)}
										>
											<X className="size-3.5" />
											{t("session.removeWorkspace")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>

							{open && own.length + pages.length > 0 && (
								<ul className="mt-0.5 space-y-px">
									{own.map((session) => (
										<li key={session.id}>
											<Row
												icon={TerminalSquare}
												mark={<StatusMark status={status[session.id]} />}
												label={sessionTitle(session)}
												current={active && session.id === activeSessionId}
												onOpen={() => onOpenSession(session.id)}
											/>
										</li>
									))}
									{pages.map((page) => (
										<li key={page.id}>
											<Row
												icon={Globe}
												label={browserTitle(page.browserId)}
												current={active && page.id === activePaneId}
												onOpen={() => onOpenBrowser(project.id, page.browserId)}
											/>
										</li>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

/**
 * What a session's shell is doing, in the place its icon would be: a spinner
 * while it works, an alert once it has finished with nobody watching, and a
 * quiet green dot when there is nothing waiting for you.
 */
function StatusMark({ status }: { status: SessionStatus | undefined }) {
	const { t } = useTranslation();
	const state = status ?? "idle";
	const label = t(`session.status.${state}`);
	// One slot the width of the icon a browser row shows, so the names line up
	// whatever is in it. The quiet state is a dot rather than a ring: it is the
	// one every row wears most of the time, and it should sit under the name
	// rather than compete with it.
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			{state === "busy" ? (
				<LoaderCircle className="size-3.5 animate-spin" />
			) : state === "done" ? (
				<Bell className="size-3.5 text-amber-500" />
			) : (
				<Circle className="size-2 fill-emerald-500 text-emerald-500" />
			)}
		</span>
	);
}

/** One thing open in a workspace, indented under it. */
function Row({
	icon: Icon,
	mark,
	label,
	current,
	onOpen,
}: {
	icon: LucideIcon;
	/** Drawn instead of the icon, for a row that has something to say. */
	mark?: ReactNode;
	label: string;
	current: boolean;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			aria-current={current ? "true" : undefined}
			onClick={onOpen}
			className={cn(
				"flex w-full items-center gap-1.5 rounded-md py-1 pr-2 pl-7 text-left text-xs",
				current
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
			)}
		>
			{mark ?? <Icon className="size-3.5 shrink-0" />}
			<span className="truncate">{label}</span>
		</button>
	);
}
