import { describe, expect, it, vi } from "vitest";
import { EmailWorker, createResendSender, loadEmailConfig, sendTestEmail, type EmailConfig } from "./email-notifications.js";
import type { Storage } from "./storage.js";

const config: EmailConfig={host:"smtp.example.com",port:587,secure:false,user:"sender",password:"not-a-real-password",from:"skyguard@example.com",recipient:"ops@example.com"};
describe("email notification worker",()=>{
  it("is disabled by default and rejects incomplete enabled configuration",()=>{
    expect(loadEmailConfig({})).toBeNull();
    expect(()=>loadEmailConfig({SKYGUARD_EMAIL_ENABLED:"1"})).toThrow(/configuration is invalid/);
  });
  it("validates the HTTPS email provider separately from SMTP",()=>{
    const env={SKYGUARD_EMAIL_ENABLED:"1",SKYGUARD_EMAIL_PROVIDER:"resend",RESEND_API_KEY:"re_test_only",SKYGUARD_EMAIL_FROM:"onboarding@resend.dev",SKYGUARD_EMAIL_TO:"ops@example.com"};
    expect(loadEmailConfig(env)).toEqual({provider:"resend",apiKey:"re_test_only",from:"onboarding@resend.dev",recipient:"ops@example.com"});
    expect(()=>loadEmailConfig({...env,RESEND_API_KEY:""})).toThrow(/Resend configuration/);
    expect(()=>loadEmailConfig({...env,SKYGUARD_EMAIL_PROVIDER:"unknown"})).toThrow(/provider/);
  });
  it("submits alerts over HTTPS and treats a provider error as failure",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({id:"test"}),{status:200})).mockResolvedValueOnce(new Response("denied",{status:403}));
    const sender=createResendSender("re_test_only",fetcher as unknown as typeof fetch);
    const message={from:"onboarding@resend.dev",to:"ops@example.com",subject:"SkyGuard test",text:"Test"};
    await sender.sendMail(message);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({...message,to:[message.to]});
    await expect(sender.sendMail(message)).rejects.toThrow("HTTP 403");
  });
  it("sends an explicitly labelled test to the saved recipient",async()=>{
    const sender={sendMail:vi.fn().mockResolvedValue({})};
    await sendTestEmail(config,"saved@example.com",sender);
    expect(sender.sendMail).toHaveBeenCalledWith(expect.objectContaining({to:"saved@example.com",subject:"SkyGuard email delivery test",text:expect.stringContaining("does not represent a weather-station anomaly")}));
  });
  it("sends a queued incident once and records successful delivery",async()=>{
    const job={id:"1",incident_id:"2",recipient:"ops@example.com",attempts:1,station_id:"AWS-001",severity:"Warning",opened_at:"2024-01-01T00:00:00.000Z"};
    const storage={claimNotification:vi.fn().mockResolvedValue(job),finishNotification:vi.fn().mockResolvedValue(undefined)} as unknown as Storage;
    const sender={sendMail:vi.fn().mockResolvedValue({})};
    await new EmailWorker(storage,config,sender).runOnce();
    expect(sender.sendMail).toHaveBeenCalledOnce(); expect(sender.sendMail.mock.calls[0][0].to).toBe("ops@example.com");
    expect(storage.finishNotification).toHaveBeenCalledWith("1",1,true);
  });
  it("marks delivery failure without exposing the error or credentials",async()=>{
    const storage={claimNotification:vi.fn().mockResolvedValue({id:"1",incident_id:"2",recipient:"ops@example.com",attempts:2,station_id:"AWS-001",severity:"Warning",opened_at:"2024-01-01T00:00:00.000Z"}),finishNotification:vi.fn().mockResolvedValue(undefined)} as unknown as Storage;
    const sender={sendMail:vi.fn().mockRejectedValue(new Error("private-password"))};
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try { await new EmailWorker(storage,config,sender).runOnce(); expect(storage.finishNotification).toHaveBeenCalledWith("1",2,false); expect(JSON.stringify(warn.mock.calls)).not.toContain("private-password"); } finally { warn.mockRestore(); }
  });
});
