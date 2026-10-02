// PayPal invoice statuses that mean the tenant paid the deposit. After a move-out refund PayPal reports
// PARTIALLY_REFUNDED or REFUNDED, which still means it was paid (and is what the statement accounts for).
export const PAID_STATUSES = ["PAID", "MARKED_AS_PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
export const wasPaid = (status: string | null | undefined) => !!status && PAID_STATUSES.includes(status);

// What PayPal records as the way an invoice was paid. An invoice paid online is PAID with one of these; one the
// landlord marked paid offline (MARKED_AS_PAID) carries whatever method the landlord entered, such as CASH or CHECK.
export const ELECTRONIC_METHODS = ["PAYPAL", "BANK_TRANSFER", "CREDIT_CARD", "DEBIT_CARD", "WIRE_TRANSFER"];

/** Whether the deposit reached the landlord electronically, which is what makes the electronic-refund rule apply
 *  (Civ. Code 1950.5(h)(1)(A)(ii)). */
export const paidElectronically = (status: string | null | undefined, method: string | null | undefined) =>
  wasPaid(status) && (status !== "MARKED_AS_PAID" || (!!method && ELECTRONIC_METHODS.includes(method)));
