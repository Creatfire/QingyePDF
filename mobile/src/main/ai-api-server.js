// The loopback OpenAPI server is a desktop feature: an Android app has no other local AI tools
// to serve, so the mobile build keeps the settings shape and reports the interface as unavailable.
export function createApiServer() {
  let allowEdits = false;
  return {
    async start() { throw new Error('安卓版不提供本地 AI 接口。'); },
    async stop() {},
    status: () => ({ running: false, port: 0, url: '', openapi: '', unsupported: true }),
    update(values) { if (typeof values?.allowEdits === 'boolean') allowEdits = values.allowEdits; },
  };
}
export default { createApiServer };
