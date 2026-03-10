/**
 * Purpose: Sends password-reset emails through the optional Resend integration.
 * Inputs: Recipient email, reset URL, and token-expiry minutes.
 * Outputs: Delivery capability checks and one async email-send operation.
 */
import { appConfig } from "../../config/appConfig";

type PasswordResetEmailArgs = {
  toEmail: string;
  resetUrl: string;
  expiresInMinutes: number;
};

export function isPasswordResetEmailDeliveryConfigured(): boolean {
  /**
   * Purpose: Reports whether production-safe password-reset email delivery is configured.
   * Inputs: None.
   * Outputs: Boolean indicating whether the Resend API key and from-address are present.
   */
  return appConfig.resendApiKey.length > 0 && appConfig.passwordResetFromEmail.length > 0;
}

export async function sendPasswordResetEmail(args: PasswordResetEmailArgs): Promise<void> {
  /**
   * Purpose: Sends a password-reset email using Resend's HTTP API.
   * Inputs: Destination email, reset URL, and expiry duration in minutes.
   * Outputs: No return value; throws if the email provider rejects the request.
   */
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appConfig.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: appConfig.passwordResetFromEmail,
      to: [args.toEmail],
      subject: "Reset your Panel of Experts password",
      text: [
        "A password reset was requested for your Panel of Experts account.",
        `Use this link within ${args.expiresInMinutes} minutes:`,
        args.resetUrl,
        "If you did not request this reset, you can ignore this email."
      ].join("\n\n"),
      html: [
        "<p>A password reset was requested for your Panel of Experts account.</p>",
        `<p><a href="${args.resetUrl}">Reset your password</a></p>`,
        `<p>This link expires in ${args.expiresInMinutes} minutes.</p>`,
        "<p>If you did not request this reset, you can ignore this email.</p>"
      ].join("")
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Password reset email delivery failed (${response.status}). ${details}`.trim()
    );
  }
}
