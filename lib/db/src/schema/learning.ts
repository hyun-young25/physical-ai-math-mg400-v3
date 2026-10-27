import { pgTable, uuid, text, timestamp, jsonb, bigserial, uniqueIndex, index } from "drizzle-orm/pg-core";

export const learningAccounts = pgTable("learning_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role").notNull(),
  classCode: text("class_code").notNull(),
  login: text("login").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("learning_account_login").on(t.role, t.classCode, t.login)]);

export const learningClasses = pgTable("learning_classes", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  teacherId: uuid("teacher_id").notNull().references(() => learningAccounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const learningSessions = pgTable("learning_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => learningAccounts.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Fresh write-only visit on every ID entry. A visit never grants read access.
export const learningVisits = pgTable("learning_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => learningAccounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable revisions, not a replace-in-place student answer table.
export const learningEvents = pgTable("learning_events", {
  sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
  eventId: uuid("event_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => learningAccounts.id),
  visitId: uuid("visit_id").references(() => learningVisits.id),
  storeKey: text("store_key").notNull(),
  recordId: text("record_id").notNull(),
  chapter: text("chapter").notNull(),
  task: text("task").notNull(),
  eventKind: text("event_kind").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  contentVersion: text("content_version").notNull(),
  dataSource: text("data_source").notNull(),
  payload: jsonb("payload").notNull(),
  changedPaths: jsonb("changed_paths").$type<string[]>().notNull(),
}, t => [
  uniqueIndex("learning_event_retry").on(t.accountId, t.eventId),
  index("learning_event_student_time").on(t.accountId, t.occurredAt),
]);
