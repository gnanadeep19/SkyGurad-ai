# Email notifications with Gmail

For hosted deployments that cannot use outbound SMTP, the app also supports Resend over HTTPS; see [Railway deployment preparation](RAILWAY-DEPLOYMENT.md).

Email is **disabled by default**. SkyGuard can queue one email when a new station-api anomaly or opted-in station data-arrival incident opens. It does not send an email for every subsequent observation, and it does not send email for uploaded historical files, the NOAA reference, Open-Meteo, or replay. No email is sent until the configuration below is completed and the backend is restarted. Station data-arrival incidents are Warning severity and respect the configured minimum severity.

## Configure

1. Use a Gmail account for the sender. Google requires 2-Step Verification for an app password and notes that app passwords may not be available for some work, school, or Advanced Protection accounts. See [Google's app password guide](https://support.google.com/accounts/answer/185833).
2. Create an app password yourself in your Google account. Do not send the password in chat, commit it, or use your normal Google account password in SkyGuard.
3. In the project folder, open the existing **ignored** `.env.skyguard.local` file in a text editor. **Keep the existing `DATABASE_URL` line** and add the following, replacing the placeholders privately. Enter the app password without its display spaces.

```dotenv
SKYGUARD_EMAIL_ENABLED=1
SKYGUARD_SMTP_HOST=smtp.gmail.com
SKYGUARD_SMTP_PORT=587
SKYGUARD_SMTP_SECURE=0
SKYGUARD_SMTP_USER=your-gmail-address@gmail.com
SKYGUARD_SMTP_PASSWORD=your-gmail-app-password
SKYGUARD_EMAIL_FROM=your-gmail-address@gmail.com
SKYGUARD_EMAIL_TO=recipient@example.com
```

The prototype uses authenticated SMTP with required STARTTLS on port 587. Google's [Gmail SMTP guidance](https://support.google.com/mail/answer/7104828) documents this server and port. Restart the backend from your normal terminal after editing the file. The Station feed incident panel shows whether email is configured and the number of pending and failed jobs; it does not show your password or recipient.

This is a local prototype that stores credentials in a local environment file. Protect it and its backups. Google recommends OAuth / â€œSign in with Googleâ€ where possible; this prototype uses SMTP app passwords and does not implement OAuth. The file is ignored by Git, but its contents remain accessible to your Windows account and should not be shared.

## Delivery behavior

- Administrators can set the primary recipient, minimum severity, maximum delivery attempts, retry delay, and optional escalation recipient and delay in Settings. The default keeps the original recipient, warning-and-critical selection, three attempts, two-minute retry delay, and no escalation. For a critical-only policy, an existing warning incident can queue its first notification if it later becomes critical. Settings changes apply to jobs created after the change; existing jobs retain their recipients, schedules, and retry limits.
- One initial email is queued per eligible incident. A single escalation email may also be scheduled for an incident that remains unacknowledged. Acknowledging, investigating, or resolving the incident cancels its pending escalation. Resolving also cancels pending initial messages. Further detections do not create duplicate jobs of the same kind. A new incident after resolution can queue new messages.
- The worker checks the queue about once a minute and uses the configured retry attempts and delay. SMTP acceptance does not guarantee inbox delivery. A crash after the mail server accepts a message can result in a duplicate on retry.
- Resolving an incident cancels a pending message; a message already being sent may still arrive. When email is disabled, new incidents are not queued for later delivery. Existing queued messages are processed if email is enabled again; the recipient captured at incident creation is retained in each job.
- A failed queue count means delivery needs attention. There is currently no UI to retry a permanently failed job and no SMS. Escalation is a single email level. A send already in flight may still arrive after the incident is acknowledged or resolved.
- PostgreSQL incident and outbox updates are transactional. The fallback JSONL file store is for single-process development and has weaker guarantees; its incident and notification files are not automatically imported by the legacy history migration.
