-- SkyGuard Phase 1 schema. Historical input is preserved alongside validated readings.
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS stations (
  station_id TEXT PRIMARY KEY, station_name TEXT NOT NULL, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  state TEXT, region TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sensors (
  sensor_id TEXT PRIMARY KEY, station_id TEXT NOT NULL REFERENCES stations(station_id), sensor_type TEXT NOT NULL,
  unit TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS observation_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB NOT NULL, quality_status TEXT NOT NULL CHECK (quality_status IN ('valid', 'invalid', 'duplicate')),
  quality_issues JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS observations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, station_id TEXT NOT NULL, station_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL, longitude DOUBLE PRECISION NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL, source TEXT NOT NULL, temperature DOUBLE PRECISION NOT NULL,
  humidity DOUBLE PRECISION NOT NULL, pressure DOUBLE PRECISION NOT NULL,
  observation_event_id BIGINT REFERENCES observation_events(id),
  UNIQUE (source, station_id, observed_at)
);
CREATE INDEX IF NOT EXISTS observations_station_time_idx ON observations (station_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS observations_source_time_idx ON observations (source, observed_at DESC);
-- Only newly submitted station readings enter the durable scoring queue.
ALTER TABLE observations ADD COLUMN IF NOT EXISTS detection_state TEXT;
CREATE INDEX IF NOT EXISTS observations_pending_detection_idx ON observations (observed_at, id) WHERE detection_state = 'pending';
CREATE TABLE IF NOT EXISTS model_versions (version TEXT PRIMARY KEY, name TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS anomaly_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, observation_id BIGINT NOT NULL REFERENCES observations(id),
  model_version TEXT NOT NULL REFERENCES model_versions(version), score DOUBLE PRECISION NOT NULL, status TEXT NOT NULL,
  health DOUBLE PRECISION NOT NULL, confidence DOUBLE PRECISION, details JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (observation_id, model_version)
);
-- Station incidents and their notification outbox are separate from historical detection snapshots.
CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, observation_id BIGINT NOT NULL UNIQUE REFERENCES observations(id), station_id TEXT NOT NULL, sensor_id TEXT, source TEXT NOT NULL,
  status TEXT NOT NULL, severity TEXT NOT NULL, opened_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS alert_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, alert_id BIGINT NOT NULL REFERENCES alerts(id),
  actor_id TEXT NOT NULL, action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS station_incidents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, station_id TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('Warning', 'Critical')),
  opened_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, details JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- Upgrade existing local databases without removing incident records.
ALTER TABLE station_incidents ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE station_incidents ADD COLUMN IF NOT EXISTS assigned_name TEXT;
ALTER TABLE station_incidents ADD COLUMN IF NOT EXISTS resolution_outcome TEXT;
ALTER TABLE station_incidents DROP CONSTRAINT IF EXISTS station_incidents_status_check;
ALTER TABLE station_incidents ADD CONSTRAINT station_incidents_status_check CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved'));
DROP INDEX IF EXISTS station_incidents_one_active_idx;
CREATE UNIQUE INDEX station_incidents_one_active_idx ON station_incidents (source, station_id) WHERE status IN ('open', 'acknowledged', 'investigating');
CREATE TABLE IF NOT EXISTS station_arrival_monitor (station_id TEXT PRIMARY KEY, disconnected BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS station_incident_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, incident_id BIGINT NOT NULL REFERENCES station_incidents(id),
  actor_id TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, incident_id BIGINT NOT NULL REFERENCES station_incidents(id),
  recipient TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, last_error TEXT,
  UNIQUE (incident_id)
);
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS retry_delay_minutes INTEGER NOT NULL DEFAULT 2;
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_incident_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_incident_kind_idx ON notification_outbox (incident_id,kind);
CREATE TABLE IF NOT EXISTS notification_policy (id INTEGER PRIMARY KEY CHECK (id=1), policy JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS detector_settings (id INTEGER PRIMARY KEY CHECK (id = 1), settings JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb, migration_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING;
