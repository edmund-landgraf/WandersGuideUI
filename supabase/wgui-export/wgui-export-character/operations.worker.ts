// compile.bundle.js refers to this module worker. The edge runtime follows that
// URL while building the graph, so the file has to sit beside the bundle.
// Character export does not run the calculation pool.
self.onmessage = () => {
  self.postMessage({ status: 'error', message: 'operations worker is not available in export' });
};
