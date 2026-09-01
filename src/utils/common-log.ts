export type CommonLogSource = 'operations' | string;

export type CommonLogEntry = {
  at: string;
  source: CommonLogSource;
  message: string;
};

const MAX_ENTRIES = 100;

const entries: CommonLogEntry[] = [];
const listeners = new Set<(entry: CommonLogEntry) => void>();

export function getCommonLog(): readonly CommonLogEntry[] {
  return entries;
}

export function subscribeCommonLog(listener: (entry: CommonLogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function appendCommonLog(source: CommonLogSource, message: string): CommonLogEntry {
  const entry: CommonLogEntry = {
    at: new Date().toISOString(),
    source,
    message,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  console.error(`[${source}] ${message}`);
  for (const listener of listeners) {
    listener(entry);
  }
  return entry;
}
