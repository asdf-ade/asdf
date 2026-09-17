import {
	ChevronDown,
	ChevronRight,
	File as FileIcon,
	Folder,
	FolderOpen,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FileNode, FileStatus } from "../types";

// Git status decides the colour, the way an editor's explorer does. Reading the
// tree should answer "what did I touch" before anything is clicked.
const statusTone: Record<FileStatus, string> = {
	clean: "",
	modified: "text-amber-600 dark:text-amber-500",
	added: "text-emerald-600 dark:text-emerald-500",
	deleted: "text-destructive line-through",
};

export function FileExplorer({
	tree,
	onOpen,
}: {
	tree: FileNode[];
	onOpen: (path: string) => void;
}) {
	const { t } = useTranslation();
	// Folders start closed: a tree that opens itself is a wall of rows, and it
	// would re-open on every refresh. What the user opened stays open, keyed by
	// path, across snapshots.
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

	// No search box of its own: the panel's one box searches what is written in
	// these files, and shows this tree while it is empty. A name filter was a
	// second box answering a question nobody was asking.
	return (
		<div className="min-h-0 flex-1 overflow-auto p-1">
			{tree.length === 0 ? (
				<p className="px-2 py-3 text-muted-foreground text-xs">
					{t("session.files.empty")}
				</p>
			) : (
				<Tree
					nodes={tree}
					depth={0}
					open={open}
					onToggle={(path) =>
						setOpen((previous) => {
							const next = new Set(previous);
							if (!next.delete(path)) next.add(path);
							return next;
						})
					}
					onOpen={onOpen}
				/>
			)}
		</div>
	);
}

function Tree({
	nodes,
	depth,
	open,
	onToggle,
	onOpen,
}: {
	nodes: FileNode[];
	depth: number;
	open: ReadonlySet<string>;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
}) {
	return (
		<ul>
			{nodes.map((node) =>
				node.kind === "dir" ? (
					<li key={node.path}>
						<button
							type="button"
							aria-expanded={open.has(node.path)}
							onClick={() => onToggle(node.path)}
							style={{ paddingLeft: depth * 12 + 8 }}
							className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-accent/60"
						>
							{open.has(node.path) ? (
								<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
							) : (
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
							)}
							{open.has(node.path) ? (
								<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
							) : (
								<Folder className="size-3.5 shrink-0 text-muted-foreground" />
							)}
							<span className="truncate">{node.name}</span>
						</button>
						{open.has(node.path) && (
							<Tree
								nodes={node.children}
								depth={depth + 1}
								open={open}
								onToggle={onToggle}
								onOpen={onOpen}
							/>
						)}
					</li>
				) : (
					<li key={node.path}>
						<button
							type="button"
							onClick={() => onOpen(node.path)}
							style={{ paddingLeft: depth * 12 + 25 }}
							className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-accent/60"
						>
							<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
							<span className={cn("truncate", statusTone[node.status])}>
								{node.name}
							</span>
						</button>
					</li>
				),
			)}
		</ul>
	);
}
