/**
 * Server-side debug logger that only outputs when DEBUG_LOGS=true is set.
 */
export function debugLog(namespace: string, message: string, data?: any) {
  const isDebug = process.env.DEBUG_LOGS ? process.env.DEBUG_LOGS === "true" : false;
  if (!isDebug) return;

  const timestamp = new Date().toISOString();
  const prefix = `[DEBUG][${namespace}]`;
  
  if (data) {
    console.log(`${timestamp} ${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${timestamp} ${prefix} ${message}`);
  }
}
