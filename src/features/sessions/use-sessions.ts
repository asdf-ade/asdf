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
	windowOf,
} from "./panes";
import { nextOrdinal, siblingOf, successorOf } from "./roster";
import type { Pane, Project, Session } from "./types";

/** The browser panes a window holds. */
const browsersIn = (window: PaneWindow) =>
	window.groups
		.flatMap((group) => group.panes)
		.filter(
			(pane): pane is Extract<Pane, { kind: "browser" }> =>
				pane.kind === "browser",
		);

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
 * A session is one window: one agent, one terminal, one working directory, and
 * the files it opened. Splitting a window splits the view of those parts, never
 * the session — a second terminal is a second session, in the same workspace.
 * That is why `windows` is keyed by session and not by workspace: a workspace
 * is not one piece of work, it is the place several pieces of work happen.
 *
 * A browser is the exception. It belongs to the workspace and any of its
 * sessions can show and drive it, because an agent's shell is short-lived and
 * the page it was reading outlasts it.
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
		() => windows[activeSessionId] ?? emptyWindow(),
		[windows, activeSessionId],
	);
	const activeGroup =
		window.groups.find((group) => group.id === window.active) ??
		window.groups[0];
	const activeId = activeGroup.activeId;

	// The browsers of each workspace, gathered from wherever its sessions are
	// showing them, so the sidebar can list them as the workspace's.
	const browsers = useMemo(() => {
		const byProject: Record<string, Extract<Pane, { kind: "browser" }>[]> = {};
		for (const session of sessions) {
			const held = windows[session.id];
			if (!held) continue;
			const found = browsersIn(held);
			if (found.length === 0) continue;
			byProject[session.projectId] = [
				...(byProject[session.projectId] ?? []),
				...found,
			];
		}
		return byProject;
	}, [sessions, windows]);

	/** Opens a tab in a session's window, and brings that session to the front. */
	const openIn = useCallback(
		(sessionId: string, projectId: string, pane: Pane) => {
			setActiveProjectId(projectId);
			setActiveSessionId(sessionId);
			setWindows((previous) => ({
				...previous,
				[sessionId]: openPane(previous[sessionId] ?? emptyWindow(), pane),
			}));
		},
		[],
	);

	/** A session picked from the sidebar comes to the front, as it was left. */
	const openSession = useCallback(
		(sessionId: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			setActiveProjectId(session.projectId);
			setActiveSessionId(sessionId);
		},
		[sessions],
	);

	const openFile = useCallback(
		(sessionId: string, dir: string, path: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			openIn(sessionId, session.projectId, {
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
			if (!activeSession) return;
			openIn(activeSession.id, activeSession.projectId, {
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
			openIn(activeSession.id, activeSession.projectId, {
				kind: "pull",
				id: `pull:${activeSession.projectId}:${number}`,
				number,
			});
		},
		[activeSession, openIn],
	);

	const focusPane = useCallback(
		(id: string) => {
			setWindows((previous) => {
				const current = previous[activeSessionId];
				if (!current) return previous;
				return { ...previous, [activeSessionId]: focusIn(current, id) };
			});
		},
		[activeSessionId],
	);

	const focusGroup = useCallback(
		(id: string) => {
			setWindows((previous) => {
				const current = previous[activeSessionId];
				if (!current || current.active === id) return previous;
				return { ...previous, [activeSessionId]: { ...current, active: id } };
			});
		},
		[activeSessionId],
	);

	const movePane = useCallback(
		(id: string, drop: DropTarget) => {
			setWindows((previous) => {
				const current = previous[activeSessionId];
				if (!current) return previous;
				return { ...previous, [activeSessionId]: moveIn(current, id, drop) };
			});
		},
		[activeSessionId],
	);

	/**
	 * Ends a session: its terminal, its window and the tabs in it.
	 *
	 * Its browsers are the workspace's, so they are handed to another of the
	 * workspace's sessions rather than closed. When there is no other session
	 * to hand them to there is nowhere left to show them, and a view nothing
	 * can place or close is worse than a closed one.
	 */
	const closeSession = useCallback(
		(sessionId: string) => {
			const session = sessions.find((item) => item.id === sessionId);
			if (!session) return;
			const held = browsersIn(windows[sessionId] ?? emptyWindow());
			const heir = siblingOf(sessions, sessionId);
			if (!heir)
				for (const browser of held) void ipc.browserClose(browser.browserId);

			// Worked out here rather than inside the updater: an updater can be
			// called more than once for one change, and moving the selection is
			// not something to do twice.
			if (sessionId === activeSessionId) {
				const next = successorOf(sessions, sessionId);
				setActiveSessionId(next?.id ?? "");
				if (next) setActiveProjectId(next.projectId);
			}
			setSessions(sessions.filter((item) => item.id !== sessionId));
			setWindows(({ [sessionId]: _gone, ...rest }) => {
				if (!heir || held.length === 0) return rest;
				let inherited = rest[heir.id] ?? emptyWindow();
				for (const browser of held) inherited = openPane(inherited, browser);
				return { ...rest, [heir.id]: inherited };
			});
		},
		[sessions, windows, activeSessionId],
	);

	/**
	 * Closes one tab. A terminal tab is the session's only terminal, so closing
	 * it ends the session and the window with it. A browser is a live page and
	 * closing its tab ends it, which is the one place a workspace's browser is
	 * deliberately let go. The rest are only views.
	 */
	const closePane = useCallback(
		(id: string) => {
			const pane = window.groups
				.flatMap((group) => group.panes)
				.find((item) => item.id === id);
			if (pane?.kind === "session") {
				closeSession(pane.sessionId);
				return;
			}
			if (pane?.kind === "browser") void ipc.browserClose(pane.browserId);
			setWindows((previous) => {
				const current = previous[activeSessionId];
				if (!current) return previous;
				return { ...previous, [activeSessionId]: closeIn(current, id) };
			});
		},
		[activeSessionId, window, closeSession],
	);

	/**
	 * Shows a workspace's browser in the session on screen, taking it out of
	 * whichever session was showing it. One view, one place: it is a live page,
	 * not a picture of one, so it cannot be in two windows at once.
	 */
	const openBrowser = useCallback(
		(projectId: string, browserId: number) => {
			const pane: Pane = {
				kind: "browser",
				id: `browser:${browserId}`,
				browserId,
			};
			const target =
				activeSession?.projectId === projectId
					? activeSession
					: sessions.find((item) => item.projectId === projectId);
			if (!target) return;
			setActiveProjectId(projectId);
			setActiveSessionId(target.id);
			setWindows((previous) => {
				const next: Record<string, PaneWindow> = {};
				for (const [id, held] of Object.entries(previous))
					next[id] = id === target.id ? held : closeIn(held, pane.id);
				next[target.id] = openPane(next[target.id] ?? emptyWindow(), pane);
				return next;
			});
		},
		[activeSession, sessions],
	);

	/**
	 * Makes a session and the terminal it is.
	 *
	 * Its number is one past the highest the workspace has used, not one past
	 * how many it holds: counting would hand a closed session's number to the
	 * next one and put two of the same name in the sidebar.
	 */
	const createSession = useCallback(
		(projectId: string) => {
			const id = `s${Date.now()}`;
			const ordinal = nextOrdinal(sessions, projectId);
			setSessions((previous) => [{ id, ordinal, projectId }, ...previous]);
			setActiveProjectId(projectId);
			setActiveSessionId(id);
			setWindows((previous) => ({
				...previous,
				[id]: windowOf({ kind: "session", id: `session:${id}`, sessionId: id }),
			}));
		},
		[sessions],
	);

	// A workspace is a name and the folder its sessions open in. It opens
	// empty, on the same "+" every session shows, so making one does not
	// decide what goes in it.
	const createWorkspace = useCallback(
		(name: string, path: string | null = null) => {
			const id = `p${Date.now()}`;
			setProjects((previous) => [...previous, { id, name, path }]);
			setActiveProjectId(id);
			setActiveSessionId("");
		},
		[],
	);

	// Forgetting a workspace ends its sessions and the browsers it owned.
	const removeWorkspace = useCallback(
		(projectId: string) => {
			const own = sessions.filter((item) => item.projectId === projectId);
			for (const session of own)
				for (const browser of browsersIn(windows[session.id] ?? emptyWindow()))
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
			if (own.some((session) => session.id === activeSessionId))
				setActiveSessionId("");
			setWindows((previous) => {
				const next = { ...previous };
				for (const session of own) delete next[session.id];
				return next;
			});
		},
		[activeProjectId, activeSessionId, sessions, windows],
	);

	return {
		sessions,
		projects,
		/** Every open tab of the session on screen, across its groups. */
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
		activeSessionId,
		activeProject,
		openSession,
		openFile,
		openIssue,
		openPull,
		closePane,
		closeSession,
		createWorkspace,
		removeWorkspace,
		createSession,
	};
}
