import { FolderOpen, GitBranch, Square } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CLONE_PROGRESS_EVENT } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { platform } from "@/ipc/platform";

/** How the workspace gets the folder it opens in. */
type Source = "empty" | "folder" | "clone";

const SOURCES = [
	{ source: "empty", icon: Square },
	{ source: "folder", icon: FolderOpen },
	{ source: "clone", icon: GitBranch },
] as const;

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The name, and the folder its terminals start in — null for a workspace
	 *  that is only a name. The caller opens the first terminal. */
	onCreate: (name: string, path: string | null) => void;
};

/** The last segment of a path, whichever separator the OS writes. */
const basename = (path: string) =>
	path.split(/[/\\]/).filter(Boolean).pop() ?? "";

/**
 * A workspace is a name and a folder. There are three ways to arrive at the
 * folder and they are asked as three, rather than as one field with rules:
 * open one that exists, clone a repository into a new one, or have none at all
 * and leave the shells to decide where they are, which is what a workspace was
 * before it could hold a folder.
 *
 * Making an empty folder is not a fourth: the OS picker has a "New folder"
 * button, and re-implementing it here would be a worse version of it.
 */
export function NewWorkspaceDialog({ open, onOpenChange, onCreate }: Props) {
	const { t } = useTranslation();
	const id = useId();
	const [source, setSource] = useState<Source | null>(null);
	const [name, setName] = useState("");
	const [path, setPath] = useState<string | null>(null);
	const [url, setUrl] = useState("");
	// What git last said while cloning, and why it stopped if it failed.
	const [progress, setProgress] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	const cloning = progress !== null && failure === null;

	// Each opening starts over; a half-filled clone left behind from last time
	// would be answered for a repository nobody is looking at any more.
	useEffect(() => {
		if (open) return;
		setSource(null);
		setName("");
		setPath(null);
		setUrl("");
		setProgress(null);
		setFailure(null);
	}, [open]);

	useEffect(() => {
		if (!cloning) return;
		const off = platform.listen<string>(CLONE_PROGRESS_EVENT, (event) =>
			setProgress(event.payload),
		);
		return () => {
			void off.then((unlisten) => unlisten());
		};
	}, [cloning]);

	// The folder names the workspace, unless the person has said otherwise.
	const pick = async (chosen: Source) => {
		setFailure(null);
		if (chosen !== "folder") {
			setSource(chosen);
			return;
		}
		const picked = await ipc.pickFolder();
		if (!picked.ok || !picked.value) return;
		const folder = picked.value;
		setPath(folder);
		setName((previous) => previous || basename(folder));
		setSource("folder");
	};

	const chooseParent = async () => {
		const picked = await ipc.pickFolder();
		if (picked.ok && picked.value) setPath(picked.value);
	};

	const done = (folder: string | null) => {
		onCreate(name.trim(), folder);
		onOpenChange(false);
	};

	const submit = async () => {
		if (!name.trim() || cloning) return;
		if (source !== "clone") {
			done(source === "folder" ? path : null);
			return;
		}
		if (!url.trim() || !path) return;
		setFailure(null);
		// A blank line rather than nothing: the progress row has to exist before
		// git speaks, or the dialog looks frozen for the first second.
		setProgress("");
		const cloned = await ipc.cloneRepo(url.trim(), path);
		if (!cloned.ok) {
			setProgress(null);
			setFailure(cloned.error.message);
			return;
		}
		done(cloned.value.path);
	};

	const ready =
		!!name.trim() &&
		!cloning &&
		(source !== "clone" || (!!url.trim() && !!path)) &&
		(source !== "folder" || !!path);

	return (
		<Dialog open={open} onOpenChange={(next) => !cloning && onOpenChange(next)}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("session.workspace.title")}</DialogTitle>
				</DialogHeader>

				{source === null ? (
					<div className="flex flex-col gap-1">
						{SOURCES.map(({ source: kind, icon: Icon }) => (
							<button
								key={kind}
								type="button"
								onClick={() => void pick(kind)}
								className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
							>
								<Icon className="size-4 shrink-0 text-muted-foreground" />
								<span className="flex min-w-0 flex-col">
									<span className="text-sm">
										{t(`session.workspace.source.${kind}`)}
									</span>
									<span className="text-muted-foreground text-xs">
										{t(`session.workspace.source.${kind}Hint`)}
									</span>
								</span>
							</button>
						))}
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{source === "clone" && (
							<Field label={t("session.workspace.url")} htmlFor={`${id}-url`}>
								<Input
									id={`${id}-url`}
									value={url}
									disabled={cloning}
									onChange={(event) => {
										setUrl(event.target.value);
										// The repository names the workspace until someone types
										// over it, the same way the folder does.
										const guess = repoName(event.target.value);
										if (guess) setName(guess);
									}}
									placeholder={t("session.workspace.urlPlaceholder")}
								/>
							</Field>
						)}

						{source !== "empty" && (
							<Field
								label={t(
									source === "clone"
										? "session.workspace.parent"
										: "session.workspace.folder",
								)}
							>
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">
										{path ?? t("session.workspace.noFolder")}
									</span>
									<Button
										variant="outline"
										size="sm"
										disabled={cloning}
										onClick={() => void chooseParent()}
									>
										{t("session.workspace.choose")}
									</Button>
								</div>
							</Field>
						)}

						<Field label={t("session.workspace.name")} htmlFor={id}>
							<Input
								id={id}
								value={name}
								disabled={cloning}
								onChange={(event) => setName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void submit();
								}}
								placeholder={t("session.workspace.namePlaceholder")}
							/>
						</Field>

						{progress !== null && (
							<p className="truncate text-muted-foreground text-xs">
								{progress || t("session.workspace.cloning")}
							</p>
						)}
						{failure && <p className="text-destructive text-xs">{failure}</p>}
					</div>
				)}

				<DialogFooter>
					<Button
						variant="ghost"
						disabled={cloning}
						onClick={() =>
							source === null ? onOpenChange(false) : setSource(null)
						}
					>
						{t(
							source === null
								? "session.workspace.cancel"
								: "session.workspace.back",
						)}
					</Button>
					{source !== null && (
						<Button onClick={() => void submit()} disabled={!ready}>
							{t(
								source === "clone"
									? "session.workspace.clone"
									: "session.workspace.create",
							)}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	// The folder row has no one input to point at — it is a read-only path and a
	// button — so it gets a heading rather than a label with nothing to label.
	const Tag = htmlFor ? "label" : "span";
	return (
		<div className="flex flex-col gap-1.5">
			<Tag htmlFor={htmlFor} className="font-medium text-xs">
				{label}
			</Tag>
			{children}
		</div>
	);
}

/** The folder a clone would land in, so the name can be filled in before the
 *  clone runs. The main process decides for real; this only has to agree. */
function repoName(url: string): string {
	const last = url.trim().replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
	const name = last.replace(/\.git$/i, "");
	return /[/\\]/.test(name) || name === "." || name === ".." ? "" : name;
}
