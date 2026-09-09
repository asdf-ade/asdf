// Who a workspace's sessions are to each other. Pure, so the rules that fire
// when one is made or ended can be checked without a React tree.
import type { Session } from "./types";

/**
 * The number the next session of `projectId` is called by.
 *
 * One past the highest the workspace has used, not one past how many it holds:
 * counting hands a closed session's number to the next one, and the sidebar
 * ends up with two rows of the same name.
 */
export function nextOrdinal(sessions: Session[], projectId: string): number {
	return (
		sessions
			.filter((session) => session.projectId === projectId)
			.reduce((high, session) => Math.max(high, session.ordinal), 0) + 1
	);
}

/**
 * Another session of the same workspace, which is who a closing session's
 * workspace-owned things — its browsers — pass to. Undefined when it is the
 * workspace's last, and there is nowhere left to show them.
 */
export function siblingOf(
	sessions: Session[],
	sessionId: string,
): Session | undefined {
	const closing = sessions.find((session) => session.id === sessionId);
	if (!closing) return undefined;
	return sessions.find(
		(session) =>
			session.id !== sessionId && session.projectId === closing.projectId,
	);
}

/**
 * Which session is shown once `sessionId` closes. Its own workspace first, so
 * closing one of several agents on a repository leaves you in that repository;
 * failing that, whatever is left, so the app is never showing nothing while
 * sessions exist.
 */
export function successorOf(
	sessions: Session[],
	sessionId: string,
): Session | undefined {
	const left = sessions.filter((session) => session.id !== sessionId);
	return siblingOf(sessions, sessionId) ?? left[0];
}
