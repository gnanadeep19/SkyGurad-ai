import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Express, Request, Response, NextFunction } from "express";

const scrypt = promisify(scryptCallback);
type Role = "administrator" | "operator";
type User = { id: string; username: string; role: Role; active: boolean; salt: string; passwordHash: string; createdAt: string };
type Session = { userId: string; expires: number };
const sessionLifetime = 8 * 60 * 60 * 1000;
const sessionCookie = "skyguard_session";
const publicUser = ({ id, username, role, active, createdAt }: User) => ({ id, username, role, active, createdAt });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function installAuth(app: Express, defaultPath: string, recordAudit?: (actor: string, action: string, details: Record<string, unknown>) => Promise<void>) {
  const audit = async (actor: string, action: string, details: Record<string, unknown>) => { try { await recordAudit?.(actor, action, details); } catch { console.error("Unable to record account audit event."); } };
  const usersPath = path.resolve(process.env.SKYGUARD_USERS_FILE || defaultPath);
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, { count: number; expires: number }>();
  let setupCode: string | null = null;
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  };
  const readUsers = async (): Promise<User[]> => {
    try {
      const parsed = JSON.parse(await fs.readFile(usersPath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Invalid user database");
      return parsed;
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  };
  const saveUsers = async (users: User[]) => {
    await fs.mkdir(path.dirname(usersPath), { recursive: true });
    const temporary = `${usersPath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(users, null, 2), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, usersPath);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  };
  const hashPassword = async (password: string, salt: string) => (await scrypt(password, salt, 64) as Buffer).toString("hex");
  const validUsername = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._-]{3,40}$/.test(value);
  const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= 12 && value.length <= 256;
  const makeUser = async (username: string, password: string, role: Role): Promise<User> => {
    const salt = randomBytes(16).toString("hex");
    return { id: randomBytes(16).toString("hex"), username, role, active: true, salt, passwordHash: await hashPassword(password, salt), createdAt: new Date().toISOString() };
  };
  const revoke = (userId: string) => { sessions.forEach((session, key) => { if (session.userId === userId) sessions.delete(key); }); };
  const limit = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.expires <= now) attempts.set(key, { count: 1, expires: now + 15 * 60_000 });
    else if (++entry.count > 10) return res.status(429).json({ error: "Too many attempts. Try again later." });
    next();
  };
  const cookieOptions = (req: Request) => ({ httpOnly: true, sameSite: "strict" as const, secure: req.secure, path: "/", maxAge: sessionLifetime });
  const setSession = (req: Request, res: Response, user: User) => {
    const token = randomBytes(32).toString("hex");
    sessions.set(digest(token), { userId: user.id, expires: Date.now() + sessionLifetime });
    res.cookie(sessionCookie, token, cookieOptions(req));
  };
  const getSession = (req: Request) => {
    const cookie = req.headers.cookie?.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${sessionCookie}=`));
    const token = cookie?.slice(sessionCookie.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = digest(token), session = sessions.get(key);
    if (!session) return null;
    if (session.expires <= Date.now()) { sessions.delete(key); return null; }
    return session;
  };
  const users = await readUsers();
  if (!users.length) {
    setupCode = randomBytes(18).toString("hex");
    console.log(`SkyGuard first administrator setup code: ${setupCode}`);
    console.log("Open the dashboard and enter this code to create the first administrator.");
  }
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Cross-site requests are not allowed." });
      if (!req.is("application/json")) return res.status(415).json({ error: "Requests must use JSON." });
    }
    next();
  });
  app.get("/api/auth/status", async (_req, res) => {
    try { res.setHeader("Cache-Control", "no-store"); res.json({ setupRequired: (await readUsers()).length === 0 }); }
    catch { res.status(500).json({ error: "Unable to read account configuration." }); }
  });
  app.post("/api/auth/setup", limit, async (req, res) => {
    try {
      const { username, password, code } = req.body ?? {};
      if (!validUsername(username) || !validPassword(password)) return res.status(400).json({ error: "Use a 3–40 character username and a password of at least 12 characters." });
      if (!setupCode || typeof code !== "string" || !/^[a-f0-9]{36}$/.test(code) || !timingSafeEqual(Buffer.from(code), Buffer.from(setupCode))) return res.status(403).json({ error: "Invalid setup code." });
      const user = await mutate(async () => {
        if ((await readUsers()).length) return null;
        const created = await makeUser(username, password, "administrator");
        await saveUsers([created]); setupCode = null;
        return created;
      });
      if (!user) return res.status(409).json({ error: "Administrator setup has already been completed." });
      await audit(user.id, "user.setup", { target_id: user.id, role: user.role });
      setSession(req, res, user); res.status(201).json({ user: publicUser(user) });
    } catch { res.status(500).json({ error: "Unable to create administrator account." }); }
  });
  app.post("/api/auth/login", limit, async (req, res) => {
    try {
      const { username, password, role } = req.body ?? {};
      if (typeof username !== "string" || typeof password !== "string" || password.length > 256) return res.status(401).json({ error: "Invalid username, password, or role." });
      const user = (await readUsers()).find((entry) => entry.username.toLowerCase() === username.trim().toLowerCase());
      const salt = user?.salt ?? "00000000000000000000000000000000";
      const hash = Buffer.from(await hashPassword(password, salt), "hex");
      const expected = user ? Buffer.from(user.passwordHash, "hex") : Buffer.alloc(64);
      if (!user?.active || expected.length !== hash.length || !timingSafeEqual(hash, expected) || user.role !== role) return res.status(401).json({ error: "Invalid username or password." });
      await audit(user.id, "user.login", {});
      setSession(req, res, user); res.json({ user: publicUser(user) });
    } catch { res.status(500).json({ error: "Unable to sign in." }); }
  });
  app.use("/api", async (req, res, next) => {
    try {
      const session = getSession(req);
      const user = session && (await readUsers()).find((entry) => entry.id === session.userId && entry.active);
      if (!user) return res.status(401).json({ error: "Please sign in." });
      res.locals.user = user;
      next();
    } catch { res.status(500).json({ error: "Unable to verify your session." }); }
  });
  const administrator = (_req: Request, res: Response, next: NextFunction) => res.locals.user.role === "administrator" ? next() : res.status(403).json({ error: "Administrator access required." });
  app.get("/api/auth/me", (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json({ user: publicUser(res.locals.user) }); });
  app.get("/api/incident-assignees", async (_req, res) => { try { res.json({ users: (await readUsers()).filter(user => user.active).map(({id,username,role}) => ({id,username,role})) }); } catch { res.status(500).json({ error: "Unable to load incident assignees." }); } });
  app.post("/api/auth/logout", async (req, res) => { const session = getSession(req); if (session) { await audit(session.userId, "user.logout", {}); revoke(session.userId); } res.clearCookie(sessionCookie, { ...cookieOptions(req), maxAge: undefined }); res.json({ ok: true }); });
  app.get("/api/users", administrator, async (_req, res) => { try { res.setHeader("Cache-Control", "no-store"); res.json({ users: (await readUsers()).map(publicUser) }); } catch { res.status(500).json({ error: "Unable to load users." }); } });
  app.post("/api/users", administrator, async (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (!validUsername(username) || !validPassword(password) || !["administrator", "operator"].includes(role)) return res.status(400).json({ error: "Provide a valid username, role, and password of at least 12 characters." });
    try {
      const user = await mutate(async () => { const list = await readUsers(); if (list.some((entry) => entry.username.toLowerCase() === username.toLowerCase())) return null; const created = await makeUser(username, password, role); await saveUsers([...list, created]); return created; });
      if (!user) return res.status(409).json({ error: "That username already exists." });
      await audit(res.locals.user.id, "user.created", { target_id: user.id, role: user.role });
      res.status(201).json({ user: publicUser(user) });
    } catch { res.status(500).json({ error: "Unable to create user." }); }
  });
  app.patch("/api/users/:id", administrator, async (req, res) => {
    const { role, active, password } = req.body ?? {};
    if ((role !== undefined && !["administrator", "operator"].includes(role)) || (active !== undefined && typeof active !== "boolean") || (password !== undefined && !validPassword(password))) return res.status(400).json({ error: "Invalid account settings." });
    try {
      const result = await mutate(async () => {
        const list = await readUsers(); const user = list.find((entry) => entry.id === req.params.id);
        if (!user) return { error: "User not found.", status: 404 };
        if (user.id === res.locals.user.id && (active === false || (role && role !== "administrator"))) return { error: "You cannot deactivate or demote your own account.", status: 400 };
        if (user.active && user.role === "administrator" && (active === false || (role && role !== "administrator")) && list.filter((entry) => entry.active && entry.role === "administrator").length <= 1) return { error: "At least one active administrator is required.", status: 400 };
        if (role !== undefined) user.role = role;
        if (active !== undefined) user.active = active;
        if (password !== undefined) { user.salt = randomBytes(16).toString("hex"); user.passwordHash = await hashPassword(password, user.salt); }
        await saveUsers(list); if (role !== undefined || active !== undefined || password !== undefined) revoke(user.id);
        return { user: publicUser(user) };
      });
      if (result.error) return res.status(result.status!).json({ error: result.error });
      await audit(res.locals.user.id, "user.updated", { target_id: req.params.id, ...(role !== undefined ? { role } : {}), ...(active !== undefined ? { active } : {}), ...(password !== undefined ? { password_reset: true } : {}) });
      res.json(result);
    } catch { res.status(500).json({ error: "Unable to update user." }); }
  });
  app.use("/api/config", (req, res, next) => req.method === "GET" ? next() : administrator(req, res, next));
  app.use("/api/station-observations", (req, res, next) => req.method === "POST" ? administrator(req, res, next) : next());
  return { getActiveAssignee: async (id: string) => { const user=(await readUsers()).find(entry=>entry.id === id && entry.active); return user ? {id:user.id,username:user.username} : null; } };
}
