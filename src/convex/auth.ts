// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";

// Anonymous (guest) sign-in is deliberately removed: it let unauthenticated
// visitors mint accounts and reach the paid AI + scraping actions. All sign-in
// is now email OTP. (MOSAI implement pack T0.2.)
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [emailOtp],
});