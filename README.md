# git-insights-wheelhouse

A [Wheelhouse](https://github.com/chrisjowen/wheelhouse) plugin that adds an **Insights** tab to each project, built from the project clone's git history and, when the clone's `origin` is on GitHub, from GitHub. It shows who is working on the project, its latest commits, the files that change most, open pull requests and a few figures. The data is read again every hour.

## Install

```sh
wheelhouse plugin install chrisjowen/git-insights-wheelhouse
```

Or use **Settings → Plugins → Install plugin** with `chrisjowen/git-insights-wheelhouse`. Installing shows what the plugin adds, asks for its settings (Enter takes each default) and restarts Wheelhouse to load it.

## Turn it on

The plugin is off until you turn it on. Go to **Settings → Plugins → Git insights** and turn it on for every project, or only for the projects you choose. Each project then gets an **Insights** tab beside its name, at `/projects/<project>/git-insights/insights`.

## What it shows

The tab opens on a period (30 days unless you change the setting) and has a **7 / 30 / 90 days** switch. From top to bottom:

- **A summary sentence**, such as "142 commits from 6 people in the last 30 days, 18 pull requests merged and 5 open".
- **When it was read**, such as "Updated 23 minutes ago · reads again every hour".
- **Four figures**:
  - commits, with a small chart of commits per day (per week over 90 days);
  - open pull requests and how many were merged;
  - the typical (median) time from opening a pull request to merging it;
  - open issues, with how many were opened and closed in the period.
- **Open pull requests**, waiting longest first, each with its review state (waiting for review, changes asked for, approved, draft) and its checks (passing, failing, running).
- **People**: who committed in the period, how many commits each made, the parts of the repository they worked in, a small activity line and when they last committed.
- **Latest commits** on the default branch, each with its author, size and age.
- **Hotspots**: the files changed most often in the period, with who changes them.
- **Also**: the latest release, open issues and when the oldest was opened, the last commit, and anyone whose first commit falls in the period.

Every row opens in place for more:

- a pull request's author, size, reviewers and a link to it;
- a person's lines changed and recent commits;
- a commit's files;
- a hotspot's changes and the commits that touched it.

Five rows show until you click **Show all**. The tab follows Wheelhouse's light and dark themes.

When the clone has no GitHub remote, the tab says so plainly. It then shows what the clone alone can tell: files changed, lines and the busiest day. When GitHub can't be read (for example `gh` isn't signed in, or GitHub is slow), the tab says why and still shows the history. If GitHub was read successfully before, the tab keeps that data and marks it as older.

## How it stays fresh

Reading a busy repository takes a second or two, so the plugin never reads on every page view. It keeps one snapshot per project, and reads again only once the snapshot is older than the refresh interval (60 minutes by default). Wheelhouse serves the last snapshot while a new read runs, so the page doesn't wait.

Wheelhouse asks plugins for data only when a page needs it. So a project nobody opens is read again the next time someone opens it, and the tab always says how old its figures are. If a read fails, the tab keeps showing the last snapshot, says the read failed, and tries again a few minutes later.

The tab has no "Refresh now" button: Wheelhouse doesn't yet let a plugin's tab ask for its data to be read again. Lowering **Read again every** makes the data fresher.

## Settings

Change these on the plugin's page in **Settings → Plugins**, or under `plugins["git-insights"].settings` in Wheelhouse's `plugins.json`. They apply without a restart.

| Setting                    | Key              | Default    | What it does                                                                                                     |
| -------------------------- | ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Read again every (minutes) | `refreshMinutes` | `60`       | How old the figures may get before the plugin reads again; at least 5, at most 1440.                             |
| Period shown first         | `defaultDays`    | `30`       | How far back people, hotspots and the figures look when the tab opens (`7`, `30` or `90`); the tab can switch.   |
| Files left out of hotspots | `hotspotIgnore`  | lock files | File names (`*` matches any part of a name), paths, or folders ending in `/`, such as `dist/` or `*.min.js`.     |
| Count bots                 | `includeBots`    | `true`     | Whether commits and pull requests from bots such as Dependabot count.                                            |

## What it reads

The plugin is read-only: it changes nothing in the clone or on GitHub. Every command runs through Wheelhouse's plugin context (an argument list with no shell, a minimal environment, and bounded time and output), in the project's clone:

- `git symbolic-ref` and `git remote get-url origin`, to find the default branch and the GitHub repository;
- `git log --numstat` for the last 90 days of the default branch (at most 5000 commits; merge commits are left out), to get who, when, the subject and the files and line counts each commit changed;
- `git log -1`, for the date of the last commit;
- `git shortlog -s`, to tell who committed before the period began;
- `gh api graphql`, one read-only query when `origin` is on GitHub. It reads the open pull requests (title, author, dates, size, review decision, requested reviewers and checks state), counts of merged pull requests and of issues opened and closed, the open issue count and the oldest open issue, and the latest releases. It never reads issue or pull request bodies.

It uses the `gh` you are signed in with (`gh auth login`); nothing else is needed. The snapshot is kept in Wheelhouse's memory only, so it is read afresh after Wheelhouse restarts.

## Development

```sh
npm install
npm run lint   # eslint and prettier
npm test       # node --test
```

The plugin has no runtime dependencies and no build step. Wheelhouse imports `wheelhouse/server/index.js` and serves `wheelhouse/ui/index.js` to the page as they are. Development dependencies are used only for linting and tests.

- `.wheelhouse-plugin/plugin.json`: the manifest.
- `wheelhouse/server/collect.js`: reads git and GitHub and counts.
- `wheelhouse/server/index.js`: the provider and its snapshot store.
- `wheelhouse/ui/index.js`: the `git-insights-tab` element.

## Licence

MIT
