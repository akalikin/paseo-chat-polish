import { createContext, useContext, useSyncExternalStore } from "react";
import { prefsSchema, type Prefs } from "../shared/timeline";

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
