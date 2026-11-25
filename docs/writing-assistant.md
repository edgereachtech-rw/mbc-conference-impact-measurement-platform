# Writing assistant (OpenAI)

Added 2026-11-25. The admin console has an AI writing assistant backed by OpenAI. It is off
until the server has an API key.

## What it does

- **Improve wording**: click into any text field of the admin console (a question, an
  option, a section title or description, an email's subject or wording, a message to
  delegates, an event setting). An **Improve wording** button appears at the field's top
  right. It opens a suggestion next to your text, with four styles: Improve, Shorter, More
  formal and Friendlier. You can edit the suggestion. The field changes only when you choose
  **Use this wording**.
- **Summaries of results**: on an assessment's submissions page, **Write a summary** writes
  a short overview and three to six findings. The summary is saved for the batch chosen in
  "Downloads for" (or for everyone). It is added to that scope's PDF and Word downloads, and to
  a **Summary** sheet in the Excel download. **Write again** replaces it, for example after more
  responses come in; the page says when the figures have moved on.

## What is sent to OpenAI

Decision 2026-11-25: no delegate data leaves the platform.

| Feature | Sent | Never sent |
|---|---|---|
| Improve wording | The text of the field you are in, and its label | Email addresses and phone numbers in that text (replaced with markers, put back after) |
| Summaries | Counts, response rate, averages, option percentages, and the question and option wording | Names, emails, organisations, any answer a delegate typed |

The assistant is not offered in fields of personal details: the delegate form, the staff
form, support request notes, search boxes, and email, phone, number or date inputs. To keep it
away from another field, put `data-no-ai` on the field or its container.

Requests are sent with `store: false`, so OpenAI does not keep them for its dashboard. Nothing
written by the assistant or by an admin goes into the logs. Writing a summary is audited
(`assessment.ai_summary_written`) without its text. Each admin can make 60 requests per 10
minutes.

## Setting it up

1. At platform.openai.com, create an API key (API keys) and set a monthly spending limit
   (Billing > Limits).
2. In `deploy/.env` on the server:

   ```
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-5-mini
   ```

3. Restart the API: `docker compose -f deploy/docker-compose.yml up -d api`.

Leaving `OPENAI_API_KEY` empty switches the assistant off: no buttons appear, and saved
summaries stay in the downloads. You can change `OPENAI_MODEL` to any chat model your
account offers. Optional: `OPENAI_BASE_URL` and `OPENAI_TIMEOUT_MS` (default 45000).

## Check before sharing

The assistant can be wrong. A summary is labelled "written by AI from the figures" wherever it
appears. Check its numbers against the figures, and check the names, dates and links in
suggested wording, before you send or share them.
