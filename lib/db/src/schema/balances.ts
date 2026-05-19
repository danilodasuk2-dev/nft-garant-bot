import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const balancesTable = pgTable("balances", {
  userId: text("user_id").primaryKey(),
  hrn: text("hrn").notNull().default("0"),
  rub: text("rub").notNull().default("0"),
  ton: text("ton").notNull().default("0"),
  stars: text("stars").notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Balance = typeof balancesTable.$inferSelect;
export type InsertBalance = typeof balancesTable.$inferInsert;
