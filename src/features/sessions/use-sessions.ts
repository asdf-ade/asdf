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
import { nextOrdinal, successorOf } from "./roster";
import type { Pane, Project, Session } from "./types";

/** Every tab of a window, across its splits. */
const panesIn = (window: PaneWindow) =>
	window.groups.flatMap((group) => group.panes);

/** The browser panes a window holds. */
const browsersIn = (window: PaneWindow) =>
	panesIn(window).filter(
		(pane): pane is Extract<Pane, { kind: "browser" }> =>
			pane.kind === "browser",
	);

/** The session a tab answers to, for the tabs that belong to one. */
const sessionOf = (pane: Pane): string | null =>
	"sessionId" in pane ? pane.sessionId : null;

// Workspaces outlive the app; sessions do not. So the names are written to
// storage and everything else starts empty.
const STORAGE_KEY = "workspaces";

function loadProjects(): Project[] {
	try {
		const stored = JSON.parse(
			localStorage.getItem(STORAGE_KEY) ?? "[]",
		) as Project[];
		// Workspaces written before a workspace could hold a folder have no
		// `path` at all; they are the name-only kind, which is still a kind.
		return stored.map((project) => ({
			...project,
			path: project.path ?? null,
		}));
	} catch {
		return [];
	}
}

/**
 * The sessions of every workspace, and the one on screen.
 *
 * A workspace is a window, and everything open in it is a tab in that window's
 * strip: its terminals, the files they opened, the issues and pulls of the
 * repository they are in, and the browsers an agent drives. `windows` is keyed
 * by workspace for that reason — a strip that can only ever hold the one
 * terminal you are already looking at is not a way to get between things.
 *
 * A session is still one shell with one working directory, numbered within its
 * workspace. What changed is only where its tab lives.
 */
export function useSessions() {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [projects, setProjects] = useState<Project[]>(loadProjects);
	const [activeProjectId, setActiveProjectId] = useState(
		() => loadProjects()[0]?.id ?? "",
	);
	const [activeSessionId, setActiveSessionId] = useState("");
	const [windows, setWindows] = useState<Record<string, PaneWindow>>({});

	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
		} catch {
			// Nothing to remember them with; they last until the window closes.
		}
	}, [projects]);

	const activeSession = sessions.find(
		(session) => session.id === activeSessionId,
	);
	const activeProject = projects.find(
		(project) => project.id === activeProjectId,
	);

	const window = useMemo(
		() => windows[activeProjectId] ?? emptyWindow(),
		[windows, activeProjectId],
	);
	const activeGroup =
		window.groups.find((group) => group.id === window.active) ??
		window.groups[0];
	const activeId = activeGroup.activeId;

	// The browsers of each workspace, for the sidebar's list. They live in the
	// workspace's window like everything else, so this is a read of it.
	const browsers = useMemo(() => {
		const byProject: Record<string, Extract<Pane, { kind: "browser" }>[]> = {};
		for (const [projectId, held] of Object.entries(windows)) {
			const found = browsersIn(held);
			if (found.length > 0) byProject[projectId] = found;
		}
		return byProject;
	}, [windows]);

	/** Opens a tab in a workspace's window and brings that workspace to the
	 *  front. `sessionId` is the session the tab answers to, where it has one. */
	const openIn = useCallback(
		(projectId: string, pane: Pane, sessionId?: string) => {
			setActiveProjectId(projectId);
			if (sessionId) setActiveSessionId(sessionId);
			setWindows((previous) => ({
				...previous,
				[projectId]: openPane(previous[projectId] ?? emptyWindow(), pane),
			}));
		},
		[],
	);

	/**
	 * A workspace picked from the sidebar brings its window back as it was left,
	 * and the panel follows whichever of its terminals the showing tab belongs
	 * to — falling back to any of them, so a workspace with terminals never
	 * shows the panel as if it had none.
	 */
	const selectProject = useCallback(
		(projectId: string) => {
			setActiveProjectId(projectId);
			const held = windows[projectId];
			const showing = held
				? held.groups
						.flatMap((group) =>
							group.panes.filter((pane) => pane.id === group.activeId),
						)
						.map(sessionOf)
						.find((id): id is string => id !== null)
				: undefined;
			setActiveSessionId(
				showing ??
					sessions.find((item) => item.projectId === projectId)?.id ??
					"",
			);
		},
		[sessions, windows],
	);

	/** A session picked from the sidebar brings its tab to the front. */
	const openSession = useCallback(
		(sessionId: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			setActiveProjectId(session.projectId);
			setActiveSessionId(sessionId);
			setWindows((previous) => {
				const held = previous[session.projectId];
				if (!held) return previous;
				return {
					...previous,
					[session.projectId]: focusIn(held, `session:${sessionId}`),
				};
			});
		},
		[sessions],
	);

	const openFile = useCallback(
		(
			sessionId: string,
			dir: string,
			path: string,
			line?: number,
			ranges?: [number, number][],
		) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			// The line is not part of the id: one file is one tab, and opening it
			// again at another line moves that tab rather than making a second.
			openIn(
				session.projectId,
				{
					kind: "file",
					id: `file:${dir}/${path}`,
					sessionId,
					dir,
					path,
					line,
					ranges,
				},
				sessionId,
			);
		},
		[sessions, openIn],
	);

	const openIssue = useCallback(
		(number: number) => {
			if (!activeSession) return;
			openIn(activeSession.projectId, {
				kind: "issue",
				id: `issue:${activeSession.projectId}:${number}`,
				number,
			});
		},
		[activeSession, openIn],
	);

	const openPull = useCallback(
		(number: number) => {
			if (!activeSession) return;
			openIn(activeSession.projectId, {
				kind: "pull",
				id: `pull:${activeSession.projectId}:${number}`,
				number,
			});
		},
		[activeSession, openIn],
	);

	/**
	 * Shows a tab. A tab that belongs to a session also moves the panel onto
	 * that session, which is what makes the tree and the diff follow the
	 * terminal you are looking at rather than the one opened last.
	 */
	const focusPane = useCallback(
		(id: string) => {
			const shown = panesIn(window).find((pane) => pane.id === id);
			const owner = shown ? sessionOf(shown) : null;
			if (owner) setActiveSessionId(owner);
			setWindows((previous) => {
				const current = previous[activeProjectId];
				if (!current) return previous;
				return { ...previous, [activeProjectId]: focusIn(current, id) };
			});
		},
		[activeProjectId, window],
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

	/**
	 * Ends a session: its shell, its tab, and the file tabs that were opened
	 * from it — a diff of a folder whose shell is gone has nothing to refresh
	 * against. The workspace's browsers stay where they are; they never belonged
	 * to the session.
	 */
	const closeSession = useCallback(
		(sessionId: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			const { projectId } = session;

			// Worked out here rather than inside the updater: an updater can be
			// called more than once for one change, and moving the selection is
			// not something to do twice.
			if (sessionId === activeSessionId) {
				const next = successorOf(sessions, sessionId);
				setActiveSessionId(next?.id ?? "");
				if (next) setActiveProjectId(next.projectId);
			}
			setSessions(sessions.filter((item) => item.id !== sessionId));
			setWindows((previous) => {
				const held = previous[projectId];
				if (!held) return previous;
				const owned = panesIn(held).filter(
					(pane) => sessionOf(pane) === sessionId,
				);
				return {
					...previous,
					[projectId]: owned.reduce(
						(window, pane) => closeIn(window, pane.id),
						held,
					),
				};
			});
		},
		[sessions, activeSessionId],
	);

	/**
	 * Closes one tab. A terminal tab is a session's only terminal, so closing it
	 * ends the session and takes its file tabs with it. A browser is a live page
	 * and closing its tab ends it. The rest are only views.
	 */
	const closePane = useCallback(
		(id: string) => {
			const pane = panesIn(window).find((item) => item.id === id);
			if (pane?.kind === "session") {
				closeSession(pane.sessionId);
				return;
			}
			if (pane?.kind === "browser") void ipc.browserClose(pane.browserId);
			setWindows((previous) => {
				const current = previous[activeProjectId];
				if (!current) return previous;
				return { ...previous, [activeProjectId]: closeIn(current, id) };
			});
		},
		[activeProjectId, window, closeSession],
	);

	/** Brings a workspace's browser to the front of its window. */
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

	/**
	 * Makes a session and the terminal it is, under a number already worked out.
	 *
	 * Split from `createSession` so a workspace can open with its first terminal
	 * without consulting the roster: a workspace being made has no sessions to
	 * count, so its first is always number one, and the roster it would ask is
	 * the state this same render is about to replace.
	 */
	const startSession = useCallback(
		(projectId: string, ordinal: number) => {
			const id = `s${Date.now()}`;
			setSessions((previous) => [{ id, ordinal, projectId }, ...previous]);
			openIn(
				projectId,
				{ kind: "session", id: `session:${id}`, sessionId: id },
				id,
			);
		},
		[openIn],
	);

	/**
	 * Makes a session and the terminal it is.
	 *
	 * Its number is one past the highest the workspace has used, not one past
	 * how many it holds: counting would hand a closed session's number to the
	 * next one and put two of the same name in the sidebar.
	 */
	const createSession = useCallback(
		(projectId: string) =>
			startSession(projectId, nextOrdinal(sessions, projectId)),
		[sessions, startSession],
	);

	// A workspace is a name and the folder its sessions open in, and it opens
	// with a terminal already in it. Nobody makes a workspace in order to look
	// at an empty one: the next click was always "+", and the empty window that
	// stood in between said only that there was one more step to go.
	const createWorkspace = useCallback(
		(name: string, path: string | null = null) => {
			const id = `p${Date.now()}`;
			setProjects((previous) => [...previous, { id, name, path }]);
			startSession(id, 1);
		},
		[startSession],
	);

	/**
	 * Gives a workspace its folder, or takes it away.
	 *
	 * Only terminals opened after this start there: a shell's working directory
	 * is the shell's, and moving a running one out from under whoever is typing
	 * in it is not something a menu should be able to do.
	 */
	const setWorkspacePath = useCallback(
		(projectId: string, path: string | null) => {
			setProjects((previous) =>
				previous.map((project) =>
					project.id === projectId ? { ...project, path } : project,
				),
			);
		},
		[],
	);

	// Forgetting a workspace ends its sessions and the browsers it owned.
	const removeWorkspace = useCallback(
		(projectId: string) => {
			for (const browser of browsersIn(windows[projectId] ?? emptyWindow()))
				void ipc.browserClose(browser.browserId);
			// Worked out here rather than inside an updater, for the same reason as
			// in `closeSession`. When the workspace on screen goes, the next one
			// comes up showing one of its own sessions: moving the workspace without
			// the session left an empty window beside a workspace that had one.
			const left = projects.filter((item) => item.id !== projectId);
			if (projectId === activeProjectId) {
				const next = left[0];
				setActiveProjectId(next?.id ?? "");
				setActiveSessionId(
					sessions.find((item) => item.projectId === next?.id)?.id ?? "",
				);
			}
			setProjects(left);
			setSessions((previous) =>
				previous.filter((session) => session.projectId !== projectId),
			);
			setWindows(({ [projectId]: _gone, ...rest }) => rest);
		},
		[activeProjectId, projects, sessions, windows],
	);

	return {
		sessions,
		projects,
		/** Every open tab of the workspace on screen, across its groups. */
		panes: panesIn(window),
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
		selectProject,
		focusPane,
		activeSession,
		activeSessionId,
		activeProject,
		openSession,
		openFile,
		openIssue,
		openPull,
		closePane,
		closeSession,
		createWorkspace,
		setWorkspacePath,
		removeWorkspace,
		createSession,
	};
}
