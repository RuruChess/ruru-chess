/**
 * Σύνδεση με ένα δωμάτιο της «Παρτίδας με φίλο» (WebSocket προς τον server του relay/). Ξανασυνδέεται μόνη της,
 * κρατά τη διαφορά ρολογιού με τον server και δίνει την κατάσταση που στέλνει εκείνος.
 * Χωρίς εξαρτήσεις από το υπόλοιπο Ruru: τη χρησιμοποιεί και η σελίδα του φίλου.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, RoomState, ServerMsg } from '../../core/online.ts';

export type Role = 'host' | 'guest' | 'spectator';

export interface RoomConn {
  status: 'connecting' | 'open' | 'retrying' | 'gone';
  role: Role | null;
  state: RoomState | null;
  online: { host: boolean; guest: boolean };
  /** ώρα του server − ώρα μας (χιλιοστά) */
  offset: number;
  /** τελευταίο σφάλμα από τον server (π.χ. «illegal») */
  error: string | null;
  send: (m: ClientMsg) => void;
}

/** «http(s)://host» → «ws(s)://host/ws/<id>?…» */
export function socketUrl(server: string, id: string, token: string | null, name?: string): string {
  const base = server.replace(/\/+$/, '').replace(/^http/, 'ws');
  const q = new URLSearchParams();
  if (token) q.set('t', token);
  if (name) q.set('name', name);
  const qs = q.toString();
  return `${base}/ws/${id}${qs ? `?${qs}` : ''}`;
}

export function useOnlineRoom(server: string, id: string, token: string | null, opts: { name?: string; onToken?: (t: string) => void } = {}): RoomConn {
  const [status, setStatus] = useState<RoomConn['status']>('connecting');
  const [role, setRole] = useState<Role | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [online, setOnline] = useState({ host: false, guest: false });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef(token);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let alive = true;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(socketUrl(server, id, tokenRef.current, optsRef.current.name));
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 25_000);
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          setRole(m.role);
          if (m.token) {
            tokenRef.current = m.token;
            optsRef.current.onToken?.(m.token);
          }
        } else if (m.t === 'state') {
          setOffset(m.now - Date.now());
          setState(m.state);
          setOnline(m.online);
          setError(null);
        } else if (m.t === 'error') setError(m.msg);
      };
      ws.onclose = (ev) => {
        clearInterval(ping);
        if (wsRef.current === ws) wsRef.current = null;
        if (!alive) return;
        // 4404: το δωμάτιο δεν υπάρχει (έληξε ή λάθος link)
        if (ev.code === 4404) return setStatus('gone');
        setStatus('retrying');
        timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
  }, [server, id]);

  const send = (m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  return { status, role, state, online, offset, error, send };
}
