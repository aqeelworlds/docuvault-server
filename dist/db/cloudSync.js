/**
 * RETIRED — GitHub-JSON "database" sync.
 *
 * Previously this module synced the entire database to a JSON file in a GitHub
 * repository using a hardcoded personal access token. That design is removed:
 *
 *  - PostgreSQL (DATABASE_URL) is now the single persistent source of truth.
 *  - The hardcoded GitHub token was a critical security leak (it shipped inside
 *    the public Android app and the public repo). REVOKE IT at
 *    https://github.com/settings/tokens if you have not already.
 *
 * These exports remain as no-ops so that existing call sites keep compiling and
 * running without changes. New code must NOT reintroduce GitHub-based storage.
 */
export async function pullCloudDatabase() {
    return true;
}
export async function pushCloudDatabase() {
    return true;
}
export async function syncToCloudNow() {
    return true;
}
export function queueCloudSync() {
    // no-op: every write now goes straight to PostgreSQL
}
export async function ensureFreshData(_force = false) {
    // no-op: reads always come straight from PostgreSQL
}
