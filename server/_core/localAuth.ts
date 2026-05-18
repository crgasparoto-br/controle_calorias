import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { users, type User, type UserWithPasswordHash } from "../../drizzle/schema";
import * as db from "../db";
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from "./passwords";

type LocalUserWithPassword = UserWithPasswordHash;
type MemoryUser = UserWithPasswordHash;

const memoryUsersById = new Map<number, MemoryUser>();
const memoryUserIdsByEmail = new Map<string, number>();
let memoryUserSequence = 1;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function stripPasswordHash(user: LocalUserWithPassword): User {
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

async function findUserByEmail(email: string) {
  const database = await db.getDb();
  if (!database) return undefined;

  const rows = await database
    .select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      passwordHash: users.passwordHash,
      loginMethod: users.loginMethod,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return rows[0];
}

export async function registerLocalUser(input: { name: string; email: string; password: string }) {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const database = await db.getDb();

  if (!database) {
    return createMemoryUser({ name: input.name.trim(), email: normalizedEmail, passwordHash });
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error("EMAIL_ALREADY_REGISTERED");
  }

  const values = {
    openId: buildLocalOpenId(),
    name: input.name.trim(),
    email: normalizedEmail,
    loginMethod: "password",
    passwordHash,
    lastSignedIn: new Date(),
  };

  await database.insert(users).values(values);

  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    throw new Error("USER_CREATE_FAILED");
  }

  return stripPasswordHash(user);
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

  const user = await findUserByEmail(normalizedEmail);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const updatePayload: Partial<typeof users.$inferInsert> = {
    lastSignedIn: new Date(),
  };

  if (passwordHashNeedsUpgrade(user.passwordHash)) {
    updatePayload.passwordHash = await hashPassword(input.password);
  }

  await database.update(users).set(updatePayload).where(eq(users.id, user.id));
  return stripPasswordHash(user);
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
