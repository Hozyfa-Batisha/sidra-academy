# Sidra Academy

Sidra Academy MVP foundation through Phase 3: role-scoped JWT authentication, teacher availability, Admin scheduling, attendance workflows, monthly digest job, and role-scoped calendars.

## Local development

```bash
npm install
npm --prefix client install
npm test
npm run build
npm run dev
```

The API defaults to an in-memory store for quick local development. The in-memory store supports API demos and unit tests; the BullMQ worker requires MySQL and Redis.

The development seed admin is:

- Email: `admin@sidra.academy`
- Password: `Admin12345!`

Change the seed password and JWT secrets before using any deployed environment.

## Docker

```bash
cp .env.example .env
# Generate secrets locally; use the two different JWT values for JWT_SECRET and JWT_REFRESH_SECRET.
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 24
openssl rand -hex 24
# Put those outputs in .env for JWT_SECRET, JWT_REFRESH_SECRET,
# MYSQL_PASSWORD, and MYSQL_ROOT_PASSWORD. Also set SEED_ADMIN_PASSWORD.
```

`SIDRA_HOSTNAME` is the DuckDNS hostname routed to Sidra Academy. The Compose file applies Traefik labels to `nginx`, shares the external `proxy` network, sends HTTP requests to HTTPS, and asks the `letsencrypt` resolver for a certificate. Your Traefik instance must use the same Docker network and define the configured `web`, `websecure`, and `letsencrypt` names. DuckDNS must resolve to this server, with ports 80 and 443 reaching Traefik.

If the external network does not already exist, create it once with `docker network create proxy` (or use the name configured by `TRAEFIK_NETWORK`). Then deploy:

```bash
docker compose up -d --build
```

The app is reached at `https://<SIDRA_HOSTNAME>`; this Compose stack does not publish the app’s HTTP port on the host. MySQL initializes the full schema on its first start. To upgrade an existing MySQL volume, run:

```bash
docker compose exec -T mysql sh -c 'mysql -usidra -p"$MYSQL_PASSWORD" sidra_academy' < server/migrations/003-scheduling.sql
```

Changing MySQL passwords in `.env` does not rotate credentials in a database volume that was already initialized; update the MySQL user password in that database before changing its Compose value.

```bash
docker compose exec -T mysql sh -c 'mysql -usidra -p"$MYSQL_PASSWORD" sidra_academy' < server/migrations/003-scheduling.sql
```

In production, configure `SMTP_URL` and `MAIL_FROM` to deliver the monthly teacher-hours digest. Without those values, the worker skips digest delivery and logs the missing configuration. Digests summarize completed, confirmed sessions and do not affect salary.

## Phase 3: test the core flow yourself

### Automated tests

```bash
npm test
npm run build
```

The test suite exercises role checks, schedule creation against availability, timezone-safe recurring slot materialization, attendance marking, Admin override audit entries, suspension reassignment, and the 24-hour attendance watchdog with an accelerated test clock.

To run the database-level concurrency test against a disposable MySQL/MariaDB database whose name contains `test`, apply the schema, then set `MYSQL_TEST_URL`:

```bash
MYSQL_TEST_URL='mysql://test_user:test_password@127.0.0.1:3306/sidra_academy_test' npm test
```

That integration test inserts two concurrent slots for the same teacher and instant, checks that the `(teacher_id, date_time_utc)` unique index rejects one, then verifies the attendance override audit row and watchdog state update. It cleans up its test rows afterward.

### Local browser walkthrough

1. Run `npm run dev` and open the Vite address (normally `http://localhost:5173`). This uses the in-memory store and is for local testing, not deployment.
2. On the Admin dashboard, create one Teacher and one Student invite. Use their displayed temporary passwords to sign in and complete the forced password resets.
3. Sign in as the Teacher. In **Teacher availability**, set a weekly window (for example Monday 09:00–12:00) and save it. The displayed IANA timezone is the time basis for those hours.
4. Return to Admin. In **Admin scheduling**, select the Teacher, Student, and course. Choose a future Monday and a time/duration inside the teacher’s window, then create the class. The API materializes the next eight weeks and the Admin calendar displays both participant timezones.
5. Sign in as the Student to verify the read-only calendar, then as the Teacher to verify the calendar and mark attendance when the class start time arrives. Teacher marking is enabled through 24 hours after the scheduled start.
6. On Admin’s calendar, override a marked slot. A reason is required; verify the action in `GET /admin/audit-log`. The background worker requires the MySQL/Redis Compose deployment; verify it with `docker compose logs -f worker`. An unmarked slot becomes `pending_review` after 24 hours; the tests cover this with an accelerated clock.