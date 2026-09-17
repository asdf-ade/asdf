import {
	ArrowDown,
	ArrowUp,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	CircleDot,
	CircleSlash,
	Clock,
	FileDiff,
	Files,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestDraft,
	type LucideIcon,
	RefreshCw,
	XCircle,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
	ChangedFile,
	Issue,
	PullRequest,
	RepoSnapshot,
	ReviewState,
} from "../types";
import { FileExplorer } from "./FileExplorer";
import { SearchPanel } from "./SearchPanel";

type View = "files" | "changes" | "issues" | "pulls";

const issueIcon: Record<Issue["state"], LucideIcon> = {
	open: CircleDot,
	closed: CircleSlash,
};

const issueTone: Record<Issue["state"], string> = {
	open: "text-emerald-600 dark:text-emerald-500",
	closed: "text-muted-foreground",
};

const pullIcon: Record<PullRequest["state"], LucideIcon> = {
	open: GitPullRequest,
	draft: GitPullRequestDraft,
	merged: GitMerge,
};

const pullTone: Record<PullRequest["state"], string> = {
	open: "text-emerald-600 dark:text-emerald-500",
	draft: "text-muted-foreground",
	merged: "text-violet-600 dark:text-violet-400",
};

const ciIcon: Record<PullRequest["ci"], LucideIcon> = {
	pass: CheckCircle2,
	fail: XCircle,
	pending: Clock,
};

const ciTone: Record<PullRequest["ci"], string> = {
	pass: "text-emerald-600 dark:text-emerald-500",
	fail: "text-destructive",
	pending: "text-muted-foreground",
};

const viewIcon: Record<View, LucideIcon> = {
	files: Files,
	changes: FileDiff,
	issues: CircleDot,
	pulls: GitPullRequest,
};

// The single letter an editor puts next to a changed file.
const kindLetter = { modified: "M", added: "A", deleted: "D" } as const;

const kindTone = {
	modified: "text-amber-600 dark:text-amber-500",
	added: "text-emerald-600 dark:text-emerald-500",
	deleted: "text-destructive",
} as const;

type Props = {
	/** Where the terminal on screen is; null while nothing is open. */
	cwd: string | null;
	repo: RepoSnapshot | null;
	/** Why git could not answer, when it could not. */
	error: string | null;
	issues: Issue[];
	pulls: PullRequest[];
	/** Why gh could not answer, when it could not. */
	github: string | null;
	reviewOf: (file: string) => ReviewState;
	onRefreshGithub: () => void;
	onCommit: (message: string) => Promise<boolean>;
	/** `dir` is what `path` is relative to: the shell's folder for the tree,
	 *  the repository root for a change. */
	onOpenFile: (dir: string, path: string, line?: number) => void;
	onOpenIssue: (number: number) => void;
	onOpenPull: (number: number) => void;
};

export function SidePanel({
	cwd,
	repo,
	error,
	issues,
	pulls,
	github,
	reviewOf,
	onRefreshGithub,
	onCommit,
	onOpenFile,
	onOpenIssue,
	onOpenPull,
}: Props) {
	const { t } = useTranslation();
	const [view, setView] = useState<View>("files");

	const counts: Record<View, number | undefined> = {
		files: undefined,
		changes: repo?.changes.filter((file) => reviewOf(file.path) === "new")
			.length,
		issues: issues.length,
		pulls: pulls.length,
	};

	const label: Record<View, string> = {
		files: t("session.files.title"),
		changes: t("session.changes.title"),
		issues: t("github.issues"),
		pulls: t("github.pulls"),
	};

	return (
		<aside className="flex min-w-0 flex-1 flex-col bg-muted/30">
			{/* One view at a time. Stacking them would leave every list too short to
			    read and the tree squeezed to nothing. */}
			<nav
				aria-label={t("session.sidePanel")}
				className="drag-region flex h-9 shrink-0 gap-px border-b p-1"
			>
				{(["files", "changes", "issues", "pulls"] as const).map((value) => {
					const Icon = viewIcon[value];
					return (
						<button
							key={value}
							type="button"
							aria-pressed={view === value}
							aria-label={label[value]}
							title={label[value]}
							onClick={() => setView(value)}
							className={cn(
								"flex flex-1 items-center justify-center rounded-md transition-colors",
								view === value
									? "bg-background text-foreground shadow-xs"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{/* The count rides the icon's corner, so a tab that wants
							    attention says so at a glance. */}
							<span className="relative">
								<Icon className="size-4" />
								{counts[value] ? (
									<span className="-top-1.5 -right-2 absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 font-medium text-[9px] text-white tabular-nums leading-none">
										{counts[value]}
									</span>
								) : null}
							</span>
						</button>
					);
				})}
			</nav>

			{/* The folder every view is about, so a `cd` in the shell is visible
			    here without reading the prompt. Its name, not the route to it: the
			    route is the part nobody needs, it is the widest thing in a narrow
			    panel, and on a personal machine it opens with a person's name in
			    it. The whole path is a hover away for the times it matters. */}
			{cwd && (
				<p
					title={cwd}
					className="truncate border-b px-3 py-1 font-mono text-[10px] text-muted-foreground"
				>
					{folderName(cwd)}
				</p>
			)}

			{!cwd ? (
				<Empty>{t("session.files.noSession")}</Empty>
			) : error ? (
				<Empty>{error}</Empty>
			) : !repo ? (
				<Empty>{t("session.files.loading")}</Empty>
			) : view === "files" ? (
				<SearchPanel
					cwd={repo.cwd}
					onOpen={(path, line) => onOpenFile(repo.cwd, path, line)}
				>
					<FileExplorer
						tree={repo.tree}
						onOpen={(path) => onOpenFile(repo.cwd, path)}
					/>
				</SearchPanel>
			) : view === "changes" ? (
				<SourceControl
					repo={repo}
					reviewOf={reviewOf}
					onCommit={onCommit}
					onOpenFile={(path) => repo.root && onOpenFile(repo.root, path)}
				/>
			) : view === "issues" ? (
				<GithubList
					repo={repo}
					github={github}
					onRefresh={onRefreshGithub}
					empty={t("github.noIssues")}
					items={issues.map((issue) => {
						const Icon = issueIcon[issue.state];
						return (
							<Row
								key={issue.number}
								icon={
									<Icon className={cn("size-3.5", issueTone[issue.state])} />
								}
								number={issue.number}
								title={issue.title}
								meta={issue.labels.join(" · ")}
								onOpen={() => onOpenIssue(issue.number)}
							/>
						);
					})}
				/>
			) : (
				<GithubList
					repo={repo}
					github={github}
					onRefresh={onRefreshGithub}
					empty={t("github.noPulls")}
					items={pulls.map((pull) => {
						const Icon = pullIcon[pull.state];
						const Ci = ciIcon[pull.ci];
						return (
							<Row
								key={pull.number}
								icon={<Icon className={cn("size-3.5", pullTone[pull.state])} />}
								number={pull.number}
								title={pull.title}
								meta={pull.branch}
								trailing={<Ci className={cn("size-3", ciTone[pull.ci])} />}
								onOpen={() => onOpenPull(pull.number)}
							/>
						);
					})}
				/>
			)}
		</aside>
	);
}

/**
 * What to call the folder the panel is on: its last segment, whichever
 * separator the OS writes. The root of a drive has no segment of its own, so
 * it answers with itself rather than with nothing.
 */
function folderName(path: string): string {
	return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

// Source control the way an editor lays it out: a message box, then the state
// of the branch, then what is checked out where, then the changes themselves.
function SourceControl({
	repo,
	reviewOf,
	onCommit,
	onOpenFile,
}: {
	repo: RepoSnapshot;
	reviewOf: (file: string) => ReviewState;
	onCommit: (message: string) => Promise<boolean>;
	onOpenFile: (path: string) => void;
}) {
	const { t } = useTranslation();
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

	if (!repo.root) return <Empty>{t("scm.notARepo")}</Empty>;

	const toggle = (key: string) =>
		setClosed((previous) => {
			const next = new Set(previous);
			if (!next.delete(key)) next.add(key);
			return next;
		});

	const pending = repo.changes.filter((file) => reviewOf(file.path) === "new");
	const settled = repo.changes.filter((file) => reviewOf(file.path) !== "new");

	const commit = async () => {
		setBusy(true);
		if (await onCommit(message.trim())) setMessage("");
		setBusy(false);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-col gap-1.5 border-b p-2">
				<textarea
					value={message}
					onChange={(event) => setMessage(event.target.value)}
					placeholder={t("scm.messagePlaceholder")}
					aria-label={t("scm.message")}
					rows={2}
					className="w-full resize-none rounded-md border bg-background/70 px-2 py-1.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				/>
				<Button
					size="sm"
					className="h-7 w-full text-xs"
					onClick={() => void commit()}
					disabled={busy || !message.trim() || repo.changes.length === 0}
				>
					{t("scm.commit")}
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				<Section
					label={t("scm.branch")}
					open={!closed.has("branch")}
					onToggle={() => toggle("branch")}
				>
					<div className="flex items-center gap-1.5 px-3 py-1 text-xs">
						<GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate font-mono">
							{repo.branch ?? t("scm.detached")}
						</span>
						<span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
							<ArrowUp className="size-3" />
							{repo.ahead}
							<ArrowDown className="size-3" />
							{repo.behind}
						</span>
					</div>
				</Section>

				{/* Which branch is checked out where is the thing a normal git GUI
				    cannot tell you once worktrees are in play. */}
				<Section
					label={t("scm.worktrees")}
					count={repo.worktrees.length}
					open={!closed.has("worktrees")}
					onToggle={() => toggle("worktrees")}
				>
					<ul>
						{repo.worktrees.map((item) => (
							<li
								key={item.path}
								title={item.path}
								className={cn(
									"flex items-center gap-1.5 px-3 py-1 text-xs",
									item.path === repo.root && "bg-accent/60",
								)}
							>
								<GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1">
									<span className="block truncate font-mono">
										{item.branch ?? t("scm.detached")}
									</span>
									<span className="block truncate text-[11px] text-muted-foreground">
										{item.path}
									</span>
								</span>
							</li>
						))}
					</ul>
				</Section>

				<Section
					label={t("scm.changes")}
					count={repo.changes.length}
					open={!closed.has("changes")}
					onToggle={() => toggle("changes")}
				>
					{repo.changes.length === 0 ? (
						<p className="px-3 pb-2 text-[11px] text-muted-foreground">
							{t("session.changes.empty")}
						</p>
					) : (
						<ul>
							{pending.map((file) => (
								<ChangedRow
									key={file.path}
									file={file}
									review={reviewOf(file.path)}
									onOpen={() => onOpenFile(file.path)}
								/>
							))}

							{settled.length > 0 && (
								<li
									aria-hidden
									className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wide"
								>
									<span className="h-px flex-1 bg-border" />
									{t("session.changes.reviewedDivider")}
									<span className="h-px flex-1 bg-border" />
								</li>
							)}

							{settled.map((file) => (
								<ChangedRow
									key={file.path}
									file={file}
									review={reviewOf(file.path)}
									onOpen={() => onOpenFile(file.path)}
								/>
							))}
						</ul>
					)}
				</Section>
			</div>

			{repo.changes.length > 0 && (
				<footer className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
					{t("session.changes.reviewedCount", {
						done: settled.length,
						total: repo.changes.length,
					})}
				</footer>
			)}
		</div>
	);
}

function ChangedRow({
	file,
	review,
	onOpen,
}: {
	file: ChangedFile;
	review: ReviewState;
	onOpen: () => void;
}) {
	const name = file.path.split("/").pop() ?? file.path;
	const dir = file.path.slice(0, file.path.length - name.length - 1);

	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				className={cn(
					"flex w-full items-baseline gap-1.5 px-3 py-1 text-left text-xs hover:bg-accent/60",
					review === "reverted" && "line-through opacity-60",
				)}
			>
				<span className="min-w-0 truncate">{name}</span>
				<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
					{dir}
				</span>
				<span className="shrink-0 text-[11px] tabular-nums">
					<span className="text-emerald-600">+{file.added}</span>{" "}
					<span className="text-destructive">-{file.removed}</span>
				</span>
				<span className={cn("w-3 shrink-0 text-center", kindTone[file.kind])}>
					{kindLetter[file.kind]}
				</span>
			</button>
		</li>
	);
}

function Section({
	label,
	count,
	open,
	onToggle,
	children,
}: {
	label: string;
	count?: number;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<section className="border-b last:border-b-0">
			<button
				type="button"
				aria-expanded={open}
				onClick={onToggle}
				className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] text-muted-foreground uppercase tracking-wide hover:bg-accent/60 hover:text-foreground"
			>
				{open ? (
					<ChevronDown className="size-3.5 shrink-0" />
				) : (
					<ChevronRight className="size-3.5 shrink-0" />
				)}
				<span className="font-medium">{label}</span>
				{count !== undefined && <span className="tabular-nums">{count}</span>}
			</button>
			{open && <div className="pb-1">{children}</div>}
		</section>
	);
}

// Issues and pull requests share a frame: a refresh, since GitHub is not
// polled, and gh's own words when it could not answer.
function GithubList({
	repo,
	github,
	onRefresh,
	empty,
	items,
}: {
	repo: RepoSnapshot;
	github: string | null;
	onRefresh: () => void;
	empty: string;
	items: ReactNode[];
}) {
	const { t } = useTranslation();
	if (!repo.root) return <Empty>{t("scm.notARepo")}</Empty>;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center border-b px-2 py-1">
				<Button
					size="sm"
					variant="ghost"
					onClick={onRefresh}
					className="ml-auto h-6 gap-1 px-2 text-[11px] text-muted-foreground"
				>
					<RefreshCw className="size-3" />
					{t("github.refresh")}
				</Button>
			</div>
			{github ? (
				<Empty>{github}</Empty>
			) : items.length === 0 ? (
				<Empty>{empty}</Empty>
			) : (
				<ul className="flex-1 overflow-auto p-1">{items}</ul>
			)}
		</div>
	);
}

function Row({
	icon,
	number,
	title,
	meta,
	trailing,
	onOpen,
}: {
	icon: ReactNode;
	number: number;
	title: string;
	meta?: string;
	trailing?: ReactNode;
	onOpen: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60"
			>
				<span className="mt-0.5 shrink-0">{icon}</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-1.5">
						<span className="shrink-0 text-muted-foreground tabular-nums">
							#{number}
						</span>
						<span className="min-w-0 flex-1 truncate">{title}</span>
					</span>
					{meta && (
						<span className="block truncate text-[11px] text-muted-foreground">
							{meta}
						</span>
					)}
				</span>
				{trailing && <span className="mt-0.5 shrink-0">{trailing}</span>}
			</button>
		</li>
	);
}

function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="flex-1 whitespace-pre-wrap px-3 py-3 text-muted-foreground text-xs">
			{children}
		</p>
	);
}
