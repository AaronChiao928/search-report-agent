# Learning guide

How to read this codebase so you can explain every design choice. Budget about three hours. Open the folder in VS Code and keep a terminal open.

## 0. Set up (10 min)

```bash
npm install
npm test
npm run check
```

`npm run check` prints exactly what the agent will be told about the demo data before any AI runs. Keep this output open; you'll recognise each part as you read.

## 1. Follow the data (45 min)

Read in pipeline order. For each file, answer the question before moving on.

| Order | File | Question to answer |
|---|---|---|
| 1 | `src/metrics.js` | Why are ratios (CTR, CPA…) never stored, only rebuilt from base metrics? |
| 2 | `src/dataset.js` | How is the previous period's value rebuilt from a % change? Why is "No data" `null` and not `0`? |
| 3 | `src/checks.js` | What happens when categories don't add up to the market? Why does the Unallocated scope make every market change fully explainable? |
| 4 | `src/calc.js` | Work the rate/mix formula by hand for one category. Why do the effects add up exactly? |
| 5 | `src/rules.js` | Read each role rule aloud in business language. Which constant would you change to make roles stricter? |

Exercise: copy `data/demo-clean.csv`, double Knives' cost and its % change, run `node src/cli.js check <your copy>`, and predict which roles change (and what the data check says) before you look.

## 2. Follow the agent (45 min)

| Order | File | Question to answer |
|---|---|---|
| 6 | `src/facts.js` | What does `"-15.0% [F4]"` let us do later? Why does "15%" in a draft still match "-15.0%"? |
| 7 | `src/tools.js` | Pick one tool. What does the model see, and what can't it do with it? Why return errors instead of failing? |
| 8 | `src/prompts.js` | Which rules came from the business (structure, wording) and which exist to protect accuracy? |
| 9 | `src/agent.js` | Trace one loop: request → `stop_reason: "tool_use"` → run tools → `tool_result` → repeat. Where is the guardrail against an endless loop? |
| 10 | `test/agent.test.js` | The fake client plays Claude's part. This is the clearest picture of the protocol. |

Exercise: in `test/agent.test.js`, make the fake agent write a role that matches the rules exactly, and check the flag disappears.

## 3. Follow the review (30 min)

| Order | File | Question to answer |
|---|---|---|
| 11 | `src/review.js` | List every flag and the failure it catches. Why are recommendations approved one by one? |
| 12 | `src/extract.js` | How does recomputing the dashboard's ratios catch a misread number? Why is the tolerance tied to display precision? |
| 13 | `src/cli.js` | How the pieces connect. |

Exercise: run `npm run analyse` with an API key, then open `out/review.md` next to `out/report.md`.

## 4. Be ready to explain (30 min)

Practise answering these out loud, in two or three sentences each:

1. Why doesn't the model do any maths?
2. What would have gone wrong with the real dataset where categories covered only 80% of the previous period?
3. How do you know a number in the draft is right?
4. Why are roles judged on change and not on level?
5. What would you change to deploy this on the company's model platform? (DESIGN.md §12)
6. What can still go wrong? (DESIGN.md §8 and §13)
7. Which parts would you reuse for a different report, such as a Close Out Report?
