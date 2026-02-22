import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DB_FIELD_LIMITS } from "../../src/server/contracts/dbFieldLimits";

const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");

describe("db field limits", () => {
  it("keeps varchar limits aligned with prisma schema", () => {
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Account\\s+\\{[\\s\\S]*?email\\s+String\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.account.email}\\)`
      )
    );
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Account\\s+\\{[\\s\\S]*?passwordHash\\s+String\\s+@map\\("password"\\)\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.account.passwordHash}\\)`
      )
    );
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Panel\\s+\\{[\\s\\S]*?name\\s+String\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.panel.name}\\)`
      )
    );
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Panel\\s+\\{[\\s\\S]*?description\\s+String\\?\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.panel.description}\\)`
      )
    );
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Expert\\s+\\{[\\s\\S]*?name\\s+String\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.expert.name}\\)`
      )
    );
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Expert\\s+\\{[\\s\\S]*?specialization\\s+String\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.expert.specialization}\\)`
      )
    );
    expect(schema).toMatch(
      new RegExp(
        `model\\s+Conversation\\s+\\{[\\s\\S]*?name\\s+String\\s+@db\\.VarChar\\(${DB_FIELD_LIMITS.conversation.name}\\)`
      )
    );
  });
});
