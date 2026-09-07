import { afterEach, describe, expect, it } from "vitest";
import { sqliteFilePath } from "./vault-key";

const original = process.env.DATABASE_URL;

afterEach(() => {
  if (original === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = original;
  }
});

describe("sqliteFilePath", () => {
  it("rejects leftover Postgres URLs", () => {
    process.env.DATABASE_URL = "postgres://agentforge:agentforge@127.0.0.1:5432/agentforge";
    expect(() => sqliteFilePath()).toThrow(/Postgres is not supported|no longer the product database/i);
  });

  it("reads file: URLs", () => {
    process.env.DATABASE_URL = "file:/tmp/agentforge-test.sqlite";
    expect(sqliteFilePath()).toBe("/tmp/agentforge-test.sqlite");
  });
});
