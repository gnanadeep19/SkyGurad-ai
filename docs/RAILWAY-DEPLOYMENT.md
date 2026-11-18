# Railway deployment preparation

This describes a single-instance college demonstration, not a production deployment. The application serves the built frontend and API from the same Node.js process. The `Dockerfile` builds it with Node.js 24. Do not upload `.env.skyguard.local`, local accounts, credentials, logs, or local database files. The repository's ignore files exclude these paths.

## Services and storage

1. Connect the project source to a Railway service. When the repository root is the parent folder containing `SkyGuard-AI`, use `SkyGuard-AI` as the service root; when the repository root already contains `package.json`, use that root. Railway can detect the `Dockerfile` there.
2. Add a PostgreSQL service and set the app service's `DATABASE_URL` to that service's internal `DATABASE_URL` reference. This creates a separate hosted database; it does not import local observations or accounts.
3. Attach a persistent volume to the app service at `/data`, and set `SKYGUARD_DATA_DIR=/data/runtime`. The account file and station-device credentials are stored in that directory, even when PostgreSQL is used. Back it up separately from PostgreSQL. The local PostgreSQL connection and local file paths will not work on Railway.
4. Set `SKYGUARD_TRUST_PROXY=1` only when HTTPS is terminated at the trusted Railway proxy and direct access to the application process is blocked. The service uses the platform-provided `PORT`. Use one app replica; the local scheduler, sessions, file-backed accounts and credentials are not designed for multiple backend processes.
5. Set the service health check path to `/healthz`. A successful health check confirms that the process started; it does not establish that email or the weather source works.
6. On first startup, obtain the one-time administrator setup code from the **private service logs**, open the app over HTTPS, and create the first administrator. Sessions are kept in memory and are cleared on restart. Protect the logs and do not expose the setup code. If no administrator is created before a restart, the code changes.

## Email for a demonstration

Railway Free, Trial and Hobby restrict outbound SMTP; the app supports Resend over HTTPS. Set these as service variables, keeping the key secret:

```
SKYGUARD_EMAIL_ENABLED=1
SKYGUARD_EMAIL_PROVIDER=resend
RESEND_API_KEY=<set privately in Railway>
SKYGUARD_EMAIL_FROM=onboarding@resend.dev
SKYGUARD_EMAIL_TO=<your Resend account email>
```

Use a Resend API key with the necessary sending permission. The `onboarding@resend.dev` sender is for testing and may only deliver to the email associated with the Resend account; check the provider's current rules. To send to other people, configure and verify a domain in Resend and use a sender on that domain. Never put the key in source control or paste it into chat. The recipient and escalation policy can be changed by an administrator in the app, but the testing sender's restrictions still apply. Keep the existing SMTP configuration for local development if desired.

The app's first setup does not import the current computer's account, data or email secrets. Configure the hosted values independently. The remote device gateway remains local-only by default and is not ready for untrusted remote stations.

## Verify after deployment

Check `/healthz`, sign in, confirm the dashboard's source and observation timestamps, inspect Station feed and notification status, and perform an explicitly labelled test with authorized test data and recipient. Provider acceptance is not proof that a message reached the inbox. Confirm persistence by restarting the service and checking that the account and historical data remain. A real-station test and independently verified sensor-fault evaluation still require external equipment and evidence.

References: [Railway build commands](https://docs.railway.com/builds/build-and-start-commands), [Railway volumes](https://docs.railway.com/volumes), [Railway email limitations](https://docs.railway.com/networking/outbound-networking), and [Resend domains](https://resend.com/docs/dashboard/domains/introduction).
