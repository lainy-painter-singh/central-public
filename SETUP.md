# Central — Setup Guide

Central is a deal flow and portfolio management desktop app built with Electron + React.

## Prerequisites

- Node.js 18+
- macOS (the app is built for Mac)
- A Google account (for Calendar and Gmail integration)
- An OpenAI API key (for deal sharing summaries)
- A Granola account (optional, for meeting notes)

## 1. Clone and install

```bash
git clone https://github.com/lainy-painter-singh/central
cd central
npm install
```

## 2. Set up your config files

Central uses three local markdown files for your firm-specific data. These are gitignored — you create them once from the templates.

### Portfolio holdings

```bash
cp PORTFOLIO.template.md PORTFOLIO.md
```

Open `PORTFOLIO.md` and replace the example rows with your actual portfolio companies. The format is:

```
| # | Company Name | Fund I, Fund II | $100.0M |
```

The app uses this to filter out existing portfolio companies from the live deals view.

**Tip:** Ask Claude to help you convert a spreadsheet or CSV export into this format:
> "Convert this CSV of portfolio holdings into the table format in PORTFOLIO.template.md"

### Deal sharing format

```bash
cp DEAL_SHARING_FORMAT.template.md DEAL_SHARING_FORMAT.md
```

Edit `DEAL_SHARING_FORMAT.md` to match your firm's preferred style for writing up deals. The app uses this as a prompt when generating deal summaries from meeting notes.

**Tip:** If your firm already has a deal memo style guide, paste it into Claude:
> "Rewrite this style guide in the format of DEAL_SHARING_FORMAT.template.md"

### Connector watch (optional)

```bash
cp CONNECTORS.template.md CONNECTORS.md
```

This is a personal notes file for tracking MCP integrations. Edit or ignore as needed.

## 3. Set up credentials

Create a `.env` file in the root:

```bash
cp .env.example .env
```

Fill in:

```
OPENAI_API_KEY=sk-...
```

For Google OAuth, add your credentials to `config/credentials.json` (see `config/credentials.example.json`).

## 4. Run the app

```bash
npm run dev
```

## 5. Customize with Claude Code

Central was built entirely in Claude Code. To customize it for your workflow, open the project in Claude Code and describe what you want:

- "Add a field for [your firm's custom deal attribute]"
- "Change the deal stages to match our pipeline: [your stages]"
- "Add a view that shows deals by [your criteria]"
- "Connect to [your CRM] using its API"

The codebase is straightforward Electron + React + SQLite. Claude Code handles it well.
