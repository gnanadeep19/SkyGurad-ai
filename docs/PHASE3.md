# Phase 3: incident review

SkyGuard groups repeated flagged submitted-station observations into an active incident. An incident is an item for investigation, not proof of equipment failure. Open-Meteo estimates and replay do not create physical-station incidents.

## Review workflow

On the Station feed or Alerts incident panel, a signed-in administrator or operator can acknowledge an incident and select **Start investigation**. If unassigned, starting an investigation assigns it to the signed-in user; an existing assignment is preserved. Either role can assign, reassign, or clear an active incident using the team selector. Assignment accepts active accounts only. It records the acting user, assignee, and time in the incident history. Resolved incidents cannot be reassigned. If a team member is later deactivated, their historical assignment remains visible. Repeated detections continue to update the same active incident, including while it is under investigation.

To resolve it, select an outcome and optionally add a review note. The default is **Undetermined**; selecting sensor fault, weather event, or false alarm requires a note explaining the review. These outcomes are operator reports, not independent verification by SkyGuard. Existing incidents resolved before this feature may have no recorded outcome. Open the incident history to review detection and user actions. Analytics can filter by investigation status and export the current incident page with assignee and outcome.

## Persistence and compatibility

PostgreSQL startup adds the new review fields and updates the incident status constraint and active-incident index while preserving existing rows. Local file storage retains review details in its incident log. Before upgrading a valuable database, follow the backup and restore guidance in [Phase 1](PHASE1.md). The backend must restart for schema and API changes to take effect; current in-memory login sessions will expire.

## Notifications and remaining work

Email setup and queue behavior are documented in [email notifications](EMAIL-NOTIFICATIONS.md). Administrators can configure the primary recipient, minimum severity, retry attempts and delay, and an optional escalation recipient and delay in Settings. One escalation may be sent if the incident is still open and unacknowledged when delivery begins. Acknowledgement, investigation, or resolution cancels pending escalations. Repeated detections do not create duplicate jobs of the same type for the same incident. A message already being sent may still arrive after acknowledgement or resolution. Configuration changes do not rewrite queued jobs.

SMS is optional and requires a provider; it is not implemented. Escalation is a single email level, not an on-call paging service, and SMTP acceptance does not guarantee inbox delivery. A physical station connection is not required for the college demo; submitted simulated readings must remain labeled as simulated and cannot validate a real sensor fault.
