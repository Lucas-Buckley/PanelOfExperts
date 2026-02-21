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
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: object, secret: string = appConfig.jwtSecret): string {
  const expiresIn = appConfig.authAccessTokenTtl as jwt.SignOptions["expiresIn"];
  return jwt.sign(payload, secret, { expiresIn });
}
