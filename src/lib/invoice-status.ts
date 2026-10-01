// PayPal invoice statuses that mean the tenant paid the deposit. After a move-out refund PayPal reports
// PARTIALLY_REFUNDED or REFUNDED, which still means it was paid (and is what the statement accounts for).
export const PAID_STATUSES = ["PAID", "MARKED_AS_PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
export const wasPaid = (status: string | null | undefined) => !!status && PAID_STATUSES.includes(status);
