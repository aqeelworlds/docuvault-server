/**
 * Normalizes a date string (YYYY-MM-DD) or Date object to midnight UTC for pure mathematical calendar day comparison.
 */
export function normalizeToCalendarDate(dateInput) {
    if (typeof dateInput === 'string') {
        // If string is YYYY-MM-DD or ISO
        const parts = dateInput.split('T')[0].split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        }
    }
    const d = new Date(dateInput);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
/**
 * Pure deterministic calculation of difference in calendar days between two dates.
 */
export function differenceInCalendarDays(targetDate, baseDate = new Date()) {
    const target = normalizeToCalendarDate(targetDate);
    const base = normalizeToCalendarDate(baseDate);
    const msPerDay = 1000 * 60 * 60 * 24;
    const diffTime = target.getTime() - base.getTime();
    return Math.round(diffTime / msPerDay);
}
/**
 * Calculates complete expiry status and metrics deterministically.
 *
 * Rules:
 * - hasNoExpiry === true => LIFETIME
 * - daysRemaining < 0 => EXPIRED
 * - 0 <= daysRemaining <= 30 => EXPIRING_SOON
 * - daysRemaining > 30 => ACTIVE
 */
export function calculateExpiryMetrics(expiryDateStr, hasNoExpiry = false, baseDate = new Date(), warningThresholdDays = 30) {
    if (hasNoExpiry || !expiryDateStr) {
        return {
            status: 'LIFETIME',
            daysRemaining: null,
            urgencyLevel: 'neutral',
            formattedRemaining: 'No Expiry',
            isExpired: false,
            isExpiringSoon: false
        };
    }
    const daysRemaining = differenceInCalendarDays(expiryDateStr, baseDate);
    if (daysRemaining < 0) {
        const absDays = Math.abs(daysRemaining);
        const text = absDays === 1 ? 'Expired yesterday' : `Expired ${absDays} days ago`;
        return {
            status: 'EXPIRED',
            daysRemaining,
            urgencyLevel: 'expired',
            formattedRemaining: text,
            isExpired: true,
            isExpiringSoon: false
        };
    }
    if (daysRemaining <= warningThresholdDays) {
        let text = '';
        let urgency = 'warning';
        if (daysRemaining === 0) {
            text = 'Expires today';
            urgency = 'urgent';
        }
        else if (daysRemaining === 1) {
            text = 'Expires tomorrow';
            urgency = 'urgent';
        }
        else {
            text = `Expires in ${daysRemaining} days`;
            if (daysRemaining <= 7)
                urgency = 'urgent';
        }
        return {
            status: 'EXPIRING_SOON',
            daysRemaining,
            urgencyLevel: urgency,
            formattedRemaining: text,
            isExpired: false,
            isExpiringSoon: true
        };
    }
    // Active (> 30 days)
    let text = '';
    if (daysRemaining > 365) {
        const years = (daysRemaining / 365.25).toFixed(1);
        text = `Expires in ${years} years (${daysRemaining} days)`;
    }
    else if (daysRemaining > 60) {
        const months = Math.round(daysRemaining / 30.4);
        text = `Expires in ~${months} months (${daysRemaining} days)`;
    }
    else {
        text = `Expires in ${daysRemaining} days`;
    }
    return {
        status: 'ACTIVE',
        daysRemaining,
        urgencyLevel: 'safe',
        formattedRemaining: text,
        isExpired: false,
        isExpiringSoon: false
    };
}
/**
 * Calculates deterministic reminder trigger dates for a given document expiry date.
 */
export function generateReminderDates(expiryDateStr, leadDaysList = [90, 60, 30, 14, 7, 1]) {
    const expiry = normalizeToCalendarDate(expiryDateStr);
    const msPerDay = 1000 * 60 * 60 * 24;
    return leadDaysList
        .filter(days => days > 0)
        .map(leadDays => {
        const reminderTime = expiry.getTime() - (leadDays * msPerDay);
        const reminderDateObj = new Date(reminderTime);
        const y = reminderDateObj.getUTCFullYear();
        const m = String(reminderDateObj.getUTCMonth() + 1).padStart(2, '0');
        const d = String(reminderDateObj.getUTCDate()).padStart(2, '0');
        return {
            leadDays,
            reminderDate: `${y}-${m}-${d}`
        };
    });
}
