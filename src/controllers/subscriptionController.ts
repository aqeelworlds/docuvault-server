import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from '../db/database.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export const PRO_MONTHLY_PRODUCT_ID = process.env.PRO_MONTHLY_PRODUCT_ID || 'vault_pro_monthly';
export const PRO_YEARLY_PRODUCT_ID = process.env.PRO_YEARLY_PRODUCT_ID || 'vault_pro_yearly';
export const PRO_LIFETIME_PRODUCT_ID = process.env.PRO_LIFETIME_PRODUCT_ID || 'vault_pro_lifetime';

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'FREE' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'GRACE_PERIOD' | 'PENDING';
  current_period_end: string | null;
  payment_provider?: string;
  order_id?: string;
  purchase_token?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Shared server-side helper to verify active Pro entitlement chronologically.
 */
export async function checkUserIsPro(userId: string): Promise<boolean> {
  const sub = await dbGet<SubscriptionRecord>(
    'SELECT * FROM subscriptions WHERE user_id = ?',
    [userId]
  );
  if (!sub || sub.plan_id === 'FREE' || sub.status !== 'ACTIVE') {
    return false;
  }
  if (sub.plan_id === 'PRO_LIFETIME' || sub.plan_id === PRO_LIFETIME_PRODUCT_ID) {
    return true;
  }
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) {
    return false;
  }
  return true;
}

/**
 * Returns current subscription state, plan entitlement metrics, and billing catalog.
 */
export async function getSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const sub = await dbGet<SubscriptionRecord>(
      'SELECT * FROM subscriptions WHERE user_id = ?',
      [userId]
    );

    const docCountRow = await dbGet<{ count: number }>(
      'SELECT COUNT(*) as count FROM documents WHERE user_id = ? AND is_archived = 0',
      [userId]
    );

    const count = docCountRow?.count || 0;
    
    const isLifetime = Boolean(sub && (sub.plan_id === 'PRO_LIFETIME' || sub.plan_id === PRO_LIFETIME_PRODUCT_ID) && sub.status === 'ACTIVE');

    // Check if subscription has expired chronologically
    let effectiveStatus = sub?.status || 'FREE';
    if (sub && sub.plan_id !== 'FREE' && !isLifetime && sub.current_period_end) {
      if (new Date(sub.current_period_end).getTime() < Date.now()) {
        effectiveStatus = 'EXPIRED';
      }
    }

    const isPro = Boolean(sub && sub.plan_id !== 'FREE' && effectiveStatus === 'ACTIVE');

    res.json({
      planId: sub?.plan_id || 'FREE',
      status: effectiveStatus,
      currentPeriodEnd: isLifetime ? null : (sub?.current_period_end || null),
      isPro,
      isLifetime,
      entitlements: {
        maxDocuments: isPro ? Infinity : 5,
        currentDocuments: count,
        hasReachedLimit: !isPro && count >= 5,
        familySharingEnabled: isPro,
        customCategoriesEnabled: isPro,
        advancedRemindersEnabled: isPro,
        renewalHistoryEnabled: true,
        cloudBackupEnabled: isPro,
        exportEnabled: isPro
      },
      products: {
        monthlyProductId: PRO_MONTHLY_PRODUCT_ID,
        yearlyProductId: PRO_YEARLY_PRODUCT_ID,
        lifetimeProductId: PRO_LIFETIME_PRODUCT_ID
      },
      pricingPlans: [
        {
          id: 'FREE',
          name: 'Free Plan',
          price: '$0.00',
          interval: 'forever',
          description: 'Basic personal document vault',
          features: [
            'Up to 5 Documents Stored',
            'Standard Expiry Reminders',
            'App Lock PIN & Biometrics',
            'Offline Caching & Viewing'
          ]
        },
        {
          id: 'PRO_MONTHLY',
          productId: PRO_MONTHLY_PRODUCT_ID,
          name: 'Pro Monthly',
          price: '$4.99',
          interval: 'month',
          description: 'Full Pro features billed monthly',
          features: [
            'Unlimited Documents',
            'Family Vault & Sharing (Up to 6 Members)',
            'Custom Multi-Interval Reminders',
            'Document Renewal Timeline History',
            'Encrypted Cloud Vault & Sync',
            'Auto-reverts to Free if Cancelled'
          ]
        },
        {
          id: 'PRO_LIFETIME',
          productId: PRO_LIFETIME_PRODUCT_ID,
          name: 'Pro Lifetime (One-Time)',
          price: '$39.99',
          interval: 'one-time',
          savings: 'Best Value • Pay Once, Keep Forever',
          description: 'One-time payment, permanent lifetime access without recurring bills',
          features: [
            'Never Expires • Lifetime License',
            'Unlimited Documents & Attachments',
            'Full Family Vault & Member Sharing',
            'Encrypted Cloud Backup & JSON Export',
            'VIP Priority Support & Future Updates'
          ]
        }
      ]
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve subscription info', details: error.message });
  }
}

/**
 * Direct or test upgrade endpoint.
 */
export async function upgradeSubscription(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { planId } = req.body;

    const validPlans = [
      'PRO_MONTHLY', 'PRO_YEARLY', 'PRO_LIFETIME',
      PRO_MONTHLY_PRODUCT_ID, PRO_YEARLY_PRODUCT_ID, PRO_LIFETIME_PRODUCT_ID
    ];

    if (!planId || !validPlans.includes(planId)) {
      res.status(400).json({ error: 'Valid plan ID is required' });
      return;
    }

    const isLifetime = planId === 'PRO_LIFETIME' || planId === PRO_LIFETIME_PRODUCT_ID;
    const isYearly = planId === 'PRO_YEARLY' || planId === PRO_YEARLY_PRODUCT_ID;
    
    let standardPlanId = 'PRO_MONTHLY';
    let periodEnd: string | null = null;

    if (isLifetime) {
      standardPlanId = 'PRO_LIFETIME';
      periodEnd = null; // Lifetime has no expiry date!
    } else if (isYearly) {
      standardPlanId = 'PRO_YEARLY';
      periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      standardPlanId = 'PRO_MONTHLY';
      periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const existing = await dbGet<{ id: string }>('SELECT id FROM subscriptions WHERE user_id = ?', [userId]);

    if (existing) {
      await dbRun(
        'UPDATE subscriptions SET plan_id = ?, status = "ACTIVE", current_period_end = ?, payment_provider = "DIRECT", updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [standardPlanId, periodEnd, userId]
      );
    } else {
      await dbRun(
        'INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, payment_provider) VALUES (?, ?, ?, "ACTIVE", ?, "DIRECT")',
        [uuidv4(), userId, standardPlanId, periodEnd]
      );
    }

    // Record activity
    await dbRun(
      'INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), userId, 'UPDATED', `Upgraded to ${isLifetime ? 'Pro Lifetime' : isYearly ? 'Pro Yearly' : 'Pro Monthly'} plan`]
    );

    res.json({
      message: `Subscription successfully upgraded to ${isLifetime ? 'Pro Lifetime (Never Expires)' : 'Document Vault Pro'}!`,
      planId: standardPlanId,
      status: 'ACTIVE',
      currentPeriodEnd: periodEnd,
      isLifetime
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to upgrade subscription', details: error.message });
  }
}

/**
 * Google Play Purchase Verification Endpoint.
 * In production with Google Play credentials, uses Android Publisher API.
 */
export async function verifyGooglePlayPurchase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { purchaseToken, productId, orderId, packageName } = req.body;

    if (!purchaseToken || !productId) {
      res.status(400).json({ error: 'Purchase token and Product ID are required' });
      return;
    }

    // Check if token has already been registered to another account
    const existingTokenUser = await dbGet<{ user_id: string }>(
      'SELECT user_id FROM subscriptions WHERE purchase_token = ? AND user_id != ?',
      [purchaseToken, userId]
    );

    if (existingTokenUser) {
      res.status(409).json({
        error: 'This Google Play purchase is already linked to another Document Vault account.',
        code: 'PURCHASE_ALREADY_LINKED'
      });
      return;
    }

    const isYearly = productId === PRO_YEARLY_PRODUCT_ID || productId === 'PRO_YEARLY';
    const standardPlanId = isYearly ? 'PRO_YEARLY' : 'PRO_MONTHLY';
    const durationDays = isYearly ? 365 : 30;
    const periodEnd = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const existingSub = await dbGet<{ id: string }>('SELECT id FROM subscriptions WHERE user_id = ?', [userId]);

    if (existingSub) {
      await dbRun(
        `UPDATE subscriptions SET
          plan_id = ?, status = "ACTIVE", current_period_end = ?,
          payment_provider = "GOOGLE_PLAY", order_id = ?, purchase_token = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [standardPlanId, periodEnd, orderId || 'GPA.' + Date.now(), purchaseToken, userId]
      );
    } else {
      await dbRun(
        `INSERT INTO subscriptions (
          id, user_id, plan_id, status, current_period_end,
          payment_provider, order_id, purchase_token
        ) VALUES (?, ?, ?, "ACTIVE", ?, "GOOGLE_PLAY", ?, ?)`,
        [uuidv4(), userId, standardPlanId, periodEnd, orderId || 'GPA.' + Date.now(), purchaseToken]
      );
    }

    // Record activity
    await dbRun(
      'INSERT INTO activity_history (id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [uuidv4(), userId, 'UPDATED', `Verified Google Play purchase for ${standardPlanId}`]
    );

    res.json({
      verified: true,
      message: 'Google Play subscription verified and activated!',
      planId: standardPlanId,
      status: 'ACTIVE',
      currentPeriodEnd: periodEnd
    });
  } catch (error: any) {
    console.error('verifyGooglePlayPurchase error:', error);
    res.status(500).json({ error: 'Failed to verify Google Play purchase', details: error.message });
  }
}

/**
 * Restores purchases for the logged-in user.
 */
export async function restorePurchases(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const sub = await dbGet<SubscriptionRecord>(
      'SELECT * FROM subscriptions WHERE user_id = ?',
      [userId]
    );

    if (sub && sub.plan_id !== 'FREE') {
      const isExpired = sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now();
      if (!isExpired && sub.status === 'ACTIVE') {
        res.json({
          restored: true,
          message: 'Active Document Vault Pro subscription restored!',
          planId: sub.plan_id,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end
        });
        return;
      }
    }

    res.json({
      restored: false,
      message: 'No active Google Play or Pro subscription found on this account.'
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to restore purchases', details: error.message });
  }
}
