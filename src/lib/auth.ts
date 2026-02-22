/**
 * Purpose: Provides auth-related utility functions for email normalization,
 * password hashing/verification, and JWT signing.
 * Inputs: Raw email/password/token payload values.
 * Outputs: Normalized emails, hashed passwords, boolean verify result, signed JWT.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { appConfig } from "../config/appConfig";

export function normalizeEmail(email: string): string {
  /**
   * Purpose: Normalizes emails for canonical storage/comparison.
   * Inputs: Raw email string.
   * Outputs: Trimmed, lowercased email string.
   */
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  /**
   * Purpose: Hashes plaintext passwords using bcrypt.
   * Inputs: Plaintext password string.
   * Outputs: Bcrypt hash string.
   */
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  /**
   * Purpose: Verifies a plaintext password against a bcrypt hash.
   * Inputs: Plaintext password and stored hash.
   * Outputs: Boolean match result.
   */
  return bcrypt.compare(password, hash);
}

export function signToken(payload: object, secret: string = appConfig.jwtSecret): string {
  /**
   * Purpose: Signs a short-lived JWT for auth/session flows.
   * Inputs: JWT payload object and optional signing secret.
   * Outputs: Signed JWT string.
   */
  const expiresIn = appConfig.authAccessTokenTtl as jwt.SignOptions["expiresIn"];
  return jwt.sign(payload, secret, { expiresIn });
}
