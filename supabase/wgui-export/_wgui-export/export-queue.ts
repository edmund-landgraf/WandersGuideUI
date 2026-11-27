// Serialize catalog lifetime, including loading and cleanup, not just compilation.
// Each isolate has its own queue; no cross-isolate synchronization is implied.
export function createExportQueue<P>(setPackage: (pkg: P) => void, clearPackage: () => void) {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(load: () => Promise<P>, compile: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      try {
        setPackage(await load());
        return await compile();
      } finally {
        clearPackage();
      }
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
