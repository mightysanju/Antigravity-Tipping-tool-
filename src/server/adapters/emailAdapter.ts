import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { ServerConfig } from '../config.ts';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  template: 'otp' | 'invite' | 'receipt' | 'unclaimed_reminder' | 'agreement';
  metadata?: Record<string, string>;
}

export interface RecordedEmail extends OutboundEmail {
  timestamp: string;
}

export interface EmailAdapter {
  readonly mode: ServerConfig['emailMode'];
  sendEmail(message: OutboundEmail): Promise<{ messageId: string }>;
}

export class StubEmailAdapter implements EmailAdapter {
  readonly mode = 'stub' as const;
  private readonly outbox: RecordedEmail[] = [];
  private readonly outboxFilePath: string | null;

  constructor(outboxFilePath: string | null = null) {
    this.outboxFilePath = outboxFilePath;
  }

  getOutbox(): readonly RecordedEmail[] {
    return this.outbox;
  }

  async sendEmail(message: OutboundEmail): Promise<{ messageId: string }> {
    const entry: RecordedEmail = {
      ...message,
      timestamp: new Date().toISOString(),
    };
    this.outbox.push(entry);
    if (this.outboxFilePath) {
      await fs.mkdir(path.dirname(this.outboxFilePath), { recursive: true });
      await fs.appendFile(this.outboxFilePath, JSON.stringify(entry) + '\n', 'utf8');
    }
    return { messageId: `stub_${this.outbox.length}` };
  }
}

class MailpitEmailAdapter implements EmailAdapter {
  readonly mode = 'mailpit' as const;
  private readonly host: string;
  private readonly port: number;
  private readonly from: string;

  constructor(host: string, port: number, from: string) {
    this.host = host;
    this.port = port;
    this.from = from;
  }

  async sendEmail(message: OutboundEmail): Promise<{ messageId: string }> {
    const id = `mailpit_${Date.now()}`;
    const rawMime = [
      `From: <${this.from}>`,
      `To: <${message.to}>`,
      `Subject: ${message.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      message.text,
      '',
    ].join('\r\n');

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let step = 0;
      const commands = [
        `EHLO localhost\r\n`,
        `MAIL FROM:<${this.from}>\r\n`,
        `RCPT TO:<${message.to}>\r\n`,
        `DATA\r\n`,
        `${rawMime}\r\n.\r\n`,
        `QUIT\r\n`,
      ];

      socket.on('data', () => {
        if (step < commands.length) {
          socket.write(commands[step]);
          step += 1;
        } else {
          socket.end();
          resolve();
        }
      });
      socket.on('error', reject);
    });

    return { messageId: id };
  }
}

class ResendEmailAdapter implements EmailAdapter {
  readonly mode = 'resend' as const;
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async sendEmail(message: OutboundEmail): Promise<{ messageId: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RESEND_API_ERROR (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { id: string };
    return { messageId: data.id };
  }
}

export function createEmailAdapter(config: ServerConfig): EmailAdapter {
  if (config.emailMode === 'stub') {
    return new StubEmailAdapter(null);
  }
  if (config.emailMode === 'mailpit') {
    return new MailpitEmailAdapter(
      config.mailpitSmtpHost,
      config.mailpitSmtpPort,
      config.emailFrom
    );
  }
  return new ResendEmailAdapter(config.resendApiKey, config.emailFrom);
}
