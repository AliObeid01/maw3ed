/**
 * Owner-facing entry links, in ONE place so a CTA cannot drift (tests/unit/public/ownerLinks.test.ts scans the files
 * that use them). Every public "start as a business owner" button goes to the plans, so the owner picks Free or Pro
 * first; `/for-business#plans` is also where the removed `/pricing` page now redirects.
 */
export const PLANS_HREF = '/for-business#plans';
export const OWNER_START_HREF = PLANS_HREF;
/** The Free plan button: plain signup. */
export const FREE_START_HREF = '/signup';
/** The Pro plan button: signup keeps the plan and a signed-in owner is forwarded to the checkout. */
export const PRO_START_HREF = '/signup?plan=pro';
/** A signed-in owner upgrading: the test checkout. */
export const PRO_CHECKOUT_HREF = '/app/checkout?plan=pro';
