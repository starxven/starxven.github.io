# Backend

Run the backend from this directory:

```bash
npm install
npm start
```

Existing process environment variables take precedence over everything else. After that, values are loaded from `backend/.env`, and the repository root `.env` is used last only to fill variables that are still missing.
