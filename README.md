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
# Set strong JWT secrets and a private seed-admin password in .env.
docker compose up --build
```

The compose stack includes `app`, `worker`, `frontend`, `mysql`, `redis`, and `nginx`. The browser entrypoint is port 80. MySQL initializes the full schema on its first start. To upgrade an existing MySQL volume, run:

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

### Browser walkthrough

1. For local testing only, start the stack with `NODE_ENV=development docker compose up --build` and open `http://localhost`. Development mode displays newly generated temporary invite passwords in the Admin UI; never use it for a deployment. Sign in with `admin@sidra.academy` and the `SEED_ADMIN_PASSWORD` from `.env`.
2. On the Admin dashboard, create one Teacher and one Student invite. Use the generated temporary passwords to sign in to each account and complete the forced password reset.
3. Sign in as the Teacher. In **Teacher availability**, set a weekly window (for example Monday 09:00–12:00) and save it. The displayed IANA timezone is the time basis for those hours.
4. Return to Admin. In **Admin scheduling**, select the Teacher, Student, and course. Choose a future Monday and a time/duration inside the teacher’s window, then create the class. The API materializes the next eight weeks and the Admin calendar displays both participant timezones.
5. Sign in as the Student to verify the read-only calendar, then as the Teacher to verify the calendar and mark attendance when the class start time arrives. Teacher marking is enabled through 24 hours after the scheduled start.
6. On Admin’s calendar, override a marked slot. A reason is required; verify the action in `GET /admin/audit-log` or the `audit_log` table.
7. The worker runs the slot generator daily and checks for unattended slots hourly. Verify it is running with `docker compose logs -f worker`. A slot with no mark after 24 hours becomes `pending_review`; the unit and database integration tests cover this without waiting a day.