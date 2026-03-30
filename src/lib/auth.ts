import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
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
export function generateOpaqueToken(byteLength: number = 32): string {
    return randomBytes(byteLength).toString("hex");
}
export function hashOpaqueToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}
export function signToken(payload: object, secret: string = appConfig.jwtSecret): string {
    const expiresIn = appConfig.authAccessTokenTtl as jwt.SignOptions["expiresIn"];
    return jwt.sign(payload, secret, { expiresIn });
}
export function verifyToken(token: string, secret: string = appConfig.jwtSecret): jwt.JwtPayload {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "string") {
        throw new Error("JWT payload must be an object.");
    }
    return decoded;
}
