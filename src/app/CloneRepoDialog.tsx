import { useEffect, useId, useState } from "react";
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

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Where the clone landed. The caller gives it to the workspace. */
	onCloned: (path: string) => void;
};

/**
 * Clones a repository into a folder the user picks, for a workspace that
 * already exists.
 *
 * This is the one part of setting up a workspace that keeps a dialog. Making a
 * workspace is typing its name, and choosing a folder is the OS picker on its
 * own — but a clone has two answers to give and a minute of progress to report,
 * and none of that fits in a row of a sidebar.
 */
export function CloneRepoDialog({ open, onOpenChange, onCloned }: Props) {
	const { t } = useTranslation();
	const id = useId();
	const [url, setUrl] = useState("");
	const [parent, setParent] = useState<string | null>(null);
	// What git last said while cloning, and why it stopped if it failed.
	const [progress, setProgress] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);

	const cloning = progress !== null && failure === null;

	// Each opening starts over; a half-filled clone left behind from last time
	// would be answered for a repository nobody is looking at any more.
	useEffect(() => {
		if (open) return;
		setUrl("");
		setParent(null);
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

	/**
	 * Opens the OS picker and keeps the folder, or says why it could not.
	 *
	 * A dismissed picker and a picker that could not run look the same from
	 * here — both give no folder — so they are told apart before returning:
	 * one is an answer, the other is worth saying out loud, or the button
	 * looks like one that does nothing.
	 */
	const chooseParent = async () => {
		setFailure(null);
		const picked = await ipc.pickFolder();
		if (!picked.ok) {
			setFailure(picked.error.message);
			return;
		}
		if (picked.value) setParent(picked.value);
	};

	const submit = async () => {
		if (!url.trim() || !parent || cloning) return;
		setFailure(null);
		// A blank line rather than nothing: the progress row has to exist before
		// git speaks, or the dialog looks frozen for the first second.
		setProgress("");
		const cloned = await ipc.cloneRepo(url.trim(), parent);
		if (!cloned.ok) {
			setProgress(null);
			setFailure(cloned.error.message);
			return;
		}
		onCloned(cloned.value.path);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !cloning && onOpenChange(next)}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("session.workspace.cloneTitle")}</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<label htmlFor={id} className="font-medium text-xs">
							{t("session.workspace.url")}
						</label>
						<Input
							id={id}
							value={url}
							disabled={cloning}
							onChange={(event) => setUrl(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void submit();
							}}
							placeholder={t("session.workspace.urlPlaceholder")}
						/>
					</div>

					{/* No one input to point at — a read-only path and a button — so a
					    heading rather than a label with nothing to label. */}
					<div className="flex flex-col gap-1.5">
						<span className="font-medium text-xs">
							{t("session.workspace.parent")}
						</span>
						<div className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">
								{parent ?? t("session.workspace.noFolder")}
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
					</div>

					{progress !== null && (
						<p className="truncate text-muted-foreground text-xs">
							{progress || t("session.workspace.cloning")}
						</p>
					)}
					{failure && <p className="text-destructive text-xs">{failure}</p>}
				</div>

				<DialogFooter>
					<Button
						variant="ghost"
						disabled={cloning}
						onClick={() => onOpenChange(false)}
					>
						{t("session.workspace.cancel")}
					</Button>
					<Button
						onClick={() => void submit()}
						disabled={!url.trim() || !parent || cloning}
					>
						{t("session.workspace.clone")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
