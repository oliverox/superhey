// Paper Trail is rarely opened, so what matters in it (a sign-in you didn't make, a bill,
// a deadline) is shown on Today. Only emails that look like one get an AI reading: plain
// rules on the subject first, so marketing from the same senders costs nothing.

// A security event, a bill or statement, a payment, or a deadline.
const WORTH =
  /\b(security|sign(ed)?[- ]?in|log(ged)?[- ]?in|new device|password|passcode|two[- ]factor|2fa|payee|(bank|card|account) (was |has been )?(added|linked|removed|changed)|statement|payment|autopay|auto[- ]?pay|direct debit|bill|invoice|balance|due|overdue|past due|vote|voting|proxy|annual meeting|election|enrol(l)?ment|deadline|respond by|action (required|needed)|expir)/i

// Offers and newsletters, even from a bank: "Get 3% cash back", "X is now on Robinhood".
const MARKETING = /\b(cash ?back|offer|deals?|promo|is now on|new ipo|get \d+%|free|save up|discount|reward|guide to|tips|ways to|missing out|get the most|introducing|win )/i

/** Whether a Paper Trail email is worth reading for Today (security, bills, deadlines). */
export function worthReading(subject: string | null): boolean {
  if (!subject) return false
  return WORTH.test(subject) && !MARKETING.test(subject)
}
