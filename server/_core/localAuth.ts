import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { users, type User } from "../../drizzle/schema";
import * as db from "../db";
import { hashPassword, verifyPassword } from "./passwords";

export type AuthUser = User;

type MemoryUser = User & { passwordHash: string | null };

const memoryUsersById = new Map<number, MemoryUser>();
const memoryUserIdsByEmail = new Map<string, number>();
let memoryUserSequence = 1;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function stripPasswordHash(user: MemoryUser): User {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

function buildLocalOpenId() {
  return `local:${crypto.randomUUID()}`;
}

function createMemoryUser(input: { name: string; email: string; passwordHash: string }): User {
  const normalizedEmail = normalizeEmail(input.email);
  if (memoryUserIdsByEmail.has(normalizedEmail)) {
    throw new Error("EMAIL_ALREADY_REGISTERED");
  }

  const now = new Date();
  const id = memoryUserSequence++;
  const user: MemoryUser = {
    id,
    openId: buildLocalOpenId(),
    name: input.name,
    email: normalizedEmail,
    loginMethod: "password",
    passwordHash: input.passwordHash,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };

  memoryUsersById.set(id, user);
  memoryUserIdsByEmail.set(normalizedEmail, id);
  return stripPasswordHash(user);
}

export async function registerLocalUser(input: { name: string; email: string; password: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const database = await db.getDb();

  if (!database) {
    return createMemoryUser({ name: input.name.trim(), email: normalizedEmail, passwordHash });
  }

  const existing = await database.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existing.length) {
    throw new Error("EMAIL_ALREADY_REGISTERED");
  }

  const inserted = await database.insert(users).values({
    openId: buildLocalOpenId(),
    name: input.name.trim(),
    email: normalizedEmail,
    loginMethod: "password",
    passwordHash,
    lastSignedIn: new Date(),
  });

  const insertedId = Number((inserted as { insertId?: number })?.insertId ?? (inserted as any)?.[0]?.insertId ?? 0);
  const rows = insertedId
    ? await database.select().from(users).where(eq(users.id, insertedId)).limit(1)
    : await database.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  const user = rows[0];
  if (!user) {
    throw new Error("USER_CREATE_FAILED");
  }

  return user;
}

export async function authenticateLocalUser(input: { email: string; password: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  const database = await db.getDb();

  if (!database) {
    const memoryUserId = memoryUserIdsByEmail.get(normalizedEmail);
    const memoryUser = memoryUserId ? memoryUsersById.get(memoryUserId) : null;
    if (!memoryUser || !(await verifyPassword(input.password, memoryUser.passwordHash))) {
      throw new Error("INVALID_CREDENTIALS");
    }
    memoryUser.lastSignedIn = new Date();
    memoryUser.updatedAt = new Date();
    return stripPasswordHash(memoryUser);
  }

  const rows = await database.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const user = rows[0] as (User & { passwordHash?: string | null }) | undefined;
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new Error("INVALID_CREDENTIALS");
  }

  await database.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return { ...user, passwordHash: undefined } as User;
}

export async function getLocalUserById(userId: number) {
  const database = await db.getDb();

  if (!database) {
    const memoryUser = memoryUsersById.get(userId);
    return memoryUser ? stripPasswordHash(memoryUser) : undefined;
  }

  const rows = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}
