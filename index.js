/**
 * Host half of dsh-effort-slider.
 *
 * The whole feature lives in the browser half (`client.js`): the slider reads
 * the shared per-session model directory and submits through the official
 * `session.selectModel` path, so this half only has to make the row exist for
 * the Loader — the Client-module scanner discovers the bundle from this row's
 * package manifest (`dsh.client` + `exports["./client"]`).
 */
export function apply() {}
