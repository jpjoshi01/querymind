# QueryMind

QueryMind is a local AI assistant for SQL and NoSQL work. It can optimize queries, explain execution plans, compare query versions, recommend indexes, generate sample data, analyze reports, and answer database questions.

## API key storage

QueryMind does not ship with an API key and does not store API keys in the browser.

On first launch, each user chooses an AI provider and enters their own API key. The backend saves that key in the user's operating-system credential store through `keytar`. On Windows, that means Windows Credential Manager.

The saved key is per Windows user account and per machine. Another laptop or another Windows user account must enter its own key.

## 1. Install dependencies

```bash
npm install
```

## 2. Optional local config

`.env` is optional. It is only used for model overrides and the local port.

```bash
copy .env.example .env
```

Do not put API keys in `.env`.

## 3. Run as a website

```bash
node server.js
```

Open:

```text
http://localhost:3000/querymind.html
```

The first time you open it, QueryMind asks for:

- AI provider
- API key

## 4. Run as a desktop app

```bash
npm start
```

Electron starts the local backend and opens QueryMind.

## 5. Build Windows installer

```bash
npm run build
```

The installer is created in:

```text
dist/QueryMind-Setup.exe
```

Share that installer with users. They do not need your `.env` file or your API key. After installing, each user enters their own provider key once.

## Notes

- `.env` is excluded from the installer.
- The Electron window uses the normal Windows frame, so minimize, maximize, and close buttons are available.
- The app needs internet access to call the selected AI provider.
- The Oracle TNS connection feature has been removed for now. Paste safe schema snippets, execution plans, or query text manually into QueryMind.
