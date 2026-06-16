# QueryMind Setup

## 1. Install dependencies
```
npm install
```
(If you don't need Oracle/TNS support, you can remove `oracledb` from package.json before installing.)

## 2. Configure environment
```
cp .env.example .env
```
Edit `.env` and fill in whichever LLM keys you have (ANTHROPIC_API_KEY, OPENAI_API_KEY, KIMI_API_KEY).
You don't need all three — the LLM dropdown will show which providers are configured.

For Oracle TNS connectivity, set `TNS_ADMIN` to the directory containing your `tnsnames.ora`.

## 3. Run
```
node server.js
```
Then open http://localhost:3000/querymind.html

## What changed
- Added an LLM dropdown (Claude / OpenAI / Kimi) in the top bar.
- Removed the browser API-key prompt entirely — `server.js` proxies all AI calls
  using keys from `.env`, so end users never need their own key.
- Added a "DB Connection (TNS)" page to test Oracle connections via a TNS alias
  and run queries against company databases.
