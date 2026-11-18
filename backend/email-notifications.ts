import nodemailer from "nodemailer";
import type { Storage } from "./storage.js";

export type EmailConfig = { provider?: "smtp"; host: string; port: number; secure: boolean; user: string; password: string; from: string; recipient: string } | { provider: "resend"; apiKey: string; from: string; recipient: string };
export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig | null {
  if (env.SKYGUARD_EMAIL_ENABLED !== "1") return null;
  const provider = env.SKYGUARD_EMAIL_PROVIDER?.trim().toLowerCase() || "smtp";
  const from=env.SKYGUARD_EMAIL_FROM?.trim(), recipient=env.SKYGUARD_EMAIL_TO?.trim();
  const address=(value: string | undefined) => !!value && /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
  if (provider === "resend") {
    const apiKey=env.RESEND_API_KEY?.trim();
    if (!apiKey || /[\r\n]/.test(apiKey) || !address(from) || !address(recipient)) throw new Error("Email is enabled but its Resend configuration is invalid.");
    return {provider:"resend",apiKey,from:from!,recipient:recipient!};
  }
  if (provider !== "smtp") throw new Error("Email provider must be smtp or resend.");
  const host=env.SKYGUARD_SMTP_HOST?.trim(), user=env.SKYGUARD_SMTP_USER?.trim(), password=env.SKYGUARD_SMTP_PASSWORD;
  const port=Number(env.SKYGUARD_SMTP_PORT ?? 587), secure=env.SKYGUARD_SMTP_SECURE === "1";
  if (!host || /[\r\n]/.test(host) || !user || !password || !address(from) || !address(recipient) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Email is enabled but its SMTP host, port, login, sender, or recipient configuration is invalid.");
  return {host,port,secure,user,password,from:from!,recipient:recipient!};
}

type MailSender = { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
export function createResendSender(apiKey: string, fetchImpl: typeof fetch = fetch): MailSender {
  return { async sendMail(message) {
    const response=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({...message,to:[message.to]}),signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
    return response.json();
  } };
}
export function createEmailSender(config: EmailConfig): MailSender {
  return config.provider === "resend" ? createResendSender(config.apiKey) : nodemailer.createTransport({host:config.host,port:config.port,secure:config.secure,requireTLS:!config.secure,auth:{user:config.user,pass:config.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
}
export async function sendTestEmail(config: EmailConfig, recipient: string, sender: MailSender = createEmailSender(config)) {
  await sender.sendMail({from:config.from,to:recipient,subject:"SkyGuard email delivery test",text:"This is a test message from SkyGuard. It does not represent a weather-station anomaly or incident."});
}
export class EmailWorker {
  private running=false;
  private timer: ReturnType<typeof setInterval> | null=null;
  private sender: MailSender;
  constructor(private storage: Storage, private config: EmailConfig, sender?: MailSender) {
    this.sender=sender ?? createEmailSender(config);
  }
  start() { if(this.timer) return; void this.runOnce(); this.timer=setInterval(()=>void this.runOnce(),60_000); this.timer.unref?.(); }
  stop() { if(this.timer) clearInterval(this.timer); this.timer=null; }
  async runOnce() {
    if(this.running) return;
    this.running=true;
    try {
      const job=await this.storage.claimNotification();
      if (!job) return;
      let delivered=false;
      try {
        const station=job.station_id.replace(/[\r\n]/g," ").slice(0,128);
        await this.sender.sendMail({from:this.config.from,to:job.recipient,subject:`SkyGuard: ${job.kind === "escalation" ? "Unacknowledged " : ""}${job.severity} station incident`,text:`${job.kind === "escalation" ? "This incident was still unacknowledged when escalation delivery began.\n\n" : ""}A ${job.severity.toLowerCase()} station incident was recorded for ${station}.\nIncident time: ${job.opened_at}\n\nSign in to SkyGuard to see whether this is an anomaly or a missing-data warning and review the evidence. An anomaly is not proof of a sensor fault.`});
        delivered=true;
      } catch { console.warn("SkyGuard email notification delivery failed."); }
      await this.storage.finishNotification(job.id,job.attempts,delivered);
    } catch { console.warn("SkyGuard email queue could not be processed."); }
    finally { this.running=false; }
  }
}
