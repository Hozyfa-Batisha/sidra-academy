# Sidra Academy

Phase 1 foundation: role-scoped JWT authentication, invite-based account creation, first-login password reset, empty dashboards, and the base MySQL/Redis/nginx compose stack.

## Local development

```bash
npm install
npm --prefix client install
npm test
npm run build
npm run dev
```

The API defaults to an in-memory store for quick local development. To use MySQL, set `DATABASE_URL` and initialize `server/schema.sql`.

The development seed admin is:

- Email: `admin@sidra.academy`
- Password: `Admin12345!`

Change the seed password before using any deployed environment.

## Docker

```bash
docker compose up --build
```

The compose stack includes `app`, `frontend`, `mysql`, `redis`, and `nginx`. The browser entrypoint is port 80.