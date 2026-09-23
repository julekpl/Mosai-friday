import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { SkipLink } from "@/components/SkipLink";
import { resolveAuthReturnTo } from "@/lib/auth-return-to";

import { useAuth } from "@/hooks/use-auth";
import {
  FloatingTiles,
  MosaicMark,
} from "@/components/mosaic";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

/** Seconds the resend control stays disabled after a code is sent. */
const RESEND_SECONDS = 30;
const AUTH_ACTION_TIMEOUT_MS = 15_000;

type AuthActionKind = "send" | "verify" | "resend";
type PendingAuthAction = { id: number; kind: AuthActionKind };

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveAuthReturnTo(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Announced through a polite live region so screen-reader users hear the
  // async progress that sighted users read from the button label.
  const [status, setStatus] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [emailFocusToken, setEmailFocusToken] = useState(0);
  const [connectionStalled, setConnectionStalled] = useState(false);
  const [pendingAuthAction, setPendingAuthAction] =
    useState<PendingAuthAction | null>(null);
  const [timedOutAction, setTimedOutAction] =
    useState<AuthActionKind | null>(null);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const nextAuthActionId = useRef(0);
  const timedOutActionId = useRef<number | null>(null);
  const focusAfterLoading = useRef<"email" | "otp" | null>(null);

  const onCodeStep = step !== "signIn";
  const email = typeof step === "string" ? "" : step.email;

  useEffect(() => {
    if (
      !authLoading &&
      isAuthenticated &&
      timedOutActionId.current === null
    ) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  useEffect(() => {
    if (!authLoading) {
      const resetTimer = window.setTimeout(
        () => setConnectionStalled(false),
        0,
      );
      return () => window.clearTimeout(resetTimer);
    }
    const timer = window.setTimeout(() => setConnectionStalled(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [authLoading]);

  useEffect(() => {
    if (!pendingAuthAction) return;
    const { id, kind } = pendingAuthAction;
    const timer = window.setTimeout(() => {
      timedOutActionId.current = id;
      setTimedOutAction(kind);
      setStatus("The sign-in request is taking longer than expected.");
    }, AUTH_ACTION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingAuthAction]);

  const startAuthAction = (kind: AuthActionKind): number => {
    const id = ++nextAuthActionId.current;
    timedOutActionId.current = null;
    setTimedOutAction(null);
    setPendingAuthAction({ id, kind });
    return id;
  };

  const finishAuthAction = (id: number): boolean => {
    if (timedOutActionId.current === id) return false;
    setPendingAuthAction(null);
    return true;
  };

  // When the code screen appears, move focus into the code field so a keyboard
  // user lands where the next action is. Returning to the email step asks for
  // focus explicitly through `emailFocusToken`.
  useEffect(() => {
    if (onCodeStep) otpInputRef.current?.focus();
  }, [onCodeStep]);

  useEffect(() => {
    if (emailFocusToken === 0) return;
    emailInputRef.current?.focus();
  }, [emailFocusToken]);

  useEffect(() => {
    if (isLoading || !focusAfterLoading.current) return;
    const target = focusAfterLoading.current;
    focusAfterLoading.current = null;
    (target === "email" ? emailInputRef : otpInputRef).current?.focus();
  }, [isLoading]);

  // Resend countdown: one timeout per tick rather than a drifting interval.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const sendCode = async (emailValue: string) => {
    const formData = new FormData();
    formData.set("email", emailValue);
    await signIn("email-otp", formData);
  };

  const handleEmailSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (isLoading) return;
    const emailValue = String(
      new FormData(event.currentTarget).get("email") ?? "",
    ).trim();
    setIsLoading(true);
    setError(null);
    setStatus("Sending your sign-in code…");
    const requestId = startAuthAction("send");
    try {
      await sendCode(emailValue);
      if (!finishAuthAction(requestId)) return;
      setStep({ email: emailValue });
      setOtp("");
      setResendIn(RESEND_SECONDS);
      setStatus(`Code sent to ${emailValue}. Enter the 6-digit code.`);
      setIsLoading(false);
    } catch {
      if (!finishAuthAction(requestId)) return;
      // Provider/backend details can expose account existence or infrastructure
      // information. Keep the user-facing response generic.
      setError("We couldn't send a code right now. Please try again shortly.");
      setStatus("Could not send the code.");
      focusAfterLoading.current = "email";
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (isLoading || otp.length !== 6) return;
    setIsLoading(true);
    setError(null);
    setStatus("Verifying your code…");
    const requestId = startAuthAction("verify");
    try {
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", otp);
      await signIn("email-otp", formData);
      if (!finishAuthAction(requestId)) return;
      navigate(redirect);
    } catch {
      if (!finishAuthAction(requestId)) return;
      setError(
        "That code didn't work or may have expired. Use a new code to sign in.",
      );
      setStatus(
        "That code didn't work or may have expired. Request a new code to sign in.",
      );
      focusAfterLoading.current = "otp";
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleResend = async () => {
    if (isLoading || resendIn > 0) return;
    setIsLoading(true);
    setError(null);
    setStatus("Resending your code…");
    const requestId = startAuthAction("resend");
    try {
      await sendCode(email);
      if (!finishAuthAction(requestId)) return;
      setOtp("");
      setResendIn(RESEND_SECONDS);
      setStatus(`A new code was sent to ${email}.`);
      focusAfterLoading.current = "otp";
      setIsLoading(false);
    } catch {
      if (!finishAuthAction(requestId)) return;
      setError("We couldn't send a code right now. Please try again shortly.");
      setStatus("Could not resend the code.");
      focusAfterLoading.current = "otp";
      setIsLoading(false);
    }
  };

  const handleUseDifferentEmail = () => {
    setStep("signIn");
    setError(null);
    setResendIn(0);
    setEmailFocusToken((n) => n + 1);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <SkipLink />
      {/* Async progress for screen readers; visually hidden. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {/* Ambient mosaic backdrop */}
      <FloatingTiles />
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60" />

      {/* Auth Content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex flex-1 items-center justify-center"
      >
        <div className="animate-mosaic-in flex h-full flex-col items-center justify-center">
        <Card className="min-w-[350px] border pb-0 shadow-pop">
          {connectionStalled && (
            <div
              role="alert"
              className="mx-6 mt-6 rounded-md border border-destructive/40 p-3 text-sm"
            >
              Sign-in is taking longer than expected. Check your connection and
              retry.
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => window.location.reload()}
              >
                Retry connection
              </Button>
            </div>
          )}
          {timedOutAction && (
            <div
              role="alert"
              className="mx-6 mt-6 rounded-md border border-destructive/40 p-3 text-sm"
            >
              The sign-in request is taking longer than expected. It has not
              been confirmed. Reload this page before trying again.
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => window.location.reload()}
              >
                Reload sign-in
              </Button>
            </div>
          )}
          {step === "signIn" ? (
            <>
              <CardHeader className="text-center">
              <div className="flex justify-center">
                    <button
                      type="button"
                      aria-label="Back to mosai home"
                      onClick={() => navigate("/")}
                      className="mb-4 mt-4 cursor-pointer transition-transform duration-300 ease-mosaic hover:scale-110 hover:rotate-6 active:scale-95"
                    >
                      <MosaicMark size={56} />
                    </button>
                  </div>
                <CardTitle className="text-xl">Get Started</CardTitle>
                <CardDescription>
                  Enter your email to log in or sign up
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleEmailSubmit} aria-busy={isLoading}>
                <CardContent>

                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <Label htmlFor="auth-email" className="sr-only">
                        Email address
                      </Label>
                      <Mail
                        aria-hidden
                        className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                      />
                      <Input
                        id="auth-email"
                        ref={emailInputRef}
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        className="pl-9"
                        disabled={
                          isLoading ||
                          connectionStalled ||
                          Boolean(timedOutAction)
                        }
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? "auth-error" : undefined}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      size="icon"
                      aria-label="Send sign-in code"
                      disabled={
                        isLoading ||
                        connectionStalled ||
                        Boolean(timedOutAction)
                      }
                    >
                      {isLoading ? (
                        <Loader2
                          aria-hidden
                          className="h-4 w-4 animate-spin"
                        />
                      ) : (
                        <ArrowRight aria-hidden className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {error && (
                    <p
                      id="auth-error"
                      role="alert"
                      className="mt-2 text-sm text-red-500"
                    >
                      {error}
                    </p>
                  )}

                </CardContent>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="text-center mt-4">
                <CardTitle>Check your email</CardTitle>
                <CardDescription>
                  We've sent a code to {email}
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleOtpSubmit} aria-busy={isLoading}>
                <CardContent className="pb-4">
                  <input type="hidden" name="email" value={email} />
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      ref={otpInputRef}
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={
                        isLoading ||
                        connectionStalled ||
                        Boolean(timedOutAction)
                      }
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      aria-label="Verification code"
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "auth-error" : undefined}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          otp.length === 6 &&
                          !isLoading &&
                          !connectionStalled &&
                          !timedOutAction
                        ) {
                          // Find the closest form and submit it
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p
                      id="auth-error"
                      role="alert"
                      className="mt-2 text-sm text-red-500 text-center"
                    >
                      {error}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    Didn't receive a code?{" "}
                    <Button
                      type="button"
                      variant="link"
                      className="p-0 h-auto"
                      onClick={handleResend}
                      disabled={
                        isLoading ||
                        connectionStalled ||
                        Boolean(timedOutAction) ||
                        resendIn > 0
                      }
                    >
                      {resendIn > 0
                        ? `Resend code in ${resendIn}s`
                        : "Resend code"}
                    </Button>
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      isLoading ||
                      connectionStalled ||
                      Boolean(timedOutAction) ||
                      otp.length !== 6
                    }
                  >
                    {isLoading ? (
                      <>
                        <Loader2
                          aria-hidden
                          className="mr-2 h-4 w-4 animate-spin"
                        />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleUseDifferentEmail}
                    disabled={
                      isLoading ||
                      connectionStalled ||
                      Boolean(timedOutAction)
                    }
                    className="w-full"
                  >
                    Use different email
                  </Button>
                </CardFooter>
              </form>
            </>
          )}

          <div className="py-4 px-6 text-xs text-center text-muted-foreground bg-muted border-t rounded-b-lg">
            Secured by{" "}
            <a
              href="https://freebuff.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary transition-colors"
            >
              freebuff.com
            </a>
          </div>
        </Card>
        </div>
      </main>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
