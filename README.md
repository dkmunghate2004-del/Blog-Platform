# Inkwell – Full-Stack Blog Platform

Node.js + Express + SQLite (better-sqlite3) backend, vanilla JS single-page frontend.

## Run
    npm install
    JWT_SECRET="a-long-random-string" npm start     # Windows PowerShell: $env:JWT_SECRET="..."; npm start
Open http://localhost:3000. The database file `blog.db` is created automatically.

## REST API
| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | – | Create account |
| POST | /api/auth/login | – | Log in, returns JWT |
| GET | /api/auth/me | ✔ | Current user |
| GET | /api/posts?q=&page= | – | List/search posts |
| GET | /api/posts/:id | – | Post with comments |
| POST | /api/posts | ✔ | Create post |
| PUT | /api/posts/:id | owner | Edit post |
| DELETE | /api/posts/:id | owner | Delete post |
| POST | /api/posts/:id/comments | ✔ | Add comment |
| DELETE | /api/comments/:id | author or post owner | Delete comment |

## Security
bcrypt password hashing, JWT auth (7-day expiry), parameterized SQL, input validation, ownership checks,
Helmet headers, rate-limited auth routes, XSS-safe rendering (textContent only).
