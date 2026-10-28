# Daily English

Learn three everyday English sentences a day, one at a time, on your phone. An LLM reads the full text of the day's Perth news stories and writes each sentence in **spoken** English (contractions, "Did you hear...", phrasal verbs) with a Chinese translation and a Chinese explanation of the hard words and phrases. You **speak** each new sentence: first you read it out loud, then the English is hidden and you say it from the Chinese. Your recordings are turned into text by Azure speech-to-text (never stored) and compared word by word; passing the second step is what marks the sentence as learned. After the new sentences, old ones come back on a spaced schedule (1, 3, 7, 14, 30 days): you see the Chinese, **type the English yourself**, and the LLM marks your answer and explains the difference. At most 10 reviews are shown per day (most overdue first; the rest wait for tomorrow), and a sentence you answer correctly in the last box is retired, so the daily workload stays flat. One flow, no tabs: new first, then reviews, then "all done".

Built to run on Azure with no passwords anywhere:

| Part | Service |
|---|---|
| Web app and API | Azure Container Apps (Node 22, Express) |
| Sign-in | Container Apps built-in authentication (Microsoft account); the app has no login code |
| Database | Azure SQL, Entra-only authentication, managed identity |
| LLM | Azure OpenAI deployment, Entra token (no API key) |
| News | Public RSS feeds (ABC WA, WAtoday, ABC National). The model picks stories from the headlines, the app fetches those articles (allow-listed hosts only) and the model writes its own sentences from the text. Article text is read, never stored or logged, and the story link is not shown |

## Run locally

```bash
npm install
cp .env.example .env      # fill in your server, database and OpenAI endpoint
az login                  # local runs use your az login as the Entra identity
node --env-file=.env scripts/migrate.js   # create the tables
node --env-file=.env src/server.js        # http://localhost:3000 (AUTH_MODE=dev)
node --env-file=.env scripts/preview.js   # run the real pipeline once, print the result, save nothing
npm test                  # 46 tests, no Azure needed
```

Your Entra user must be a database user (the SQL admin works), and have the *Cognitive Services OpenAI User* role on the OpenAI resource.

## Notes

- `AUTH_MODE=easyauth` trusts the identity headers added by Container Apps authentication, so it must only be used behind it with "require authentication" turned on. `AUTH_MODE=dev` ignores the headers.
- Typed answers are passed to the model as data inside a delimited block. Azure's safety filter also blocks obvious injection attempts; the app shows a clear message and does not record that answer.
- Each user can have 40 answers judged per hour (cost guard).
- The free serverless Azure SQL database pauses when idle; the first connection while it wakes up fails, so database calls retry with back-off (`src/retry.js`).

## Licence

MIT
