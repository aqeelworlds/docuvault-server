/**
 * Shared test helper: upgrade a user to a Pro plan via the admin endpoint.
 *
 * Direct POST /subscriptions/upgrade is admin-only since the security fix,
 * so tests must upgrade through PUT /admin/users/:id/subscription instead.
 *
 * @param {Function} request - the test file's request(endpoint, options) helper
 * @param {string} userToken - JWT of the user to upgrade
 * @param {string} planId - target plan (default PRO_MONTHLY)
 * @returns the upgrade response { status, data }
 */
export async function adminUpgradeUser(request, userToken, planId = 'PRO_MONTHLY') {
  let adminToken;
  const adminReg = await request('/auth/register', {
    method: 'POST',
    body: { email: 'aqeelpay38@gmail.com', password: 'Password123!', fullName: 'Test Admin' }
  });
  if (adminReg.status === 201) {
    adminToken = adminReg.data.token;
  } else {
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: { email: 'aqeelpay38@gmail.com', password: 'Password123!' }
    });
    adminToken = adminLogin.data.token;
  }
  const meRes = await request('/auth/me', {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  const targetUserId = meRes.data.user.id;
  return request(`/admin/users/${targetUserId}/subscription`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { planId, status: 'ACTIVE' }
  });
}
