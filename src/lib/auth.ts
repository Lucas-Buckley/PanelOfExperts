/**
 * Purpose: Provides auth-related utility functions for email normalization,
 * password hashing/verification, opaque reset-token generation/hashing, and JWT signing.
 * Inputs: Raw email/password/token payload values.
 * Outputs: Normalized emails, hashed passwords, opaque reset tokens/hashes, boolean verify result, signed JWT.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
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

export function generateOpaqueToken(byteLength: number = 32): string {
  /**
   * Purpose: Generates a cryptographically random opaque token for one-time flows like password reset.
   * Inputs: Optional raw byte length.
   * Outputs: Hex-encoded random token string.
   */
  return randomBytes(byteLength).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  /**
   * Purpose: Hashes opaque tokens before persistence so raw reset tokens are never stored in the database.
   * Inputs: Raw opaque token string.
   * Outputs: SHA-256 hex digest string.
   */
  return createHash("sha256").update(token).digest("hex");
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

export function verifyToken(token: string, secret: string = appConfig.jwtSecret): jwt.JwtPayload {
  /**
   * Purpose: Verifies and decodes a JWT used for API auth.
   * Inputs: Encoded JWT string and optional verification secret.
   * Outputs: Decoded JWT payload object, or throws on invalid token.
   */
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string") {
    throw new Error("JWT payload must be an object.");
  }

  return decoded;
}
