import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent } from '../domain/types';
import { isDamaged } from '../domain/conversation';
import {
  foldSession,
  liveFromConversation,
  sessionBoard,
  type SessionLive,
  type SessionRow,
} from '../domain/session-board';
import { hostEvents } from './host-events';

const host = window.irori;

/** The set less one id; the same set when it lacks it. */
const without = (id: string) => (all: ReadonlySet<string>) => {
  if (!all.has(id)) return all;
  const next = new Set(all);
  next.delete(id);
  return next;
};

/** An owner whose conversations the board lists: a vault, or the irori agent of the workspace. */
export interface BoardOwner {
  scopeId: string;
  /** The irori agent: its conversations are the workspace's (ADR 017 D4). */
  irori?: boolean;
}

/**
 * What the session board shows (ADR 069): the conversations of every owner in the
 * workspace, read from the host when a run begins or ends, and followed between
 * those reads from the runs' events. Nothing here is kept across restarts.
 */
export function useSessionBoard({
  enabled,
  owners,
  workspaceId,
  open,
  visible,
}: {
  enabled: boolean;
  owners: BoardOwner[];
  workspaceId?: string;
  /** Conversations open as a tab or on show in a column. */
  open: ReadonlySet<string>;
  /** Conversations on show in a column on screen: what they did is seen. */
  visible: readonly string[];
}) {
  const [rows, setRows] = useState<Record<string, SessionRow[]>>({});
  const [live, setLive] = useState<Record<string, SessionLive>>({});
  const [seen, setSeen] = useState<Record<string, number>>({});
  // Conversations closed on the board, until they are opened again or run again.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const ownerKey = owners.map((owner) => `${owner.scopeId}:${owner.irori ? 1 : 0}`).join(',');
  const ownersRef = useRef(owners);
  ownersRef.current = owners;

  // Each owner's rows, read again a moment after one of its runs begins or ends.
  const reading = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const read = useCallback(
    (scopeId: string, delay = 0) => {
      const owner = ownersRef.current.find((item) => item.scopeId === scopeId);
      if (!owner) return;
      clearTimeout(reading.current.get(scopeId));
      reading.current.set(
        scopeId,
        setTimeout(() => {
          reading.current.delete(scopeId);
          host
            .agentConversations(scopeId, owner.irori ? workspaceId : undefined)
            .then((list) => {
              // The owner may have left the workspace while it was read.
              if (!ownersRef.current.some((item) => item.scopeId === scopeId)) return;
              setRows((all) => ({
                ...all,
                [scopeId]: list.flatMap((row) => (isDamaged(row) ? [] : [{ ...row, scopeId }])),
              }));
            })
            .catch(() => {
              // The board is a summary: a list it cannot read (a host out of reach) keeps
              // what it showed, and the owner's own column reports the failure.
            });
        }, delay),
      );
    },
    [workspaceId],
  );
  useEffect(() => {
    if (!enabled) return;
    for (const owner of owners) read(owner.scopeId);
    // Owners that left take their rows with them.
    setRows((all) => {
      const kept = Object.fromEntries(
        Object.entries(all).filter(([scopeId]) =>
          owners.some((owner) => owner.scopeId === scopeId),
        ),
      );
      return Object.keys(kept).length === Object.keys(all).length ? all : kept;
    });
  }, [enabled, ownerKey, read]);
  useEffect(
    () => () => {
      for (const timer of reading.current.values()) clearTimeout(timer);
    },
    [],
  );

  // The runs' events, folded into each conversation's state once per frame.
  useEffect(() => {
    if (!enabled) return;
    let pending: AgentEvent[] = [];
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = timer = undefined;
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      const now = Date.now();
      setLive((all) => {
        const next = { ...all };
        for (const event of batch)
          next[event.conversationId!] = foldSession(next[event.conversationId!], event, now);
        return next;
      });
    };
    const stop = hostEvents.onEvent((event) => {
      if (event.type !== 'agent') return;
      const incoming = event.event;
      if (!incoming.conversationId || !incoming.scopeId) return;
      if (!ownersRef.current.some((owner) => owner.scopeId === incoming.scopeId)) return;
      pending.push(incoming);
      // A new run brings a conversation closed on the board back.
      if (incoming.role === 'user') setClosed(without(incoming.conversationId));
      // A run that begins or ends changes the owner's list: a new title, a queue, a hand-off.
      if (incoming.role === 'user' || incoming.type === 'done') read(incoming.scopeId, 250);
      if (frame === undefined && timer === undefined) {
        if (!document.hidden) frame = requestAnimationFrame(flush);
        timer = setTimeout(flush, 250);
      }
    });
    return () => {
      flush();
      stop();
    };
  }, [enabled, read]);

  // A run this window did not see begin (before a reload, on another window) is read once.
  const fetched = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    for (const list of Object.values(rows))
      for (const row of list) {
        if (!row.running || live[row.id] || fetched.current.has(row.id)) continue;
        fetched.current.add(row.id);
        const irori = ownersRef.current.find((owner) => owner.scopeId === row.scopeId)?.irori;
        host
          .agentConversation(row.scopeId, row.agent, row.id, irori ? workspaceId : undefined)
          .then((conversation) =>
            setLive((all) =>
              // Events that arrived meanwhile already tell more than the read.
              all[row.id]
                ? all
                : { ...all, [row.id]: liveFromConversation(conversation, Date.now()) },
            ),
          )
          .catch(() => {
            // As above: the conversation's column says why it cannot be read.
          });
      }
  }, [enabled, rows, live, workspaceId]);

  // What is on show in a column is seen as it happens.
  const visibleKey = visible.join(',');
  useEffect(() => {
    setSeen((all) => {
      let next = all;
      for (const id of visible) {
        const changed = live[id]?.changedAt;
        if (changed !== undefined && !(all[id] >= changed)) next = { ...next, [id]: Date.now() };
      }
      return next;
    });
  }, [visibleKey, live]);
  const acknowledge = useCallback(
    (id: string) => setSeen((all) => ({ ...all, [id]: Date.now() })),
    [],
  );
  /** Takes a conversation off the board; `reopen` puts it back. */
  const close = useCallback(
    (id: string) => setClosed((all) => (all.has(id) ? all : new Set(all).add(id))),
    [],
  );
  const reopen = useCallback((id: string) => setClosed(without(id)), []);
  // One opened again as a tab or in a column shows again. Only an opening counts:
  // a column may still show it for a moment while it is closed.
  const wasOpen = useRef(open);
  useEffect(() => {
    const before = wasOpen.current;
    wasOpen.current = open;
    setClosed((all) => {
      let next = all;
      for (const id of all) if (open.has(id) && !before.has(id)) next = without(id)(next);
      return next;
    });
  }, [open]);

  const lanes = useMemo(
    () =>
      sessionBoard({
        rows: owners.flatMap((owner) => rows[owner.scopeId] ?? []),
        live,
        open,
        seen,
        closed,
      }),
    [rows, live, open, seen, closed, ownerKey],
  );
  return { lanes, acknowledge, close, reopen };
}
