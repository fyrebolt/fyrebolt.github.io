import { useCallback, useEffect, useState } from 'react';
import { clearToken, loadToken, probeAgent, saveToken } from './agent';

/**
 * Whether the local agent is there, and the passphrase for talking to it.
 *
 * Held once and passed down rather than looked up wherever it's wanted, because
 * two separate parts of the panel now depend on it — the buttons that start and
 * stop a pull, and the "Last attempt" line that only the agent can answer. Held
 * separately, unlocking in one place would leave the other blank until a
 * reload: a token another component saved to localStorage re-renders nobody.
 */
export interface AgentSession {
  /** null while the probe is in flight; false on every machine but the one. */
  available: boolean | null;
  token: string | null;
  /** Accept a passphrase that has already been checked against the agent. */
  remember: (token: string) => void;
  /** Throw away a passphrase the agent has since rejected. */
  forget: () => void;
}

export function useAgentSession(): AgentSession {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(() => loadToken());

  useEffect(() => {
    let stop = false;
    probeAgent().then((ok) => {
      if (!stop) setAvailable(ok);
    });
    return () => {
      stop = true;
    };
  }, []);

  const remember = useCallback((value: string) => {
    saveToken(value);
    setToken(value);
  }, []);

  const forget = useCallback(() => {
    clearToken();
    setToken(null);
  }, []);

  return { available, token, remember, forget };
}
