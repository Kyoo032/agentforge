/** The OTP mail: both locales, and a failure that says nothing it should not. */
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../log";
import { translator } from "../views/i18n";
import { createSmtpMailer, smtpTransportOptions, type MailTransport } from "./smtp";
import { otpMessage } from "./templates";
import { MailDeliveryError, recipientDomain } from "./types";

const SMTP = {
  host: "127.0.0.1",
  port: 1025,
  secure: false,
  requireTls: false,
  ignoreTls: true,
  user: null,
  pass: null,
  from: "DPSBuddy <no-reply@portal.localhost>",
} as const;

describe("otpMessage", () => {
  it("carries the code and the expiry in English", () => {
    const message = otpMessage({ to: "kyo@example.test", code: "123456", expiresInMinutes: 10 });
    expect(message.subject).toContain("123456");
    expect(message.text).toContain("123456");
    expect(message.text).toContain("10 minutes");
    expect(message.text).toContain("once");
  });

  it("carries the same facts in Bahasa Indonesia", () => {
    const message = otpMessage({
      to: "kyo@example.test",
      code: "123456",
      expiresInMinutes: 10,
      locale: "id",
    });
    expect(message.subject).toContain("Kode masuk");
    expect(message.text).toContain("123456");
    expect(message.text).toContain("10 menit");
    expect(message.text).toContain("sekali");
  });

  it("uses the tenant's product name when there is one", () => {
    const message = otpMessage({
      to: "kyo@example.test",
      code: "123456",
      expiresInMinutes: 10,
      productName: "AIHub Metranet",
    });
    expect(message.subject).toContain("AIHub Metranet");
  });

  /**
   * The bug: the subject carried a product-name constant of the mail's own while every page of the
   * same sign-in rendered a different name. It now falls back to the copy catalog the pages read,
   * so there is one name and not two. `views/brand.test.ts` is the guard on what that name is.
   */
  it("falls back to the same product name the pages print, in both locales", () => {
    expect(translator("en")("product")).toBe("DPSBuddy");

    for (const locale of ["en", "id"] as const) {
      const message = otpMessage({
        to: "kyo@example.test",
        code: "123456",
        expiresInMinutes: 10,
        locale,
      });
      expect(message.subject).toContain(translator(locale)("product"));
      expect(message.text).toContain(translator(locale)("product"));
    }
  });

  it("has no link to click, because a sign-in mail with a link is a phishing template", () => {
    const message = otpMessage({ to: "kyo@example.test", code: "123456", expiresInMinutes: 10 });
    expect(message.text).not.toMatch(/https?:\/\//);
    expect(message.html ?? "").not.toContain("<a ");
  });

  it("escapes a product name rather than letting it into the markup", () => {
    const message = otpMessage({
      to: "kyo@example.test",
      code: "123456",
      expiresInMinutes: 10,
      productName: "<script>alert(1)</script>",
    });
    expect(message.html ?? "").not.toContain("<script>");
    expect(message.html ?? "").toContain("&lt;script&gt;");
  });
});

describe("createSmtpMailer", () => {
  function transportThat(behaviour: "ok" | "fail"): MailTransport {
    return {
      sendMail: vi.fn(async () => {
        if (behaviour === "fail") {
          throw new Error("ECONNREFUSED 127.0.0.1:1025");
        }
        return { messageId: "<abc@portal>", accepted: ["kyo@example.test"] };
      }),
    };
  }

  it("sends through the transport and reports the message id", async () => {
    const transport = transportThat("ok");
    const lines: string[] = [];
    const mailer = createSmtpMailer({
      smtp: SMTP,
      transport,
      logger: createLogger({ env: {}, sink: (_l, line) => lines.push(line) }),
    });

    const sent = await mailer.send(otpMessage({ to: "kyo@example.test", code: "123456", expiresInMinutes: 10 }));
    expect(sent.messageId).toBe("<abc@portal>");
    expect(transport.sendMail).toHaveBeenCalledOnce();

    const logged = lines.join("\n");
    expect(logged).toContain("mail_sent");
    // The domain, never the address, and never the code.
    expect(logged).toContain("example.test");
    expect(logged).not.toContain("kyo@example.test");
    expect(logged).not.toContain("123456");
  });

  it("raises MailDeliveryError and logs no code when the transport refuses", async () => {
    const lines: string[] = [];
    const mailer = createSmtpMailer({
      smtp: SMTP,
      transport: transportThat("fail"),
      logger: createLogger({ env: {}, sink: (_l, line) => lines.push(line) }),
    });

    await expect(
      mailer.send(otpMessage({ to: "kyo@example.test", code: "654321", expiresInMinutes: 10 })),
    ).rejects.toBeInstanceOf(MailDeliveryError);

    const logged = lines.join("\n");
    expect(logged).toContain("mail_send_failed");
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("654321");
    expect(logged).not.toContain("kyo@example.test");
  });

  it("names only the recipient's domain in the error", async () => {
    const mailer = createSmtpMailer({ smtp: SMTP, transport: transportThat("fail") });
    await expect(
      mailer.send({ to: "kyo@example.test", subject: "s", text: "code 111111" }),
    ).rejects.toMatchObject({ recipientDomain: "example.test" });
  });

  it("reduces an address to its domain", () => {
    expect(recipientDomain("Kyo <kyo@Example.TEST>")).toBe("example.test");
    expect(recipientDomain("kyo@example.test")).toBe("example.test");
    expect(recipientDomain("nonsense")).toBe("unknown");
  });
});

/**
 * SR-39. `ignoreTLS: !secure` told nodemailer to skip STARTTLS even where the server offered it,
 * so a provider on 587 got the code and the SMTP AUTH credentials in the clear. The transport now
 * copies the decision `loadConfig` already made and adds nothing of its own.
 */
describe("smtpTransportOptions", () => {
  it("carries implicit TLS through untouched", () => {
    const options = smtpTransportOptions({ ...SMTP, host: "smtp.example.com", port: 465, secure: true, requireTls: false, ignoreTls: false });
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
    expect(options.ignoreTLS).toBe(false);
  });

  it("requires STARTTLS on a remote host, and never ignores it", () => {
    const options = smtpTransportOptions({
      ...SMTP,
      host: "smtp.example.com",
      port: 587,
      requireTls: true,
      ignoreTls: false,
      user: "portal",
      pass: "secret",
    });
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
    expect(options.ignoreTLS).toBe(false);
    expect(options.auth).toEqual({ user: "portal", pass: "secret" });
  });

  it("ignores TLS only for the loopback sandbox", () => {
    const options = smtpTransportOptions(SMTP);
    expect(options.ignoreTLS).toBe(true);
    expect(options.requireTLS).toBe(false);
    expect(options.auth).toBeUndefined();
  });
});
