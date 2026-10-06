/**
 * Server-side Google Play purchase verification via the Android Publisher API.
 *
 * Configure with env var GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (the JSON content of a
 * Google Cloud service-account key that has the "Android Publisher" role / the
 * Play Console "View financial data" + "Manage orders" permissions).
 *
 * Return contract:
 *  - `{ verified: true, ... }`  -> Google confirmed the purchase. Trust it.
 *  - `{ verified: false }`       -> Google says the purchase is invalid/cancelled.
 *  - `null`                      -> could not verify (not configured or transient
 *                                   error). Caller falls back to trust-and-record
 *                                   so real buyers are never blocked.
 */
export async function verifyPlayPurchase(purchaseToken, productId, packageName) {
    const saJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    if (!saJson) {
        return null;
    }
    try {
        const { google } = await import('googleapis');
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(saJson),
            scopes: ['https://www.googleapis.com/auth/androidpublisher'],
        });
        const androidpublisher = google.androidpublisher({ version: 'v3', auth });
        const pkg = packageName || process.env.ANDROID_PACKAGE_NAME || 'com.docuvault.expirymanager';
        const lower = (productId || '').toLowerCase();
        const isSubscription = lower.includes('monthly') || lower.includes('yearly') || lower.includes('subscription');
        if (isSubscription) {
            const res = await androidpublisher.purchases.subscriptions.get({
                packageName: pkg,
                subscriptionId: productId,
                token: purchaseToken,
            });
            const d = res.data || {};
            // paymentState: 0=pending, 1=received, 2=free trial
            const paid = d.paymentState === 1 || d.paymentState === 2;
            const expiry = d.expiryTimeMillis ? Number(d.expiryTimeMillis) : undefined;
            if (paid && (!expiry || expiry > Date.now())) {
                return { verified: true, orderId: d.orderId, expiryTimeMillis: expiry };
            }
            return { verified: false };
        }
        // One-time in-app product (lifetime)
        const res = await androidpublisher.purchases.products.get({
            packageName: pkg,
            productId,
            token: purchaseToken,
        });
        const d = res.data || {};
        // purchaseState: 0=purchased, 1=cancelled
        if (d.purchaseState === 0) {
            return { verified: true, orderId: d.orderId };
        }
        return { verified: false };
    }
    catch (e) {
        console.warn('[PlayVerify] Google verification unavailable:', e?.message || e);
        return null;
    }
}
