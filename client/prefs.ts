import { useSettings } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { prefsSchema, prefsSettings, type Prefs } from "../shared/timeline";

// Saved prefs, shared by transformers (read at transform time) and renderers (subscribed).
let prefs: Prefs = prefsSchema.parse({});
const listeners = new Set<() => void>();

export const currentPrefs = () => prefs;

export function setPrefs(next: Prefs) {
  prefs = next;
  listeners.forEach((l) => l());
}

export const subscribePrefs = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Lets the dashboard preview prefs before they are saved. */
export const PrefsOverride = createContext<Prefs | undefined>(undefined);

export function usePrefs() {
  const override = useContext(PrefsOverride);
  const live = useSyncExternalStore(subscribePrefs, currentPrefs);
  return override ?? live;
}

// Settings can only be saved from a component; Command Center toggles hand their change to one that is always mounted.
const savers = new Set<(next: Prefs) => void>();

/** Applies prefs now and saves them through a mounted `usePrefsSaver` (the sidebar item); without one they last until reload. */
export function savePrefs(next: Prefs) {
  setPrefs(next);
  savers.forEach((save) => save(next));
}

export function usePrefsSaver() {
  const settings = useSettings(prefsSettings);
  const latest = useRef(settings);
  latest.current = settings;
  useEffect(() => {
    const save = (next: Prefs) => {
      const s = latest.current;
      if (s.status === "ready") void s.save(next, s.revision);
    };
    savers.add(save);
    return () => void savers.delete(save);
  }, []);
}
