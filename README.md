# Daily English

Learn three everyday English sentences a day, taken from local (Perth) news. An LLM rewrites each story as one simple, natural sentence with a Chinese translation. Later the app shows you the Chinese and asks you to type the English; the LLM marks your answer and the sentence comes back on a spaced schedule (1, 3, 7, 14, 30 days).

Built to run on Azure with no passwords anywhere:

| Part | Service |
|---|---|
| Web app and API | Azure Container Apps (Node 22, Express) |
| Sign-in | Container Apps built-in authentication (Microsoft account); the app has no login code |
| Database | Azure SQL, Entra-only authentication, managed identity |
| LLM | Azure OpenAI deployment, Entra token (no API key) |
| News | Public RSS headlines only. The LLM writes its own sentences and the app links to the story; article text is never stored |

## Run locally

```bash
npm install
cp .env.example .env      # fill in your server, database and OpenAI endpoint
az login                  # local runs use your az login as the Entra identity
node --env-file=.env scripts/migrate.js   # create the tables
node --env-file=.env src/server.js        # http://localhost:3000 (AUTH_MODE=dev)
npm test                  # 23 tests, no Azure needed
```

Your Entra user must be a database user (the SQL admin works), and have the *Cognitive Services OpenAI User* role on the OpenAI resource.

## Notes

- `AUTH_MODE=easyauth` trusts the identity headers added by Container Apps authentication, so it must only be used behind it with "require authentication" turned on. `AUTH_MODE=dev` ignores the headers.
- Typed answers are passed to the model as data inside a delimited block. Azure's safety filter also blocks obvious injection attempts; the app shows a clear message and does not record that answer.
- Each user can have 40 answers judged per hour (cost guard).

## Licence

MIT
