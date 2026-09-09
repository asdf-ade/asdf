import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc } from "@/ipc/client";
import {
	closePane as closeIn,
	type DropTarget,
	emptyWindow,
	focusPane as focusIn,
	leaves,
	movePane as moveIn,
	openPane,
	type PaneWindow,
} from "./panes";
import type { Pane, Project, Session } from "./types";

/** The browser views the panes of one window hold, so closing can end them. */
const browsersOf = (window: PaneWindow) =>
	window.groups
		.flatMap((group) => group.panes)
		.filter(
			(pane): pane is Extract<Pane, { kind: "browser" }> =>
				pane.kind === "browser",
		);

// Workspaces outlive the app; terminals do not. So the names are written to
// storage and everything else starts empty.
const STORAGE_KEY = "workspaces";

function loadProjects(): Project[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Project[];
	} catch {
		return [];
	}
}

export function useSessions() {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [projects, setProjects] = useState<Project[]>(loadProjects);
	const [activeProjectId, setActiveProjectId] = useState(
		() => loadProjects()[0]?.id ?? "",
	);
	const [windows, setWindows] = useState<Record<string, PaneWindow>>({});

	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
		} catch {
			// Nothing to remember them with; they last until the window closes.
		}
	}, [projects]);

	const window = useMemo(
		() => windows[activeProjectId] ?? emptyWindow(),
		[windows, activeProjectId],
	);
	const activeGroup =
		window.groups.find((group) => group.id === window.active) ??
		window.groups[0];
	const panes = activeGroup.panes;
	const activeId = activeGroup.activeId;

	// The panel follows the open tab of the workspace you are in. Issue and
	// pull request tabs carry no terminal, so it keeps the last one that did.
	const withSession = panes.filter(
		(pane) => pane.kind === "session" || pane.kind === "file",
	);
	const activeSessionId =
		withSession.find((pane) => pane.id === activeId)?.sessionId ??
		withSession[withSession.length - 1]?.sessionId;
	const activeSession = sessions.find(
		(session) => session.id === activeSessionId,
	);
	const activeProject = projects.find(
		(project) => project.id === activeProjectId,
	);

	// The browser tabs of every workspace, so the sidebar can list them under
	// their workspace the way it lists terminals. A workspace with no window
	// yet has none.
	const browsers = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(windows).map(([id, held]) => [id, browsersOf(held)]),
			),
		[windows],
	);

	const openIn = useCallback((projectId: string, pane: Pane) => {
		setActiveProjectId(projectId);
		setWindows((previous) => ({
			...previous,
			[projectId]: openPane(previous[projectId] ?? emptyWindow(), pane),
		}));
	}, []);

	// A terminal picked from the sidebar comes to the front in its workspace.
	const openSession = useCallback(
		(sessionId: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			openIn(session.projectId, {
				kind: "session",
				id: `session:${sessionId}`,
				sessionId,
			});
		},
		[sessions, openIn],
	);

	const openFile = useCallback(
		(sessionId: string, dir: string, path: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			openIn(session.projectId, {
				kind: "file",
				id: `file:${dir}/${path}`,
				sessionId,
				dir,
				path,
			});
		},
		[sessions, openIn],
	);

	const openIssue = useCallback(
		(number: number) => {
			openIn(activeProjectId, {
				kind: "issue",
				id: `issue:${activeProjectId}:${number}`,
				number,
			});
		},
		[activeProjectId, openIn],
	);

	const openPull = useCallback(
		(number: number) => {
			openIn(activeProjectId, {
				kind: "pull",
				id: `pull:${activeProjectId}:${number}`,
				number,
			});
		},
		[activeProjectId, openIn],
	);

	const focusPane = useCallback(
		(id: string) => {
			setWindows((previous) => {
				const current = previous[activeProjectId];
				if (!current) return previous;
				return { ...previous, [activeProjectId]: focusIn(current, id) };
			});
		},
		[activeProjectId],
	);

	const focusGroup = useCallback(
		(id: string) => {
			setWindows((previous) => {
				const current = previous[activeProjectId];
				if (!current || current.active === id) return previous;
				return { ...previous, [activeProjectId]: { ...current, active: id } };
			});
		},
		[activeProjectId],
	);

	const movePane = useCallback(
		(id: string, drop: DropTarget) => {
			setWindows((previous) => {
				const current = previous[activeProjectId];
				if (!current) return previous;
				return { ...previous, [activeProjectId]: moveIn(current, id, drop) };
			});
		},
		[activeProjectId],
	);

	// A terminal tab is the terminal: closing it ends the shell, the way a
	// terminal window does. Files, issues and pull requests are only views; a
	// browser is a live page, so closing its tab ends the page — but only its
	// own tab does, since the page belongs to the workspace and not to whatever
	// terminal happened to be open when it was made.
	const closePane = useCallback(
		(id: string) => {
			const pane = window.groups
				.flatMap((group) => group.panes)
				.find((item) => item.id === id);
			if (pane?.kind === "browser") void ipc.browserClose(pane.browserId);
			if (pane?.kind === "session")
				setSessions((previous) =>
					previous.filter((session) => session.id !== pane.sessionId),
				);
			setWindows((previous) => {
				const current = previous[activeProjectId];
				if (!current) return previous;
				return { ...previous, [activeProjectId]: closeIn(current, id) };
			});
		},
		[activeProjectId, window],
	);

	// A browser opens as a tab in the active group, the way a new terminal
	// does — not split off. The person splits it later by dragging, if they
	// want. The view already exists in the main process; this is only its tab.
	const openBrowser = useCallback(
		(projectId: string, browserId: number) => {
			openIn(projectId, {
				kind: "browser",
				id: `browser:${browserId}`,
				browserId,
			});
		},
		[openIn],
	);

	// A terminal opens in its tab the moment it is made. The title is the
	// caller's, since only it knows the language and how many came before.
	const createTerminal = useCallback(
		(projectId: string, title: string) => {
			const id = `s${Date.now()}`;
			setSessions((previous) => [{ id, title, projectId }, ...previous]);
			openIn(projectId, {
				kind: "session",
				id: `session:${id}`,
				sessionId: id,
			});
		},
		[openIn],
	);

	// A workspace is a name and nothing else. It opens empty, on the same "+"
	// every other window shows, so making one does not decide what goes in it.
	const createWorkspace = useCallback((name: string) => {
		const id = `p${Date.now()}`;
		setProjects((previous) => [...previous, { id, name }]);
		setActiveProjectId(id);
	}, []);

	// Forgetting a workspace closes its terminals, and their browsers.
	const removeWorkspace = useCallback(
		(projectId: string) => {
			for (const browser of browsersOf(windows[projectId] ?? emptyWindow()))
				void ipc.browserClose(browser.browserId);
			setProjects((previous) => {
				const next = previous.filter((item) => item.id !== projectId);
				if (projectId === activeProjectId)
					setActiveProjectId(next[0]?.id ?? "");
				return next;
			});
			setSessions((previous) =>
				previous.filter((session) => session.projectId !== projectId),
			);
			setWindows(({ [projectId]: _dropped, ...rest }) => rest);
		},
		[activeProjectId, windows],
	);

	return {
		sessions,
		projects,
		/** Every open tab of the window, across its groups. */
		panes: window.groups.flatMap((group) => group.panes),
		paneGroups: window.groups,
		/** How the groups are arranged, and their order on screen. */
		layout: window.layout,
		groupOrder: leaves(window.layout),
		openBrowser,
		/** Browser tabs by workspace, for the sidebar's list. */
		browsers,
		activeGroupId: activeGroup.id,
		/** The tab on screen in the group new tabs open in. */
		activeId,
		focusGroup,
		movePane,
		activeProjectId,
		selectProject: setActiveProjectId,
		focusPane,
		activeSession,
		activeProject,
		openSession,
		openFile,
		openIssue,
		openPull,
		closePane,
		createWorkspace,
		removeWorkspace,
		createTerminal,
	};
}
